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

function ehGestor(){ return currentUserProfile && currentUserProfile.tipo === "GESTOR"; }
function ehSuporte(){ return currentUserProfile && currentUserProfile.tipo === "SUPORTE"; }
function ehProgramador(){ return currentUserProfile && currentUserProfile.tipo === "PROGRAMADOR"; }

function setStatusBar(texto){ setText("status-bar", texto); }
function setStatusClientes(texto){ setText("status-clientes", texto); }

// Permissões demanda
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

// Permissões andamento
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
    if(currentUserProfile){
      mostrarApp();
    } else {
      mostrarTelaAuth();
    }
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

  // Painel do gestor e gestão de usuários: apenas gestor
  if(ehGestor()){
    show("sec-painel-gestor");
  } else {
    hide("sec-painel-gestor");
  }

  // Cadastro de clientes: gestor e suporte
  if(ehGestor() || ehSuporte()){
    show("sec-clientes");
  } else {
    hide("sec-clientes");
  }

  // Cadastro de demandas: gestor e suporte
  if(ehGestor() || ehSuporte()){
    show("sec-cadastro-demanda");
  } else {
    hide("sec-cadastro-demanda");
  }

  if(ehProgramador()){
    if(ajudaEl) ajudaEl.textContent = "Perfil Programador: você vê as suas demandas (ou consulta todas no toggle) e registra andamentos.";
  } else if(ehSuporte()){
    if(ajudaEl) ajudaEl.textContent = "Perfil Suporte: você cadastra, edita e exclui as demandas que criar e pode consultar todas no toggle.";
  } else if(ehGestor()){
    if(ajudaEl) ajudaEl.textContent = "Perfil Gestor: gerencia usuários, clientes e acompanha produção.";
  }
}

function mostrarApp(){
  hide("auth-container");
  show("app-container");

  setText("user-label", `${currentUserProfile.nome} (${currentUserProfile.tipo} · ${currentUserProfile.unidade || "-"})`);
  ajustarInterfacePorPerfil();

  // Carregamentos base
  carregarUsuariosParaEncaminhar();
  carregarClientes();
  carregarDemandas();

  if(ehGestor()){
    carregarUsuariosGestor();
  }
}

async function carregarPerfilUsuarioAtual(){
  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if(userError || !userData?.user){
    console.error("Erro ao obter usuário:", userError);
    currentUserProfile = null;
    return;
  }

  const uid = userData.user.id;

  const { data: perfil, error: perfilError } = await supabaseClient
    .from("usuarios")
    .select("*")
    .eq("id", uid)
    .single();

  if(perfilError){
    console.error("Erro ao obter perfil:", perfilError);
    currentUserProfile = null;
    setText("auth-status", "Erro ao obter perfil. Verifique se o usuário existe na tabela usuarios.");
    return;
  }

  if((perfil.status || "").toUpperCase() !== "ATIVO"){
    await supabaseClient.auth.signOut();
    currentSession = null;
    currentUserProfile = null;
    setText("auth-status", "Seu usuário ainda não está ATIVO. Aguarde aprovação do gestor.");
    mostrarTelaAuth();
    return;
  }

  currentUserProfile = perfil;
}

async function cadastrarNovoUsuario(){
  const nome = byId("cad-nome").value.trim();
  const email = byId("cad-email").value.trim();
  const dtNasc = byId("cad-dt-nasc").value;
  const unidade = byId("cad-unidade").value;
  const tipo = byId("cad-tipo").value || "PROGRAMADOR";
  const senha = byId("cad-senha").value;
  const senha2 = byId("cad-senha2").value;

  if(!nome || !email || !unidade || !senha || !senha2){
    setText("auth-status", "Preencha todos os campos obrigatórios.");
    return;
  }
  if(senha !== senha2){
    setText("auth-status", "As senhas não conferem.");
    return;
  }
  if(!validarSenhaSimples(senha)){
    setText("auth-status", "Senha inválida. Use até 10 caracteres, apenas letras e números, sem símbolos.");
    return;
  }

  setText("auth-status", "Criando usuário...");

  const { error: signError } = await supabaseClient.auth.signUp({ email, password: senha });
  if(signError){
    console.error("Erro signUp:", signError);
    setText("auth-status", "Erro ao criar usuário: " + signError.message);
    return;
  }

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if(userError || !userData?.user){
    console.error("Erro getUser:", userError);
    setText("auth-status", "Usuário criado, mas não foi possível obter o ID.");
    return;
  }

  const uid = userData.user.id;

  const { error: perfilError } = await supabaseClient.from("usuarios").insert([{
    id: uid,
    nome,
    email,
    dt_nascimento: dtNasc || null,
    unidade,
    tipo,
    status: "PENDENTE"
  }]);

  if(perfilError){
    console.error("Erro ao salvar perfil:", perfilError);
    setText("auth-status", "Usuário criado no Auth, mas falhou ao salvar perfil: " + perfilError.message);
    return;
  }

  setText("auth-status", "Cadastro realizado com sucesso! Aguarde aprovação do gestor para acessar.");
  await supabaseClient.auth.signOut();
}

async function login(){
  const email = byId("login-email").value.trim();
  const senha = byId("login-senha").value;

  if(!email || !senha){
    setText("auth-status", "Informe email e senha.");
    return;
  }

  setText("auth-status", "Autenticando...");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
  if(error){
    console.error("Erro ao autenticar:", error);
    setText("auth-status", "Erro ao autenticar: " + error.message);
    return;
  }

  currentSession = data.session;
  await carregarPerfilUsuarioAtual();
  if(!currentUserProfile) return;

  setText("auth-status", "");
  mostrarApp();
}

async function logout(){
  await supabaseClient.auth.signOut();
  currentSession = null;
  currentUserProfile = null;
  demandasCache = [];
  usuariosCache = [];
  clientesCache = [];
  tagsAtuais = [];
  mostrarTelaAuth();
}

// =========================
// CLIENTES (CRUD)
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
  renderizarClientes();
  montarSelectClientesParaDemanda();
}

function renderizarClientes(){
  const tbody = byId("tabela-clientes");
  if(!tbody) return;
  tbody.innerHTML = "";

  // só gestor e suporte visualizam esse painel
  if(!(ehGestor() || ehSuporte())){
    return;
  }

  for(const c of clientesCache){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.cliente || ""}</td>
      <td>${c.tipo || ""}</td>
      <td>${c.estado || ""}</td>
      <td>${c.contato || ""}</td>
      <td>${c.telefone || ""}</td>
      <td>
        <div class="row-actions">
          <button class="btn-mini" data-a="editar">Editar</button>
          <button class="btn-mini" data-a="excluir">Excluir</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-a="editar"]').addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await editarCliente(c.id);
    });

    tr.querySelector('[data-a="excluir"]').addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await excluirCliente(c.id);
    });

    tbody.appendChild(tr);
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
  const contato = byId("cli-contato").value.trim().toUpperCase();
  const telefone = byId("cli-telefone").value.trim();
  const tipo = byId("cli-tipo").value;

  if(!cliente || !estado || !contato || !telefone || !tipo){
    alert("Preencha Cliente, Tipo, Estado, Contato e Telefone.");
    return;
  }

  setStatusClientes("Salvando cliente...");

  const { error } = await supabaseClient.from("clientes").insert([{
    cliente, estado, contato, telefone, tipo
  }]);

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

  const novoTipo = prompt("Tipo (CM, PM, AUTARQUIA, IPM, CONSORCIO):", c.tipo || "");
  if(novoTipo === null) return;

  const novoEstado = prompt("Estado:", c.estado || "");
  if(novoEstado === null) return;

  const novoContato = prompt("Contato:", c.contato || "");
  if(novoContato === null) return;

  const novoTelefone = prompt("Telefone:", c.telefone || "");
  if(novoTelefone === null) return;

  const { error } = await supabaseClient.from("clientes").update({
    cliente: novoCliente.trim().toUpperCase(),
    tipo: novoTipo.trim().toUpperCase(),
    estado: novoEstado.trim(),
    contato: novoContato.trim().toUpperCase(),
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
// SELECTS EM CASCATA (DEMANDA)
// =========================
function montarSelectClientesParaDemanda(){
  const selCliente = byId("dem-cliente");
  const selTipo = byId("dem-cliente-tipo");
  const selEstado = byId("dem-cliente-estado");
  const selContato = byId("dem-cliente-contato");
  const tel = byId("dem-cliente-telefone");

  if(!selCliente || !selTipo || !selEstado || !selContato || !tel) return;

  // cliente
  selCliente.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Selecione...";
  selCliente.appendChild(opt0);

  const clientesUnicos = Array.from(new Set(clientesCache.map(c => c.cliente).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const nome of clientesUnicos){
    const opt = document.createElement("option");
    opt.value = nome;
    opt.textContent = nome;
    selCliente.appendChild(opt);
  }

  // tipo/estado/contato vazios inicialmente
  selTipo.innerHTML = `<option value="">Selecione...</option>`;
  selEstado.innerHTML = `<option value="">Selecione...</option>`;
  selContato.innerHTML = `<option value="">Selecione...</option>`;
  tel.value = "";

  // listeners
  selCliente.onchange = () => {
    preencherTiposPorCliente(selCliente.value);
    preencherEstadosPorClienteETipo(selCliente.value, selTipo.value);
    preencherContatosPorClienteTipoEstado(selCliente.value, selTipo.value, selEstado.value);
    tel.value = "";
  };
  selTipo.onchange = () => {
    preencherEstadosPorClienteETipo(selCliente.value, selTipo.value);
    preencherContatosPorClienteTipoEstado(selCliente.value, selTipo.value, selEstado.value);
    tel.value = "";
  };
  selEstado.onchange = () => {
    preencherContatosPorClienteTipoEstado(selCliente.value, selTipo.value, selEstado.value);
    tel.value = "";
  };
  selContato.onchange = () => {
    const item = acharClienteSelecionado();
    tel.value = item?.telefone || "";
  };
}

function preencherTiposPorCliente(clienteNome){
  const selTipo = byId("dem-cliente-tipo");
  if(!selTipo) return;

  selTipo.innerHTML = `<option value="">Selecione...</option>`;
  if(!clienteNome) return;

  const tipos = Array.from(
    new Set(clientesCache.filter(c => c.cliente === clienteNome).map(c => c.tipo).filter(Boolean))
  ).sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const t of tipos){
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    selTipo.appendChild(opt);
  }
}

function preencherEstadosPorClienteETipo(clienteNome, tipo){
  const selEstado = byId("dem-cliente-estado");
  if(!selEstado) return;

  selEstado.innerHTML = `<option value="">Selecione...</option>`;
  if(!clienteNome) return;

  const filtrados = clientesCache.filter(c => c.cliente === clienteNome && (!tipo || c.tipo === tipo));
  const estados = Array.from(new Set(filtrados.map(c => c.estado).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const e of estados){
    const opt = document.createElement("option");
    opt.value = e;
    opt.textContent = e;
    selEstado.appendChild(opt);
  }
}

function preencherContatosPorClienteTipoEstado(clienteNome, tipo, estado){
  const selContato = byId("dem-cliente-contato");
  if(!selContato) return;

  selContato.innerHTML = `<option value="">Selecione...</option>`;
  if(!clienteNome) return;

  const filtrados = clientesCache.filter(c =>
    c.cliente === clienteNome &&
    (!tipo || c.tipo === tipo) &&
    (!estado || c.estado === estado)
  );

  const contatos = Array.from(new Set(filtrados.map(c => c.contato).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const ct of contatos){
    const opt = document.createElement("option");
    opt.value = ct;
    opt.textContent = ct;
    selContato.appendChild(opt);
  }
}

function acharClienteSelecionado(){
  const cliente = byId("dem-cliente")?.value || "";
  const tipo = byId("dem-cliente-tipo")?.value || "";
  const estado = byId("dem-cliente-estado")?.value || "";
  const contato = byId("dem-cliente-contato")?.value || "";

  if(!cliente || !tipo || !estado || !contato) return null;

  return clientesCache.find(c =>
    c.cliente === cliente &&
    c.tipo === tipo &&
    c.estado === estado &&
    c.contato === contato
  ) || null;
}

// =========================
// TAGS (chips)
// =========================
function normalizarTag(t){
  return (t || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function renderizarTags(){
  const cont = byId("dem-tags-chips");
  if(!cont) return;
  cont.innerHTML = "";

  for(const t of tagsAtuais){
    const chip = document.createElement("span");
    chip.className = "chip-tag";
    chip.innerHTML = `${t} <button type="button" aria-label="Remover">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      tagsAtuais = tagsAtuais.filter(x => x !== t);
      renderizarTags();
    });
    cont.appendChild(chip);
  }
}
function adicionarTagsDoInput(){
  const input = byId("dem-tags-input");
  if(!input) return;

  const bruto = input.value;
  const partes = bruto.split(",").map(normalizarTag).filter(Boolean);

  let mudou = false;
  for(const p of partes){
    if(!tagsAtuais.includes(p)){
      tagsAtuais.push(p);
      mudou = true;
    }
  }
  if(mudou) renderizarTags();

  input.value = "";
}

// =========================
// USUÁRIOS (LISTA PARA ENCAMINHAR / FILTROS / PROGRAMADOR)
// =========================
async function carregarUsuariosParaEncaminhar(){
  // ✅ regra: Programador lista só usuários PROGRAMADORES
  // Suporte/Gestor: lista todos os ATIVOS
  let q = supabaseClient.from("usuarios").select("id,nome,tipo,status").order("nome", { ascending:true });

  const { data, error } = await q;
  if(error){
    console.error("Erro ao carregar usuários:", error);
    return;
  }

  let lista = (data || []).filter(u => (u.status || "").toUpperCase() === "ATIVO");

  if(ehProgramador()){
    lista = lista.filter(u => (u.tipo || "").toUpperCase() === "PROGRAMADOR");
  }

  usuariosCache = lista;
}

// =========================
// DEMANDAS (CRUD)
// =========================
async function gerarCodigoDemanda(){
  const ano = new Date().getFullYear();
  const prefixo = "D" + ano;

  const { data, error } = await supabaseClient
    .from("demandas")
    .select("codigo")
    .like("codigo", `${prefixo}-%`)
    .order("codigo", { ascending: false })
    .limit(1);

  if(error){
    console.error("Erro ao buscar último código:", error);
    return `${prefixo}-00001`;
  }
  if(!data || data.length === 0) return `${prefixo}-00001`;

  const ultimo = data[0].codigo || "";
  const partes = ultimo.split("-");
  let num = 0;
  if(partes.length > 1) num = parseInt(partes[1], 10) || 0;
  num++;
  return `${prefixo}-${String(num).padStart(5, "0")}`;
}

async function salvarDemanda(e){
  e.preventDefault();

  if(!(ehGestor() || ehSuporte())){
    alert("Apenas Gestor ou Suporte podem cadastrar demandas.");
    return;
  }

  const municipio = byId("dem-municipio").value.trim().toUpperCase();
  const tipoEntidade = byId("dem-tipo-entidade").value.trim().toUpperCase();
  const assunto = byId("dem-assunto").value.trim().toUpperCase();
  const descricao = byId("dem-descricao").value.trim();
  const programador = byId("dem-programador").value.trim();
  const formaAtendimento = byId("dem-forma-atendimento").value.trim();
  const prioridade = byId("dem-prioridade").value;
  const statusDemanda = byId("dem-status").value;
  const linkTrello = byId("dem-link-trello").value.trim();
  const linkEmail = byId("dem-link-email").value.trim();

  if(!municipio || !assunto || !descricao){
    alert("Preencha Município, Assunto e Descrição.");
    return;
  }

  // cliente selecionado
  const cliSel = acharClienteSelecionado();
  if(!cliSel){
    alert("Selecione Cliente, Tipo, Estado e Contato (cadastro).");
    return;
  }

  const suporteNome = currentUserProfile.nome;
  const agoraLocal = new Date().toLocaleString("pt-BR");
  const codigo = await gerarCodigoDemanda();

  setStatusBar("Salvando demanda...");

  const payload = {
    user_id: currentUserProfile.id,
    codigo,
    municipio,
    tipo_entidade: tipoEntidade || null,

    cliente_id: cliSel.id,
    cliente_nome: cliSel.cliente,
    cliente_tipo: cliSel.tipo,
    cliente_estado: cliSel.estado,
    cliente_contato: cliSel.contato,
    cliente_telefone: cliSel.telefone,

    assunto,
    descricao,
    programador: programador || null,
    encaminhar_para: programador || null,
    forma_atendimento: formaAtendimento || null,
    prioridade: prioridade || "MÉDIA",
    status: statusDemanda || "ABERTA",
    atendente: suporteNome,
    link_trello: linkTrello || null,
    link_email: linkEmail || null,
    data_hora_local: agoraLocal,
    tags: tagsAtuais.length ? tagsAtuais : []
  };

  const { error } = await supabaseClient.from("demandas").insert([payload]);

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

  demandasCache = data || [];
  atualizarFiltrosSugestoes();
  renderizarDemandas();

  if(ehGestor()){
    renderTop10Gestor();
  }

  setStatusBar("Pronto");
}

function aplicarVisibilidadeConsultas(lista){
  // ✅ regra: por padrão, usuário só vê suas demandas
  // se marcar "consultar todas", mostra tudo, porém SEM editar/excluir (somente leitura)
  if(filtrosAtuais.consultarTodas) return lista;

  // default: somente as demandas criadas pelo usuário
  // (Programador também fica restrito ao próprio ID por padrão)
  return lista.filter(d => d.user_id === currentUserProfile.id);
}

function renderizarDemandas(){
  const tbody = byId("tabela-demandas");
  tbody.innerHTML = "";

  let lista = [...demandasCache];
  lista = aplicarVisibilidadeConsultas(lista);

  if(filtrosAtuais.ocultarConcluidas){
    lista = lista.filter(d => (d.status || "").toUpperCase() !== "CONCLUÍDA");
  }

  if(filtrosAtuais.status !== "TODOS"){
    lista = lista.filter(d => (d.status || "").toUpperCase() === filtrosAtuais.status.toUpperCase());
  }
  if(filtrosAtuais.atendente !== "TODOS"){
    lista = lista.filter(d => (d.atendente || "") === filtrosAtuais.atendente);
  }
  if(filtrosAtuais.programador !== "TODOS"){
    lista = lista.filter(d => (d.programador || "") === filtrosAtuais.programador);
  }
  if(filtrosAtuais.municipio !== "TODOS"){
    lista = lista.filter(d => (d.municipio || "") === filtrosAtuais.municipio);
  }
  if(filtrosAtuais.estado !== "TODOS"){
    lista = lista.filter(d => (d.cliente_estado || "") === filtrosAtuais.estado);
  }
  if(filtrosAtuais.tipoEntidade !== "TODOS"){
    lista = lista.filter(d => (d.tipo_entidade || "") === filtrosAtuais.tipoEntidade);
  }

  if(filtrosAtuais.buscaTexto.trim() !== ""){
    const termo = filtrosAtuais.buscaTexto.toLowerCase();
    lista = lista.filter(d =>
      (d.descricao || "").toLowerCase().includes(termo) ||
      (d.assunto || "").toLowerCase().includes(termo) ||
      (d.codigo || "").toLowerCase().includes(termo) ||
      (d.cliente_nome || "").toLowerCase().includes(termo)
    );
  }

  const somenteLeitura = filtrosAtuais.consultarTodas; // quando consulta todas, não edita/exclui

  for(const d of lista){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="codigo">${d.codigo || "-"}</span></td>
      <td>${d.municipio || ""}</td>
      <td>${d.cliente_nome || ""}</td>
      <td>${d.assunto || ""}</td>
      <td>${d.status || ""}</td>
      <td>${d.prioridade || ""}</td>
      <td>
        <div class="row-actions">
          <button class="btn-mini" data-action="detalhes">Detalhes</button>
          <button class="btn-mini" data-action="editar">Editar</button>
          <button class="btn-mini" data-action="excluir">Excluir</button>
        </div>
      </td>
    `;

    tr.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if(btn) return;
      abrirModalDemanda(d.id);
    });

    tr.querySelector('[data-action="detalhes"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalDemanda(d.id);
    });

    tr.querySelector('[data-action="editar"]').addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await editarDemanda(d.id);
    });

    tr.querySelector('[data-action="excluir"]').addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await excluirDemanda(d.id);
    });

    // ✅ permissões
    if(somenteLeitura){
      tr.querySelector('[data-action="editar"]').disabled = true;
      tr.querySelector('[data-action="excluir"]').disabled = true;
    } else if(!podeEditarOuExcluirDemanda(d)){
      tr.querySelector('[data-action="editar"]').disabled = true;
      tr.querySelector('[data-action="excluir"]').disabled = true;
    }

    tbody.appendChild(tr);
  }

  setText("total-demandas", `Total: ${lista.length}`);
}

async function excluirDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(filtrosAtuais.consultarTodas){
    alert("Modo 'Consultar todas' é somente leitura.");
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

async function editarDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(filtrosAtuais.consultarTodas){
    alert("Modo 'Consultar todas' é somente leitura.");
    return;
  }

  if(!podeEditarOuExcluirDemanda(d)){
    alert("Você não tem permissão para editar esta demanda.");
    return;
  }

  const municipio = prompt("Município:", d.municipio || "");
  if(municipio === null) return;
  const assunto = prompt("Assunto:", d.assunto || "");
  if(assunto === null) return;
  const descricao = prompt("Descrição:", d.descricao || "");
  if(descricao === null) return;

  const status = prompt("Status (ABERTA, EM ANÁLISE, NA PROGRAMAÇÃO, ENCAMINHADA, CONCLUÍDA):", d.status || "");
  if(status === null) return;

  const prioridade = prompt("Prioridade (BAIXA, MÉDIA, ALTA, URGENTE):", d.prioridade || "");
  if(prioridade === null) return;

  const payload = {
    municipio: municipio.trim().toUpperCase(),
    assunto: assunto.trim().toUpperCase(),
    descricao: descricao.trim(),
    status: status.trim().toUpperCase(),
    prioridade: prioridade.trim().toUpperCase()
  };

  const { error } = await supabaseClient.from("demandas").update(payload).eq("id", demandaId);
  if(error){
    console.error("Erro ao editar demanda:", error);
    alert("Erro ao editar demanda: " + error.message);
    return;
  }

  await carregarDemandas();
}

// =========================
// MODAL DEMANDA
// =========================
function abrirModal(){ show("modal-overlay"); show("modal-detalhes"); }
function fecharModal(){ hide("modal-overlay"); hide("modal-detalhes"); }

async function abrirModalDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  byId("det-demanda-id").value = d.id;

  setText("modal-titulo", `Demanda ${d.codigo || ""}`);
  setText("modal-subtitulo", `${d.municipio || "-"} · ${d.assunto || "-"}`);

  setText("det-codigo", d.codigo || "-");
  setText("det-municipio", d.municipio || "-");

  setText("det-cliente", d.cliente_nome || "-");
  setText("det-cliente-tipo", d.cliente_tipo || "-");
  setText("det-cliente-estado", d.cliente_estado || "-");
  setText("det-cliente-contato", d.cliente_contato || "-");
  setText("det-cliente-telefone", d.cliente_telefone || "-");

  setText("det-tipo-entidade", d.tipo_entidade || "-");
  setText("det-assunto", d.assunto || "-");
  setText("det-descricao", d.descricao || "-");

  setText("det-programador", d.programador || "-");
  setText("det-encaminhar-para", d.encaminhar_para || "-");
  setText("det-forma-atendimento", d.forma_atendimento || "-");

  const tags = Array.isArray(d.tags) ? d.tags : [];
  setText("det-tags", tags.length ? tags.join(", ") : "-");

  setText("det-prioridade", d.prioridade || "-");
  setText("det-status", d.status || "-");
  setText("det-atendente", d.atendente || "-");

  setText("det-link-trello", d.link_trello || "-");
  setText("det-link-email", d.link_email || "-");
  setText("det-criado-em", formatarDataHoraBr(d.created_at));

  // Ações: encaminhar
  if(podeEncaminharDemanda(d) && !filtrosAtuais.consultarTodas){
    show("card-encaminhar");
    await popularSelectEncaminhar(d);
  } else {
    hide("card-encaminhar");
  }

  // Editar/Excluir
  if(podeEditarOuExcluirDemanda(d) && !filtrosAtuais.consultarTodas){
    show("card-editar");
    show("card-excluir");
  } else {
    hide("card-editar");
    hide("card-excluir");
  }

  byId("btn-encaminhar").onclick = async () => encaminharDemanda(d.id);
  byId("btn-editar-demanda").onclick = async () => {
    await editarDemanda(d.id);
    await abrirModalDemanda(d.id);
  };
  byId("btn-excluir-demanda").onclick = async () => {
    await excluirDemanda(d.id);
    fecharModal();
  };

  abrirModal();
  await carregarAtualizacoesDemanda(d.id);
}

async function popularSelectEncaminhar(d){
  const sel = byId("sel-encaminhar-usuario");
  sel.innerHTML = `<option value="">Selecione...</option>`;

  // lista já filtrada (programador só vê programadores; suporte/gestor vê todos ativos)
  const lista = [...usuariosCache].sort((a,b)=>(a.nome||"").localeCompare((b.nome||""),"pt-BR"));

  for(const u of lista){
    const opt = document.createElement("option");
    opt.value = u.id; // guardo ID, pra saber tipo
    opt.textContent = `${u.nome} (${u.tipo})`;
    sel.appendChild(opt);
  }

  // pré seleção por encaminhar_para (quando tiver)
  const atualNome = d.encaminhar_para || "";
  const match = lista.find(u => u.nome === atualNome);
  if(match) sel.value = match.id;
}

async function encaminharDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(filtrosAtuais.consultarTodas){
    alert("Modo 'Consultar todas' é somente leitura.");
    return;
  }

  if(!podeEncaminharDemanda(d)){
    alert("Você não tem permissão para encaminhar esta demanda.");
    return;
  }

  const destinoId = byId("sel-encaminhar-usuario").value;
  if(!destinoId){
    alert("Selecione um usuário para encaminhar.");
    return;
  }

  const destino = usuariosCache.find(u => u.id === destinoId);
  if(!destino){
    alert("Usuário destino não encontrado (recarregue a página).");
    return;
  }

  // ✅ regra: só muda programador se destino for PROGRAMADOR
  const payload = {
    encaminhar_para: destino.nome,
    status: "ENCAMINHADA"
  };
  if((destino.tipo || "").toUpperCase() === "PROGRAMADOR"){
    payload.programador = destino.nome;
  }

  const { error } = await supabaseClient.from("demandas").update(payload).eq("id", demandaId);
  if(error){
    console.error("Erro ao encaminhar:", error);
    alert("Erro ao encaminhar: " + error.message);
    return;
  }

  await carregarDemandas();
  await abrirModalDemanda(demandaId);
}

// =========================
// ATUALIZAÇÕES (CRUD)
// =========================
async function carregarAtualizacoesDemanda(demandaId){
  const listaEl = byId("lista-atualizacoes");
  listaEl.innerHTML = "Carregando atualizações...";

  const { data, error } = await supabaseClient
    .from("atualizacoes_demanda")
    .select("*")
    .eq("demanda_id", demandaId)
    .order("created_at", { ascending: true });

  if(error){
    console.error("Erro ao carregar atualizações:", error);
    listaEl.textContent = "Erro ao carregar atualizações.";
    return;
  }

  if(!data || data.length === 0){
    listaEl.textContent = "Nenhuma atualização registrada.";
    return;
  }

  listaEl.innerHTML = "";
  for(const a of data){
    const li = document.createElement("li");
    li.classList.add("item-atualizacao");

    const pode = podeEditarOuExcluirAtualizacao(a);

    li.innerHTML = `
      <div><strong>${a.usuario_nome || "Usuário"}</strong> – <span class="muted">${formatarDataHoraBr(a.created_at)}</span></div>
      <div>${a.mensagem || ""}</div>
      <div class="upd-actions">
        <button class="btn-mini" data-a="editar" ${pode ? "" : "disabled"}>Editar</button>
        <button class="btn-mini" data-a="excluir" ${pode ? "" : "disabled"}>Excluir</button>
      </div>
    `;

    li.querySelector('[data-a="editar"]').addEventListener("click", () => abrirModalAtualizacao(a));
    li.querySelector('[data-a="excluir"]').addEventListener("click", async () => {
      if(!pode) return;
      if(!confirm("Excluir este andamento?")) return;
      await excluirAtualizacao(a.id, demandaId);
    });

    listaEl.appendChild(li);
  }
}

async function salvarAtualizacaoDemanda(e){
  e.preventDefault();

  if(!currentUserProfile){
    alert("Faça login para registrar atualização.");
    return;
  }

  const demandaId = byId("det-demanda-id").value;
  const msg = byId("nova-atualizacao-texto").value.trim();
  if(!demandaId || !msg){
    alert("Escreva uma mensagem de atualização.");
    return;
  }

  const { error } = await supabaseClient.from("atualizacoes_demanda").insert([{
    demanda_id: demandaId,
    usuario_id: currentUserProfile.id,
    usuario_nome: currentUserProfile.nome,
    mensagem: msg
  }]);

  if(error){
    console.error("Erro ao salvar atualização:", error);
    alert("Erro ao salvar atualização: " + error.message);
    return;
  }

  byId("nova-atualizacao-texto").value = "";
  await carregarAtualizacoesDemanda(demandaId);
}

function abrirModalAtualizacao(a){
  byId("upd-id").value = a.id;
  byId("upd-texto").value = a.mensagem || "";
  setText("upd-subtitulo", `${a.usuario_nome || ""} · ${formatarDataHoraBr(a.created_at)}`);
  show("modal-upd-overlay");
  show("modal-upd");

  byId("btn-salvar-upd").onclick = async () => {
    const texto = byId("upd-texto").value.trim();
    if(!texto) return alert("Texto vazio.");
    await atualizarAtualizacao(a.id, texto, byId("det-demanda-id").value);
  };

  byId("btn-excluir-upd").onclick = async () => {
    if(!confirm("Excluir este andamento?")) return;
    await excluirAtualizacao(a.id, byId("det-demanda-id").value);
  };
}

function fecharModalAtualizacao(){
  hide("modal-upd-overlay");
  hide("modal-upd");
}

async function atualizarAtualizacao(updId, texto, demandaId){
  const { error } = await supabaseClient
    .from("atualizacoes_demanda")
    .update({ mensagem: texto })
    .eq("id", updId);

  if(error){
    console.error("Erro ao editar andamento:", error);
    alert("Erro ao editar andamento: " + error.message);
    return;
  }

  fecharModalAtualizacao();
  await carregarAtualizacoesDemanda(demandaId);
}

async function excluirAtualizacao(updId, demandaId){
  const { error } = await supabaseClient
    .from("atualizacoes_demanda")
    .delete()
    .eq("id", updId);

  if(error){
    console.error("Erro ao excluir andamento:", error);
    alert("Erro ao excluir andamento: " + error.message);
    return;
  }

  fecharModalAtualizacao();
  await carregarAtualizacoesDemanda(demandaId);
}

// =========================
// FILTROS + SUGESTÕES
// =========================
function atualizarFiltrosSugestoes(){
  const atendentes = new Set();
  const programadores = new Set();
  const municipios = new Set();
  const estados = new Set();
  const tiposEntidade = new Set();
  const formasAtendimento = new Set();
  const assuntos = new Set();

  // usa o cache completo, mas filtros vão aplicar visibilidade depois
  for(const d of demandasCache){
    if(d.atendente) atendentes.add(d.atendente);
    if(d.programador) programadores.add(d.programador);
    if(d.municipio) municipios.add(d.municipio);
    if(d.cliente_estado) estados.add(d.cliente_estado);
    if(d.tipo_entidade) tiposEntidade.add(d.tipo_entidade);
    if(d.forma_atendimento){
      d.forma_atendimento.split(",").map(s=>s.trim()).filter(Boolean).forEach(fa => formasAtendimento.add(fa));
    }
    if(d.assunto) assuntos.add(d.assunto);
  }

  popularSelectComSet("filtro-atendente", atendentes, "Suporte");
  popularSelectComSet("filtro-programador", programadores, "Programador");
  popularSelectComSet("filtro-municipio", municipios, "Município");
  popularSelectComSet("filtro-estado", estados, "Estado (Cliente)");
  popularSelectComSet("filtro-tipo-entidade", tiposEntidade, "Tipo Entidade");

  renderizarSugestoesChips("sugs-assunto", assuntos, (valor)=>{ byId("dem-assunto").value = valor; });
  renderizarSugestoesChips("sugs-forma-atendimento", formasAtendimento, (valor)=>{
    const campo = byId("dem-forma-atendimento");
    if(!campo.value) campo.value = valor;
    else{
      const parts = campo.value.split(",").map(s=>s.trim()).filter(Boolean);
      if(!parts.includes(valor)) campo.value = campo.value.trim() + ", " + valor;
    }
  });

  // sugestão programador: nomes do cache usuariosCache (já respeita regra)
  const nomesProg = new Set(usuariosCache.map(u => u.nome).filter(Boolean));
  renderizarSugestoesChips("sugs-programador", nomesProg, (valor)=>{ byId("dem-programador").value = valor; });
}

function popularSelectComSet(selectId, setValores, labelPadrao){
  const select = byId(selectId);
  if(!select) return;

  const valorAtual = select.value || "TODOS";
  select.innerHTML = "";

  const optTodos = document.createElement("option");
  optTodos.value = "TODOS";
  optTodos.textContent = `Todos (${labelPadrao})`;
  select.appendChild(optTodos);

  Array.from(setValores).sort((a,b)=>a.localeCompare(b,"pt-BR")).forEach(v=>{
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });

  select.value = Array.from(setValores).includes(valorAtual) ? valorAtual : "TODOS";
}

function renderizarSugestoesChips(containerId, setValores, onClickValor){
  const cont = byId(containerId);
  if(!cont) return;
  cont.innerHTML = "";

  const arr = Array.from(setValores).sort((a,b)=>a.localeCompare(b,"pt-BR"));
  if(arr.length === 0){
    cont.innerHTML = '<span class="hint">Sem sugestões ainda.</span>';
    return;
  }

  for(const valor of arr){
    const span = document.createElement("span");
    span.classList.add("chip-sugestao");
    span.textContent = valor;
    span.addEventListener("click", ()=>onClickValor(valor));
    cont.appendChild(span);
  }
}

// filtros handlers
function onFiltroStatusChange(){ filtrosAtuais.status = byId("filtro-status").value; renderizarDemandas(); }
function onFiltroAtendenteChange(){ filtrosAtuais.atendente = byId("filtro-atendente").value; renderizarDemandas(); }
function onFiltroProgramadorChange(){ filtrosAtuais.programador = byId("filtro-programador").value; renderizarDemandas(); }
function onFiltroMunicipioChange(){ filtrosAtuais.municipio = byId("filtro-municipio").value; renderizarDemandas(); }
function onFiltroEstadoChange(){ filtrosAtuais.estado = byId("filtro-estado").value; renderizarDemandas(); }
function onFiltroTipoEntidadeChange(){ filtrosAtuais.tipoEntidade = byId("filtro-tipo-entidade").value; renderizarDemandas(); }
function onFiltroOcultarConcluidasChange(){ filtrosAtuais.ocultarConcluidas = byId("filtro-ocultar-concluidas").checked; renderizarDemandas(); }
function onFiltroConsultarTodasChange(){ filtrosAtuais.consultarTodas = byId("filtro-consultar-todas").checked; renderizarDemandas(); }
function onBuscaTextoKeyup(){ filtrosAtuais.buscaTexto = byId("filtro-busca").value; renderizarDemandas(); }

// =========================
// GESTOR: usuários + top10
// =========================
async function carregarUsuariosGestor(){
  if(!ehGestor()) return;

  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("nome", { ascending:true });

  if(error){
    console.error("Erro ao carregar usuários (gestor):", error);
    alert("Erro ao carregar usuários: " + error.message);
    return;
  }

  renderizarUsuariosGestor(data || []);
}

function renderizarUsuariosGestor(lista){
  const tbody = byId("tabela-usuarios");
  tbody.innerHTML = "";

  for(const u of lista){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.nome || ""}</td>
      <td>${u.email || ""}</td>
      <td>${u.tipo || ""}</td>
      <td>${u.unidade || ""}</td>
      <td><span class="badge-status ${u.status || ""}">${u.status || ""}</span></td>
      <td>
        <div class="acao-botoes">
          <button class="btn-xs" data-a="ATIVO">Ativar</button>
          <button class="btn-xs" data-a="PENDENTE">Pendente</button>
          <button class="btn-xs" data-a="INATIVO">Inativar</button>
          <button class="btn-xs" data-a="EDITAR">Editar</button>
          <button class="btn-xs" data-a="EXCLUIR">Excluir</button>
        </div>
      </td>
    `;

    tr.querySelectorAll("button.btn-xs").forEach(btn => {
      btn.addEventListener("click", async () => {
        const a = btn.getAttribute("data-a");
        if(a === "EDITAR") return editarUsuarioPrompt(u);
        if(a === "EXCLUIR") return excluirUsuario(u.id);
        return atualizarStatusUsuario(u.id, a);
      });
    });

    tbody.appendChild(tr);
  }
}

async function atualizarStatusUsuario(userId, novoStatus){
  if(!ehGestor()) return;

  const { error } = await supabaseClient.from("usuarios").update({ status: novoStatus }).eq("id", userId);
  if(error){
    console.error("Erro ao atualizar status:", error);
    alert("Erro ao atualizar status: " + error.message);
    return;
  }
  alert("Status atualizado com sucesso!");
  await carregarUsuariosGestor();
}

async function editarUsuarioPrompt(u){
  if(!ehGestor()) return;

  const novoNome = prompt("Novo nome:", u.nome || "");
  if(novoNome === null) return;

  const novoEmail = prompt("Novo email:", u.email || "");
  if(novoEmail === null) return;

  const novoTipo = prompt("Tipo (GESTOR, SUPORTE, PROGRAMADOR):", u.tipo || "");
  if(novoTipo === null) return;

  const novaUnidade = prompt("Unidade:", u.unidade || "");
  if(novaUnidade === null) return;

  const { error } = await supabaseClient.from("usuarios").update({
    nome: novoNome.trim(),
    email: novoEmail.trim(),
    tipo: novoTipo.trim().toUpperCase(),
    unidade: novaUnidade.trim()
  }).eq("id", u.id);

  if(error){
    console.error("Erro ao editar usuário:", error);
    alert("Erro ao editar usuário: " + error.message);
    return;
  }

  alert("Usuário atualizado com sucesso!");
  await carregarUsuariosGestor();
}

async function excluirUsuario(userId){
  if(!ehGestor()) return;
  if(!confirm("Tem certeza que deseja excluir este usuário?")) return;

  const { error } = await supabaseClient.from("usuarios").delete().eq("id", userId);
  if(error){
    console.error("Erro ao excluir usuário:", error);
    alert("Erro ao excluir usuário: " + error.message);
    return;
  }

  alert("Usuário excluído com sucesso!");
  await carregarUsuariosGestor();
}

function renderTop10Gestor(){
  if(!ehGestor()) return;

  const topCad = [...demandasCache]
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
    .slice(0,10);

  const topCon = [...demandasCache]
    .filter(d => (d.status||"").toUpperCase() === "CONCLUÍDA")
    .sort((a,b)=>new Date(b.updated_at||b.created_at)-new Date(a.updated_at||a.created_at))
    .slice(0,10);

  const tb1 = byId("gestor-top10-cadastradas");
  const tb2 = byId("gestor-top10-concluidas");
  if(tb1){
    tb1.innerHTML = topCad.map(d => `
      <tr>
        <td><span class="codigo">${d.codigo||""}</span></td>
        <td>${d.municipio||""}</td>
        <td>${d.assunto||""}</td>
        <td>${formatarDataHoraBr(d.created_at)}</td>
      </tr>
    `).join("");
  }
  if(tb2){
    tb2.innerHTML = topCon.map(d => `
      <tr>
        <td><span class="codigo">${d.codigo||""}</span></td>
        <td>${d.municipio||""}</td>
        <td>${d.assunto||""}</td>
        <td>${formatarDataHoraBr(d.updated_at||d.created_at)}</td>
      </tr>
    `).join("");
  }
}

// =========================
// LISTENERS
// =========================
function registrarListeners(){
  byId("btn-login")?.addEventListener("click", login);
  byId("btn-cadastrar")?.addEventListener("click", cadastrarNovoUsuario);
  byId("btn-logout")?.addEventListener("click", logout);

  byId("form-demanda")?.addEventListener("submit", salvarDemanda);
  byId("form-atualizacao-demanda")?.addEventListener("submit", salvarAtualizacaoDemanda);

  byId("form-cliente")?.addEventListener("submit", salvarCliente);

  byId("filtro-status")?.addEventListener("change", onFiltroStatusChange);
  byId("filtro-atendente")?.addEventListener("change", onFiltroAtendenteChange);
  byId("filtro-programador")?.addEventListener("change", onFiltroProgramadorChange);
  byId("filtro-municipio")?.addEventListener("change", onFiltroMunicipioChange);
  byId("filtro-estado")?.addEventListener("change", onFiltroEstadoChange);
  byId("filtro-tipo-entidade")?.addEventListener("change", onFiltroTipoEntidadeChange);
  byId("filtro-ocultar-concluidas")?.addEventListener("change", onFiltroOcultarConcluidasChange);
  byId("filtro-consultar-todas")?.addEventListener("change", onFiltroConsultarTodasChange);
  byId("filtro-busca")?.addEventListener("keyup", onBuscaTextoKeyup);

  // Modal demanda
  byId("btn-fechar-modal")?.addEventListener("click", fecharModal);
  byId("modal-overlay")?.addEventListener("click", fecharModal);

  // Modal atualização
  byId("btn-fechar-upd")?.addEventListener("click", fecharModalAtualizacao);
  byId("modal-upd-overlay")?.addEventListener("click", fecharModalAtualizacao);

  // TAGS: vírgula ou Enter
  const tagsInput = byId("dem-tags-input");
  tagsInput?.addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === ","){
      e.preventDefault();
      adicionarTagsDoInput();
    }
  });

  // botão gráficos
  byId("btn-graficos")?.addEventListener("click", () => {
    alert("Tela de gráficos pode ser implementada com Chart.js usando demandasCache.");
  });

  // ESC fecha modais
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      fecharModal();
      fecharModalAtualizacao();
    }
  });
}

window.addEventListener("load", inicializarApp);
