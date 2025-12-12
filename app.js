
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

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text;
}

function show(id) {
  const el = byId(id);
  if (el) el.classList.remove("hidden");
}

function hide(id) {
  const el = byId(id);
  if (el) el.classList.add("hidden");
}

function formatarDataHoraBr(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("pt-BR");
}

function validarSenhaSimples(senha) {
  // até 10 caracteres, só letras e números
  const re = /^[A-Za-z0-9]{1,10}$/;
  return re.test(senha);
}

// =========================
// AUTH
// =========================

async function inicializarApp() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("Erro ao obter sessão:", error);
  }
  currentSession = data?.session || null;

  registrarListeners();

  if (currentSession) {
    await carregarPerfilUsuarioAtual();
    if (currentUserProfile) {
      mostrarApp();
    } else {
      mostrarTelaAuth();
    }
  } else {
    mostrarTelaAuth();
  }
}

function mostrarTelaAuth() {
  show("auth-container");
  hide("app-container");
  setText("auth-status", "Informe seus dados para entrar ou se cadastrar.");
}

function mostrarApp() {
  hide("auth-container");
  show("app-container");

  if (currentUserProfile) {
    setText(
      "user-label",
      `${currentUserProfile.nome} (${currentUserProfile.tipo} · ${currentUserProfile.unidade || "-"})`
    );
  }
  ajustarInterfacePorPerfil();
  carregarDemandas();
  if (ehGestor()) {
    carregarUsuariosGestor();
  }
}

function ehGestor() {
  return currentUserProfile && currentUserProfile.tipo === "GESTOR";
}

function ehAtendente() {
  return currentUserProfile && currentUserProfile.tipo === "ATENDENTE";
}

function ehProgramador() {
  return currentUserProfile && currentUserProfile.tipo === "PROGRAMADOR";
}

async function carregarPerfilUsuarioAtual() {
  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !userData?.user) {
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

  if (perfilError) {
    console.error("Erro ao obter perfil:", perfilError);
    currentUserProfile = null;
    setText(
      "auth-status",
      "Erro ao obter perfil. Verifique se o usuário foi cadastrado na tabela usuarios."
    );
    return;
  }

  if (perfil.status !== "ATIVO") {
    await supabaseClient.auth.signOut();
    currentSession = null;
    currentUserProfile = null;
    setText(
      "auth-status",
      "Seu usuário ainda não está ATIVO. Aguarde aprovação do gestor."
    );
    mostrarTelaAuth();
    return;
  }

  currentUserProfile = perfil;
}

async function cadastrarNovoUsuario() {
  const nome = byId("cad-nome").value.trim();
  const email = byId("cad-email").value.trim();
  const dtNasc = byId("cad-dt-nasc").value;
  const unidade = byId("cad-unidade").value;
  const tipo = byId("cad-tipo").value || "PROGRAMADOR";
  const senha = byId("cad-senha").value;
  const senha2 = byId("cad-senha2").value;

  if (!nome || !email || !unidade || !senha || !senha2) {
    setText("auth-status", "Preencha todos os campos obrigatórios.");
    return;
  }

  if (senha !== senha2) {
    setText("auth-status", "As senhas não conferem.");
    return;
  }

  if (!validarSenhaSimples(senha)) {
    setText(
      "auth-status",
      "Senha inválida. Use até 10 caracteres, apenas letras e números, sem símbolos."
    );
    return;
  }

  setText("auth-status", "Criando usuário...");

  const { data: signData, error: signError } = await supabaseClient.auth.signUp({
    email,
    password: senha,
  });

  if (signError) {
    console.error("Erro signUp:", signError);
    setText("auth-status", "Erro ao criar usuário: " + signError.message);
    return;
  }

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !userData?.user) {
    console.error("Erro getUser:", userError);
    setText("auth-status", "Usuário criado, mas não foi possível obter o ID.");
    return;
  }

  const uid = userData.user.id;

  const { error: perfilError } = await supabaseClient.from("usuarios").insert([
    {
      id: uid,
      nome,
      email,
      dt_nascimento: dtNasc || null,
      unidade,
      tipo,
      status: "PENDENTE",
    },
  ]);

  if (perfilError) {
    console.error("Erro ao salvar perfil:", perfilError);
    setText(
      "auth-status",
      "Usuário criado no Auth, mas falhou ao salvar perfil: " + perfilError.message
    );
    return;
  }

  setText(
    "auth-status",
    "Cadastro realizado com sucesso! Aguarde aprovação do gestor para acessar."
  );
  await supabaseClient.auth.signOut();
}

async function login() {
  const email = byId("login-email").value.trim();
  const senha = byId("login-senha").value;

  if (!email || !senha) {
    setText("auth-status", "Informe email e senha.");
    return;
  }

  setText("auth-status", "Autenticando...");

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    console.error("Erro ao autenticar:", error);
    setText("auth-status", "Erro ao autenticar: " + error.message);
    return;
  }

  currentSession = data.session;
  await carregarPerfilUsuarioAtual();
  if (!currentUserProfile) {
    return;
  }

  setText("auth-status", "");
  mostrarApp();
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentSession = null;
  currentUserProfile = null;
  demandasCache = [];
  usuariosCache = [];
  mostrarTelaAuth();
}

// =========================
// INTERFACE POR PERFIL
// =========================

function ajustarInterfacePorPerfil() {
  if (!currentUserProfile) return;
  const tipo = currentUserProfile.tipo;

  const ajudaEl = byId("ajuda-perfil");
  if (tipo === "PROGRAMADOR") {
    hide("sec-cadastro-demanda");
    show("sec-lista-demandas");
    show("sec-detalhes-demanda");
    hide("sec-painel-gestor");
    if (ajudaEl)
      ajudaEl.textContent =
        "Perfil Programador: você visualiza demandas encaminhadas para você e registra atualizações.";
  } else if (tipo === "ATENDENTE") {
    show("sec-cadastro-demanda");
    show("sec-lista-demandas");
    show("sec-detalhes-demanda");
    hide("sec-painel-gestor");
    if (ajudaEl)
      ajudaEl.textContent =
        "Perfil Atendente: você cadastra, edita e exclui as demandas que criar.";
  } else if (tipo === "GESTOR") {
    show("sec-cadastro-demanda");
    show("sec-lista-demandas");
    show("sec-detalhes-demanda");
    show("sec-painel-gestor");
    if (ajudaEl)
      ajudaEl.textContent =
        "Perfil Gestor: você acompanha a produção, gerencia usuários e demandas.";
  }
}

// =========================
// DEMANDAS
// =========================

function setStatusBar(texto) {
  setText("status-bar", texto);
}

async function gerarCodigoDemanda() {
  const ano = new Date().getFullYear();
  const prefixo = "D" + ano;

  const { data, error } = await supabaseClient
    .from("demandas")
    .select("codigo")
    .like("codigo", `${prefixo}-%`)
    .order("codigo", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Erro ao buscar último código:", error);
    return `${prefixo}-00001`;
  }

  if (!data || data.length === 0) {
    return `${prefixo}-00001`;
  }

  const ultimo = data[0].codigo;
  const partes = ultimo.split("-");
  let num = 0;
  if (partes.length > 1) {
    num = parseInt(partes[1], 10) || 0;
  }
  num++;
  return `${prefixo}-${String(num).padStart(5, "0")}`;
}

async function salvarDemanda(e) {
  e.preventDefault();
  if (!currentUserProfile) {
    alert("Faça login antes de cadastrar demanda.");
    return;
  }

  if (!ehAtendente() && !ehGestor()) {
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

  if (!municipio || !assunto || !descricao) {
    alert("Preencha Município, Assunto e Descrição.");
    return;
  }

  const atendente = currentUserProfile.nome;
  const agoraLocal = new Date().toLocaleString("pt-BR");
  const codigo = await gerarCodigoDemanda();

  setStatusBar("Salvando demanda...");

  const { error } = await supabaseClient.from("demandas").insert([
    {
      user_id: currentUserProfile.id,
      codigo,
      municipio,
      tipo_entidade: tipoEntidade || null,
      contato_cliente: contatoCliente || null,
      estado: estado || null,
      assunto,
      descricao,
      programador: programador || null,
      forma_atendimento: formaAtendimento || null,
      prioridade: prioridade || "MÉDIA",
      status: statusDemanda || "ABERTA",
      atendente,
      link_trello: linkTrello || null,
      link_email: linkEmail || null,
      encaminhar_para: programador || null,
      data_hora_local: agoraLocal,
    },
  ]);

  if (error) {
    console.error("Erro ao salvar demanda:", error);
    setStatusBar("Erro ao salvar demanda: " + error.message);
    alert("Erro ao salvar demanda: " + error.message);
    return;
  }

  byId("form-demanda").reset();
  setStatusBar("Demanda salva com sucesso!");
  await carregarDemandas();
}

async function carregarDemandas() {
  if (!currentUserProfile) return;
  setStatusBar("Carregando demandas...");

  let query = supabaseClient.from("demandas").select("*").order("created_at", {
    ascending: false,
  });

  if (ehProgramador()) {
    query = query.or(
      `programador.eq.${currentUserProfile.nome},encaminhar_para.eq.${currentUserProfile.nome}`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("Erro ao carregar demandas:", error);
    setStatusBar("Erro ao carregar demandas: " + error.message);
    return;
  }

  demandasCache = data || [];
  atualizarFiltrosSugestoes();
  renderizarDemandas();
  setStatusBar("Pronto");
}

function renderizarDemandas() {
  const tbody = byId("tabela-demandas");
  if (!tbody) return;
  tbody.innerHTML = "";

  let lista = [...demandasCache];

  if (filtrosAtuais.ocultarConcluidas) {
    lista = lista.filter((d) => (d.status || "").toUpperCase() !== "CONCLUÍDA");
  }

  if (filtrosAtuais.status !== "TODOS") {
    lista = lista.filter(
      (d) => (d.status || "").toUpperCase() === filtrosAtuais.status.toUpperCase()
    );
  }

  if (filtrosAtuais.atendente !== "TODOS") {
    lista = lista.filter((d) => (d.atendente || "") === filtrosAtuais.atendente);
  }

  if (filtrosAtuais.programador !== "TODOS") {
    lista = lista.filter((d) => (d.programador || "") === filtrosAtuais.programador);
  }

  if (filtrosAtuais.municipio !== "TODOS") {
    lista = lista.filter((d) => (d.municipio || "") === filtrosAtuais.municipio);
  }

  if (filtrosAtuais.estado !== "TODOS") {
    lista = lista.filter((d) => (d.estado || "") === filtrosAtuais.estado);
  }

  if (filtrosAtuais.tipoEntidade !== "TODOS") {
    lista = lista.filter(
      (d) => (d.tipo_entidade || "") === filtrosAtuais.tipoEntidade
    );
  }

  if (filtrosAtuais.buscaTexto.trim() !== "") {
    const termo = filtrosAtuais.buscaTexto.toLowerCase();
    lista = lista.filter((d) => {
      return (
        (d.descricao || "").toLowerCase().includes(termo) ||
        (d.assunto || "").toLowerCase().includes(termo) ||
        (d.codigo || "").toLowerCase().includes(termo)
      );
    });
  }

  lista.forEach((d) => {
    const tr = document.createElement("tr");
    tr.classList.add("linha-demanda");
    tr.dataset.demandaId = d.id;

    const tdCodigo = document.createElement("td");
    tdCodigo.innerHTML = `<span class="codigo">${d.codigo || "-"}</span>`;
    tr.appendChild(tdCodigo);

    const tdMunicipio = document.createElement("td");
    tdMunicipio.textContent = d.municipio || "";
    tr.appendChild(tdMunicipio);

    const tdAssunto = document.createElement("td");
    tdAssunto.textContent = d.assunto || "";
    tr.appendChild(tdAssunto);

    const tdStatus = document.createElement("td");
    tdStatus.textContent = d.status || "";
    tr.appendChild(tdStatus);

    const tdPrioridade = document.createElement("td");
    tdPrioridade.textContent = d.prioridade || "";
    tr.appendChild(tdPrioridade);

    tr.addEventListener("click", () => abrirDetalhesDemanda(d.id));

    tbody.appendChild(tr);
  });

  setText("total-demandas", `Total: ${lista.length}`);
}

// =========================
// DETALHES E ATUALIZAÇÕES
// =========================

async function abrirDetalhesDemanda(demandaId) {
  const demanda = demandasCache.find((d) => d.id === demandaId);
  if (!demanda) return;

  byId("det-demanda-id").value = demanda.id;
  setText("det-codigo", demanda.codigo || "-");
  setText("det-municipio", demanda.municipio || "-");
  setText("det-tipo-entidade", demanda.tipo_entidade || "-");
  setText("det-contato-cliente", demanda.contato_cliente || "-");
  setText("det-estado", demanda.estado || "-");
  setText("det-assunto", demanda.assunto || "-");
  setText("det-descricao", demanda.descricao || "-");
  setText("det-programador", demanda.programador || "-");
  setText("det-forma-atendimento", demanda.forma_atendimento || "-");
  setText("det-prioridade", demanda.prioridade || "-");
  setText("det-status", demanda.status || "-");
  setText("det-atendente", demanda.atendente || "-");
  setText("det-link-trello", demanda.link_trello || "-");
  setText("det-link-email", demanda.link_email || "-");
  setText("det-criado-em", formatarDataHoraBr(demanda.created_at));

  show("sec-detalhes-demanda");

  await carregarAtualizacoesDemanda(demanda.id);
}

async function carregarAtualizacoesDemanda(demandaId) {
  const listaEl = byId("lista-atualizacoes");
  if (!listaEl) return;
  listaEl.innerHTML = "Carregando atualizações...";

  const { data, error } = await supabaseClient
    .from("atualizacoes_demanda")
    .select("*")
    .eq("demanda_id", demandaId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Erro ao carregar atualizações:", error);
    listaEl.textContent = "Erro ao carregar atualizações.";
    return;
  }

  if (!data || data.length === 0) {
    listaEl.textContent = "Nenhuma atualização registrada.";
    return;
  }

  listaEl.innerHTML = "";
  data.forEach((a) => {
    const li = document.createElement("li");
    li.classList.add("item-atualizacao");
    li.innerHTML = `
      <div><strong>${a.usuario_nome || "Usuário"}</strong> – <span class="muted">${formatarDataHoraBr(
      a.created_at
    )}</span></div>
      <div>${a.mensagem || ""}</div>
    `;
    listaEl.appendChild(li);
  });
}

async function salvarAtualizacaoDemanda(e) {
  e.preventDefault();
  if (!currentUserProfile) {
    alert("Faça login para registrar atualização.");
    return;
  }

  const demandaId = byId("det-demanda-id").value;
  const msg = byId("nova-atualizacao-texto").value.trim();

  if (!demandaId || !msg) {
    alert("Escreva uma mensagem de atualização.");
    return;
  }

  const { error } = await supabaseClient.from("atualizacoes_demanda").insert([
    {
      demanda_id: demandaId,
      usuario_id: currentUserProfile.id,
      usuario_nome: currentUserProfile.nome,
      mensagem: msg,
    },
  ]);

  if (error) {
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

function atualizarFiltrosSugestoes() {
  const atendentes = new Set();
  const programadores = new Set();
  const municipios = new Set();
  const estados = new Set();
  const tiposEntidade = new Set();
  const formasAtendimento = new Set();
  const assuntos = new Set();
  const contatosCliente = new Set();

  demandasCache.forEach((d) => {
    if (d.atendente) atendentes.add(d.atendente);
    if (d.programador) programadores.add(d.programador);
    if (d.municipio) municipios.add(d.municipio);
    if (d.estado) estados.add(d.estado);
    if (d.tipo_entidade) tiposEntidade.add(d.tipo_entidade);
    if (d.forma_atendimento) {
      d.forma_atendimento
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((fa) => formasAtendimento.add(fa));
    }
    if (d.assunto) assuntos.add(d.assunto);
    if (d.contato_cliente) contatosCliente.add(d.contato_cliente);
  });

  popularSelectComSet("filtro-atendente", atendentes, "Atendente");
  popularSelectComSet("filtro-programador", programadores, "Programador");
  popularSelectComSet("filtro-municipio", municipios, "Município");
  popularSelectComSet("filtro-estado", estados, "Estado");
  popularSelectComSet("filtro-tipo-entidade", tiposEntidade, "Tipo Entidade");

  renderizarSugestoesChips("sugs-programador", programadores, (valor) => {
    byId("dem-programador").value = valor;
  });

  renderizarSugestoesChips("sugs-assunto", assuntos, (valor) => {
    byId("dem-assunto").value = valor;
  });

  renderizarSugestoesChips("sugs-forma-atendimento", formasAtendimento, (valor) => {
    const campo = byId("dem-forma-atendimento");
    if (!campo.value) {
      campo.value = valor;
    } else {
      const parts = campo.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.includes(valor)) {
        campo.value = campo.value.trim() + ", " + valor;
      }
    }
  });

  renderizarSugestoesChips("sugs-contato-cliente", contatosCliente, (valor) => {
    byId("dem-contato-cliente").value = valor;
  });

  renderizarSugestoesChips("sugs-municipio", municipios, (valor) => {
    byId("dem-municipio").value = valor;
  });

  renderizarSugestoesChips("sugs-tipo-entidade", tiposEntidade, (valor) => {
    byId("dem-tipo-entidade").value = valor;
  });
}

function popularSelectComSet(selectId, setValores, labelPadrao) {
  const select = byId(selectId);
  if (!select) return;

  const valorAtual = select.value || "TODOS";

  select.innerHTML = "";
  const optTodos = document.createElement("option");
  optTodos.value = "TODOS";
  optTodos.textContent = `Todos (${labelPadrao})`;
  select.appendChild(optTodos);

  Array.from(setValores)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });

  if (Array.from(setValores).includes(valorAtual)) {
    select.value = valorAtual;
  } else {
    select.value = "TODOS";
  }
}

function renderizarSugestoesChips(containerId, setValores, onClickValor) {
  const cont = byId(containerId);
  if (!cont) return;

  cont.innerHTML = "";

  const arr = Array.from(setValores).sort((a, b) => a.localeCompare(b, "pt-BR"));

  if (arr.length === 0) {
    cont.innerHTML = '<span class="hint">Sem sugestões ainda.</span>';
    return;
  }

  arr.forEach((valor) => {
    const span = document.createElement("span");
    span.classList.add("chip-sugestao");
    span.textContent = valor;
    span.addEventListener("click", () => onClickValor(valor));
    cont.appendChild(span);
  });
}

function onFiltroStatusChange() {
  filtrosAtuais.status = byId("filtro-status").value;
  renderizarDemandas();
}

function onFiltroAtendenteChange() {
  filtrosAtuais.atendente = byId("filtro-atendente").value;
  renderizarDemandas();
}

function onFiltroProgramadorChange() {
  filtrosAtuais.programador = byId("filtro-programador").value;
  renderizarDemandas();
}

function onFiltroMunicipioChange() {
  filtrosAtuais.municipio = byId("filtro-municipio").value;
  renderizarDemandas();
}

function onFiltroEstadoChange() {
  filtrosAtuais.estado = byId("filtro-estado").value;
  renderizarDemandas();
}

function onFiltroTipoEntidadeChange() {
  filtrosAtuais.tipoEntidade = byId("filtro-tipo-entidade").value;
  renderizarDemandas();
}

function onFiltroOcultarConcluidasChange() {
  filtrosAtuais.ocultarConcluidas = byId("filtro-ocultar-concluidas").checked;
  renderizarDemandas();
}

function onBuscaTextoKeyup() {
  filtrosAtuais.buscaTexto = byId("filtro-busca").value;
  renderizarDemandas();
}

// =========================
// GESTÃO DE USUÁRIOS (GESTOR)
// =========================

async function carregarUsuariosGestor() {
  if (!ehGestor()) return;
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("nome", { ascending: true });

  if (error) {
    console.error("Erro ao carregar usuários:", error);
    return;
  }

  usuariosCache = data || [];
  renderizarUsuariosGestor();
}

function renderizarUsuariosGestor() {
  const tbody = byId("tabela-usuarios");
  if (!tbody) return;
  tbody.innerHTML = "";

  usuariosCache.forEach((u) => {
    const tr = document.createElement("tr");

    const tdNome = document.createElement("td");
    tdNome.textContent = u.nome || "";
    tr.appendChild(tdNome);

    const tdEmail = document.createElement("td");
    tdEmail.textContent = u.email || "";
    tr.appendChild(tdEmail);

    const tdTipo = document.createElement("td");
    tdTipo.textContent = u.tipo || "";
    tr.appendChild(tdTipo);

    const tdUnidade = document.createElement("td");
    tdUnidade.textContent = u.unidade || "";
    tr.appendChild(tdUnidade);

    const tdStatus = document.createElement("td");
    const spanStatus = document.createElement("span");
    spanStatus.textContent = u.status || "";
    spanStatus.classList.add("badge-status");
    if (u.status) spanStatus.classList.add(u.status);
    tdStatus.appendChild(spanStatus);
    tr.appendChild(tdStatus);

    const tdAcoes = document.createElement("td");
    const divBtns = document.createElement("div");
    divBtns.classList.add("acao-botoes");

    const btnAtivar = document.createElement("button");
    btnAtivar.textContent = "Ativar";
    btnAtivar.className = "btn-xs";
    btnAtivar.addEventListener("click", () => atualizarStatusUsuario(u.id, "ATIVO"));

    const btnPend = document.createElement("button");
    btnPend.textContent = "Pendente";
    btnPend.className = "btn-xs";
    btnPend.addEventListener("click", () => atualizarStatusUsuario(u.id, "PENDENTE"));

    const btnInat = document.createElement("button");
    btnInat.textContent = "Inativar";
    btnInat.className = "btn-xs";
    btnInat.addEventListener("click", () => atualizarStatusUsuario(u.id, "INATIVO"));

    const btnEditar = document.createElement("button");
    btnEditar.textContent = "Editar";
    btnEditar.className = "btn-xs";
    btnEditar.addEventListener("click", () => editarUsuarioPrompt(u));

    const btnExcluir = document.createElement("button");
    btnExcluir.textContent = "Excluir";
    btnExcluir.className = "btn-xs";
    btnExcluir.addEventListener("click", () => excluirUsuario(u.id));

    divBtns.appendChild(btnAtivar);
    divBtns.appendChild(btnPend);
    divBtns.appendChild(btnInat);
    divBtns.appendChild(btnEditar);
    divBtns.appendChild(btnExcluir);

    tdAcoes.appendChild(divBtns);
    tr.appendChild(tdAcoes);

    tbody.appendChild(tr);
  });
}

async function atualizarStatusUsuario(userId, novoStatus) {
  if (!ehGestor()) return;
  const { error } = await supabaseClient
    .from("usuarios")
    .update({ status: novoStatus })
    .eq("id", userId);

  if (error) {
    console.error("Erro ao atualizar status:", error);
    alert("Erro ao atualizar status: " + error.message);
    return;
  }

  alert("Status atualizado com sucesso!");
  await carregarUsuariosGestor();
}

async function editarUsuarioPrompt(u) {
  if (!ehGestor() && (!currentUserProfile || currentUserProfile.id !== u.id)) {
    alert("Apenas gestor ou o próprio usuário podem editar nome/email.");
    return;
  }

  const novoNome = prompt("Novo nome:", u.nome || "");
  if (novoNome === null) return;

  const novoEmail = prompt("Novo email:", u.email || "");
  if (novoEmail === null) return;

  const { error } = await supabaseClient
    .from("usuarios")
    .update({ nome: novoNome.trim(), email: novoEmail.trim() })
    .eq("id", u.id);

  if (error) {
    console.error("Erro ao editar usuário:", error);
    alert("Erro ao editar usuário: " + error.message);
    return;
  }

  alert("Usuário atualizado com sucesso!");
  await carregarUsuariosGestor();
}

async function excluirUsuario(userId) {
  if (!ehGestor()) return;
  if (!confirm("Tem certeza que deseja excluir este usuário?")) return;

  const { error } = await supabaseClient.from("usuarios").delete().eq("id", userId);
  if (error) {
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

function registrarListeners() {
  const btnLogin = byId("btn-login");
  if (btnLogin) btnLogin.addEventListener("click", login);

  const btnCadastrar = byId("btn-cadastrar");
  if (btnCadastrar) btnCadastrar.addEventListener("click", cadastrarNovoUsuario);

  const btnLogout = byId("btn-logout");
  if (btnLogout) btnLogout.addEventListener("click", logout);

  const formDemanda = byId("form-demanda");
  if (formDemanda) formDemanda.addEventListener("submit", salvarDemanda);

  const formAtualizacao = byId("form-atualizacao-demanda");
  if (formAtualizacao)
    formAtualizacao.addEventListener("submit", salvarAtualizacaoDemanda);

  const selStatus = byId("filtro-status");
  if (selStatus) selStatus.addEventListener("change", onFiltroStatusChange);

  const selAtendente = byId("filtro-atendente");
  if (selAtendente)
    selAtendente.addEventListener("change", onFiltroAtendenteChange);

  const selProgramador = byId("filtro-programador");
  if (selProgramador)
    selProgramador.addEventListener("change", onFiltroProgramadorChange);

  const selMunicipio = byId("filtro-municipio");
  if (selMunicipio)
    selMunicipio.addEventListener("change", onFiltroMunicipioChange);

  const selEstado = byId("filtro-estado");
  if (selEstado) selEstado.addEventListener("change", onFiltroEstadoChange);

  const selTipoEntidade = byId("filtro-tipo-entidade");
  if (selTipoEntidade)
    selTipoEntidade.addEventListener("change", onFiltroTipoEntidadeChange);

  const chkOcultar = byId("filtro-ocultar-concluidas");
  if (chkOcultar)
    chkOcultar.addEventListener("change", onFiltroOcultarConcluidasChange);

  const inpBusca = byId("filtro-busca");
  if (inpBusca) inpBusca.addEventListener("keyup", onBuscaTextoKeyup);

  const btnGraficos = byId("btn-graficos");
  if (btnGraficos) {
    btnGraficos.addEventListener("click", () => {
      alert("Tela de gráficos pode ser implementada com Chart.js usando demandasCache.");
    });
  }
}

window.addEventListener("load", inicializarApp);
