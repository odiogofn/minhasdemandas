// =========================
// CONFIGURAÇÃO SUPABASE
// =========================

const SUPABASE_URL = "https://cmxepgkkdvyfraesvqly.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGVwZ2trZHZ5ZnJhZXN2cWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3ODA2NDksImV4cCI6MjA4MDM1NjY0OX0.rQMjA0pyJ2gWvPlyuQr0DccdkUs24NQTdsQvgiN2QXY";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================
// ESTADO GLOBAL
// =========================
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

// =========================
// UTILITÁRIOS
// =========================
function byId(id) {
  return document.getElementById(id);
}
function setText(id, txt) {
  const el = byId(id);
  if (el) el.textContent = txt;
}
function show(id) {
  const el = byId(id);
  if (el) el.style.display = "";
}
function hide(id) {
  const el = byId(id);
  if (el) el.style.display = "none";
}
function formatarDataHoraBr(str) {
  if (!str) return "";
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleString("pt-BR");
}
function validarSenhaSimples(s) {
  const re = /^[A-Za-z0-9]{1,10}$/;
  return re.test(s);
}
function setStatusBar(txt) {
  setText("status-bar", txt);
}

// =========================
// INICIALIZAÇÃO
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
      return;
    }
  }
  mostrarTelaAuth();
}

// =========================
// AUTH
// =========================
function mostrarTelaAuth() {
  show("auth-container");
  hide("app-container");
  setText(
    "auth-status",
    "Informe seus dados para entrar ou solicite cadastro. Após cadastro, aguarde aprovação do gestor."
  );
}

function mostrarApp() {
  hide("auth-container");
  show("app-container");

  if (currentUserProfile) {
    setText(
      "user-label",
      `${currentUserProfile.nome} (${currentUserProfile.tipo} · ${
        currentUserProfile.unidade || "-"
      })`
    );
  }
  ajustarInterfacePorPerfil();
  carregarDemandas();
  carregarQuadroAvisos();
  carregarUsuariosGestor();
}

async function carregarPerfilUsuarioAtual() {
  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !userData?.user) {
    console.error("Erro ao obter usuário Auth:", userError);
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
    setText("auth-status", "Erro ao obter perfil. Fale com o gestor.");
    currentUserProfile = null;
    return;
  }

  if ((perfil.status || "").toUpperCase() === "PENDENTE") {
    await supabaseClient.auth.signOut();
    currentSession = null;
    currentUserProfile = null;
    mostrarTelaAuth();
    setText(
      "auth-status",
      "Seu cadastro está pendente de aprovação pelo gestor. Tente novamente mais tarde."
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
  const tipo = byId("cad-tipo").value;
  const senha = byId("cad-senha").value;
  const senha2 = byId("cad-senha2").value;

  if (!nome || !email || !unidade || !tipo || !senha || !senha2) {
    setText("auth-status", "Preencha todos os campos do cadastro.");
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

  // 1) Cria no Auth
  const { error: signError } = await supabaseClient.auth.signUp({
    email,
    password: senha,
  });
  if (signError) {
    console.error(signError);
    setText("auth-status", "Erro ao criar usuário: " + signError.message);
    return;
  }

  // 2) Pega user.id
  const { data: authUser, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !authUser?.user) {
    console.error(userError);
    setText(
      "auth-status",
      "Usuário criado no Auth, mas não foi possível obter o ID. Tente logar depois ou fale com o gestor."
    );
    return;
  }

  const uid = authUser.user.id;

  // 3) Insere na tabela usuarios com status PENDENTE
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
    console.error(perfilError);
    setText(
      "auth-status",
      "Usuário criado no Auth, mas falhou ao salvar perfil: " + perfilError.message
    );
    return;
  }

  setText(
    "auth-status",
    "Cadastro realizado com sucesso! Aguarde aprovação do gestor para poder acessar."
  );

  await supabaseClient.auth.signOut();
  currentSession = null;
  currentUserProfile = null;
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
    console.error(error);
    setText("auth-status", "Erro ao autenticar: " + error.message);
    return;
  }

  currentSession = data.session;

  await carregarPerfilUsuarioAtual();
  if (!currentUserProfile) {
    // mensagem já foi setada em carregarPerfilUsuarioAtual
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
  mostrarTelaAuth();
}

// =========================
// INTERFACE POR PERFIL
// =========================
function ajustarInterfacePorPerfil() {
  if (!currentUserProfile) return;
  const tipo = (currentUserProfile.tipo || "").toUpperCase();

  if (tipo === "PROGRAMADOR") {
    hide("sec-cadastro-demanda");
    show("sec-lista-demandas");
    show("sec-detalhes-demanda");
    hide("sec-painel-gestor");
    hide("btn-graficos");
    setText(
      "ajuda-perfil",
      "Perfil Programador: você visualiza apenas suas demandas e registra atualizações."
    );
  } else if (tipo === "ATENDENTE") {
    show("sec-cadastro-demanda");
    show("sec-lista-demandas");
    show("sec-detalhes-demanda");
    hide("sec-painel-gestor");
    show("btn-graficos");
    setText(
      "ajuda-perfil",
      "Perfil Atendente: você cadastra, edita e acompanha demandas."
    );
  } else if (tipo === "GESTOR") {
    show("sec-cadastro-demanda");
    show("sec-lista-demandas");
    show("sec-detalhes-demanda");
    show("sec-painel-gestor");
    show("btn-graficos");
    setText(
      "ajuda-perfil",
      "Perfil Gestor: você acompanha a produção, gerencia usuários e demandas."
    );
  }
}

// =========================
// DEMANDAS
// =========================

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
  if (!data || data.length === 0) return `${prefixo}-00001`;

  const ultimo = data[0].codigo;
  const partes = ultimo.split("-");
  let num = 0;
  if (partes.length > 1) num = parseInt(partes[1], 10) || 0;
  num++;
  return `${prefixo}-${String(num).padStart(5, "0")}`;
}

async function salvarDemanda(e) {
  e.preventDefault();
  if (!currentUserProfile) {
    alert("Faça login antes de cadastrar demanda.");
    return;
  }

  const tipoUser = (currentUserProfile.tipo || "").toUpperCase();
  if (tipoUser === "PROGRAMADOR") {
    alert("Programador não pode cadastrar demandas.");
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
  const atendente = currentUserProfile.nome;

  if (!municipio || !assunto || !descricao) {
    alert("Preencha Município, Assunto e Descrição.");
    return;
  }

  setStatusBar("Gerando código da demanda...");
  const codigo = await gerarCodigoDemanda();
  const agoraLocal = new Date().toLocaleString("pt-BR");

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
  await carregarQuadroAvisos();
}

async function carregarDemandas() {
  if (!currentUserProfile) return;
  setStatusBar("Carregando demandas...");

  const tipo = (currentUserProfile.tipo || "").toUpperCase();

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
    lista = lista.filter(
      (d) => (d.status || "").toUpperCase() !== "CONCLUÍDA"
    );
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

    const tdCod = document.createElement("td");
    tdCod.innerHTML = `<span class="codigo">${d.codigo || "-"}</span>`;
    tr.appendChild(tdCod);

    const tdMun = document.createElement("td");
    tdMun.textContent = d.municipio || "";
    tr.appendChild(tdMun);

    const tdAss = document.createElement("td");
    tdAss.textContent = d.assunto || "";
    tr.appendChild(tdAss);

    const tdStat = document.createElement("td");
    tdStat.textContent = d.status || "";
    tr.appendChild(tdStat);

    const tdPri = document.createElement("td");
    tdPri.textContent = d.prioridade || "";
    tr.appendChild(tdPri);

    tr.addEventListener("click", () => abrirDetalhesDemanda(d.id));
    tbody.appendChild(tr);
  });

  setText("total-demandas", `Total: ${lista.length}`);
}

async function abrirDetalhesDemanda(id) {
  const d = demandasCache.find((x) => x.id === id);
  if (!d) return;

  byId("det-demanda-id").value = d.id || "";
  setText("det-codigo", d.codigo || "-");
  setText("det-municipio", d.municipio || "-");
  setText("det-tipo-entidade", d.tipo_entidade || "-");
  setText("det-contato-cliente", d.contato_cliente || "-");
  setText("det-estado", d.estado || "-");
  setText("det-assunto", d.assunto || "-");
  setText("det-descricao", d.descricao || "-");
  setText("det-programador", d.programador || "-");
  setText("det-forma-atendimento", d.forma_atendimento || "-");
  setText("det-prioridade", d.prioridade || "-");
  setText("det-status", d.status || "-");
  setText("det-atendente", d.atendente || "-");
  setText("det-link-trello", d.link_trello || "-");
  setText("det-link-email", d.link_email || "-");
  setText("det-criado-em", formatarDataHoraBr(d.created_at));

  await carregarAtualizacoesDemanda(d.id);
}

async function carregarAtualizacoesDemanda(demandaId) {
  const listaEl = byId("lista-atualizacoes");
  if (!listaEl) return;

  listaEl.textContent = "Carregando atualizações...";

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
    alert("Selecione uma demanda e preencha a mensagem.");
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
  await carregarQuadroAvisos();
}

// =========================
// QUADRO DE AVISOS (últimas atualizações)
// =========================
async function carregarQuadroAvisos() {
  const el = byId("quadro-avisos");
  if (!el) return;

  el.textContent = "Carregando avisos...";

  const { data, error } = await supabaseClient
    .from("atualizacoes_demanda")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Erro ao carregar avisos:", error);
    el.textContent = "Erro ao carregar avisos.";
    return;
  }

  if (!data || data.length === 0) {
    el.textContent = "Nenhuma atualização recente.";
    return;
  }

  el.innerHTML = "";
  data.forEach((a) => {
    const div = document.createElement("div");
    div.classList.add("aviso-item");
    div.innerHTML = `
      <div class="aviso-top">
        <span class="aviso-usuario">${a.usuario_nome || "Usuário"}</span>
        <span class="aviso-data">${formatarDataHoraBr(a.created_at)}</span>
      </div>
      <div class="aviso-msg">${a.mensagem || ""}</div>
    `;
    el.appendChild(div);
  });
}

// =========================
// FILTROS & SUGESTÕES
// =========================
function atualizarFiltrosSugestoes() {
  const atendentes = new Set();
  const programadores = new Set();
  const municipios = new Set();
  const estados = new Set();
  const tiposEntidade = new Set();
  const formasAtendimento = new Set();
  const assuntos = new Set();
  const contatos = new Set();

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
    if (d.contato_cliente) contatos.add(d.contato_cliente);
  });

  popularSelectComSet("filtro-atendente", atendentes, "Atendente");
  popularSelectComSet("filtro-programador", programadores, "Programador");
  popularSelectComSet("filtro-municipio", municipios, "Município");
  popularSelectComSet("filtro-estado", estados, "Estado");
  popularSelectComSet("filtro-tipo-entidade", tiposEntidade, "Tipo Entidade");

  renderizarSugestoesChips("sugs-programador", programadores, (v) => {
    byId("dem-programador").value = v;
  });
  renderizarSugestoesChips("sugs-assunto", assuntos, (v) => {
    byId("dem-assunto").value = v;
  });
  renderizarSugestoesChips("sugs-forma-atendimento", formasAtendimento, (v) => {
    const campo = byId("dem-forma-atendimento");
    if (!campo.value) campo.value = v;
    else if (!campo.value.split(",").map((s) => s.trim()).includes(v)) {
      campo.value = campo.value.trim() + ", " + v;
    }
  });
  renderizarSugestoesChips("sugs-contato-cliente", contatos, (v) => {
    byId("dem-contato-cliente").value = v;
  });
  renderizarSugestoesChips("sugs-municipio", municipios, (v) => {
    byId("dem-municipio").value = v;
  });
  renderizarSugestoesChips("sugs-tipo-entidade", tiposEntidade, (v) => {
    byId("dem-tipo-entidade").value = v;
  });
}

function popularSelectComSet(id, setValores, label) {
  const sel = byId(id);
  if (!sel) return;

  const atual = sel.value || "TODOS";

  sel.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "TODOS";
  opt.textContent = `Todos (${label})`;
  sel.appendChild(opt);

  Array.from(setValores)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });

  sel.value = atual && Array.from(setValores).includes(atual) ? atual : "TODOS";
}

function renderizarSugestoesChips(id, setValores, onClickValor) {
  const cont = byId(id);
  if (!cont) return;

  cont.innerHTML = "";
  if (setValores.size === 0) {
    cont.innerHTML = `<span class="muted">Sem sugestões ainda.</span>`;
    return;
  }

  Array.from(setValores)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach((v) => {
      const span = document.createElement("span");
      span.classList.add("chip-sugestao");
      span.textContent = v;
      span.addEventListener("click", () => onClickValor(v));
      cont.appendChild(span);
    });
}

// handlers filtros
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
// GESTOR - GESTÃO DE USUÁRIOS
// =========================
async function carregarUsuariosGestor() {
  if (!currentUserProfile) return;
  const tipo = (currentUserProfile.tipo || "").toUpperCase();
  if (tipo !== "GESTOR") {
    hide("sec-painel-gestor");
    return;
  }

  show("sec-painel-gestor");
  const tbody = byId("tabela-usuarios-gestor");
  const texto = byId("texto-gestor-usuarios");
  if (!tbody) return;

  tbody.innerHTML = "<tr><td colspan='6'>Carregando...</td></tr>";
  texto.textContent = "";

  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("nome", { ascending: true });

  if (error) {
    console.error("Erro ao carregar usuários:", error);
    tbody.innerHTML =
      "<tr><td colspan='6'>Erro ao carregar usuários.</td></tr>";
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6'>Nenhum usuário cadastrado.</td></tr>";
    return;
  }

  tbody.innerHTML = "";
  data.forEach((u) => {
    const tr = document.createElement("tr");

    const tdNome = document.createElement("td");
    const inpNome = document.createElement("input");
    inpNome.type = "text";
    inpNome.value = u.nome || "";
    inpNome.classList.add("input-tabela");
    inpNome.dataset.id = u.id;
    inpNome.dataset.campo = "nome";
    tdNome.appendChild(inpNome);
    tr.appendChild(tdNome);

    const tdEmail = document.createElement("td");
    const inpEmail = document.createElement("input");
    inpEmail.type = "email";
    inpEmail.value = u.email || "";
    inpEmail.classList.add("input-tabela");
    inpEmail.dataset.id = u.id;
    inpEmail.dataset.campo = "email";
    tdEmail.appendChild(inpEmail);
    tr.appendChild(tdEmail);

    const tdUnid = document.createElement("td");
    const inpUnid = document.createElement("input");
    inpUnid.type = "text";
    inpUnid.value = u.unidade || "";
    inpUnid.classList.add("input-tabela");
    inpUnid.dataset.id = u.id;
    inpUnid.dataset.campo = "unidade";
    tdUnid.appendChild(inpUnid);
    tr.appendChild(tdUnid);

    const tdTipo = document.createElement("td");
    const selTipo = document.createElement("select");
    ["PROGRAMADOR", "ATENDENTE", "GESTOR"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if ((u.tipo || "").toUpperCase() === t) opt.selected = true;
      selTipo.appendChild(opt);
    });
    selTipo.dataset.id = u.id;
    selTipo.dataset.campo = "tipo";
    selTipo.classList.add("input-tabela");
    tdTipo.appendChild(selTipo);
    tr.appendChild(tdTipo);

    const tdStatus = document.createElement("td");
    const selStatus = document.createElement("select");
    ["PENDENTE", "ATIVO", "INATIVO"].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      if ((u.status || "").toUpperCase() === s) opt.selected = true;
      selStatus.appendChild(opt);
    });
    selStatus.dataset.id = u.id;
    selStatus.dataset.campo = "status";
    selStatus.classList.add("input-tabela");
    tdStatus.appendChild(selStatus);
    tr.appendChild(tdStatus);

    const tdAcoes = document.createElement("td");
    const btnSalvar = document.createElement("button");
    btnSalvar.textContent = "Salvar";
    btnSalvar.classList.add("btn", "btn-primary", "btn-sm");
    btnSalvar.addEventListener("click", () => salvarUsuarioLinha(u.id, tr));

    tdAcoes.appendChild(btnSalvar);
    tr.appendChild(tdAcoes);

    tbody.appendChild(tr);
  });

  texto.textContent =
    "Apenas o gestor pode aprovar (status ATIVO), inativar e editar nome/email.";
}

async function salvarUsuarioLinha(id, tr) {
  if (!currentUserProfile) return;
  const tipo = (currentUserProfile.tipo || "").toUpperCase();
  if (tipo !== "GESTOR") {
    alert("Apenas gestor pode editar usuários.");
    return;
  }

  const inputs = tr.querySelectorAll(".input-tabela");
  const update = {};
  inputs.forEach((inp) => {
    const campo = inp.dataset.campo;
    if (!campo) return;
    update[campo] = inp.value;
  });

  const { error } = await supabaseClient
    .from("usuarios")
    .update(update)
    .eq("id", id);

  if (error) {
    console.error("Erro ao salvar usuário:", error);
    alert("Erro ao salvar usuário: " + error.message);
    return;
  }

  alert("Usuário atualizado com sucesso!");
}

// =========================
// LISTENERS
// =========================
function registrarListeners() {
  const btnCad = byId("btn-cadastrar");
  if (btnCad) btnCad.addEventListener("click", cadastrarNovoUsuario);

  const btnLogin = byId("btn-login");
  if (btnLogin) btnLogin.addEventListener("click", login);

  const btnLogout = byId("btn-logout");
  if (btnLogout) btnLogout.addEventListener("click", logout);

  const formDem = byId("form-demanda");
  if (formDem) formDem.addEventListener("submit", salvarDemanda);

  const formAt = byId("form-atualizacao-demanda");
  if (formAt) formAt.addEventListener("submit", salvarAtualizacaoDemanda);

  const selStatus = byId("filtro-status");
  if (selStatus) selStatus.addEventListener("change", onFiltroStatusChange);

  const selAt = byId("filtro-atendente");
  if (selAt) selAt.addEventListener("change", onFiltroAtendenteChange);

  const selProg = byId("filtro-programador");
  if (selProg) selProg.addEventListener("change", onFiltroProgramadorChange);

  const selMun = byId("filtro-municipio");
  if (selMun) selMun.addEventListener("change", onFiltroMunicipioChange);

  const selEst = byId("filtro-estado");
  if (selEst) selEst.addEventListener("change", onFiltroEstadoChange);

  const selTipoEnt = byId("filtro-tipo-entidade");
  if (selTipoEnt)
    selTipoEnt.addEventListener("change", onFiltroTipoEntidadeChange);

  const chkConc = byId("filtro-ocultar-concluidas");
  if (chkConc)
    chkConc.addEventListener("change", onFiltroOcultarConcluidasChange);

  const inpBusca = byId("filtro-busca");
  if (inpBusca) inpBusca.addEventListener("keyup", onBuscaTextoKeyup);

  const btnGraf = byId("btn-graficos");
  if (btnGraf) {
    btnGraf.addEventListener("click", () => {
      alert(
        "Aqui entra a tela de gráficos (total por município, atendente, tipo de entidade)."
      );
    });
  }
}

// =========================
// BOOT
// =========================
window.addEventListener("load", inicializarApp);
