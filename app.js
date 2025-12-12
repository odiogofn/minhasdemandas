// =========================
// CONFIGURAÇÃO SUPABASE
// =========================
const SUPABASE_URL = "https://cmxepgkkdvyfraesvqly.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGVwZ2trZHZ5ZnJhZXN2cWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3ODA2NDksImV4cCI6MjA4MDM1NjY0OX0.rQMjA0pyJ2gWvPlyuQr0DccdkUs24NQTdsQvgiN2QXY";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserProfile = null;
let currentSession = null;

let demandasCache = [];

// ✅ separados (pra não “sumir” usuário do gestor)
let usuariosAtivosCache = [];   // usado pra encaminhar/sugestões (id,nome,tipo,status)
let usuariosGestorCache = [];   // usado na tabela do gestor (select *)

let filtrosAtuais = {
  buscaTexto: "",
  ocultarConcluidas: false,
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
  const re = /^[A-Za-z0-9]{1,10}$/;
  return re.test(senha);
}

function ehGestor(){ return currentUserProfile && currentUserProfile.tipo === "GESTOR"; }
function ehAtendente(){ return currentUserProfile && currentUserProfile.tipo === "ATENDENTE"; }
function ehProgramador(){ return currentUserProfile && currentUserProfile.tipo === "PROGRAMADOR"; }

function setStatusBar(texto){ setText("status-bar", texto); }

// Permissões de demanda:
function podeEditarOuExcluir(d){
  if(!currentUserProfile || !d) return false;
  if(ehGestor()) return true;
  if(ehAtendente() && d.user_id === currentUserProfile.id) return true;
  return false;
}
function podeEncaminhar(d){
  if(!currentUserProfile || !d) return false;
  if(ehGestor()) return true;
  if(ehAtendente() && d.user_id === currentUserProfile.id) return true;
  return false;
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

function mostrarApp(){
  hide("auth-container");
  show("app-container");

  setText("user-label", `${currentUserProfile.nome} (${currentUserProfile.tipo} · ${currentUserProfile.unidade || "-"})`);
  ajustarInterfacePorPerfil();

  // ✅ carregar caches sem conflitar
  carregarUsuariosAtivosParaEncaminhar();
  carregarDemandas();

  if(ehGestor()){
    carregarUsuariosGestor(); // ✅ agora sempre renderiza no painel do gestor
  }
}

function ajustarInterfacePorPerfil(){
  const ajudaEl = byId("ajuda-perfil");
  if(ehProgramador()){
    hide("sec-cadastro-demanda");
    hide("sec-painel-gestor");
    if(ajudaEl) ajudaEl.textContent = "Perfil Programador: você visualiza suas demandas e registra atualizações.";
  } else if(ehAtendente()){
    show("sec-cadastro-demanda");
    hide("sec-painel-gestor");
    if(ajudaEl) ajudaEl.textContent = "Perfil Atendente: você cadastra, edita e exclui as demandas que criar.";
  } else if(ehGestor()){
    show("sec-cadastro-demanda");
    show("sec-painel-gestor");
    if(ajudaEl) ajudaEl.textContent = "Perfil Gestor: você acompanha a produção, gerencia usuários e demandas.";
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
  usuariosAtivosCache = [];
  usuariosGestorCache = [];
  mostrarTelaAuth();
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
  if(!currentUserProfile){
    alert("Faça login antes de cadastrar demanda.");
    return;
  }
  if(!ehAtendente() && !ehGestor()){
    alert("Apenas Atendentes ou Gestores podem cadastrar demandas.");
    return;
  }

  const municipio = byId("dem-municipio").value.trim().toUpperCase();
  const tipoEntidade = byId("dem-tipo-entidade").value.trim().toUpperCase();
  const contatoCliente = byId("dem-contato-cliente").value.trim();
  const estado = byId("dem-estado").value;
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

  const atendente = currentUserProfile.nome;
  const agoraLocal = new Date().toLocaleString("pt-BR");
  const codigo = await gerarCodigoDemanda();

  setStatusBar("Salvando demanda...");

  const payload = {
    user_id: currentUserProfile.id,
    codigo,
    municipio,
    tipo_entidade: tipoEntidade || null,
    contato_cliente: contatoCliente || null,
    estado: estado || null,
    assunto,
    descricao,
    programador: programador || null,
    encaminhar_para: programador || null,
    forma_atendimento: formaAtendimento || null,
    prioridade: prioridade || "MÉDIA",
    status: statusDemanda || "ABERTA",
    atendente,
    link_trello: linkTrello || null,
    link_email: linkEmail || null,
    data_hora_local: agoraLocal,
  };

  const { error } = await supabaseClient.from("demandas").insert([payload]);

  if(error){
    console.error("Erro ao salvar demanda:", error);
    setStatusBar("Erro ao salvar demanda: " + error.message);
    alert("Erro ao salvar demanda: " + error.message);
    return;
  }

  byId("form-demanda").reset();
  setStatusBar("Demanda salva com sucesso!");
  await carregarDemandas();
}

async function carregarDemandas(){
  if(!currentUserProfile) return;
  setStatusBar("Carregando demandas...");

  let q = supabaseClient.from("demandas").select("*").order("created_at", { ascending:false });

  if(ehProgramador()){
    q = q.or(`programador.eq.${currentUserProfile.nome},encaminhar_para.eq.${currentUserProfile.nome}`);
  }

  const { data, error } = await q;
  if(error){
    console.error("Erro ao carregar demandas:", error);
    setStatusBar("Erro ao carregar demandas: " + error.message);
    return;
  }

  demandasCache = data || [];
  atualizarFiltrosSugestoes();
  renderizarDemandas();
  setStatusBar("Pronto");
}

function renderizarDemandas(){
  const tbody = byId("tabela-demandas");
  tbody.innerHTML = "";

  let lista = [...demandasCache];

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
    lista = lista.filter(d => (d.estado || "") === filtrosAtuais.estado);
  }
  if(filtrosAtuais.tipoEntidade !== "TODOS"){
    lista = lista.filter(d => (d.tipo_entidade || "") === filtrosAtuais.tipoEntidade);
  }

  if(filtrosAtuais.buscaTexto.trim() !== ""){
    const termo = filtrosAtuais.buscaTexto.toLowerCase();
    lista = lista.filter(d =>
      (d.descricao || "").toLowerCase().includes(termo) ||
      (d.assunto || "").toLowerCase().includes(termo) ||
      (d.codigo || "").toLowerCase().includes(termo)
    );
  }

  for(const d of lista){
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><span class="codigo">${d.codigo || "-"}</span></td>
      <td>${d.municipio || ""}</td>
      <td>${d.assunto || ""}</td>
      <td>${d.status || ""}</td>
      <td>${d.prioridade || ""}</td>
      <td>
        <div class="row-actions">
          <button class="btn-mini" data-action="detalhes" data-id="${d.id}">Detalhes</button>
          <button class="btn-mini" data-action="editar" data-id="${d.id}">Editar</button>
          <button class="btn-mini" data-action="excluir" data-id="${d.id}">Excluir</button>
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

    if(!podeEditarOuExcluir(d)){
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
  if(!podeEditarOuExcluir(d)){
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
  if(!podeEditarOuExcluir(d)){
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
// MODAL (DETALHES + ENCAMINHAR + ATUALIZAÇÕES)
// =========================
function abrirModal(){
  show("modal-overlay");
  show("modal-detalhes");
}
function fecharModal(){
  hide("modal-overlay");
  hide("modal-detalhes");
}

async function abrirModalDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  byId("det-demanda-id").value = d.id;
  setText("modal-titulo", `Demanda ${d.codigo || ""}`);
  setText("modal-subtitulo", `${d.municipio || "-"} · ${d.assunto || "-"}`);

  setText("det-codigo", d.codigo || "-");
  setText("det-municipio", d.municipio || "-");
  setText("det-tipo-entidade", d.tipo_entidade || "-");
  setText("det-contato-cliente", d.contato_cliente || "-");
  setText("det-estado", d.estado || "-");
  setText("det-assunto", d.assunto || "-");
  setText("det-descricao", d.descricao || "-");
  setText("det-programador", d.programador || "-");
  setText("det-encaminhar-para", d.encaminhar_para || "-");
  setText("det-forma-atendimento", d.forma_atendimento || "-");
  setText("det-prioridade", d.prioridade || "-");
  setText("det-status", d.status || "-");
  setText("det-atendente", d.atendente || "-");
  setText("det-link-trello", d.link_trello || "-");
  setText("det-link-email", d.link_email || "-");
  setText("det-criado-em", formatarDataHoraBr(d.created_at));

  if(podeEncaminhar(d)){
    show("card-encaminhar");
    await popularSelectEncaminhar(d);
  } else {
    hide("card-encaminhar");
  }

  if(podeEditarOuExcluir(d)){
    show("card-editar");
    show("card-excluir");
  } else {
    hide("card-editar");
    hide("card-excluir");
  }

  byId("btn-encaminhar").onclick = async () => { await encaminharDemanda(d.id); };
  byId("btn-editar-demanda").onclick = async () => { await editarDemanda(d.id); await abrirModalDemanda(d.id); };
  byId("btn-excluir-demanda").onclick = async () => { await excluirDemanda(d.id); fecharModal(); };

  abrirModal();
  await carregarAtualizacoesDemanda(d.id);
}

async function popularSelectEncaminhar(d){
  const sel = byId("sel-encaminhar-usuario");
  sel.innerHTML = "";

  // ✅ gestor usa cache completo (se existir), senão usa cache de ativos
  const base = (ehGestor() && usuariosGestorCache.length) ? usuariosGestorCache : usuariosAtivosCache;
  const ativos = base.filter(u => (u.status || "").toUpperCase() === "ATIVO");

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Selecione...";
  sel.appendChild(opt0);

  ativos
    .sort((a,b) => (a.nome || "").localeCompare((b.nome || ""), "pt-BR"))
    .forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.nome;
      opt.textContent = `${u.nome} (${u.tipo})`;
      sel.appendChild(opt);
    });

  const atual = d.encaminhar_para || d.programador || "";
  if(atual){
    const found = ativos.find(u => u.nome === atual);
    if(found) sel.value = atual;
  }
}

async function encaminharDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;
  if(!podeEncaminhar(d)){
    alert("Você não tem permissão para encaminhar esta demanda.");
    return;
  }

  const destinoNome = byId("sel-encaminhar-usuario").value;
  if(!destinoNome){
    alert("Selecione um usuário para encaminhar.");
    return;
  }

  const payload = { programador: destinoNome, encaminhar_para: destinoNome, status: "ENCAMINHADA" };

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
// ATUALIZAÇÕES
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
    li.innerHTML = `
      <div><strong>${a.usuario_nome || "Usuário"}</strong> – <span class="muted">${formatarDataHoraBr(a.created_at)}</span></div>
      <div>${a.mensagem || ""}</div>
    `;
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

// =========================
// FILTROS E SUGESTÕES
// =========================
async function carregarUsuariosAtivosParaEncaminhar(){
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("id,nome,tipo,status")
    .order("nome", { ascending: true });

  if(error){
    console.error("Erro ao carregar lista de usuários (ativos):", error);
    return;
  }
  usuariosAtivosCache = data || [];
}

function atualizarFiltrosSugestoes(){
  const atendentes = new Set();
  const programadores = new Set();
  const municipios = new Set();
  const estados = new Set();
  const tiposEntidade = new Set();
  const formasAtendimento = new Set();
  const assuntos = new Set();
  const contatosCliente = new Set();

  for(const d of demandasCache){
    if(d.atendente) atendentes.add(d.atendente);
    if(d.programador) programadores.add(d.programador);
    if(d.municipio) municipios.add(d.municipio);
    if(d.estado) estados.add(d.estado);
    if(d.tipo_entidade) tiposEntidade.add(d.tipo_entidade);
    if(d.forma_atendimento){
      d.forma_atendimento.split(",").map(s=>s.trim()).filter(Boolean).forEach(fa => formasAtendimento.add(fa));
    }
    if(d.assunto) assuntos.add(d.assunto);
    if(d.contato_cliente) contatosCliente.add(d.contato_cliente);
  }

  popularSelectComSet("filtro-atendente", atendentes, "Atendente");
  popularSelectComSet("filtro-programador", programadores, "Programador");
  popularSelectComSet("filtro-municipio", municipios, "Município");
  popularSelectComSet("filtro-estado", estados, "Estado");
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
  renderizarSugestoesChips("sugs-contato-cliente", contatosCliente, (valor)=>{ byId("dem-contato-cliente").value = valor; });

  // ✅ usa cache de ativos para sugestões (não depende do gestor)
  const ativosNomes = new Set(
    usuariosAtivosCache
      .filter(u => (u.status || "").toUpperCase() === "ATIVO")
      .map(u => u.nome)
      .filter(Boolean)
  );
  programadores.forEach(n => ativosNomes.add(n));
  renderizarSugestoesChips("sugs-programador", ativosNomes, (valor)=>{ byId("dem-programador").value = valor; });
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

function onFiltroStatusChange(){ filtrosAtuais.status = byId("filtro-status").value; renderizarDemandas(); }
function onFiltroAtendenteChange(){ filtrosAtuais.atendente = byId("filtro-atendente").value; renderizarDemandas(); }
function onFiltroProgramadorChange(){ filtrosAtuais.programador = byId("filtro-programador").value; renderizarDemandas(); }
function onFiltroMunicipioChange(){ filtrosAtuais.municipio = byId("filtro-municipio").value; renderizarDemandas(); }
function onFiltroEstadoChange(){ filtrosAtuais.estado = byId("filtro-estado").value; renderizarDemandas(); }
function onFiltroTipoEntidadeChange(){ filtrosAtuais.tipoEntidade = byId("filtro-tipo-entidade").value; renderizarDemandas(); }
function onFiltroOcultarConcluidasChange(){ filtrosAtuais.ocultarConcluidas = byId("filtro-ocultar-concluidas").checked; renderizarDemandas(); }
function onBuscaTextoKeyup(){ filtrosAtuais.buscaTexto = byId("filtro-busca").value; renderizarDemandas(); }

// =========================
// GESTÃO DE USUÁRIOS (GESTOR)  ✅ AQUI O FIX
// =========================
async function carregarUsuariosGestor(){
  if(!ehGestor()) return;

  const tbody = byId("tabela-usuarios");
  if(tbody) tbody.innerHTML = `<tr><td colspan="6">Carregando usuários...</td></tr>`;

  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("nome", { ascending:true });

  if(error){
    console.error("Erro ao carregar usuários (gestor):", error);
    if(tbody) tbody.innerHTML = `<tr><td colspan="6">Erro ao carregar usuários. Verifique RLS.</td></tr>`;
    return;
  }

  usuariosGestorCache = data || [];
  renderizarUsuariosGestor();
}

function renderizarUsuariosGestor(){
  const tbody = byId("tabela-usuarios");
  if(!tbody) return;

  tbody.innerHTML = "";

  if(!usuariosGestorCache.length){
    tbody.innerHTML = `<tr><td colspan="6">Nenhum usuário encontrado.</td></tr>`;
    return;
  }

  for(const u of usuariosGestorCache){
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
  const novoNome = prompt("Novo nome:", u.nome || "");
  if(novoNome === null) return;
  const novoEmail = prompt("Novo email:", u.email || "");
  if(novoEmail === null) return;

  const { error } = await supabaseClient.from("usuarios").update({
    nome: novoNome.trim(),
    email: novoEmail.trim()
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

// =========================
// LISTENERS
// =========================
function registrarListeners(){
  byId("btn-login")?.addEventListener("click", login);
  byId("btn-cadastrar")?.addEventListener("click", cadastrarNovoUsuario);
  byId("btn-logout")?.addEventListener("click", logout);
  byId("form-demanda")?.addEventListener("submit", salvarDemanda);
  byId("form-atualizacao-demanda")?.addEventListener("submit", salvarAtualizacaoDemanda);

  byId("filtro-status")?.addEventListener("change", onFiltroStatusChange);
  byId("filtro-atendente")?.addEventListener("change", onFiltroAtendenteChange);
  byId("filtro-programador")?.addEventListener("change", onFiltroProgramadorChange);
  byId("filtro-municipio")?.addEventListener("change", onFiltroMunicipioChange);
  byId("filtro-estado")?.addEventListener("change", onFiltroEstadoChange);
  byId("filtro-tipo-entidade")?.addEventListener("change", onFiltroTipoEntidadeChange);
  byId("filtro-ocultar-concluidas")?.addEventListener("change", onFiltroOcultarConcluidasChange);
  byId("filtro-busca")?.addEventListener("keyup", onBuscaTextoKeyup);

  byId("btn-fechar-modal")?.addEventListener("click", fecharModal);
  byId("modal-overlay")?.addEventListener("click", fecharModal);

  byId("btn-graficos")?.addEventListener("click", () => {
    alert("Tela de gráficos pode ser implementada com Chart.js usando demandasCache.");
  });

  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      fecharModal();
    }
  });
}

window.addEventListener("load", inicializarApp);
