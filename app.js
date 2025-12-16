// ======================================================
// APP.JS - PARTE 1/5
// Configuração, estado global, utilidades, auth e abas
// ======================================================

// ----------------------
// SUPABASE
// ----------------------
const SUPABASE_URL = "https://cmxepgkkdvyfraesvqly.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGVwZ2trZHZ5ZnJhZXN2cWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3ODA2NDksImV4cCI6MjA4MDM1NjY0OX0.rQMjA0pyJ2gWvPlyuQr0DccdkUs24NQTdsQvgiN2QXY";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ----------------------
// ESTADO GLOBAL
// ----------------------
let currentSession = null;
let currentUserProfile = null;

let clientesCache = [];
let demandasCache = [];
let usuariosCache = [];

let tagsAtuais = [];

let filtrosAtuais = {
  buscaTexto: "",
  consultarTodas: false,
};

// ----------------------
// HELPERS
// ----------------------
const byId = (id) => document.getElementById(id);

function show(id) {
  const el = byId(id);
  if (el) el.classList.remove("hidden");
}

function hide(id) {
  const el = byId(id);
  if (el) el.classList.add("hidden");
}

function tipoPerfil() {
  return (currentUserProfile?.tipo || "").trim().toUpperCase();
}

function ehGestor() {
  return tipoPerfil() === "GESTOR";
}

function ehSuporte() {
  return tipoPerfil() === "SUPORTE";
}

function ehProgramador() {
  return tipoPerfil() === "PROGRAMADOR";
}

// ----------------------
// AUTH
// ----------------------
async function login() {
  const email = byId("login-email").value.trim();
  const senha = byId("login-senha").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    alert("Erro ao autenticar: " + error.message);
    return;
  }

  currentSession = data.session;
  await carregarPerfilUsuario();
  iniciarApp();
}

async function cadastrarUsuario() {
  const nome = byId("cad-nome").value.trim().toUpperCase();
  const email = byId("cad-email").value.trim().toLowerCase();
  const dtNasc = byId("cad-dt-nasc").value;
  const unidade = byId("cad-unidade").value;
  const tipo = byId("cad-tipo").value;
  const senha = byId("cad-senha").value;
  const senha2 = byId("cad-senha2").value;

  if (!nome || !email || !senha || senha !== senha2) {
    alert("Dados inválidos");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password: senha,
  });

  if (error) {
    alert(error.message);
    return;
  }

  await supabaseClient.from("usuarios").insert({
    id: data.user.id,
    nome,
    email,
    data_nascimento: dtNasc,
    unidade,
    tipo,
    status: "PENDENTE",
  });

  alert("Cadastro enviado. Aguarde aprovação do gestor.");
}

// ----------------------
// PERFIL
// ----------------------
async function carregarPerfilUsuario() {
  const { data } = await supabaseClient.auth.getUser();
  if (!data?.user) return;

  const { data: perfil } = await supabaseClient
    .from("usuarios")
    .select("*")
    .eq("id", data.user.id)
    .single();

  if (!perfil || perfil.status !== "ATIVO") {
    await supabaseClient.auth.signOut();
    alert("Usuário não aprovado");
    return;
  }

  currentUserProfile = perfil;
}

// ----------------------
// INICIAR APP
// ----------------------
function iniciarApp() {
  hide("auth-container");
  show("app-container");

  byId("user-label").innerText =
    currentUserProfile.nome + " (" + tipoPerfil() + ")";

  if (ehGestor()) show("tab-usuarios");

  initTabs();
  garantirOverlaysOcultos();

  carregarClientes();
  carregarDemandas();
  if (ehGestor()) carregarUsuarios();
}

// ----------------------
// ABAS (FIX DEFINITIVO)
// ----------------------
function initTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  const contents = document.querySelectorAll(".tab-content");

  tabs.forEach((btn) => {
    btn.onclick = () => {
      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      contents.forEach((c) => {
        c.classList.toggle("hidden", c.dataset.tab !== btn.dataset.tab);
      });
    };
  });
}

// ----------------------
// OVERLAYS
// ----------------------
function garantirOverlaysOcultos() {
  ["modal-overlay", "modal-detalhes"].forEach((id) => {
    const el = byId(id);
    if (el) el.classList.add("hidden");
  });
}

// ----------------------
// EVENTOS BÁSICOS
// ----------------------
document.addEventListener("DOMContentLoaded", async () => {
  byId("btn-login").onclick = login;
  byId("btn-cadastrar").onclick = cadastrarUsuario;

  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session;

  if (currentSession) {
    await carregarPerfilUsuario();
    if (currentUserProfile) iniciarApp();
  }
});
// ======================================================
// APP.JS - PARTE 2/5
// CLIENTES (com município) + integração com DEMANDA
// ======================================================

// ----------------------
// CLIENTES - CARREGAR
// ----------------------
async function carregarClientes() {
  const { data, error } = await supabaseClient
    .from("clientes")
    .select("*")
    .order("cliente", { ascending: true });

  if (error) {
    console.error(error);
    alert("Erro ao carregar clientes: " + error.message);
    return;
  }

  clientesCache = data || [];
  preencherTabelaClientes();
  preencherSelectClienteDemanda();
}

// ----------------------
// CLIENTES - TABELA
// ----------------------
function preencherTabelaClientes() {
  const tbody = byId("tb-clientes");
  if (!tbody) return;

  tbody.innerHTML = "";

  clientesCache.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.cliente || ""}</td>
      <td>${(c.tipo_entidade || c.tipo || "")}</td>
      <td>${(c.municipio || "")}</td>
      <td>
        <button data-del="${c.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("Excluir cliente?")) return;
      await excluirCliente(id);
    };
  });
}

// ----------------------
// CLIENTES - SELECT DEMANDA
// ----------------------
function preencherSelectClienteDemanda() {
  const sel = byId("dem-cliente");
  if (!sel) return;

  sel.innerHTML = `<option value="">Selecione</option>`;

  clientesCache.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.cliente;
    opt.dataset.tipo_entidade = (c.tipo_entidade || c.tipo || "");
    opt.dataset.municipio = (c.municipio || "");
    sel.appendChild(opt);
  });

  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    byId("dem-tipo-entidade").value = opt?.dataset.tipo_entidade || "";
    byId("dem-municipio").value = opt?.dataset.municipio || "";
  };
}

// ----------------------
// CLIENTES - SALVAR
// (sem contato; com municipio)
// ----------------------
async function salvarCliente() {
  if (!(ehGestor() || ehSuporte())) {
    alert("Somente Gestor/Suporte");
    return;
  }

  const cliente = (byId("cli-nome").value || "").trim().toUpperCase();
  const tipoEntidade = (byId("cli-tipo").value || "").trim().toUpperCase();
  const estado = (byId("cli-estado").value || "").trim().toUpperCase();
  const municipio = (byId("cli-municipio").value || "").trim().toUpperCase();
  const telefone = (byId("cli-telefone").value || "").trim();

  if (!cliente || !tipoEntidade || !estado || !municipio || !telefone) {
    alert("Preencha Cliente, Tipo, Estado, Município e Telefone.");
    return;
  }

  const { error } = await supabaseClient.from("clientes").insert({
    cliente,
    tipo_entidade: tipoEntidade,
    estado,
    municipio,
    telefone,
  });

  if (error) {
    console.error(error);
    alert("Erro ao salvar cliente: " + error.message);
    return;
  }

  // limpar
  byId("cli-nome").value = "";
  byId("cli-tipo").value = "";
  byId("cli-estado").value = "";
  byId("cli-municipio").value = "";
  byId("cli-telefone").value = "";

  await carregarClientes();
}

// ----------------------
// CLIENTES - EXCLUIR
// ----------------------
async function excluirCliente(id) {
  const { error } = await supabaseClient.from("clientes").delete().eq("id", id);
  if (error) {
    console.error(error);
    alert("Erro ao excluir cliente: " + error.message);
    return;
  }
  await carregarClientes();
}

// ----------------------
// EVENTO SALVAR CLIENTE (botão)
// ----------------------
document.addEventListener("DOMContentLoaded", () => {
  const btnSalvarCliente = byId("btn-salvar-cliente");
  if (btnSalvarCliente) btnSalvarCliente.onclick = salvarCliente;
});
// ======================================================
// APP.JS - PARTE 3/5
// DEMANDAS (campos completos + encaminhar + tags + filtros)
// ======================================================

// ----------------------
// GERAR CÓDIGO DEMANDA
// ----------------------
async function gerarCodigoDemanda() {
  const ano = new Date().getFullYear();
  const prefixo = `D${ano}-`;

  const { data, error } = await supabaseClient
    .from("demandas")
    .select("codigo")
    .like("codigo", `${prefixo}%`)
    .order("codigo", { ascending: false })
    .limit(1);

  if (error) return `${prefixo}00001`;

  const ultimo = data?.[0]?.codigo || `${prefixo}00000`;
  const num = parseInt(ultimo.split("-")[1] || "0", 10) + 1;
  return `${prefixo}${String(num).padStart(5, "0")}`;
}

// ----------------------
// TAGS (chips simples)
// ----------------------
function renderizarTags() {
  const cont = byId("tags-container");
  if (!cont) return;

  cont.innerHTML = "";
  tagsAtuais.forEach((t, i) => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = t;

    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "x";
    x.style.marginLeft = "6px";
    x.onclick = () => {
      tagsAtuais.splice(i, 1);
      renderizarTags();
    };

    span.appendChild(x);
    cont.appendChild(span);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const btnAddTag = byId("btn-add-tag");
  if (btnAddTag) {
    btnAddTag.onclick = () => {
      const v = (byId("dem-tag").value || "").trim().toUpperCase();
      if (!v) return;
      if (!tagsAtuais.includes(v)) tagsAtuais.push(v);
      byId("dem-tag").value = "";
      renderizarTags();
    };
  }
});

// ----------------------
// DEMANDAS - SALVAR
// (tipoEntidade e municipio vêm do cliente)
// ----------------------
async function salvarDemanda() {
  if (!(ehGestor() || ehSuporte())) {
    alert("Somente Gestor/Suporte pode cadastrar demanda");
    return;
  }

  const clienteId = byId("dem-cliente").value;
  const cli = clientesCache.find((c) => c.id === clienteId);

  if (!cli) {
    alert("Selecione um cliente");
    return;
  }

  const codigo = await gerarCodigoDemanda();

  const assunto = (byId("dem-assunto").value || "").trim().toUpperCase();
  const descricao = (byId("dem-descricao").value || "").trim();

  const programador = (byId("dem-programador").value || "").trim();
  const formaAtendimento = (byId("dem-forma-atendimento").value || "").trim().toUpperCase();

  const prioridade = (byId("dem-prioridade").value || "Média");
  const status = (byId("dem-status").value || "ABERTA");

  const linkTrello = (byId("dem-link-trello").value || "").trim();
  const linkEmail = (byId("dem-link-email").value || "").trim();

  if (!assunto || !descricao) {
    alert("Assunto e Descrição obrigatórios");
    return;
  }

  const payload = {
    user_id: currentUserProfile.id,
    atendente: currentUserProfile.nome,
    codigo,

    cliente_id: cli.id,
    cliente_nome: cli.cliente,
    cliente_tipo_entidade: (cli.tipo_entidade || cli.tipo || null),
    cliente_municipio: (cli.municipio || null),
    cliente_estado: (cli.estado || null),
    cliente_telefone: (cli.telefone || null),

    tipo_entidade: (cli.tipo_entidade || cli.tipo || null),
    municipio: (cli.municipio || null),

    assunto,
    descricao,
    programador: programador || null,
    forma_atendimento: formaAtendimento || null,

    tags: tagsAtuais || [],
    prioridade,
    status,

    link_trello: linkTrello || null,
    link_email: linkEmail || null,

    encaminhar_para: null,
  };

  const { error } = await supabaseClient.from("demandas").insert(payload);
  if (error) {
    console.error(error);
    alert("Erro ao salvar demanda: " + error.message);
    return;
  }

  // limpar
  byId("dem-assunto").value = "";
  byId("dem-descricao").value = "";
  byId("dem-forma-atendimento").value = "";
  byId("dem-link-trello").value = "";
  byId("dem-link-email").value = "";
  tagsAtuais = [];
  renderizarTags();

  await carregarDemandas();
}

// botão salvar demanda
document.addEventListener("DOMContentLoaded", () => {
  const btn = byId("btn-salvar-demanda");
  if (btn) btn.onclick = salvarDemanda;
});

// ----------------------
// DEMANDAS - CARREGAR
// ----------------------
async function carregarDemandas() {
  const { data, error } = await supabaseClient
    .from("demandas")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    alert("Erro ao carregar demandas: " + error.message);
    return;
  }

  demandasCache = data || [];
  aplicarFiltrosERenderizar();
}

// ----------------------
// FILTROS BÁSICOS
// ----------------------
function aplicarFiltrosERenderizar() {
  let lista = [...demandasCache];

  // regra: não gestor -> vê só as próprias, a não ser que "consultarTodas" esteja marcado (somente leitura)
  if (!ehGestor()) {
    if (!filtrosAtuais.consultarTodas) {
      lista = lista.filter((d) => d.user_id === currentUserProfile.id);
    }
  }

  const texto = (filtrosAtuais.buscaTexto || "").trim().toUpperCase();
  if (texto) {
    lista = lista.filter((d) => {
      const s = `${d.codigo} ${d.cliente_nome} ${d.assunto} ${(d.tags || []).join(" ")}`.toUpperCase();
      return s.includes(texto);
    });
  }

  preencherTabelaDemandas(lista);
}

document.addEventListener("DOMContentLoaded", () => {
  const f = byId("filtro-texto");
  if (f) {
    f.oninput = () => {
      filtrosAtuais.buscaTexto = f.value;
      aplicarFiltrosERenderizar();
    };
  }
});

// ----------------------
// DEMANDAS - TABELA
// ----------------------
function preencherTabelaDemandas(lista) {
  const tbody = byId("tb-demandas");
  if (!tbody) return;

  tbody.innerHTML = "";

  lista.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.codigo || ""}</td>
      <td>${d.cliente_nome || ""}</td>
      <td>${d.status || ""}</td>
      <td>
        <button data-open="${d.id}">Abrir</button>
        ${(ehGestor() || ehSuporte()) ? `<button data-del="${d.id}">Excluir</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-open]").forEach((btn) => {
    btn.onclick = () => abrirModalDemanda(btn.getAttribute("data-open"));
  });

  tbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-del");
      await excluirDemanda(id);
    };
  });
}

// ----------------------
// EXCLUIR DEMANDA
// (suporte/gestor; se consultarTodas e não for gestor -> bloqueia)
// ----------------------
async function excluirDemanda(id) {
  const d = demandasCache.find((x) => x.id === id);
  if (!d) return;

  if (filtrosAtuais.consultarTodas && !ehGestor()) {
    alert("Consultar todas é somente leitura para não-gestor.");
    return;
  }

  if (!(ehGestor() || ehSuporte())) {
    alert("Sem permissão");
    return;
  }

  if (!confirm("Excluir demanda " + (d.codigo || "") + "?")) return;

  const { error } = await supabaseClient.from("demandas").delete().eq("id", id);
  if (error) {
    console.error(error);
    alert("Erro ao excluir: " + error.message);
    return;
  }

  await carregarDemandas();
}
// ======================================================
// APP.JS - PARTE 4/5
// USUÁRIOS (gestor + encaminhar) e DETALHES/ENCAMINHAR/EDITAR
// ======================================================

// ----------------------
// CARREGAR USUÁRIOS (para encaminhar / programador)
// ----------------------
async function carregarUsuarios() {
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("id,nome,tipo,status")
    .eq("status", "ATIVO")
    .order("nome", { ascending: true });

  if (error) {
    console.error(error);
    alert("Erro ao carregar usuários: " + error.message);
    return;
  }

  usuariosCache = data || [];
  preencherSelectProgramador();
}

// Programadores no select de cadastro
function preencherSelectProgramador() {
  const sel = byId("dem-programador");
  if (!sel) return;

  sel.innerHTML = `<option value="">(não definido)</option>`;
  usuariosCache
    .filter((u) => (u.tipo || "").toUpperCase() === "PROGRAMADOR")
    .forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.nome;
      opt.textContent = u.nome;
      sel.appendChild(opt);
    });
}

// ----------------------
// GESTOR - CARREGAR USUÁRIOS (tabela completa)
// ----------------------
async function carregarUsuariosGestor() {
  if (!ehGestor()) return;

  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    alert("Erro ao carregar usuários (gestor): " + error.message);
    return;
  }

  const tbody = byId("tb-usuarios");
  if (!tbody) return;

  tbody.innerHTML = "";

  (data || []).forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.nome || ""}</td>
      <td>${u.email || ""}</td>
      <td>${(u.tipo || "").toUpperCase()}</td>
      <td>${u.status || ""}</td>
      <td>
        ${u.status !== "ATIVO" ? `<button data-aprovar="${u.id}">Aprovar</button>` : ""}
        <button data-editar="${u.id}">Editar</button>
        <button data-del="${u.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-aprovar]").forEach((b) => {
    b.onclick = () => aprovarUsuario(b.getAttribute("data-aprovar"));
  });

  tbody.querySelectorAll("button[data-editar]").forEach((b) => {
    b.onclick = () => editarUsuario(b.getAttribute("data-editar"));
  });

  tbody.querySelectorAll("button[data-del]").forEach((b) => {
    b.onclick = () => excluirUsuario(b.getAttribute("data-del"));
  });
}

async function aprovarUsuario(id) {
  const { error } = await supabaseClient
    .from("usuarios")
    .update({ status: "ATIVO" })
    .eq("id", id);

  if (error) {
    alert("Erro ao aprovar: " + error.message);
    return;
  }

  await carregarUsuariosGestor();
  await carregarUsuarios(); // atualiza encaminhamento/programador
}

async function editarUsuario(id) {
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    alert("Não foi possível abrir usuário.");
    return;
  }

  const novoTipo = prompt("Tipo (GESTOR/SUPORTE/PROGRAMADOR):", (data.tipo || "").toUpperCase());
  if (novoTipo === null) return;

  const novoStatus = prompt("Status (ATIVO/PENDENTE/BLOQUEADO):", (data.status || "").toUpperCase());
  if (novoStatus === null) return;

  const { error: err2 } = await supabaseClient
    .from("usuarios")
    .update({ tipo: novoTipo.trim().toUpperCase(), status: novoStatus.trim().toUpperCase() })
    .eq("id", id);

  if (err2) {
    alert("Erro ao editar usuário: " + err2.message);
    return;
  }

  await carregarUsuariosGestor();
  await carregarUsuarios();
}

async function excluirUsuario(id) {
  if (!confirm("Excluir usuário do cadastro? (não remove do Auth)")) return;

  const { error } = await supabaseClient.from("usuarios").delete().eq("id", id);
  if (error) {
    alert("Erro ao excluir: " + error.message);
    return;
  }

  await carregarUsuariosGestor();
  await carregarUsuarios();
}

// ----------------------
// DETALHES DA DEMANDA
// Se modal existir: preenche. Se não: fallback prompt.
// ----------------------
function abrirModalDemanda(id) {
  const d = demandasCache.find((x) => x.id === id);
  if (!d) return;

  // Se existir modal no HTML, use (compatibilidade com layout antigo)
  const modal = byId("modal-detalhes");
  const overlay = byId("modal-overlay");

  if (modal && overlay) {
    // Se você usa o HTML com modal, aqui você pode preencher campos.
    // No HTML simples, não existe, então vai cair no fallback.
    overlay.classList.remove("hidden");
    modal.classList.remove("hidden");
    // opcional: guardar id atual
    modal.dataset.demandaId = id;
    return;
  }

  // Fallback (HTML simples)
  const resumo =
    `Código: ${d.codigo}\n` +
    `Cliente: ${d.cliente_nome}\n` +
    `Tipo Entidade: ${d.tipo_entidade || ""}\n` +
    `Município: ${d.municipio || ""}\n` +
    `Status: ${d.status}\n` +
    `Prioridade: ${d.prioridade}\n` +
    `Programador: ${d.programador || ""}\n` +
    `Encaminhar para: ${d.encaminhar_para || ""}\n` +
    `Assunto: ${d.assunto}\n\n` +
    `Descrição:\n${d.descricao}`;

  const acao = prompt(
    resumo + "\n\nDigite:\n1 = Encaminhar\n2 = Editar\n3 = Excluir\n(ENTER para fechar)",
    ""
  );

  if (!acao) return;

  if (acao === "1") encaminharDemandaPrompt(id);
  if (acao === "2") editarDemandaPrompt(id);
  if (acao === "3") excluirDemanda(id);
}

// ----------------------
// ENCAMINHAR (fallback prompt)
// Regra: se destino for PROGRAMADOR -> atualiza programador também
// ----------------------
async function encaminharDemandaPrompt(id) {
  const d = demandasCache.find((x) => x.id === id);
  if (!d) return;

  if (!(ehGestor() || ehSuporte())) {
    alert("Sem permissão");
    return;
  }

  // lista ativos
  const ativos = usuariosCache.length ? usuariosCache : await buscarUsuariosAtivos();

  const lista = ativos
    .map((u, idx) => `${idx + 1} - ${u.nome} (${(u.tipo || "").toUpperCase()})`)
    .join("\n");

  const escolha = prompt("Escolha o usuário para encaminhar:\n\n" + lista, "");
  if (!escolha) return;

  const idx = parseInt(escolha, 10) - 1;
  const user = ativos[idx];
  if (!user) {
    alert("Escolha inválida.");
    return;
  }

  const upd = {
    encaminhar_para: user.nome,
    status: "ENCAMINHADA",
  };

  if ((user.tipo || "").toUpperCase() === "PROGRAMADOR") {
    upd.programador = user.nome;
  }

  const { error } = await supabaseClient.from("demandas").update(upd).eq("id", id);
  if (error) {
    alert("Erro ao encaminhar: " + error.message);
    return;
  }

  await carregarDemandas();
}

// auxiliar
async function buscarUsuariosAtivos() {
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("id,nome,tipo,status")
    .eq("status", "ATIVO")
    .order("nome", { ascending: true });

  if (error) {
    alert("Erro ao buscar usuários: " + error.message);
    return [];
  }
  usuariosCache = data || [];
  return usuariosCache;
}

// ----------------------
// EDITAR DEMANDA (fallback prompt)
// ----------------------
async function editarDemandaPrompt(id) {
  const d = demandasCache.find((x) => x.id === id);
  if (!d) return;

  if (filtrosAtuais.consultarTodas && !ehGestor()) {
    alert("Consultar todas é somente leitura para não-gestor.");
    return;
  }

  if (!(ehGestor() || ehSuporte())) {
    alert("Sem permissão");
    return;
  }

  const assunto = prompt("Assunto:", d.assunto || "");
  if (assunto === null) return;

  const descricao = prompt("Descrição:", d.descricao || "");
  if (descricao === null) return;

  const status = prompt("Status (ABERTA/EM ANDAMENTO/ENCAMINHADA/CONCLUIDA):", d.status || "ABERTA");
  if (status === null) return;

  const prioridade = prompt("Prioridade (Baixa/Média/Alta):", d.prioridade || "Média");
  if (prioridade === null) return;

  const programador = prompt("Programador (nome) ou vazio:", d.programador || "");
  if (programador === null) return;

  const forma = prompt("Forma de atendimento:", d.forma_atendimento || "");
  if (forma === null) return;

  const linkTrello = prompt("Link Trello:", d.link_trello || "");
  if (linkTrello === null) return;

  const linkEmail = prompt("Link Email:", d.link_email || "");
  if (linkEmail === null) return;

  const { error } = await supabaseClient
    .from("demandas")
    .update({
      assunto: assunto.trim().toUpperCase(),
      descricao: descricao.trim(),
      status: status.trim().toUpperCase(),
      prioridade: prioridade.trim(),
      programador: programador.trim() || null,
      forma_atendimento: forma.trim() || null,
      link_trello: linkTrello.trim() || null,
      link_email: linkEmail.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    alert("Erro ao editar: " + error.message);
    return;
  }

  await carregarDemandas();
}
// ======================================================
// APP.JS - PARTE 5/5
// LOGOUT + CONSULTAR TODAS + BOOT FINAL
// ======================================================

// ----------------------
// CHECKBOX "CONSULTAR TODAS" (se existir no HTML)
// ----------------------
document.addEventListener("DOMContentLoaded", () => {
  const chk = byId("chk-consultar-todas");
  if (chk) {
    chk.onchange = () => {
      filtrosAtuais.consultarTodas = chk.checked;
      aplicarFiltrosERenderizar();
    };
  }
});

// ----------------------
// LOGOUT
// ----------------------
async function logout() {
  await supabaseClient.auth.signOut();
  currentSession = null;
  currentUserProfile = null;
  location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = byId("btn-logout");
  if (btn) btn.onclick = logout;
});

// ----------------------
// COMPLEMENTO: quando entrar no app, carrega usuários também
// (para programador/encaminhar)
// ----------------------
const _iniciarAppOriginal = iniciarApp;
iniciarApp = function () {
  _iniciarAppOriginal();
  carregarUsuarios();          // para select programador e encaminhamento
  if (ehGestor()) carregarUsuariosGestor(); // tabela de usuários
};

// ----------------------
// GARANTIA: se usuário clicar fora do modal (quando existir) fecha
// ----------------------
document.addEventListener("DOMContentLoaded", () => {
  const overlay = byId("modal-overlay");
  const modal = byId("modal-detalhes");
  if (overlay && modal) {
    overlay.onclick = () => {
      overlay.classList.add("hidden");
      modal.classList.add("hidden");
    };
  }
});
