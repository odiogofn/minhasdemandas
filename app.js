//-----------------------------------------
// CONFIGURAÇÃO SUPABASE (SUAS CHAVES)
//-----------------------------------------
const SUPABASE_URL = "https://cmxepgkkdvyfraesvqly.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGVwZ2trZHZ5ZnJhZXN2cWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3ODA2NDksImV4cCI6MjA4MDM1NjY0OX0.rQMjA0pyJ2gWvPlyuQr0DccdkUs24NQTdsQvgiN2QXY";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Estado global
let currentUserProfile = null;
let currentSession = null;
let demandasCache = [];

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

//-----------------------------------------
// UTILITÁRIOS
//-----------------------------------------
function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = byId(id);
  if (el) el.textContent = value;
}

function show(id) {
  const el = byId(id);
  if (el) el.style.display = "";
}

function hide(id) {
  const el = byId(id);
  if (el) el.style.display = "none";
}

function validarSenhaSimples(s) {
  return /^[A-Za-z0-9]{1,10}$/.test(s);
}

function formatarDataHoraBr(dt) {
  if (!dt) return "-";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt;
  return d.toLocaleString("pt-BR");
}

//-----------------------------------------
// AUTENTICAÇÃO
//-----------------------------------------

async function inicializarApp() {
  const { data } = await supabaseClient.auth.getSession();
  currentSession = data?.session || null;

  if (currentSession) {
    await carregarPerfilUsuarioAtual();
    mostrarApp();
  } else {
    mostrarTelaAuth();
  }

  registrarListeners();
}

function mostrarTelaAuth() {
  show("auth-container");
  hide("app-container");
}

function mostrarApp() {
  hide("auth-container");
  show("app-container");

  if (currentUserProfile) {
    setText(
      "user-label",
      `${currentUserProfile.nome} (${currentUserProfile.tipo} · ${currentUserProfile.unidade})`
    );
  }

  ajustarInterfacePorPerfil();
  carregarDemandas();
}

async function carregarPerfilUsuarioAtual() {
  const { data: userData } = await supabaseClient.auth.getUser();
  if (!userData?.user) return;

  const uid = userData.user.id;

  const { data: perfil } = await supabaseClient
    .from("usuarios")
    .select("*")
    .eq("id", uid)
    .single();

  if (perfil?.status === "PENDENTE") {
    await supabaseClient.auth.signOut();
    currentSession = null;
    currentUserProfile = null;
    mostrarTelaAuth();
    setText(
      "auth-status",
      "Seu cadastro ainda não foi aprovado pelo gestor."
    );
    return;
  }

  currentUserProfile = perfil;
}

async function cadastrarNovoUsuario() {
  const nome = byId("cad-nome").value.trim();
  const email = byId("cad-email").value.trim();
  const dtNasc = byId("cad-dt-nasc").value;
  const unidade = byId("cad-unidade").value;
  const senha = byId("cad-senha").value;
  const senha2 = byId("cad-senha2").value;

  if (!nome || !email || !senha || !senha2 || !unidade) {
    setText("auth-status", "Preencha todos os campos.");
    return;
  }

  if (senha !== senha2) {
    setText("auth-status", "Senhas não conferem.");
    return;
  }

  if (!validarSenhaSimples(senha)) {
    setText(
      "auth-status",
      "Senha inválida. Apenas letras e números, até 10 caracteres."
    );
    return;
  }

  const { error: signError } = await supabaseClient.auth.signUp({
    email,
    password: senha,
  });

  if (signError) {
    setText("auth-status", "Erro ao cadastrar: " + signError.message);
    return;
  }

  const { data: userData } = await supabaseClient.auth.getUser();
  if (!userData?.user) {
    setText("auth-status", "Erro ao obter usuário.");
    return;
  }

  const uid = userData.user.id;

  const { error } = await supabaseClient.from("usuarios").insert([
    {
      id: uid,
      nome,
      email,
      dt_nascimento: dtNasc,
      unidade,
      tipo: "PROGRAMADOR",
      status: "PENDENTE",
    },
  ]);

  if (error) {
    setText("auth-status", "Erro ao salvar perfil: " + error.message);
    return;
  }

  setText(
    "auth-status",
    "Cadastro enviado! Aguarde aprovação do gestor."
  );

  await supabaseClient.auth.signOut();
}

async function login() {
  const email = byId("login-email").value;
  const senha = byId("login-senha").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    setText("auth-status", "Erro: " + error.message);
    return;
  }

  currentSession = data.session;

  await carregarPerfilUsuarioAtual();
  mostrarApp();
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentUserProfile = null;
  currentSession = null;
  mostrarTelaAuth();
}

//-----------------------------------------
// DEMANDAS
//-----------------------------------------

async function gerarCodigoDemanda() {
  const ano = new Date().getFullYear();
  const prefixo = "D" + ano;

  const { data } = await supabaseClient
    .from("demandas")
    .select("codigo")
    .like("codigo", `${prefixo}-%`)
    .order("codigo", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return `${prefixo}-00001`;

  const ultimo = data[0].codigo.split("-")[1];
  const num = parseInt(ultimo, 10) + 1;

  return `${prefixo}-${String(num).padStart(5, "0")}`;
}

async function salvarDemanda(e) {
  e.preventDefault();

  if (!currentUserProfile) {
    alert("Faça login.");
    return;
  }

  if (currentUserProfile.tipo === "PROGRAMADOR") {
    alert("Programador não pode cadastrar demandas.");
    return;
  }

  const municipio = byId("dem-municipio").value.trim().toUpperCase();
  const assunto = byId("dem-assunto").value.trim().toUpperCase();
  const descricao = byId("dem-descricao").value.trim();
  const estado = byId("dem-estado").value;
  const tipoEntidade = byId("dem-tipo-entidade").value;
  const contatoCliente = byId("dem-contato-cliente").value;
  const programador = byId("dem-programador").value;
  const formaAtendimento = byId("dem-forma-atendimento").value;
  const prioridade = byId("dem-prioridade").value;
  const statusDemanda = byId("dem-status").value;
  const linkTrello = byId("dem-link-trello").value;
  const linkEmail = byId("dem-link-email").value;

  if (!municipio || !assunto || !descricao) {
    alert("Preencha os campos obrigatórios.");
    return;
  }

  const codigo = await gerarCodigoDemanda();
  const agora = new Date().toLocaleString("pt-BR");

  const { error } = await supabaseClient.from("demandas").insert([
    {
      user_id: currentUserProfile.id,
      codigo,
      municipio,
      assunto,
      descricao,
      estado,
      tipo_entidade: tipoEntidade,
      contato_cliente: contatoCliente,
      programador,
      forma_atendimento: formaAtendimento,
      prioridade,
      status: statusDemanda,
      atendente: currentUserProfile.nome,
      link_trello: linkTrello,
      link_email: linkEmail,
      data_hora_local: agora,
    },
  ]);

  if (error) {
    alert("Erro ao salvar demanda: " + error.message);
    console.error(error);
    return;
  }

  byId("form-demanda").reset();
  carregarDemandas();
}

async function carregarDemandas() {
  const tipo = currentUserProfile?.tipo ?? "";

  let query = supabaseClient.from("demandas").select("*").order("created_at", {
    ascending: false,
  });

  if (tipo === "PROGRAMADOR") {
    query = query.or(
      `programador.eq.${currentUserProfile.nome},encaminhar_para.eq.${currentUserProfile.nome}`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return;
  }

  demandasCache = data;
  renderizarDemandas();
}

function renderizarDemandas() {
  const tbody = byId("tabela-demandas");
  tbody.innerHTML = "";

  let lista = [...demandasCache];

  lista.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.codigo}</td>
      <td>${d.municipio}</td>
      <td>${d.assunto}</td>
      <td>${d.status}</td>
      <td>${d.prioridade}</td>
    `;
    tr.addEventListener("click", () => abrirDetalhesDemanda(d.id));
    tbody.appendChild(tr);
  });
}

async function abrirDetalhesDemanda(id) {
  const d = demandasCache.find((x) => x.id === id);
  if (!d) return;

  byId("det-codigo").textContent = d.codigo;
  byId("det-assunto").textContent = d.assunto;
  byId("det-municipio").textContent = d.municipio;
  byId("det-estado").textContent = d.estado;
  byId("det-programador").textContent = d.programador;
  byId("det-forma").textContent = d.forma_atendimento;
  byId("det-status").textContent = d.status;
  byId("det-id").value = id;

  show("sec-detalhes-demanda");

  await carregarAtualizacoes(id);
}

async function carregarAtualizacoes(id) {
  const lista = byId("lista-atualizacoes");
  lista.innerHTML = "carregando...";

  const { data } = await supabaseClient
    .from("atualizacoes_demanda")
    .select("*")
    .eq("demanda_id", id)
    .order("created_at", { ascending: true });

  lista.innerHTML = "";

  if (!data || data.length === 0) {
    lista.innerHTML = "<li>Nenhuma atualização.</li>";
    return;
  }

  data.forEach((a) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${a.usuario_nome}</strong> — ${formatarDataHoraBr(
      a.created_at
    )}<br>${a.mensagem}`;
    lista.appendChild(li);
  });
}

async function salvarAtualizacaoDemanda(e) {
  e.preventDefault();

  const demandaId = byId("det-id").value;
  const msg = byId("nova-atualizacao-texto").value.trim();
  if (!msg) return;

  const { error } = await supabaseClient.from("atualizacoes_demanda").insert([
    {
      demanda_id: demandaId,
      usuario_id: currentUserProfile.id,
      usuario_nome: currentUserProfile.nome,
      mensagem: msg,
    },
  ]);

  if (error) {
    alert("Erro ao atualizar: " + error.message);
    return;
  }

  byId("nova-atualizacao-texto").value = "";
  carregarAtualizacoes(demandaId);
}

//-----------------------------------------
// EVENTOS
//-----------------------------------------
function registrarListeners() {
  byId("btn-login")?.addEventListener("click", login);
  byId("btn-cadastrar")?.addEventListener("click", cadastrarNovoUsuario);
  byId("btn-logout")?.addEventListener("click", logout);

  byId("form-demanda")?.addEventListener("submit", salvarDemanda);
  byId("form-atualizacao")?.addEventListener("submit", salvarAtualizacaoDemanda);
}

//-----------------------------------------
// BOOT
//-----------------------------------------
window.addEventListener("load", inicializarApp);
