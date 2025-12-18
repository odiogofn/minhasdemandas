// =========================
// SISTEMA DE DEMANDAS - app.js (refeito)
// Compatível com index_v4.html
// =========================

// =========================
// CONFIGURAÇÃO SUPABASE
// =========================
const SUPABASE_URL = "https://cmxepgkkdvyfraesvqly.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGVwZ2trZHZ5ZnJhZXN2cWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3ODA2NDksImV4cCI6MjA4MDM1NjY0OX0.rQMjA0pyJ2gWvPlyuQr0DccdkUs24NQTdsQvgiN2QXY";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================
// ESTADO GLOBAL
// =========================
let currentUserProfile = null;
let currentSession = null;

let demandasCache = [];
let selectedClienteDemanda = null;
let usuariosCache = [];
let clientesCache = [];

let tagsAtuais = [];
let formasAtendimentoAtuais = [];

let filtrosAtuais = {
  buscaTexto: "",
  ocultarConcluidas: false,
  consultarTodas: false,
  status: "TODOS",
  atendente: "TODOS",
  programador: "TODOS",
  municipio: "TODOS",
  estado: "TODOS",
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
  if(isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString("pt-BR");
}

function normalizarTextoUpper(v) {
  return (v || "").toString().trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizarEstadoSigla(v){
  const raw = (v || "").toString().trim().toUpperCase();

  // Mapeamentos solicitados (mantidos exatamente como você pediu)
  const mapa = {
    "CEARÁ": "CE",
    "CEARA": "CE",
    "RIO GRANDE DO NORTE": "RN",
    "AMAPÁ": "AM",
    "AMAPA": "AM",
    "MARANHÃO": "MA",
    "MARANHAO": "MA",
    "PARÁ": "PA",
    "PARA": "PA",
  };

  if(mapa[raw]) return mapa[raw];
  if(/^[A-Z]{2}$/.test(raw)) return raw;
  return raw;
}

function tipoPerfil(){
  return (currentUserProfile?.tipo || "").toString().trim().toUpperCase();
}
function ehGestor(){ return tipoPerfil() === "GESTOR"; }
function ehSuporte(){ return tipoPerfil() === "SUPORTE"; }
function ehProgramador(){ return tipoPerfil() === "PROGRAMADOR"; }

function setStatusBar(texto){ setText("status-bar", texto); }
function setStatusClientes(texto){ setText("status-clientes", texto); }

function validarSenhaSimples(senha){
  return /^[A-Za-z0-9]{1,10}$/.test(senha || "");
}

// ==========================
// TABS (UI)
// ==========================
const TAB_SECTION_IDS = ["sec-lista-demandas","sec-cadastro-demanda","sec-clientes","sec-usuarios","sec-painel-gestor"];

function setActiveTab(sectionId){
  TAB_SECTION_IDS.forEach(id=>{
    const el = byId(id);
    if(!el) return;
    if(id === sectionId) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });

  const btns = document.querySelectorAll("#tabs-main .tab-btn");
  btns.forEach(b=>{
    const tid = b.getAttribute("data-tab");
    if(tid === sectionId) b.classList.add("active");
    else b.classList.remove("active");
  });
}

function pickFirstVisibleTab(){
  const btns = Array.from(document.querySelectorAll("#tabs-main .tab-btn"))
    .filter(b=>!b.classList.contains("hidden"));
  if(btns.length === 0) return null;
  return btns[0].getAttribute("data-tab");
}

function ajustarInterfacePorPerfil(){
  const ajudaEl = byId("ajuda-perfil");

  // Abas / Seções por perfil
  // Usuários: apenas gestor
  if(ehGestor()){
    show("sec-usuarios");
    const btnUsuarios = byId("tab-usuarios");
    if(btnUsuarios) btnUsuarios.classList.remove("hidden");
  } else {
    hide("sec-usuarios");
    const btnUsuarios = byId("tab-usuarios");
    if(btnUsuarios) btnUsuarios.classList.add("hidden");
  }

  // Clientes: gestor e suporte
  if(ehGestor() || ehSuporte()){
    show("sec-clientes");
    const btnClientes = byId("tab-clientes");
    if(btnClientes) btnClientes.classList.remove("hidden");
  } else {
    hide("sec-clientes");
    const btnClientes = byId("tab-clientes");
    if(btnClientes) btnClientes.classList.add("hidden");
  }

  // Cadastro de demanda: gestor e suporte
  if(ehGestor() || ehSuporte()){
    show("sec-cadastro-demanda");
    const btnCad = byId("tab-cad-demanda");
    if(btnCad) btnCad.classList.remove("hidden");
  } else {
    hide("sec-cadastro-demanda");
    const btnCad = byId("tab-cad-demanda");
    if(btnCad) btnCad.classList.add("hidden");
  }

  // Painel gestor: somente gestor (opcional/oculto para não poluir)
  if(ehGestor()) show("sec-painel-gestor");
  else hide("sec-painel-gestor");

  // Se aba atual ficou inacessível, troca
  const activeBtn = document.querySelector("#tabs-main .tab-btn.active");
  const activeTarget = activeBtn?.getAttribute("data-tab");
  const isActiveHidden = activeBtn?.classList.contains("hidden") || (activeTarget && byId(activeTarget)?.classList.contains("hidden"));
  if(!activeBtn || isActiveHidden){
    const first = pickFirstVisibleTab() || "sec-lista-demandas";
    setActiveTab(first);
  }

  if(ehProgramador()) {
    if(ajudaEl) ajudaEl.textContent = "Perfil Programador: você visualiza demandas (suas por padrão) e registra andamentos.";
  } else if(ehSuporte()) {
    if(ajudaEl) ajudaEl.textContent = "Perfil Suporte: cadastra demandas e clientes; edita/exclui suas demandas (ou tudo se for gestor).";
  } else if(ehGestor()) {
    if(ajudaEl) ajudaEl.textContent = "Perfil Gestor: gerencia usuários, clientes e acompanha demandas.";
  } else {
    if(ajudaEl) ajudaEl.textContent = "";
  }
}

// =========================
// PERMISSÕES
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

function podeDevolverDemanda(d){
  // Devolver: gestor ou suporte (quando em modo leitura total desabilita para não-gestor)
  if(!currentUserProfile || !d) return false;
  if(ehGestor()) return true;
  if(ehSuporte() && d.user_id === currentUserProfile.id) return true;
  return false;
}

// Atualizações
function podeEditarOuExcluirAtualizacao(a){
  if(!currentUserProfile || !a) return false;
  if(ehGestor()) return true;
  return a.usuario_id === currentUserProfile.id;
}

// =========================
// AUTH
// =========================
document.addEventListener("DOMContentLoaded", () => {
  registrarListeners();
  inicializarApp();
});

async function inicializarApp(){
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if(error) console.error("Erro ao obter sessão:", error);
    currentSession = data?.session || null;

    if(currentSession){
      await carregarPerfilUsuarioAtual();
      if(currentUserProfile) mostrarApp();
      else mostrarTelaAuth();
    } else {
      mostrarTelaAuth();
    }
  } catch (e) {
    console.error("Falha ao inicializar:", e);
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

  setText("user-label", `${currentUserProfile.nome} (${tipoPerfil()} · ${currentUserProfile.unidade || "-"})`);
  ajustarInterfacePorPerfil();

  // Aba inicial
  if(byId("tabs-main")) setActiveTab("sec-lista-demandas");

  // Carregamentos base
  carregarUsuariosCache();
  carregarClientes();
  carregarDemandas();

  if(ehGestor()) carregarUsuariosGestor();
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
  const nome = (byId("cad-nome")?.value || "").trim();
  const email = (byId("cad-email")?.value || "").trim();
  const dtNasc = byId("cad-dt-nasc")?.value || "";
  const unidade = byId("cad-unidade")?.value || "";
  const tipo = byId("cad-tipo")?.value || "PROGRAMADOR";
  const senha = byId("cad-senha")?.value || "";
  const senha2 = byId("cad-senha2")?.value || "";

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
  const email = (byId("login-email")?.value || "").trim();
  const senha = byId("login-senha")?.value || "";

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
  formasAtendimentoAtuais = [];
  mostrarTelaAuth();
}

// =========================
// CLIENTES (CRUD) - 6 campos
// cliente, tipo_entidade, municipio, estado,  telefone
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
/* =========================
   BUSCA EM TEMPO REAL - CLIENTES (DEMANDA)
========================= */
let __buscaTimerCliente = null;

async function buscarClientesTempoReal(termo){
  const t = (termo || "").trim();
  if(!t) return [];

  const like = `%${t}%`;

  const { data, error } = await supabaseClient
    .from("clientes")
    .select("id,cliente,municipio,estado,tipo_entidade,tipo")
    .or(`cliente.ilike.${like},municipio.ilike.${like},tipo_entidade.ilike.${like},tipo.ilike.${like}`)
    .order("cliente", { ascending: true })
    .limit(10);

  if(error){
    console.error("Erro ao buscar clientes (tempo real):", error);
    return [];
  }

  return (data || []).map(c => ({
    ...c,
    tipo_entidade: c.tipo_entidade || c.tipo || ""
  }));
}

function renderResultadosClientes(lista){
  const box = byId("dem-cliente-resultados");
  if(!box) return;

  if(!lista || lista.length === 0){
    box.innerHTML = `<div class="typeahead-empty">Nenhum resultado.</div>`;
    box.classList.remove("hidden");
    return;
  }

  box.innerHTML = "";
  for(const c of lista){
    const item = document.createElement("button");
    item.type = "button";
    item.className = "typeahead-item";
    item.innerHTML = `
      <div class="t-main">${(c.cliente || "")}</div>
      <div class="t-sub">${(c.municipio || "")} · ${(c.tipo_entidade || "")}</div>
    `;
    item.addEventListener("click", () => {
      aplicarClienteNaTelaDemanda(c);
      const inp = byId("dem-cliente-busca");
      if(inp) inp.value = c.cliente || "";
    });
    box.appendChild(item);
  }
  box.classList.remove("hidden");
}

function limparSelecaoClienteDemanda(){
  selectedClienteDemanda = null;
  const ids = ["dem-cliente-id","dem-cliente-nome","dem-cliente-tipo-entidade","dem-municipio","dem-cliente-estado"];
  for(const id of ids){
    const el = byId(id);
    if(el) el.value = "";
  }
}

function instalarBuscaClientesUI(){
  const input = byId("dem-cliente-busca");
  const box = byId("dem-cliente-resultados");
  if(!input || !box) return;

  input.addEventListener("input", () => {
    const termo = input.value;
    limparSelecaoClienteDemanda();

    if(__buscaTimerCliente) clearTimeout(__buscaTimerCliente);
    __buscaTimerCliente = setTimeout(async () => {
      const lista = await buscarClientesTempoReal(termo);
      renderResultadosClientes(lista);
    }, 250);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => box.classList.add("hidden"), 180);
  });

  input.addEventListener("focus", async () => {
    if((input.value || "").trim().length >= 2){
      const lista = await buscarClientesTempoReal(input.value);
      renderResultadosClientes(lista);
    }
  });
}


function renderizarClientes(){
  const tbody = byId("tabela-clientes");
  if(!tbody) return;
  tbody.innerHTML = "";

  if(!(ehGestor() || ehSuporte())) return;

  for(const c of clientesCache){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.cliente || ""}</td>
      <td>${c.tipo_entidade || ""}</td>
      <td>${c.municipio || ""}</td>
      <td>${c.estado || ""}</td>
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

  const cliente = normalizarTextoUpper(byId("cli-nome")?.value);
  const tipoEntidade = normalizarTextoUpper(byId("cli-tipo-entidade")?.value);
  const municipio = normalizarTextoUpper(byId("cli-municipio")?.value);
  const estado = normalizarEstadoSigla(byId("cli-estado")?.value || "");

  if(!cliente || !tipoEntidade || !municipio || !estado){
    alert("Preencha Cliente, Tipo Entidade, Município e Estado (sigla).");
    return;
  }

  setStatusClientes("Salvando cliente...");

  const { error } = await supabaseClient.from("clientes").insert([{
    cliente,
tipo_entidade: tipoEntidade,
tipo: tipoEntidade, // compatibilidade com schema antigo (NOT NULL)
municipio,
estado
    
  }]);

  if(error){
    console.error("Erro ao salvar cliente:", error);
    setStatusClientes("Erro: " + error.message);
    alert("Erro ao salvar cliente: " + error.message);
    return;
  }

  byId("form-cliente")?.reset();
  setStatusClientes("Cliente salvo com sucesso!");
  await carregarClientes();
}

async function editarCliente(clienteId){
  const c = clientesCache.find(x => x.id === clienteId);
  if(!c) return;

  const novoCliente = prompt("Cliente:", c.cliente || "");
  if(novoCliente === null) return;

  const novoTipoEntidade = prompt("Tipo Entidade (AUTARQUIA, CM, PM, CONSORCIO, IPM):", c.tipo_entidade || "");
  if(novoTipoEntidade === null) return;

  const novoMunicipio = prompt("Município:", c.municipio || "");
  if(novoMunicipio === null) return;

  const novoEstado = prompt("Estado (sigla, ex: CE):", c.estado || "");
  if(novoEstado === null) return;
const { error } = await supabaseClient.from("clientes").update({
    cliente: normalizarTextoUpper(novoCliente),
    tipo_entidade: normalizarTextoUpper(novoTipoEntidade),
    tipo: normalizarTextoUpper(novoTipoEntidade), // compatibilidade com schema antigo (NOT NULL)
    municipio: normalizarTextoUpper(novoMunicipio),
    estado: normalizarEstadoSigla(novoEstado || ""),
    
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
// LOCALIZAR CLIENTE (demanda)
// =========================

function aplicarClienteNaTelaDemanda(c){
  selectedClienteDemanda = c || null;

  const setVal = (id, v) => { const el = byId(id); if(el) el.value = v || ""; };

  setVal("dem-cliente-id", c?.id || "");
  setVal("dem-cliente-nome", c?.cliente || "");
  setVal("dem-cliente-tipo-entidade", c?.tipo_entidade || c?.tipo || "");
  setVal("dem-municipio", c?.municipio || "");
  setVal("dem-cliente-estado", c?.estado || "");

  const box = byId("dem-cliente-resultados");
  if(box) box.classList.add("hidden");
}


// =========================
// SELECTS EM CASCATA (DEMANDA)
// Cliente -> Tipo Entidade -> Estado -> Contato -> Telefone + município readonly
// =========================
function montarSelectClientesParaDemanda(){
  // seleção de cliente na demanda agora é via pesquisa em tempo real (typeahead)
}


function preencherTiposEntidadePorCliente(clienteNome){
  const selTipo = byId("dem-cliente-tipo-entidade");
  if(!selTipo) return;

  selTipo.innerHTML = `<option value="">Selecione...</option>`;
  if(!clienteNome) return;

  const tipos = Array.from(
    new Set(clientesCache.filter(c => c.cliente === clienteNome).map(c => c.tipo_entidade).filter(Boolean))
  ).sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const t of tipos){
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    selTipo.appendChild(opt);
  }
}

function preencherEstadosPorClienteETipoEntidade(clienteNome, tipoEntidade){
  const selEstado = byId("dem-cliente-estado");
  if(!selEstado) return;

  selEstado.innerHTML = `<option value="">Selecione...</option>`;
  if(!clienteNome) return;

  const filtrados = clientesCache.filter(c => c.cliente === clienteNome && (!tipoEntidade || c.tipo_entidade === tipoEntidade));
  const estados = Array.from(new Set(filtrados.map(c => c.estado).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const e of estados){
    const opt = document.createElement("option");
    opt.value = e;
    opt.textContent = e;
    selEstado.appendChild(opt);
  }
}


function acharClienteSelecionado(){
  return selectedClienteDemanda;
}


// =========================
// TAGS (chips) - Demanda
// =========================
function normalizarTag(t){
  return normalizarTextoUpper(t);
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
// Forma de Atendimento (chips) - Demanda
// =========================
function renderizarFormaAtendimento(){
  const cont = byId("dem-forma-atendimento-chips");
  if(!cont) return;
  cont.innerHTML = "";

  for(const t of formasAtendimentoAtuais){
    const chip = document.createElement("span");
    chip.className = "chip-tag";
    chip.innerHTML = `${t} <button type="button" aria-label="Remover">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      formasAtendimentoAtuais = formasAtendimentoAtuais.filter(x => x !== t);
      renderizarFormaAtendimento();
    });
    cont.appendChild(chip);
  }
}

function adicionarFormaAtendimentoDoInput(){
  const input = byId("dem-forma-atendimento-input");
  if(!input) return;

  const bruto = input.value;
  const partes = bruto.split(",").map(normalizarTag).filter(Boolean);

  let mudou = false;
  for(const p of partes){
    if(!formasAtendimentoAtuais.includes(p)){
      formasAtendimentoAtuais.push(p);
      mudou = true;
    }
  }
  if(mudou) renderizarFormaAtendimento();

  input.value = "";
}

// =========================
// USUÁRIOS (CACHE / SELECTS)
// =========================
async function carregarUsuariosCache(){
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("id,nome,tipo,status,unidade,email")
    .order("nome", { ascending:true });

  if(error){
    console.error("Erro ao carregar usuários:", error);
    return;
  }

  usuariosCache = (data || []).filter(u => (u.status || "").toUpperCase() === "ATIVO");
  montarSelectProgramadores();
  montarSelectEncaminharCadastro();
  montarFiltrosUsuarios();
}

function montarSelectProgramadores(){
  const sel = byId("dem-programador");
  if(!sel) return;
  sel.innerHTML = `<option value="">Selecione...</option>`;

  const progs = usuariosCache.filter(u => (u.tipo || "").toUpperCase() === "PROGRAMADOR")
    .sort((a,b)=>(a.nome||"").localeCompare((b.nome||""),"pt-BR"));

  for(const u of progs){
    const opt = document.createElement("option");
    opt.value = u.nome;
    opt.textContent = u.nome;
    sel.appendChild(opt);
  }
}

function montarSelectEncaminharCadastro(){
  const sel = byId("dem-encaminhar-para");
  if(!sel) return;
  sel.innerHTML = `<option value="">Selecione...</option>`;

  const lista = [...usuariosCache].sort((a,b)=>(a.nome||"").localeCompare((b.nome||""),"pt-BR"));
  for(const u of lista){
    const opt = document.createElement("option");
    opt.value = u.id; // id do usuário
    opt.textContent = `${u.nome} (${u.tipo})`;
    sel.appendChild(opt);
  }
}

// =========================
// DEMANDAS
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

  // Cliente selecionado
  const cliSel = acharClienteSelecionado();
  if(!cliSel){
    alert("Selecione Cliente, Tipo Entidade, Estado e Contato (cadastro).");
    return;
  }

  const assunto = normalizarTextoUpper(byId("dem-assunto")?.value);
  const descricao = (byId("dem-descricao")?.value || "").trim();
  const programadorNome = (byId("dem-programador")?.value || "").trim(); // nome
  const statusDemanda = (byId("dem-status")?.value || "ABERTURA").trim().toUpperCase();
  const prioridade = (byId("dem-prioridade")?.value || "MÉDIA").trim().toUpperCase();
  const linkTrello = (byId("dem-link-trello")?.value || "").trim();
  const linkEmail = (byId("dem-link-email")?.value || "").trim();

  if(!assunto || !descricao){
    alert("Preencha Assunto e Descrição.");
    return;
  }

  const codigo = await gerarCodigoDemanda();
  const agoraLocal = new Date().toLocaleString("pt-BR");
  const atendenteNome = currentUserProfile.nome;

  // Encaminhar opcional
  const encaminharId = (byId("dem-encaminhar-para")?.value || "").trim();
  let encaminharParaNome = null;
  let statusFinal = statusDemanda;

  if(encaminharId){
    const dest = usuariosCache.find(u => u.id === encaminharId);
    if(dest){
      encaminharParaNome = dest.nome;
      statusFinal = "ENCAMINHADO";
    }
  }

  // se encaminhar para programador, programa "programador" fica igual ao destino
  let programadorFinal = programadorNome || null;
  if(encaminharId){
    const dest = usuariosCache.find(u => u.id === encaminharId);
    if(dest && (dest.tipo || "").toUpperCase() === "PROGRAMADOR"){
      programadorFinal = dest.nome;
    }
  }

  const municipioDemanda = cliSel.municipio || ""; // demanda município vem do cliente

  setStatusBar("Salvando demanda...");

  const payload = {
    user_id: currentUserProfile.id,
    codigo,
    municipio: municipioDemanda,

    cliente_id: cliSel.id,
    cliente_nome: cliSel.cliente,
    cliente_tipo_entidade: cliSel.tipo_entidade,
    cliente_tipo: cliSel.tipo_entidade, // compat
    cliente_municipio: cliSel.municipio,
    cliente_estado: cliSel.estado,
    assunto,
    descricao,
    programador: programadorFinal,
    encaminhar_para: encaminharParaNome || null,

    forma_atendimento: formasAtendimentoAtuais.length ? formasAtendimentoAtuais.join(", ") : null,
    prioridade: prioridade || "MÉDIA",
    status: statusFinal,
    atendente: atendenteNome,

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

  byId("form-demanda")?.reset();
  tagsAtuais = [];
  formasAtendimentoAtuais = [];
  renderizarTags();
  renderizarFormaAtendimento();

  // reseta selects cliente
  montarSelectClientesParaDemanda();

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

  setStatusBar("Pronto");
}

function aplicarVisibilidadeConsultas(lista){
  // por padrão: só vê suas demandas
  if(filtrosAtuais.consultarTodas) return lista;
  return lista.filter(d => d.user_id === currentUserProfile.id);
}

function renderizarDemandas(){
  const tbody = byId("tabela-demandas");
  if(!tbody) return;
  tbody.innerHTML = "";

  let lista = [...demandasCache];
  lista = aplicarVisibilidadeConsultas(lista);

  if(filtrosAtuais.ocultarConcluidas){
    lista = lista.filter(d => (d.status || "").toUpperCase() !== "CONCLUÍDO" && (d.status || "").toUpperCase() !== "CONCLUIDO");
  }

  if(filtrosAtuais.status !== "TODOS"){
    const st = filtrosAtuais.status.toUpperCase();
    lista = lista.filter(d => (d.status || "").toUpperCase() === st);
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

  if((filtrosAtuais.buscaTexto || "").trim() !== ""){
    const termo = filtrosAtuais.buscaTexto.toLowerCase();
    lista = lista.filter(d =>
      (d.descricao || "").toLowerCase().includes(termo) ||
      (d.assunto || "").toLowerCase().includes(termo) ||
      (d.codigo || "").toLowerCase().includes(termo) ||
      (d.cliente_nome || "").toLowerCase().includes(termo)
    );
  }

  const somenteLeitura = (filtrosAtuais.consultarTodas && !ehGestor());

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

    if(somenteLeitura && !ehGestor()){
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

  if(filtrosAtuais.consultarTodas && !ehGestor()){
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

  if(filtrosAtuais.consultarTodas && !ehGestor()){
    alert("Modo 'Consultar todas' é somente leitura.");
    return;
  }

  if(!podeEditarOuExcluirDemanda(d)){
    alert("Você não tem permissão para editar esta demanda.");
    return;
  }

  const assunto = prompt("Assunto:", d.assunto || "");
  if(assunto === null) return;
  const descricao = prompt("Descrição:", d.descricao || "");
  if(descricao === null) return;

  const status = prompt("Status (ABERTURA, EM ANDAMENTO, ENCAMINHADO, CONCLUÍDO):", d.status || "");
  if(status === null) return;

  const prioridade = prompt("Prioridade (BAIXA, MÉDIA, ALTA, URGENTE):", d.prioridade || "");
  if(prioridade === null) return;

  const payload = {
    assunto: normalizarTextoUpper(assunto),
    descricao: (descricao || "").trim(),
    status: normalizarTextoUpper(status),
    prioridade: normalizarTextoUpper(prioridade)
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
// MODAL DEMANDA + ENCAMINHAR/DEVOLVER + ATUALIZAÇÕES
// =========================
function abrirModal(){ show("modal-overlay"); show("modal-detalhes"); }
function fecharModal(){ hide("modal-overlay"); hide("modal-detalhes"); }

function abrirModalUpd(){ show("modal-upd-overlay"); show("modal-upd"); }
function fecharModalUpd(){ hide("modal-upd-overlay"); hide("modal-upd"); }

async function abrirModalDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  byId("det-demanda-id").value = d.id;

  setText("modal-titulo", `Demanda ${d.codigo || ""}`);
  setText("modal-subtitulo", `${d.municipio || "-"} · ${d.assunto || "-"}`);

  setText("det-codigo", d.codigo || "-");
  setText("det-municipio", d.municipio || "-");

  setText("det-cliente", d.cliente_nome || "-");
  setText("det-cliente-tipo", d.cliente_tipo_entidade || d.cliente_tipo || "-");
  setText("det-cliente-estado", d.cliente_estado || "-");
  setText("det-cliente-contato", "-");
  setText("det-cliente-telefone", "-");

  setText("det-tipo-entidade", d.tipo_entidade || (d.cliente_tipo_entidade || d.cliente_tipo || "-"));
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
  if(podeEncaminharDemanda(d) && (!filtrosAtuais.consultarTodas || ehGestor())){
    show("card-encaminhar");
    await popularSelectEncaminharModal(d);
  } else {
    hide("card-encaminhar");
  }

  // Botão devolver (para o criador)
  if(podeDevolverDemanda(d) && (!filtrosAtuais.consultarTodas || ehGestor())) {
    show("btn-devolver");
  } else {
    hide("btn-devolver");
  }

  // Editar/Excluir
  if(podeEditarOuExcluirDemanda(d) && (!filtrosAtuais.consultarTodas || ehGestor())){
    show("card-editar");
    show("card-excluir");
  } else {
    hide("card-editar");
    hide("card-excluir");
  }

  byId("btn-encaminhar").onclick = async () => encaminharDemanda(d.id);
  byId("btn-devolver").onclick = async () => devolverDemanda(d.id);
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

async function popularSelectEncaminharModal(d){
  const sel = byId("sel-encaminhar-usuario");
  if(!sel) return;
  sel.innerHTML = `<option value="">Selecione...</option>`;

  const lista = [...usuariosCache].sort((a,b)=>(a.nome||"").localeCompare((b.nome||""),"pt-BR"));
  for(const u of lista){
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = `${u.nome} (${u.tipo})`;
    sel.appendChild(opt);
  }

  // pré seleção por encaminhar_para (nome)
  const atualNome = d.encaminhar_para || "";
  const match = lista.find(u => u.nome === atualNome);
  if(match) sel.value = match.id;
}

async function encaminharDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(filtrosAtuais.consultarTodas && !ehGestor()){
    alert("Modo 'Consultar todas' é somente leitura.");
    return;
  }

  if(!podeEncaminharDemanda(d)){
    alert("Você não tem permissão para encaminhar esta demanda.");
    return;
  }

  const destinoId = byId("sel-encaminhar-usuario")?.value || "";
  if(!destinoId){
    alert("Selecione um usuário para encaminhar.");
    return;
  }

  const destino = usuariosCache.find(u => u.id === destinoId);
  if(!destino){
    alert("Usuário destino não encontrado (recarregue a página).");
    return;
  }

  const payload = {
    encaminhar_para: destino.nome,
    status: "ENCAMINHADO"
  };

  // regra: se destino for PROGRAMADOR, atualiza programador para o nome dele
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

async function devolverDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  if(filtrosAtuais.consultarTodas && !ehGestor()){
    alert("Modo 'Consultar todas' é somente leitura.");
    return;
  }

  if(!podeDevolverDemanda(d)){
    alert("Você não tem permissão para devolver esta demanda.");
    return;
  }

  const ok = confirm("Devolver a demanda para o usuário que cadastrou?");
  if(!ok) return;

  // volta o encaminhar_para para o atendente (criador), sem mexer no 'programador' (fica o último programador que resolveu)
  const payload = {
    encaminhar_para: d.atendente || null,
    status: "EM ANDAMENTO"
  };

  const { error } = await supabaseClient.from("demandas").update(payload).eq("id", demandaId);
  if(error){
    console.error("Erro ao devolver:", error);
    alert("Erro ao devolver: " + error.message);
    return;
  }

  await carregarDemandas();
  await abrirModalDemanda(demandaId);
}

// =========================
// ATUALIZAÇÕES (CRUD) - tabela atualizacoes_demanda
// =========================
async function carregarAtualizacoesDemanda(demandaId){
  const listaEl = byId("lista-atualizacoes");
  if(!listaEl) return;
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
    li.className = "item-atualizacao";
    li.innerHTML = `
      <div>${(a.texto || "").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
      <div class="muted">por ${a.usuario_nome || "-"} · ${formatarDataHoraBr(a.created_at)}</div>
      <div class="upd-actions"></div>
    `;

    const actions = li.querySelector(".upd-actions");

    // editar/excluir (gestor ou autor)
    if(podeEditarOuExcluirAtualizacao(a)){
      const btnEditar = document.createElement("button");
      btnEditar.className = "btn-xs";
      btnEditar.textContent = "Editar";
      btnEditar.onclick = () => abrirModalEditarAtualizacao(a, demandaId);

      const btnExcluir = document.createElement("button");
      btnExcluir.className = "btn-xs";
      btnExcluir.textContent = "Excluir";
      btnExcluir.onclick = () => excluirAtualizacao(a.id, demandaId);

      actions.appendChild(btnEditar);
      actions.appendChild(btnExcluir);
    }

    listaEl.appendChild(li);
  }
}

function abrirModalEditarAtualizacao(a, demandaId){
  byId("upd-id").value = a.id;
  setText("upd-titulo", "Editar atualização");
  setText("upd-subtitulo", `Demanda: ${demandaId}`);
  byId("upd-texto").value = a.texto || "";

  show("btn-excluir-upd");
  abrirModalUpd();

  byId("btn-salvar-upd").onclick = () => salvarAtualizacaoEditada(demandaId);
  byId("btn-excluir-upd").onclick = () => excluirAtualizacao(a.id, demandaId);
}

function abrirModalNovaAtualizacao(demandaId){
  byId("upd-id").value = "";
  setText("upd-titulo", "Nova atualização");
  setText("upd-subtitulo", `Demanda: ${demandaId}`);
  byId("upd-texto").value = "";

  hide("btn-excluir-upd");
  abrirModalUpd();

  byId("btn-salvar-upd").onclick = () => salvarNovaAtualizacao(demandaId);
}

async function salvarNovaAtualizacao(demandaId){
  const texto = (byId("upd-texto")?.value || "").trim();
  if(!texto){
    alert("Digite a atualização.");
    return;
  }

  const payload = {
    demanda_id: demandaId,
    usuario_id: currentUserProfile.id,
    usuario_nome: currentUserProfile.nome,
    texto
  };

  const { error } = await supabaseClient.from("atualizacoes_demanda").insert([payload]);
  if(error){
    console.error("Erro ao salvar atualização:", error);
    alert("Erro ao salvar atualização: " + error.message);
    return;
  }

  fecharModalUpd();
  await carregarAtualizacoesDemanda(demandaId);
  await carregarDemandas();
}

async function salvarAtualizacaoEditada(demandaId){
  const updId = byId("upd-id")?.value || "";
  const texto = (byId("upd-texto")?.value || "").trim();
  if(!updId) return;
  if(!texto){
    alert("Digite a atualização.");
    return;
  }

  const { error } = await supabaseClient
    .from("atualizacoes_demanda")
    .update({ texto })
    .eq("id", updId);

  if(error){
    console.error("Erro ao editar atualização:", error);
    alert("Erro ao editar atualização: " + error.message);
    return;
  }

  fecharModalUpd();
  await carregarAtualizacoesDemanda(demandaId);
  await carregarDemandas();
}

async function excluirAtualizacao(atualizacaoId, demandaId){
  const ok = confirm("Excluir esta atualização?");
  if(!ok) return;

  const { error } = await supabaseClient
    .from("atualizacoes_demanda")
    .delete()
    .eq("id", atualizacaoId);

  if(error){
    console.error("Erro ao excluir atualização:", error);
    alert("Erro ao excluir atualização: " + error.message);
    return;
  }

  fecharModalUpd();
  await carregarAtualizacoesDemanda(demandaId);
  await carregarDemandas();
}

// =========================
// FILTROS (lista)
// =========================
function atualizarFiltrosSugestoes(){
  // preenche selects de filtros baseado no cache atual
  const sAt = byId("filtro-atendente");
  const sPr = byId("filtro-programador");
  const sMu = byId("filtro-municipio");
  const sEs = byId("filtro-estado");

  if(sAt){
    const nomes = Array.from(new Set(demandasCache.map(d => d.atendente).filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b,"pt-BR"));
    sAt.innerHTML = `<option value="TODOS">Todos Atendentes</option>` + nomes.map(n=>`<option value="${n}">${n}</option>`).join("");
  }
  if(sPr){
    const nomes = Array.from(new Set(demandasCache.map(d => d.programador).filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b,"pt-BR"));
    sPr.innerHTML = `<option value="TODOS">Todos Programadores</option>` + nomes.map(n=>`<option value="${n}">${n}</option>`).join("");
  }
  if(sMu){
    const nomes = Array.from(new Set(demandasCache.map(d => d.municipio).filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b,"pt-BR"));
    sMu.innerHTML = `<option value="TODOS">Todos Municípios</option>` + nomes.map(n=>`<option value="${n}">${n}</option>`).join("");
  }
  if(sEs){
    const nomes = Array.from(new Set(demandasCache.map(d => d.cliente_estado).filter(Boolean)))
      .sort((a,b)=>a.localeCompare(b,"pt-BR"));
    sEs.innerHTML = `<option value="TODOS">Todos Estados</option>` + nomes.map(n=>`<option value="${n}">${n}</option>`).join("");
  }
}

function montarFiltrosUsuarios(){
  // Nada extra aqui, mas mantido para extensões.
}

// =========================
// USUÁRIOS (GESTOR)
// =========================
async function carregarUsuariosGestor(){
  const tbody = byId("tabela-usuarios");
  const badge = byId("badge-pendentes");
  if(!tbody) return;

  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("nome", { ascending:true });

  if(error){
    console.error("Erro ao carregar usuários (gestor):", error);
    return;
  }

  const lista = data || [];
  const pendentes = lista.filter(u => (u.status || "").toUpperCase() === "PENDENTE").length;

  if(badge){
    if(pendentes > 0) {
      badge.textContent = String(pendentes);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  tbody.innerHTML = "";
  for(const u of lista){
    const tr = document.createElement("tr");
    const status = (u.status || "").toUpperCase();
    tr.innerHTML = `
      <td>${u.nome || ""}</td>
      <td>${u.email || ""}</td>
      <td>${u.tipo || ""}</td>
      <td>${u.unidade || ""}</td>
      <td><span class="badge-status ${status}">${status}</span></td>
      <td>
        <div class="acao-botoes">
          <button class="btn-xs" data-a="ativar">Ativar</button>
          <button class="btn-xs" data-a="inativar">Inativar</button>
          <button class="btn-xs" data-a="editar">Editar</button>
          <button class="btn-xs" data-a="excluir">Excluir</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-a="ativar"]').onclick = () => atualizarStatusUsuario(u.id, "ATIVO");
    tr.querySelector('[data-a="inativar"]').onclick = () => atualizarStatusUsuario(u.id, "INATIVO");
    tr.querySelector('[data-a="editar"]').onclick = () => editarUsuarioGestor(u);
    tr.querySelector('[data-a="excluir"]').onclick = () => excluirUsuarioGestor(u);

    tbody.appendChild(tr);
  }
}

async function atualizarStatusUsuario(uid, status){
  const { error } = await supabaseClient.from("usuarios").update({ status }).eq("id", uid);
  if(error){
    alert("Erro: " + error.message);
    return;
  }
  await carregarUsuariosGestor();
  await carregarUsuariosCache();
}

async function editarUsuarioGestor(u){
  const novoNome = prompt("Nome:", u.nome || "");
  if(novoNome === null) return;
  const novoTipo = prompt("Tipo (GESTOR, SUPORTE, PROGRAMADOR):", u.tipo || "");
  if(novoTipo === null) return;
  const novaUnidade = prompt("Unidade:", u.unidade || "");
  if(novaUnidade === null) return;

  const { error } = await supabaseClient.from("usuarios").update({
    nome: (novoNome || "").trim(),
    tipo: normalizarTextoUpper(novoTipo),
    unidade: (novaUnidade || "").trim()
  }).eq("id", u.id);

  if(error){
    alert("Erro: " + error.message);
    return;
  }
  await carregarUsuariosGestor();
  await carregarUsuariosCache();
}

async function excluirUsuarioGestor(u){
  const ok = confirm("Excluir o perfil do usuário? (Não remove do Auth)");
  if(!ok) return;

  const { error } = await supabaseClient.from("usuarios").delete().eq("id", u.id);
  if(error){
    alert("Erro: " + error.message);
    return;
  }
  await carregarUsuariosGestor();
  await carregarUsuariosCache();
}

// =========================
// LISTENERS
// =========================
function registrarListeners(){
  // Auth
  byId("btn-login")?.addEventListener("click", login);
  byId("btn-cadastrar")?.addEventListener("click", cadastrarNovoUsuario);
  byId("btn-logout")?.addEventListener("click", logout);

  // Tabs
  document.querySelectorAll("#tabs-main .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      setActiveTab(target);
    });
  });

  // Clientes
  byId("form-cliente")?.addEventListener("submit", salvarCliente);

  // Demandas
  byId("form-demanda")?.addEventListener("submit", salvarDemanda);

  // Localizar cliente (demanda)
  byId("dem-localizar-cliente")?.addEventListener("input", (ev) => {
    const v = ev.target.value;
    const c = localizarClientePorTexto(v);
    if(c) aplicarClienteNaTelaDemanda(c);
  });

  // Tags: Enter ou vírgula
  const tagsInput = byId("dem-tags-input");
  if(tagsInput){
    tagsInput.addEventListener("keydown", (ev) => {
      if(ev.key === "Enter" || ev.key === ",") {
        ev.preventDefault();
        adicionarTagsDoInput();
      }
    });
    tagsInput.addEventListener("blur", adicionarTagsDoInput);
  }

  // Forma atendimento: Enter ou vírgula
  const faInput = byId("dem-forma-atendimento-input");
  if(faInput){
    faInput.addEventListener("keydown", (ev) => {
      if(ev.key === "Enter" || ev.key === ",") {
        ev.preventDefault();
        adicionarFormaAtendimentoDoInput();
      }
    });
    faInput.addEventListener("blur", adicionarFormaAtendimentoDoInput);
  }

  // Filtros
  byId("filtro-busca")?.addEventListener("input", (ev) => {
    filtrosAtuais.buscaTexto = ev.target.value || "";
    renderizarDemandas();
  });
  byId("filtro-ocultar-concluidas")?.addEventListener("change", (ev) => {
    filtrosAtuais.ocultarConcluidas = !!ev.target.checked;
    renderizarDemandas();
  });
  byId("filtro-consultar-todas")?.addEventListener("change", (ev) => {
    filtrosAtuais.consultarTodas = !!ev.target.checked;
    renderizarDemandas();
  });
  byId("filtro-status")?.addEventListener("change", (ev) => {
    filtrosAtuais.status = ev.target.value || "TODOS";
    renderizarDemandas();
  });
  byId("filtro-atendente")?.addEventListener("change", (ev) => {
    filtrosAtuais.atendente = ev.target.value || "TODOS";
    renderizarDemandas();
  });
  byId("filtro-programador")?.addEventListener("change", (ev) => {
    filtrosAtuais.programador = ev.target.value || "TODOS";
    renderizarDemandas();
  });
  byId("filtro-municipio")?.addEventListener("change", (ev) => {
    filtrosAtuais.municipio = ev.target.value || "TODOS";
    renderizarDemandas();
  });
  byId("filtro-estado")?.addEventListener("change", (ev) => {
    filtrosAtuais.estado = ev.target.value || "TODOS";
    renderizarDemandas();
  });

  // Modal
  byId("btn-fechar-modal")?.addEventListener("click", fecharModal);
  byId("modal-overlay")?.addEventListener("click", fecharModal);

  // Modal updates
  byId("btn-fechar-upd")?.addEventListener("click", fecharModalUpd);
  byId("modal-upd-overlay")?.addEventListener("click", fecharModalUpd);

  // Botão "Gráficos" (placeholder)
  byId("btn-graficos")?.addEventListener("click", () => {
    alert("Gráficos: módulo em construção (você pode me pedir e eu monto).");
  });

  // Botão "Nova atualização" (se existir no HTML como btn-nova-upd)
  byId("btn-nova-upd")?.addEventListener("click", () => {
    const demandaId = byId("det-demanda-id")?.value || "";
    if(demandaId) abrirModalNovaAtualizacao(demandaId);
  });
}