// =========================
// CONFIGURAÇÃO SUPABASE
// =========================
const SUPABASE_URL = "https://cmxepgkkdvyfraesvqly.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGVwZ2trZHZ5ZnJhZXN2cWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3ODA2NDksImV4cCI6MjA4MDM1NjY0OX0.rQMjA0pyJ2gWvPlyuQr0DccdkUs24NQTdsQvgiN2QXY";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserProfile = null;
let currentSession = null;

let demandasCache = [];
let usuariosCache = [];
let clientesCache = [];

let tagsAtuais = [];

let filtrosAtuais = {
  buscaTexto: "",
  ocultarConcluidas: false,
  consultarTodas: false,
  status: "TODOS",
  atendente: "TODOS",
  programador: "TODOS",
  municipio: "TODOS",
  estado: "TODOS",
  tipoEntidade: "TODOS",
};

// =========================
// UTILITÁRIOS
// =========================
function byId(id){ return document.getElementById(id); }
function setText(id, text){ const el = byId(id); if(el) el.textContent = text; }
function show(id){ const el = byId(id); if(el) el.classList.remove("hidden"); }
function hide(id){ const el = byId(id); if(el) el.classList.add("hidden"); }

function formatarDataHoraBr(dateStr){
  if(!dateStr) return "";
  const d = new Date(dateStr);
  if(isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("pt-BR");
}

function validarSenhaSimples(senha){
  return /^[A-Za-z0-9]{1,10}$/.test(senha);
}

// =========================
// PERFIS (CORREÇÃO DEFINITIVA)
// =========================
function tipoPerfil(){
  return (currentUserProfile?.tipo || "").toString().trim().toUpperCase();
}
function ehGestor(){ return tipoPerfil() === "GESTOR"; }
function ehSuporte(){ return tipoPerfil() === "SUPORTE"; }
function ehProgramador(){ return tipoPerfil() === "PROGRAMADOR"; }

// =========================
// STATUS
// =========================
function setStatusBar(texto){ setText("status-bar", texto); }
function setStatusClientes(texto){ setText("status-clientes", texto); }

// =========================
// PERMISSÕES DEMANDA
// =========================
function podeEditarOuExcluirDemanda(d){
  if(!currentUserProfile || !d) return false;
  if(ehGestor()) return true;
  if(ehSuporte() && d.user_id === currentUserProfile.id) return true;
  return false;
}

function podeEncaminharDemanda(d){
  if(!currentUserProfile || !d) return false;
  if(ehGestor()) return true;
  if(ehSuporte() && d.user_id === currentUserProfile.id) return true;
  return false;
}

// =========================
// PERMISSÕES ATUALIZAÇÃO
// =========================
function podeEditarOuExcluirAtualizacao(a){
  if(!currentUserProfile || !a) return false;
  if(ehGestor()) return true;
  return a.usuario_id === currentUserProfile.id;
}

// =========================
// AUTH
// =========================
async function inicializarApp(){
  registrarListeners();

  const { data, error } = await supabaseClient.auth.getSession();
  if(error) console.error("Erro ao obter sessão:", error);
  currentSession = data?.session || null;

  if(currentSession){
    await carregarPerfilUsuarioAtual();
    currentUserProfile ? mostrarApp() : mostrarTelaAuth();
  } else {
    mostrarTelaAuth();
  }
}

function mostrarTelaAuth(){
  show("auth-container");
  hide("app-container");
  setText("auth-status", "Informe seus dados para entrar ou se cadastrar.");
}

function ajustarInterfacePorPerfil(){
  const ajudaEl = byId("ajuda-perfil");

  // Painel gestor
  ehGestor() ? show("sec-painel-gestor") : hide("sec-painel-gestor");

  // Clientes + Cadastro demanda para Gestor/Suporte
  (ehGestor() || ehSuporte()) ? show("sec-clientes") : hide("sec-clientes");
  (ehGestor() || ehSuporte()) ? show("sec-cadastro-demanda") : hide("sec-cadastro-demanda");

  if(ehProgramador()){
    ajudaEl.textContent = "Perfil Programador: registre andamentos das demandas.";
  } else if(ehSuporte()){
    ajudaEl.textContent = "Perfil Suporte: cadastre e gerencie demandas.";
  } else if(ehGestor()){
    ajudaEl.textContent = "Perfil Gestor: visão completa e gestão.";
  }
}

function mostrarApp(){
  hide("auth-container");
  show("app-container");

  setText(
    "user-label",
    `${currentUserProfile.nome} (${tipoPerfil()} · ${currentUserProfile.unidade || "-"})`
  );

  ajustarInterfacePorPerfil();
  carregarUsuariosParaEncaminhar();
  carregarClientes();
  carregarDemandas();

  if(ehGestor()){
    carregarUsuariosGestor();
  }
}

// =========================
// PERFIL USUÁRIO
// =========================
async function carregarPerfilUsuarioAtual(){
  const { data } = await supabaseClient.auth.getUser();
  if(!data?.user) return;

  const { data: perfil, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .eq("id", data.user.id)
    .single();

  if(error || !perfil){
    currentUserProfile = null;
    return;
  }

  if((perfil.status || "").toUpperCase() !== "ATIVO"){
    await supabaseClient.auth.signOut();
    currentUserProfile = null;
    mostrarTelaAuth();
    return;
  }

  currentUserProfile = perfil;
}

// =========================
// CADASTRO NOVO USUÁRIO
// =========================
async function cadastrarNovoUsuario(){
  const nome = byId("cad-nome").value.trim().toUpperCase();
  const email = byId("cad-email").value.trim().toLowerCase();
  const dtNasc = byId("cad-dt-nasc").value;
  const unidade = byId("cad-unidade").value;
  const tipo = byId("cad-tipo").value;
  const senha = byId("cad-senha").value;
  const senha2 = byId("cad-senha2").value;

  if(!nome || !email || !dtNasc || !unidade || !tipo || !senha || !senha2){
    setText("auth-status", "Preencha todos os campos.");
    return;
  }
  if(!validarSenhaSimples(senha)){
    setText("auth-status", "Senha deve ter até 10 caracteres (letras/números).");
    return;
  }
  if(senha !== senha2){
    setText("auth-status", "Senhas não conferem.");
    return;
  }

  setText("auth-status", "Cadastrando...");

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password: senha,
  });

  if(error){
    console.error("Erro signUp:", error);
    setText("auth-status", "Erro: " + error.message);
    return;
  }

  const userId = data?.user?.id;
  if(!userId){
    setText("auth-status", "Erro: não foi possível obter o ID do usuário.");
    return;
  }

  const { error: errIns } = await supabaseClient.from("usuarios").insert({
    id: userId,
    nome,
    email,
    data_nascimento: dtNasc,
    unidade,
    tipo: tipo.toUpperCase(),
    status: "PENDENTE",
  });

  if(errIns){
    console.error("Erro inserir perfil:", errIns);
    setText("auth-status", "Erro ao criar perfil: " + errIns.message);
    return;
  }

  setText("auth-status", "Cadastro enviado! Aguarde aprovação do gestor.");
}

// =========================
// LOGIN / LOGOUT
// =========================
async function login(){
  const email = byId("login-email").value.trim().toLowerCase();
  const senha = byId("login-senha").value;

  if(!email || !senha){
    setText("auth-status", "Informe email e senha.");
    return;
  }

  setText("auth-status", "Entrando...");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
  if(error){
    console.error("Erro login:", error);
    setText("auth-status", "Erro ao autenticar: " + error.message);
    return;
  }

  currentSession = data?.session || null;
  await carregarPerfilUsuarioAtual();
  if(!currentUserProfile){
    setText("auth-status", "Usuário não aprovado ou perfil inexistente.");
    return;
  }

  mostrarApp();
}

async function logout(){
  await supabaseClient.auth.signOut();
  currentSession = null;
  currentUserProfile = null;
  mostrarTelaAuth();
}

// =========================
// CLIENTES (AGORA COM MUNICÍPIO / SEM CONTATO)
// =========================
async function carregarClientes(){
  const { data, error } = await supabaseClient
    .from("clientes")
    .select("*")
    .order("cliente", { ascending: true });

  if(error){
    console.error("Erro ao carregar clientes:", error);
    return;
  }
  clientesCache = data || [];
  renderizarTabelaClientes();
  popularSelectClienteDemanda();
  popularFiltrosCliente();
}

function renderizarTabelaClientes(){
  const tbody = byId("tb-clientes");
  if(!tbody) return;
  tbody.innerHTML = "";

  clientesCache.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.cliente || ""}</td>
      <td>${(c.tipo_entidade || c.tipo || "")}</td>
      <td>${c.estado || ""}</td>
      <td>${c.municipio || ""}</td>
      <td>${c.telefone || ""}</td>
      <td class="actions">
        <button class="btn ghost" data-act="edit" data-id="${c.id}">Editar</button>
        <button class="btn danger" data-act="del" data-id="${c.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-act='edit']").forEach(b => {
    b.addEventListener("click", () => editarCliente(b.dataset.id));
  });
  tbody.querySelectorAll("button[data-act='del']").forEach(b => {
    b.addEventListener("click", () => excluirCliente(b.dataset.id));
  });
}

function popularSelectClienteDemanda(){
  const sel = byId("dem-cliente");
  if(!sel) return;

  sel.innerHTML = `<option value="">Selecione</option>`;
  clientesCache.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.cliente;
    opt.dataset.tipo_entidade = (c.tipo_entidade || c.tipo || "");
    opt.dataset.estado = c.estado || "";
    opt.dataset.municipio = c.municipio || "";
    opt.dataset.telefone = c.telefone || "";
    sel.appendChild(opt);
  });
}

function popularFiltrosCliente(){
  // Mantém filtros já existentes no seu projeto (municipio/estado/tipoEntidade)
  const selMun = byId("filtro-municipio");
  const selEst = byId("filtro-estado");
  const selTipoEnt = byId("filtro-tipo-entidade");

  if(selMun){
    const set = new Set(clientesCache.map(c => (c.municipio || "").trim()).filter(Boolean));
    selMun.innerHTML = `<option value="TODOS">Todos</option>` + [...set].sort().map(v=>`<option>${v}</option>`).join("");
  }
  if(selEst){
    const set = new Set(clientesCache.map(c => (c.estado || "").trim()).filter(Boolean));
    selEst.innerHTML = `<option value="TODOS">Todos</option>` + [...set].sort().map(v=>`<option>${v}</option>`).join("");
  }
  if(selTipoEnt){
    const set = new Set(clientesCache.map(c => (c.tipo_entidade || c.tipo || "").trim()).filter(Boolean));
    selTipoEnt.innerHTML = `<option value="TODOS">Todos</option>` + [...set].sort().map(v=>`<option>${v}</option>`).join("");
  }
}

async function salvarCliente(e){
  e.preventDefault();
  if(!(ehGestor() || ehSuporte())){
    alert("Apenas Gestor ou Suporte podem cadastrar clientes.");
    return;
  }

  const cliente = byId("cli-nome").value.trim().toUpperCase();
  const estado = byId("cli-estado").value;
  const municipio = (byId("cli-municipio") ? byId("cli-municipio").value : "").trim().toUpperCase();
  const telefone = byId("cli-telefone").value.trim();
  const tipoEntidade = byId("cli-tipo").value;

  if(!cliente || !estado || !municipio || !telefone || !tipoEntidade){
    alert("Preencha Cliente, Tipo Entidade, Estado, Município e Telefone.");
    return;
  }

  setStatusClientes("Salvando cliente...");

  const payload = {
    cliente,
    tipo_entidade: tipoEntidade,
    estado,
    municipio,
    telefone,
  };

  const { error } = await supabaseClient.from("clientes").insert(payload);

  if(error){
    console.error("Erro ao salvar cliente:", error);
    setStatusClientes("Erro: " + error.message);
    alert("Erro ao salvar cliente: " + error.message);
    return;
  }

  byId("form-cliente").reset();
  setStatusClientes("Cliente salvo com sucesso!");
  await carregarClientes();
}

async function editarCliente(clienteId){
  const c = clientesCache.find(x => x.id === clienteId);
  if(!c) return;

  const novoCliente = prompt("Cliente:", c.cliente || "");
  if(novoCliente === null) return;

  const novoTipoEntidade = prompt("Tipo Entidade (ex: CM, PM, AUTARQUIA, IPM, CONSORCIO):", (c.tipo_entidade || c.tipo || ""));
  if(novoTipoEntidade === null) return;

  const novoEstado = prompt("Estado:", c.estado || "");
  if(novoEstado === null) return;

  const novoMunicipio = prompt("Município:", c.municipio || "");
  if(novoMunicipio === null) return;

  const novoTelefone = prompt("Telefone:", c.telefone || "");
  if(novoTelefone === null) return;

  if(!novoCliente.trim() || !novoTipoEntidade.trim() || !novoEstado.trim() || !novoMunicipio.trim() || !novoTelefone.trim()){
    alert("Preencha todos os campos obrigatórios.");
    return;
  }

  const { error } = await supabaseClient.from("clientes").update({
    cliente: novoCliente.trim().toUpperCase(),
    tipo_entidade: novoTipoEntidade.trim().toUpperCase(),
    estado: novoEstado.trim(),
    municipio: novoMunicipio.trim().toUpperCase(),
    telefone: novoTelefone.trim()
  }).eq("id", clienteId);

  if(error){
    console.error("Erro ao editar cliente:", error);
    alert("Erro ao editar cliente: " + error.message);
    return;
  }

  await carregarClientes();
}

async function excluirCliente(clienteId){
  if(!confirm("Excluir este cadastro de cliente?")) return;

  const { error } = await supabaseClient.from("clientes").delete().eq("id", clienteId);
  if(error){
    console.error("Erro ao excluir cliente:", error);
    alert("Erro ao excluir cliente: " + error.message);
    return;
  }

  await carregarClientes();
}

// =========================
// USUÁRIOS PARA ENCAMINHAR
// =========================
async function carregarUsuariosParaEncaminhar(){
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("id,nome,tipo,status")
    .eq("status", "ATIVO")
    .order("nome", { ascending:true });

  if(error){
    console.error("Erro ao carregar usuários:", error);
    return;
  }

  usuariosCache = data || [];
  popularSelectEncaminhar();
  popularSelectProgramador();
}

function popularSelectProgramador(){
  const selProg = byId("dem-programador");
  if(!selProg) return;

  selProg.innerHTML = `<option value="">(não definido)</option>`;
  usuariosCache
    .filter(u => (u.tipo || "").toUpperCase() === "PROGRAMADOR")
    .forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.nome;
      opt.textContent = u.nome;
      selProg.appendChild(opt);
    });
}

function popularSelectEncaminhar(){
  const sel = byId("sel-encaminhar-usuario");
  if(!sel) return;

  sel.innerHTML = `<option value="">Selecione</option>`;
  usuariosCache.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = `${u.nome} (${(u.tipo || "").toUpperCase()})`;
    opt.dataset.tipo = (u.tipo || "").toUpperCase();
    opt.dataset.nome = u.nome;
    sel.appendChild(opt);
  });
}

// =========================
// DEMANDAS
// =========================
async function gerarCodigoDemanda(){
  const ano = new Date().getFullYear();
  const prefixo = `D${ano}-`;

  const { data, error } = await supabaseClient
    .from("demandas")
    .select("codigo")
    .like("codigo", `${prefixo}%`)
    .order("codigo", { ascending:false })
    .limit(1);

  if(error){
    console.error("Erro ao gerar código:", error);
    return `${prefixo}00001`;
  }

  const ultimo = data?.[0]?.codigo || `${prefixo}00000`;
  const partes = ultimo.split("-");
  let num = parseInt(partes[1], 10) || 0;
  num++;
  return `${prefixo}${String(num).padStart(5, "0")}`;
}

function renderizarTags(){
  const cont = byId("tags-container");
  if(!cont) return;
  cont.innerHTML = "";

  tagsAtuais.forEach((t, idx) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = t;

    const x = document.createElement("button");
    x.type = "button";
    x.className = "chip-x";
    x.textContent = "×";
    x.addEventListener("click", () => {
      tagsAtuais.splice(idx, 1);
      renderizarTags();
    });

    chip.appendChild(x);
    cont.appendChild(chip);
  });
}

async function salvarDemanda(e){
  e.preventDefault();

  if(!(ehGestor() || ehSuporte())){
    alert("Apenas Gestor ou Suporte podem cadastrar demandas.");
    return;
  }

  // Município e Tipo Entidade vêm do cadastro de clientes (campos podem estar readonly)
  const municipio = (byId("dem-municipio")?.value || "").trim().toUpperCase();
  const tipoEntidade = (byId("dem-tipo-entidade")?.value || "").trim().toUpperCase();
  const assunto = byId("dem-assunto").value.trim().toUpperCase();
  const descricao = byId("dem-descricao").value.trim();
  const programador = byId("dem-programador").value.trim();
  const formaAtendimento = byId("dem-forma-atendimento").value.trim();
  const prioridade = byId("dem-prioridade").value;
  const statusDemanda = byId("dem-status").value;

  const linkTrello = byId("dem-link-trello").value.trim();
  const linkEmail = byId("dem-link-email").value.trim();

  const clienteId = byId("dem-cliente").value;
  const cliSel = clientesCache.find(c => c.id === clienteId);

  if(!cliSel){
    alert("Selecione um cliente cadastrado.");
    return;
  }
  if(!assunto || !descricao){
    alert("Informe Assunto e Descrição.");
    return;
  }

  setStatusBar("Salvando demanda...");

  const codigo = await gerarCodigoDemanda();

  const payload = {
    user_id: currentUserProfile.id,
    codigo,

    municipio: (cliSel.municipio || municipio || null),
    tipo_entidade: (cliSel.tipo_entidade || cliSel.tipo || tipoEntidade || null),

    cliente_id: cliSel.id,
    cliente_nome: cliSel.cliente,
    cliente_tipo_entidade: (cliSel.tipo_entidade || cliSel.tipo || null),
    cliente_estado: cliSel.estado,
    cliente_municipio: (cliSel.municipio || null),
    cliente_telefone: cliSel.telefone,

    assunto,
    descricao,
    programador: programador || null,
    encaminhar_para: null,
    forma_atendimento: formaAtendimento || null,

    tags: tagsAtuais || [],
    prioridade,
    status: statusDemanda,

    link_trello: linkTrello || null,
    link_email: linkEmail || null,
  };

  const { error } = await supabaseClient.from("demandas").insert(payload);

  if(error){
    console.error("Erro ao salvar demanda:", error);
    setStatusBar("Erro ao salvar demanda: " + error.message);
    alert("Erro ao salvar demanda: " + error.message);
    return;
  }

  byId("form-demanda").reset();
  tagsAtuais = [];
  renderizarTags();

  setStatusBar("Demanda salva com sucesso!");
  await carregarDemandas();
}

async function carregarDemandas(){
  setStatusBar("Carregando demandas...");

  const { data, error } = await supabaseClient
    .from("demandas")
    .select("*")
    .order("created_at", { ascending:false });

  if(error){
    console.error("Erro ao carregar demandas:", error);
    setStatusBar("Erro ao carregar demandas: " + error.message);
    return;
  }

  const todas = data || [];
  demandasCache = todas;

  aplicarFiltrosERenderizar();
  setStatusBar(`${demandasCache.length} demandas carregadas.`);
}

function aplicarFiltrosERenderizar(){
  let arr = [...demandasCache];

  // Regras de visibilidade (programador só vê as dele; suporte padrão só as dele; gestor vê tudo)
  if(!ehGestor()){
    if(ehProgramador()){
      arr = arr.filter(d => (d.programador || "") === (currentUserProfile.nome || ""));
    } else if(ehSuporte() && !filtrosAtuais.consultarTodas){
      arr = arr.filter(d => d.user_id === currentUserProfile.id);
    }
  }

  if(filtrosAtuais.ocultarConcluidas){
    arr = arr.filter(d => (d.status || "").toUpperCase() !== "CONCLUIDA");
  }

  if(filtrosAtuais.status && filtrosAtuais.status !== "TODOS"){
    arr = arr.filter(d => (d.status || "") === filtrosAtuais.status);
  }
  if(filtrosAtuais.atendente && filtrosAtuais.atendente !== "TODOS"){
    arr = arr.filter(d => (d.atendente || "") === filtrosAtuais.atendente);
  }
  if(filtrosAtuais.programador && filtrosAtuais.programador !== "TODOS"){
    arr = arr.filter(d => (d.programador || "") === filtrosAtuais.programador);
  }
  if(filtrosAtuais.municipio && filtrosAtuais.municipio !== "TODOS"){
    arr = arr.filter(d => (d.municipio || d.cliente_municipio || "") === filtrosAtuais.municipio);
  }
  if(filtrosAtuais.estado && filtrosAtuais.estado !== "TODOS"){
    arr = arr.filter(d => (d.cliente_estado || "") === filtrosAtuais.estado);
  }
  if(filtrosAtuais.tipoEntidade && filtrosAtuais.tipoEntidade !== "TODOS"){
    arr = arr.filter(d => (d.tipo_entidade || d.cliente_tipo_entidade || "") === filtrosAtuais.tipoEntidade);
  }

  const txt = (filtrosAtuais.buscaTexto || "").trim().toUpperCase();
  if(txt){
    arr = arr.filter(d => {
      const s = [
        d.codigo, d.cliente_nome, d.assunto, d.descricao,
        d.programador, d.forma_atendimento,
        (d.tags || []).join(" "),
        d.link_trello, d.link_email
      ].join(" ").toUpperCase();
      return s.includes(txt);
    });
  }

  renderizarTabelaDemandas(arr);
}

function renderizarTabelaDemandas(lista){
  const tb = byId("tb-demandas");
  if(!tb) return;
  tb.innerHTML = "";

  lista.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.codigo || ""}</td>
      <td>${d.cliente_nome || ""}</td>
      <td>${(d.tipo_entidade || d.cliente_tipo_entidade || "")}</td>
      <td>${(d.municipio || d.cliente_municipio || "")}</td>
      <td>${d.assunto || ""}</td>
      <td><span class="badge status">${d.status || ""}</span></td>
      <td class="actions">
        <button class="btn ghost" data-act="open" data-id="${d.id}">Detalhes</button>
        ${(podeEditarOuExcluirDemanda(d) ? `<button class="btn danger" data-act="del" data-id="${d.id}">Excluir</button>` : "")}
      </td>
    `;
    tb.appendChild(tr);
  });

  tb.querySelectorAll("button[data-act='open']").forEach(b => {
    b.addEventListener("click", () => abrirModalDemanda(b.dataset.id));
  });
  tb.querySelectorAll("button[data-act='del']").forEach(b => {
    b.addEventListener("click", () => excluirDemanda(b.dataset.id));
  });
}

async function excluirDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(filtrosAtuais.consultarTodas && !ehGestor()){
    alert("Modo 'Consultar todas' é somente leitura para não-gestor.");
    return;
  }

  if(!podeEditarOuExcluirDemanda(d)){
    alert("Você não tem permissão para excluir esta demanda.");
    return;
  }

  const ok = confirm(`Excluir a demanda ${d.codigo}? (ação permanente)`);
  if(!ok) return;

  const { error } = await supabaseClient.from("demandas").delete().eq("id", demandaId);
  if(error){
    console.error("Erro ao excluir demanda:", error);
    alert("Erro ao excluir demanda: " + error.message);
    return;
  }

  await carregarDemandas();
}

async function editarDemanda(){
  const demandaId = byId("det-demanda-id").value;
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(filtrosAtuais.consultarTodas && !ehGestor()){
    alert("Modo 'Consultar todas' é somente leitura para não-gestor.");
    return;
  }

  if(!podeEditarOuExcluirDemanda(d)){
    alert("Você não tem permissão para editar esta demanda.");
    return;
  }

  const novoAssunto = prompt("Assunto:", d.assunto || "");
  if(novoAssunto === null) return;

  const novaDesc = prompt("Descrição:", d.descricao || "");
  if(novaDesc === null) return;

  const novoProg = prompt("Programador (nome) ou vazio:", d.programador || "");
  if(novoProg === null) return;

  const novaForma = prompt("Forma de Atendimento:", d.forma_atendimento || "");
  if(novaForma === null) return;

  const novaPrioridade = prompt("Prioridade (Baixa/Média/Alta):", d.prioridade || "Média");
  if(novaPrioridade === null) return;

  const novoStatus = prompt("Status (ABERTA/EM ANDAMENTO/ENCAMINHADA/CONCLUIDA):", d.status || "ABERTA");
  if(novoStatus === null) return;

  const novoLinkTrello = prompt("Link Trello:", d.link_trello || "");
  if(novoLinkTrello === null) return;

  const novoLinkEmail = prompt("Link Email:", d.link_email || "");
  if(novoLinkEmail === null) return;

  const { error } = await supabaseClient.from("demandas").update({
    assunto: novoAssunto.trim().toUpperCase(),
    descricao: novaDesc.trim(),
    programador: (novoProg.trim() || null),
    forma_atendimento: (novaForma.trim() || null),
    prioridade: novaPrioridade,
    status: novoStatus,
    link_trello: (novoLinkTrello.trim() || null),
    link_email: (novoLinkEmail.trim() || null),
    updated_at: new Date().toISOString(),
  }).eq("id", demandaId);

  if(error){
    console.error("Erro ao editar demanda:", error);
    alert("Erro ao editar demanda: " + error.message);
    return;
  }

  await carregarDemandas();
  await abrirModalDemanda(demandaId);
}

// =========================
// MODAL DETALHES DEMANDA
// =========================
async function abrirModalDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  show("modal-overlay");
  show("modal-detalhes");

  byId("det-demanda-id").value = d.id;

  setText("modal-titulo", `Demanda ${d.codigo || ""}`);
  setText("modal-subtitulo", `${d.cliente_nome || ""}`);

  setText("det-codigo", d.codigo || "-");
  setText("det-cliente", d.cliente_nome || "-");
  setText("det-tipo", d.cliente_tipo_entidade || d.cliente_tipo || "-");
  setText("det-estado", d.cliente_estado || "-");
  setText("det-municipio", d.cliente_municipio || d.municipio || "-");
  setText("det-telefone", d.cliente_telefone || "-");

  setText("det-tipo-entidade", d.tipo_entidade || d.cliente_tipo_entidade || "-");
  setText("det-assunto", d.assunto || "-");
  setText("det-descricao", d.descricao || "-");

  setText("det-programador", d.programador || "-");
  setText("det-encaminhar-para", d.encaminhar_para || "-");
  setText("det-forma-atendimento", d.forma_atendimento || "-");

  setText("det-tags", (d.tags && d.tags.length) ? d.tags.join(", ") : "-");

  setText("det-prioridade", d.prioridade || "-");
  setText("det-status", d.status || "-");

  setText("det-atendente", d.atendente || currentUserProfile.nome || "-");
  setText("det-link-trello", d.link_trello || "-");
  setText("det-link-email", d.link_email || "-");

  setText("det-criado-em", formatarDataHoraBr(d.created_at));
  setText("det-atualizado-em", formatarDataHoraBr(d.updated_at));

  // Ações
  const podeAcoes = podeEncaminharDemanda(d) || podeEditarOuExcluirDemanda(d) || ehGestor();
  podeAcoes ? show("sec-acoes-demanda") : hide("sec-acoes-demanda");

  // Botões ação (respeita permissão)
  const btnEditar = byId("btn-editar-demanda");
  const btnExcluir = byId("btn-excluir-demanda");
  const btnEnc = byId("btn-encaminhar");

  if(btnEditar) btnEditar.disabled = !podeEditarOuExcluirDemanda(d);
  if(btnExcluir) btnExcluir.disabled = !podeEditarOuExcluirDemanda(d);
  if(btnEnc) btnEnc.disabled = !podeEncaminharDemanda(d);

  // Atualizações
  await carregarAtualizacoesDemanda(d.id);
}

function fecharModalDemanda(){
  hide("modal-detalhes");
  hide("modal-overlay");
  byId("det-demanda-id").value = "";
}

// =========================
// ENCAMINHAR DEMANDA (MANTIDO)
// =========================
async function encaminharDemanda(){
  const demandaId = byId("det-demanda-id").value;
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(!podeEncaminharDemanda(d)){
    alert("Você não tem permissão para encaminhar esta demanda.");
    return;
  }

  const sel = byId("sel-encaminhar-usuario");
  const userIdDestino = sel.value;
  if(!userIdDestino){
    alert("Selecione um usuário.");
    return;
  }

  const opt = sel.selectedOptions[0];
  const tipoDestino = (opt.dataset.tipo || "").toUpperCase();
  const nomeDestino = opt.dataset.nome || "";

  const upd = {
    encaminhar_para: nomeDestino,
    status: "ENCAMINHADA",
    updated_at: new Date().toISOString(),
  };

  if(tipoDestino === "PROGRAMADOR"){
    upd.programador = nomeDestino;
  }

  const { error } = await supabaseClient.from("demandas").update(upd).eq("id", demandaId);
  if(error){
    console.error("Erro ao encaminhar:", error);
    alert("Erro ao encaminhar: " + error.message);
    return;
  }

  await carregarDemandas();
  await abrirModalDemanda(demandaId);
}

// =========================
// ATUALIZAÇÕES (ANDAMENTOS)
// =========================
async function carregarAtualizacoesDemanda(demandaId){
  const cont = byId("lista-atualizacoes");
  if(!cont) return;

  cont.innerHTML = "Carregando...";

  const { data, error } = await supabaseClient
    .from("atualizacoes_demanda")
    .select("*")
    .eq("demanda_id", demandaId)
    .order("created_at", { ascending:false });

  if(error){
    console.error("Erro ao carregar atualizações:", error);
    cont.innerHTML = "Erro ao carregar atualizações.";
    return;
  }

  const arr = data || [];
  if(!arr.length){
    cont.innerHTML = "<p class='hint'>Sem atualizações registradas.</p>";
    return;
  }

  cont.innerHTML = "";
  arr.forEach(a => {
    const div = document.createElement("div");
    div.className = "upd";
    div.innerHTML = `
      <div class="upd-top">
        <strong>${a.usuario_nome || "Usuário"}</strong>
        <span class="muted">${formatarDataHoraBr(a.created_at)}</span>
      </div>
      <div class="upd-msg">${(a.mensagem || "").replace(/\n/g,"<br>")}</div>
      <div class="upd-actions">
        ${podeEditarOuExcluirAtualizacao(a) ? `<button class="btn ghost" data-act="edit" data-id="${a.id}">Editar</button>` : ""}
        ${podeEditarOuExcluirAtualizacao(a) ? `<button class="btn danger" data-act="del" data-id="${a.id}">Excluir</button>` : ""}
      </div>
    `;
    cont.appendChild(div);
  });

  cont.querySelectorAll("button[data-act='edit']").forEach(b => {
    b.addEventListener("click", () => atualizarAtualizacao(b.dataset.id));
  });
  cont.querySelectorAll("button[data-act='del']").forEach(b => {
    b.addEventListener("click", () => excluirAtualizacao(b.dataset.id));
  });
}

async function salvarAtualizacaoDemanda(){
  const demandaId = byId("det-demanda-id").value;
  if(!demandaId) return;

  const msg = byId("upd-mensagem").value.trim();
  if(!msg){
    alert("Digite uma atualização.");
    return;
  }

  const payload = {
    demanda_id: demandaId,
    usuario_id: currentUserProfile.id,
    usuario_nome: currentUserProfile.nome,
    mensagem: msg,
  };

  const { error } = await supabaseClient.from("atualizacoes_demanda").insert(payload);
  if(error){
    console.error("Erro ao salvar atualização:", error);
    alert("Erro: " + error.message);
    return;
  }

  byId("upd-mensagem").value = "";
  await carregarAtualizacoesDemanda(demandaId);
}

async function atualizarAtualizacao(atualizacaoId){
  const demandaId = byId("det-demanda-id").value;
  const { data, error } = await supabaseClient
    .from("atualizacoes_demanda")
    .select("*")
    .eq("id", atualizacaoId)
    .single();

  if(error || !data){
    alert("Não foi possível abrir atualização.");
    return;
  }

  if(!podeEditarOuExcluirAtualizacao(data)){
    alert("Sem permissão.");
    return;
  }

  // abre modal upd (já existe no seu HTML original)
  show("modal-upd-overlay");
  show("modal-upd");
  byId("upd-id").value = data.id;
  byId("upd-edit-mensagem").value = data.mensagem || "";
}

async function salvarEdicaoAtualizacao(){
  const id = byId("upd-id").value;
  const msg = byId("upd-edit-mensagem").value.trim();

  const { error } = await supabaseClient
    .from("atualizacoes_demanda")
    .update({ mensagem: msg, updated_at: new Date().toISOString() })
    .eq("id", id);

  if(error){
    alert("Erro ao editar: " + error.message);
    return;
  }

  fecharModalAtualizacao();
  await carregarAtualizacoesDemanda(byId("det-demanda-id").value);
}

async function excluirAtualizacao(atualizacaoId){
  if(!confirm("Excluir atualização?")) return;

  const { error } = await supabaseClient.from("atualizacoes_demanda").delete().eq("id", atualizacaoId);
  if(error){
    alert("Erro ao excluir: " + error.message);
    return;
  }

  await carregarAtualizacoesDemanda(byId("det-demanda-id").value);
}

function fecharModalAtualizacao(){
  hide("modal-upd");
  hide("modal-upd-overlay");
  byId("upd-id").value = "";
  byId("upd-edit-mensagem").value = "";
}

// =========================
// GESTOR - USUÁRIOS
// =========================
async function carregarUsuariosGestor(){
  if(!ehGestor()) return;

  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("created_at", { ascending:false });

  if(error){
    console.error("Erro ao carregar usuários gestor:", error);
    return;
  }

  const tb = byId("tb-usuarios");
  if(!tb) return;
  tb.innerHTML = "";

  (data || []).forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.nome || ""}</td>
      <td>${u.email || ""}</td>
      <td>${(u.tipo || "").toUpperCase()}</td>
      <td><span class="badge ${u.status === "ATIVO" ? "ok" : "warn"}">${u.status}</span></td>
      <td class="actions">
        ${u.status !== "ATIVO" ? `<button class="btn primary" data-act="ativar" data-id="${u.id}">Aprovar</button>` : ""}
        <button class="btn ghost" data-act="edit" data-id="${u.id}">Editar</button>
        <button class="btn danger" data-act="del" data-id="${u.id}">Excluir</button>
      </td>
    `;
    tb.appendChild(tr);
  });

  tb.querySelectorAll("button[data-act='ativar']").forEach(b => {
    b.addEventListener("click", () => atualizarStatusUsuario(b.dataset.id, "ATIVO"));
  });
  tb.querySelectorAll("button[data-act='edit']").forEach(b => {
    b.addEventListener("click", () => editarUsuarioPrompt(b.dataset.id));
  });
  tb.querySelectorAll("button[data-act='del']").forEach(b => {
    b.addEventListener("click", () => excluirUsuario(b.dataset.id));
  });
}

async function atualizarStatusUsuario(userId, status){
  const { error } = await supabaseClient.from("usuarios").update({ status }).eq("id", userId);
  if(error){
    alert("Erro: " + error.message);
    return;
  }
  await carregarUsuariosGestor();
}

async function editarUsuarioPrompt(userId){
  const { data, error } = await supabaseClient.from("usuarios").select("*").eq("id", userId).single();
  if(error || !data) return;

  const novoTipo = prompt("Tipo (GESTOR/SUPORTE/PROGRAMADOR):", (data.tipo || ""));
  if(novoTipo === null) return;

  const novoStatus = prompt("Status (ATIVO/PENDENTE/BLOQUEADO):", (data.status || ""));
  if(novoStatus === null) return;

  const { error: errUpd } = await supabaseClient
    .from("usuarios")
    .update({ tipo: novoTipo.trim().toUpperCase(), status: novoStatus.trim().toUpperCase() })
    .eq("id", userId);

  if(errUpd){
    alert("Erro: " + errUpd.message);
    return;
  }

  await carregarUsuariosGestor();
}

async function excluirUsuario(userId){
  if(!confirm("Excluir usuário do cadastro? (não remove do Auth)")) return;

  const { error } = await supabaseClient.from("usuarios").delete().eq("id", userId);
  if(error){
    alert("Erro: " + error.message);
    return;
  }

  await carregarUsuariosGestor();
}

// =========================
// LISTENERS
// =========================
function registrarListeners(){
  const bLogin = byId("btn-login");
  const bCad = byId("btn-cadastrar");
  const bLogout = byId("btn-logout");

  if(bLogin) bLogin.addEventListener("click", login);
  if(bCad) bCad.addEventListener("click", cadastrarNovoUsuario);
  if(bLogout) bLogout.addEventListener("click", logout);

  const fCli = byId("form-cliente");
  if(fCli) fCli.addEventListener("submit", salvarCliente);

  const fDem = byId("form-demanda");
  if(fDem) fDem.addEventListener("submit", salvarDemanda);

  const btnAddTag = byId("btn-add-tag");
  if(btnAddTag){
    btnAddTag.addEventListener("click", () => {
      const inp = byId("dem-tag");
      const v = (inp.value || "").trim().toUpperCase();
      if(!v) return;
      if(!tagsAtuais.includes(v)) tagsAtuais.push(v);
      inp.value = "";
      renderizarTags();
    });
  }

  const selCli = byId("dem-cliente");
  if(selCli){
    selCli.addEventListener("change", () => {
      const opt = selCli.selectedOptions[0];
      if(!opt) return;
      if(byId("dem-tipo-entidade")) byId("dem-tipo-entidade").value = opt.dataset.tipo_entidade || "";
      if(byId("dem-estado")) byId("dem-estado").value = opt.dataset.estado || "";
      if(byId("dem-municipio")) byId("dem-municipio").value = opt.dataset.municipio || "";
      if(byId("dem-telefone")) byId("dem-telefone").value = opt.dataset.telefone || "";
    });
  }

  const btnFechar = byId("btn-fechar-modal");
  if(btnFechar) btnFechar.addEventListener("click", fecharModalDemanda);

  const btnEnc = byId("btn-encaminhar");
  if(btnEnc) btnEnc.addEventListener("click", encaminharDemanda);

  const btnEd = byId("btn-editar-demanda");
  if(btnEd) btnEd.addEventListener("click", editarDemanda);

  const btnEx = byId("btn-excluir-demanda");
  if(btnEx) btnEx.addEventListener("click", () => excluirDemanda(byId("det-demanda-id").value));

  const btnSalvarUpd = byId("btn-salvar-atualizacao");
  if(btnSalvarUpd) btnSalvarUpd.addEventListener("click", salvarAtualizacaoDemanda);

  const btnUpdClose = byId("btn-fechar-upd");
  if(btnUpdClose) btnUpdClose.addEventListener("click", fecharModalAtualizacao);

  const btnUpdSalvar = byId("btn-salvar-upd");
  if(btnUpdSalvar) btnUpdSalvar.addEventListener("click", salvarEdicaoAtualizacao);

  // Filtros
  const fBusca = byId("filtro-texto");
  if(fBusca) fBusca.addEventListener("input", () => {
    filtrosAtuais.buscaTexto = fBusca.value;
    aplicarFiltrosERenderizar();
  });

  const chk = byId("chk-ocultar-concluidas");
  if(chk) chk.addEventListener("change", () => {
    filtrosAtuais.ocultarConcluidas = chk.checked;
    aplicarFiltrosERenderizar();
  });

  const chkTodas = byId("chk-consultar-todas");
  if(chkTodas) chkTodas.addEventListener("change", () => {
    filtrosAtuais.consultarTodas = chkTodas.checked;
    aplicarFiltrosERenderizar();
  });

  const fs = byId("filtro-status");
  if(fs) fs.addEventListener("change", () => { filtrosAtuais.status = fs.value; aplicarFiltrosERenderizar(); });

  const fa = byId("filtro-atendente");
  if(fa) fa.addEventListener("change", () => { filtrosAtuais.atendente = fa.value; aplicarFiltrosERenderizar(); });

  const fp = byId("filtro-programador");
  if(fp) fp.addEventListener("change", () => { filtrosAtuais.programador = fp.value; aplicarFiltrosERenderizar(); });

  const fm = byId("filtro-municipio");
  if(fm) fm.addEventListener("change", () => { filtrosAtuais.municipio = fm.value; aplicarFiltrosERenderizar(); });

  const fe = byId("filtro-estado");
  if(fe) fe.addEventListener("change", () => { filtrosAtuais.estado = fe.value; aplicarFiltrosERenderizar(); });

  const ft = byId("filtro-tipo-entidade");
  if(ft) ft.addEventListener("change", () => { filtrosAtuais.tipoEntidade = ft.value; aplicarFiltrosERenderizar(); });
}

// =========================
// START
// =========================
document.addEventListener("DOMContentLoaded", inicializarApp);
