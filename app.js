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

let filtrosAtuais = {
  buscaTexto: "",
  ocultarConcluidas: false,
  consultarTodas: false,
  status: "TODOS",
  suporte: "TODOS",
  programador: "TODOS",
  cliente: "TODOS",
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
function ehSuporte(){ return currentUserProfile && currentUserProfile.tipo === "SUPORTE"; }
function ehProgramador(){ return currentUserProfile && currentUserProfile.tipo === "PROGRAMADOR"; }

function setStatusBar(texto){ setText("status-bar", texto); }

function podeEditarOuExcluir(d){
  if(!currentUserProfile || !d) return false;
  if(ehGestor()) return true;
  if(ehSuporte() && d.user_id === currentUserProfile.id) return true;
  return false;
}
function podeEncaminhar(d){
  if(!currentUserProfile || !d) return false;
  if(ehGestor()) return true;
  if(ehSuporte() && d.user_id === currentUserProfile.id) return true;
  return false;
}

function podeEditarAtualizacao(a){
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

function mostrarApp(){
  hide("auth-container");
  show("app-container");

  setText("user-label", `${currentUserProfile.nome} (${currentUserProfile.tipo} · ${currentUserProfile.unidade || "-"})`);
  ajustarInterfacePorPerfil();

  // carregar base
  carregarUsuariosParaListas();
  carregarClientes();
  carregarDemandas();

  if(ehGestor()){
    carregarUsuariosGestor();       // <-- EXIBIR USUÁRIOS NO GESTOR
    carregarTop10Gestor();          // <-- top 10
  }
}

function ajustarInterfacePorPerfil(){
  const ajudaEl = byId("ajuda-perfil");

  // checkbox "consultar todas" só faz sentido para quem NÃO é gestor
  if(ehGestor()){
    show("sec-cadastro-demanda");
    show("sec-painel-gestor");
    show("sec-clientes");
    hide("box-consultar-todas");
    if(ajudaEl) ajudaEl.textContent = "Perfil Gestor: você acompanha, gerencia usuários, clientes e demandas.";
    return;
  }

  show("box-consultar-todas");

  if(ehProgramador()){
    hide("sec-cadastro-demanda");
    hide("sec-painel-gestor");
    hide("sec-clientes");
    if(ajudaEl) ajudaEl.textContent = "Perfil Programador: você visualiza e registra atualizações.";
  } else if(ehSuporte()){
    show("sec-cadastro-demanda");
    hide("sec-painel-gestor");
    show("sec-clientes");
    if(ajudaEl) ajudaEl.textContent = "Perfil Suporte: você cadastra/edita/exclui suas demandas e gerencia clientes.";
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
  mostrarTelaAuth();
}

// =========================
// CLIENTES (CRUD + CASCATA)
// =========================
async function carregarClientes(){
  const { data, error } = await supabaseClient
    .from("clientes")
    .select("*")
    .order("cliente", { ascending:true });

  if(error){
    console.error("Erro ao carregar clientes:", error);
    setText("clientes-status", "Erro ao carregar clientes: " + error.message);
    clientesCache = [];
    popularSelectClientes();
    return;
  }

  clientesCache = data || [];
  setText("clientes-status", "");
  renderizarClientes();
  popularSelectClientes();
}

function renderizarClientes(){
  const tbody = byId("tabela-clientes");
  if(!tbody) return;
  tbody.innerHTML = "";

  for(const c of clientesCache){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.cliente || ""}</td>
      <td>${c.estado || ""}</td>
      <td>${c.contato || ""}</td>
      <td>${c.telefone || ""}</td>
      <td>
        <button class="btn-mini" data-a="EDITAR">Editar</button>
        <button class="btn-mini" data-a="EXCLUIR">Excluir</button>
      </td>
    `;
    const btnEditar = tr.querySelector('[data-a="EDITAR"]');
    const btnExcluir = tr.querySelector('[data-a="EXCLUIR"]');

    btnEditar.addEventListener("click", ()=>editarClientePrompt(c));
    btnExcluir.addEventListener("click", ()=>excluirCliente(c.id));

    tbody.appendChild(tr);
  }
}

async function salvarCliente(e){
  e.preventDefault();
  if(!(ehGestor() || ehSuporte())){
    alert("Apenas SUPORTE ou GESTOR podem cadastrar clientes.");
    return;
  }

  const cliente = byId("cli-cliente").value.trim().toUpperCase();
  const estado = byId("cli-estado").value.trim().toUpperCase();
  const contato = byId("cli-contato").value.trim().toUpperCase();
  const telefone = byId("cli-telefone").value.trim();

  if(!cliente || !estado || !contato || !telefone){
    setText("clientes-status", "Preencha todos os campos do cliente.");
    return;
  }

  const { error } = await supabaseClient.from("clientes").insert([{
    cliente, estado, contato, telefone
  }]);

  if(error){
    console.error("Erro ao salvar cliente:", error);
    setText("clientes-status", "Erro ao salvar cliente: " + error.message);
    return;
  }

  byId("form-cliente").reset();
  setText("clientes-status", "Cliente salvo com sucesso!");
  await carregarClientes();
}

async function editarClientePrompt(c){
  if(!(ehGestor() || ehSuporte())){
    alert("Sem permissão.");
    return;
  }

  const cliente = prompt("Cliente:", c.cliente || "");
  if(cliente === null) return;
  const estado = prompt("Estado:", c.estado || "");
  if(estado === null) return;
  const contato = prompt("Contato:", c.contato || "");
  if(contato === null) return;
  const telefone = prompt("Telefone:", c.telefone || "");
  if(telefone === null) return;

  const { error } = await supabaseClient.from("clientes").update({
    cliente: cliente.trim().toUpperCase(),
    estado: estado.trim().toUpperCase(),
    contato: contato.trim().toUpperCase(),
    telefone: telefone.trim()
  }).eq("id", c.id);

  if(error){
    console.error("Erro ao editar cliente:", error);
    alert("Erro ao editar cliente: " + error.message);
    return;
  }

  await carregarClientes();
}

async function excluirCliente(id){
  if(!(ehGestor() || ehSuporte())){
    alert("Sem permissão.");
    return;
  }
  if(!confirm("Excluir este cliente?")) return;

  const { error } = await supabaseClient.from("clientes").delete().eq("id", id);
  if(error){
    console.error("Erro ao excluir cliente:", error);
    alert("Erro ao excluir cliente: " + error.message);
    return;
  }

  await carregarClientes();
}

function popularSelectClientes(){
  const selCliente = byId("dem-cliente");
  if(!selCliente) return;

  const clienteAtual = selCliente.value;
  selCliente.innerHTML = `<option value="">Selecione...</option>`;

  const nomes = Array.from(new Set(clientesCache.map(c => c.cliente).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const nome of nomes){
    const opt = document.createElement("option");
    opt.value = nome;
    opt.textContent = nome;
    selCliente.appendChild(opt);
  }

  if(nomes.includes(clienteAtual)) selCliente.value = clienteAtual;
  onClienteChange();
}

function onClienteChange(){
  const selCliente = byId("dem-cliente");
  const selEstado = byId("dem-estado");
  const selContato = byId("dem-contato");
  const inpTel = byId("dem-telefone");

  const cliente = selCliente.value;

  selEstado.innerHTML = `<option value="">Selecione...</option>`;
  selContato.innerHTML = `<option value="">Selecione...</option>`;
  inpTel.value = "";

  if(!cliente) return;

  const estados = Array.from(new Set(
    clientesCache.filter(c => c.cliente === cliente).map(c => c.estado).filter(Boolean)
  )).sort((a,b)=>a.localeCompare(b,"pt-BR"));

  for(const est of estados){
    const opt = document.createElement("option");
    opt.value = est;
    opt.textContent = est;
    selEstado.appendChild(opt);
  }
}

function onEstadoChange(){
  const cliente = byId("dem-cliente").value;
  const estado = byId("dem-estado").value;
  const selContato = byId("dem-contato");
  const inpTel = byId("dem-telefone");

  selContato.innerHTML = `<option value="">Selecione...</option>`;
  inpTel.value = "";

  if(!cliente || !estado) return;

  const contatos = clientesCache
    .filter(c => c.cliente === cliente && c.estado === estado)
    .sort((a,b)=>(a.contato||"").localeCompare((b.contato||""),"pt-BR"));

  for(const c of contatos){
    const opt = document.createElement("option");
    opt.value = c.contato;
    opt.textContent = c.contato;
    opt.dataset.tel = c.telefone || "";
    selContato.appendChild(opt);
  }
}

function onContatoChange(){
  const selContato = byId("dem-contato");
  const opt = selContato.selectedOptions?.[0];
  const tel = opt?.dataset?.tel || "";
  byId("dem-telefone").value = tel;
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

  if(error) return `${prefixo}-00001`;
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
  if(!currentUserProfile) return alert("Faça login antes.");
  if(!(ehSuporte() || ehGestor())) return alert("Apenas SUPORTE ou GESTOR cadastram demanda.");

  const cliente = byId("dem-cliente").value.trim().toUpperCase();
  const estado = byId("dem-estado").value.trim().toUpperCase();
  const contato = byId("dem-contato").value.trim().toUpperCase();
  const telefone = byId("dem-telefone").value.trim();

  const tipoEntidade = byId("dem-tipo-entidade").value.trim().toUpperCase();
  const assunto = byId("dem-assunto").value.trim().toUpperCase();
  const descricao = byId("dem-descricao").value.trim();
  const programador = byId("dem-programador").value.trim();
  const formaAtendimento = byId("dem-forma-atendimento").value.trim();
  const prioridade = byId("dem-prioridade").value;
  const statusDemanda = byId("dem-status").value;
  const linkTrello = byId("dem-link-trello").value.trim();
  const linkEmail = byId("dem-link-email").value.trim();

  if(!cliente || !estado || !contato || !telefone || !assunto || !descricao){
    return alert("Preencha Cliente/Estado/Contato/Telefone, Assunto e Descrição.");
  }

  const suporte = currentUserProfile.nome;
  const agoraLocal = new Date().toLocaleString("pt-BR");
  const codigo = await gerarCodigoDemanda();

  setStatusBar("Salvando demanda...");

  const payload = {
    user_id: currentUserProfile.id,
    codigo,

    cliente,
    estado,
    contato,
    telefone,

    tipo_entidade: tipoEntidade || null,
    assunto,
    descricao,

    programador: programador || null,
    encaminhar_para: programador || null,

    forma_atendimento: formaAtendimento || null,
    prioridade: prioridade || "MÉDIA",
    status: statusDemanda || "ABERTA",

    suporte,
    link_trello: linkTrello || null,
    link_email: linkEmail || null,
    data_hora_local: agoraLocal,
  };

  const { error } = await supabaseClient.from("demandas").insert([payload]);
  if(error){
    console.error(error);
    setStatusBar("Erro ao salvar: " + error.message);
    return alert("Erro ao salvar: " + error.message);
  }

  byId("form-demanda").reset();
  setStatusBar("Demanda salva com sucesso!");
  await carregarDemandas();
}

async function carregarDemandas(){
  if(!currentUserProfile) return;
  setStatusBar("Carregando demandas...");

  const consultarTodas = !!byId("filtro-consultar-todas")?.checked;

  let q = supabaseClient.from("demandas").select("*").order("created_at", { ascending:false });

  // regra:
  // - gestor: sempre todas
  // - suporte/programador: padrão = só as suas; se "consultar todas" = traz tudo (somente consulta)
  if(!ehGestor() && !consultarTodas){
    if(ehProgramador()){
      q = q.or(`programador.eq.${currentUserProfile.nome},encaminhar_para.eq.${currentUserProfile.nome}`);
    } else if(ehSuporte()){
      q = q.eq("user_id", currentUserProfile.id);
    }
  }

  const { data, error } = await q;
  if(error){
    console.error("Erro ao carregar demandas:", error);
    setStatusBar("Erro ao carregar: " + error.message);
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
  if(filtrosAtuais.suporte !== "TODOS"){
    lista = lista.filter(d => (d.suporte || "") === filtrosAtuais.suporte);
  }
  if(filtrosAtuais.programador !== "TODOS"){
    lista = lista.filter(d => (d.programador || "") === filtrosAtuais.programador);
  }
  if(filtrosAtuais.cliente !== "TODOS"){
    lista = lista.filter(d => (d.cliente || "") === filtrosAtuais.cliente);
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
      <td>${d.cliente || ""}</td>
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
  if(!podeEditarOuExcluir(d)) return alert("Sem permissão para excluir.");

  if(!confirm(`Excluir a demanda ${d.codigo}? (ação permanente)`)) return;

  const { error } = await supabaseClient.from("demandas").delete().eq("id", demandaId);
  if(error) return alert("Erro: " + error.message);

  await carregarDemandas();
}

async function editarDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;
  if(!podeEditarOuExcluir(d)) return alert("Sem permissão para editar.");

  const assunto = prompt("Assunto:", d.assunto || "");
  if(assunto === null) return;
  const descricao = prompt("Descrição:", d.descricao || "");
  if(descricao === null) return;

  const status = prompt("Status (ABERTA, EM ANÁLISE, NA PROGRAMAÇÃO, ENCAMINHADA, CONCLUÍDA):", d.status || "");
  if(status === null) return;

  const prioridade = prompt("Prioridade (BAIXA, MÉDIA, ALTA, URGENTE):", d.prioridade || "");
  if(prioridade === null) return;

  const payload = {
    assunto: assunto.trim().toUpperCase(),
    descricao: descricao.trim(),
    status: status.trim().toUpperCase(),
    prioridade: prioridade.trim().toUpperCase()
  };

  const { error } = await supabaseClient.from("demandas").update(payload).eq("id", demandaId);
  if(error) return alert("Erro: " + error.message);

  await carregarDemandas();
}

// =========================
// MODAL / DETALHES / ENCAMINHAR
// =========================
function abrirModal(){ show("modal-overlay"); show("modal-detalhes"); }
function fecharModal(){ hide("modal-overlay"); hide("modal-detalhes"); }

async function abrirModalDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;

  byId("det-demanda-id").value = d.id;
  setText("modal-titulo", `Demanda ${d.codigo || ""}`);
  setText("modal-subtitulo", `${d.cliente || "-"} · ${d.assunto || "-"}`);

  setText("det-codigo", d.codigo || "-");
  setText("det-cliente", d.cliente || "-");
  setText("det-estado", d.estado || "-");
  setText("det-contato", d.contato || "-");
  setText("det-telefone", d.telefone || "-");

  setText("det-tipo-entidade", d.tipo_entidade || "-");
  setText("det-assunto", d.assunto || "-");
  setText("det-descricao", d.descricao || "-");

  setText("det-programador", d.programador || "-");
  setText("det-encaminhar-para", d.encaminhar_para || "-");

  setText("det-forma-atendimento", d.forma_atendimento || "-");
  setText("det-prioridade", d.prioridade || "-");
  setText("det-status", d.status || "-");
  setText("det-suporte", d.suporte || "-");
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

  byId("btn-encaminhar").onclick = async () => encaminharDemanda(d.id);
  byId("btn-editar-demanda").onclick = async () => { await editarDemanda(d.id); await carregarDemandas(); await abrirModalDemanda(d.id); };
  byId("btn-excluir-demanda").onclick = async () => { await excluirDemanda(d.id); fecharModal(); };

  abrirModal();
  await carregarAtualizacoesDemanda(d.id);
}

async function popularSelectEncaminhar(d){
  const sel = byId("sel-encaminhar-usuario");
  sel.innerHTML = `<option value="">Selecione...</option>`;

  const ativos = usuariosCache
    .filter(u => (u.status || "").toUpperCase() === "ATIVO")
    .sort((a,b)=>(a.nome||"").localeCompare((b.nome||""),"pt-BR"));

  for(const u of ativos){
    const opt = document.createElement("option");
    opt.value = u.id; // usamos ID para saber tipo depois
    opt.textContent = `${u.nome} (${u.tipo})`;
    sel.appendChild(opt);
  }
}

async function encaminharDemanda(demandaId){
  const d = demandasCache.find(x => x.id === demandaId);
  if(!d) return;
  if(!podeEncaminhar(d)) return alert("Sem permissão para encaminhar.");

  const destinoId = byId("sel-encaminhar-usuario").value;
  if(!destinoId) return alert("Selecione um usuário.");

  const destino = usuariosCache.find(u => u.id === destinoId);
  if(!destino) return alert("Usuário destino não encontrado.");

  // REGRA: só altera programador se destino for PROGRAMADOR
  const payload = {
    encaminhar_para: destino.nome,
    status: "ENCAMINHADA"
  };
  if((destino.tipo || "").toUpperCase() === "PROGRAMADOR"){
    payload.programador = destino.nome;
  }

  const { error } = await supabaseClient.from("demandas").update(payload).eq("id", demandaId);
  if(error) return alert("Erro ao encaminhar: " + error.message);

  await carregarDemandas();
  await abrirModalDemanda(demandaId);
}

// =========================
// ATUALIZAÇÕES (INSERIR/EDITAR/EXCLUIR)
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
    console.error(error);
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

    const pode = podeEditarAtualizacao(a);

    li.innerHTML = `
      <div>
        <strong>${a.usuario_nome || "Usuário"}</strong>
        – <span class="muted">${formatarDataHoraBr(a.created_at)}</span>
        ${pode ? `
          <button class="btn-link-mini" data-act="EDITAR">Editar</button>
          <button class="btn-link-mini" data-act="EXCLUIR">Excluir</button>
        ` : ``}
      </div>
      <div id="msg-${a.id}">${a.mensagem || ""}</div>
    `;

    if(pode){
      li.querySelector('[data-act="EDITAR"]').addEventListener("click", ()=>editarAtualizacaoPrompt(a));
      li.querySelector('[data-act="EXCLUIR"]').addEventListener("click", ()=>excluirAtualizacao(a));
    }

    listaEl.appendChild(li);
  }
}

async function salvarAtualizacaoDemanda(e){
  e.preventDefault();
  if(!currentUserProfile) return alert("Faça login.");

  const demandaId = byId("det-demanda-id").value;
  const msg = byId("nova-atualizacao-texto").value.trim();
  if(!demandaId || !msg) return alert("Escreva a atualização.");

  const { error } = await supabaseClient.from("atualizacoes_demanda").insert([{
    demanda_id: demandaId,
    usuario_id: currentUserProfile.id,
    usuario_nome: currentUserProfile.nome,
    mensagem: msg
  }]);

  if(error) return alert("Erro: " + error.message);

  byId("nova-atualizacao-texto").value = "";
  await carregarAtualizacoesDemanda(demandaId);
}

async function editarAtualizacaoPrompt(a){
  if(!podeEditarAtualizacao(a)) return alert("Sem permissão.");

  const nova = prompt("Editar andamento:", a.mensagem || "");
  if(nova === null) return;

  const { error } = await supabaseClient
    .from("atualizacoes_demanda")
    .update({ mensagem: nova.trim() })
    .eq("id", a.id);

  if(error) return alert("Erro: " + error.message);

  const demandaId = byId("det-demanda-id").value;
  await carregarAtualizacoesDemanda(demandaId);
}

async function excluirAtualizacao(a){
  if(!podeEditarAtualizacao(a)) return alert("Sem permissão.");
  if(!confirm("Excluir este andamento?")) return;

  const { error } = await supabaseClient
    .from("atualizacoes_demanda")
    .delete()
    .eq("id", a.id);

  if(error) return alert("Erro: " + error.message);

  const demandaId = byId("det-demanda-id").value;
  await carregarAtualizacoesDemanda(demandaId);
}

// =========================
// LISTAS AUX (usuários + filtros + sugestões)
// =========================
async function carregarUsuariosParaListas(){
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("id,nome,tipo,status,email,unidade")
    .order("nome", { ascending: true });

  if(error){
    console.error("Erro ao carregar usuários (listas):", error);
    usuariosCache = [];
    return;
  }
  usuariosCache = data || [];
}

function atualizarFiltrosSugestoes(){
  const suportes = new Set();
  const programadores = new Set();
  const clientes = new Set();
  const estados = new Set();
  const tiposEntidade = new Set();
  const formasAtendimento = new Set();
  const assuntos = new Set();

  for(const d of demandasCache){
    if(d.suporte) suportes.add(d.suporte);
    if(d.programador) programadores.add(d.programador);
    if(d.cliente) clientes.add(d.cliente);
    if(d.estado) estados.add(d.estado);
    if(d.tipo_entidade) tiposEntidade.add(d.tipo_entidade);
    if(d.forma_atendimento){
      d.forma_atendimento.split(",").map(s=>s.trim()).filter(Boolean).forEach(fa => formasAtendimento.add(fa));
    }
    if(d.assunto) assuntos.add(d.assunto);
  }

  popularSelectComSet("filtro-suporte", suportes, "Suporte");
  popularSelectComSet("filtro-programador", programadores, "Programador");
  popularSelectComSet("filtro-cliente", clientes, "Cliente");
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

  const ativosNomes = new Set(
    usuariosCache
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

// =========================
// GESTOR: TOP 10 + USUÁRIOS
// =========================
async function carregarTop10Gestor(){
  if(!ehGestor()) return;

  const ulCad = byId("top10-cadastradas");
  const ulCon = byId("top10-concluidas");
  if(ulCad) ulCad.innerHTML = "Carregando...";
  if(ulCon) ulCon.innerHTML = "Carregando...";

  const { data: ultimas, error: e1 } = await supabaseClient
    .from("demandas")
    .select("id,codigo,cliente,assunto,status,created_at")
    .order("created_at", { ascending:false })
    .limit(10);

  const { data: concluidas, error: e2 } = await supabaseClient
    .from("demandas")
    .select("id,codigo,cliente,assunto,status,created_at")
    .eq("status", "CONCLUÍDA")
    .order("created_at", { ascending:false })
    .limit(10);

  if(e1) console.error(e1);
  if(e2) console.error(e2);

  if(ulCad){
    ulCad.innerHTML = "";
    (ultimas || []).forEach(d=>{
      const li = document.createElement("li");
      li.classList.add("item-atualizacao");
      li.style.cursor = "pointer";
      li.innerHTML = `<div><strong>${d.codigo}</strong> – ${d.cliente || "-"} · ${d.assunto || "-"}</div><div class="muted">${formatarDataHoraBr(d.created_at)}</div>`;
      li.addEventListener("click", ()=>abrirModalDemanda(d.id));
      ulCad.appendChild(li);
    });
    if((ultimas||[]).length === 0) ulCad.textContent = "Sem dados.";
  }

  if(ulCon){
    ulCon.innerHTML = "";
    (concluidas || []).forEach(d=>{
      const li = document.createElement("li");
      li.classList.add("item-atualizacao");
      li.style.cursor = "pointer";
      li.innerHTML = `<div><strong>${d.codigo}</strong> – ${d.cliente || "-"} · ${d.assunto || "-"}</div><div class="muted">${formatarDataHoraBr(d.created_at)}</div>`;
      li.addEventListener("click", ()=>abrirModalDemanda(d.id));
      ulCon.appendChild(li);
    });
    if((concluidas||[]).length === 0) ulCon.textContent = "Sem dados.";
  }
}

async function carregarUsuariosGestor(){
  if(!ehGestor()) return;

  setText("usuarios-gestor-status", "Carregando usuários...");

  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("nome", { ascending:true });

  if(error){
    console.error("Erro ao carregar usuários:", error);
    setText("usuarios-gestor-status", "Erro: " + error.message);
    usuariosCache = usuariosCache || [];
    renderizarUsuariosGestor([]);
    return;
  }

  setText("usuarios-gestor-status", "");
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

    const btns = tr.querySelectorAll("button.btn-xs");
    btns.forEach(btn => {
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
  const { error } = await supabaseClient.from("usuarios").update({ status: novoStatus }).eq("id", userId);
  if(error) return alert("Erro: " + error.message);
  alert("Status atualizado com sucesso!");
  await carregarUsuariosGestor();
  await carregarUsuariosParaListas(); // mantém lista atualizada para encaminhar
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

  if(error) return alert("Erro: " + error.message);

  alert("Usuário atualizado com sucesso!");
  await carregarUsuariosGestor();
  await carregarUsuariosParaListas();
}

async function excluirUsuario(userId){
  if(!confirm("Tem certeza que deseja excluir este usuário?")) return;

  const { error } = await supabaseClient.from("usuarios").delete().eq("id", userId);
  if(error) return alert("Erro: " + error.message);

  alert("Usuário excluído com sucesso!");
  await carregarUsuariosGestor();
  await carregarUsuariosParaListas();
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

  byId("dem-cliente")?.addEventListener("change", onClienteChange);
  byId("dem-estado")?.addEventListener("change", onEstadoChange);
  byId("dem-contato")?.addEventListener("change", onContatoChange);

  byId("filtro-status")?.addEventListener("change", ()=>{ filtrosAtuais.status = byId("filtro-status").value; renderizarDemandas(); });
  byId("filtro-suporte")?.addEventListener("change", ()=>{ filtrosAtuais.suporte = byId("filtro-suporte").value; renderizarDemandas(); });
  byId("filtro-programador")?.addEventListener("change", ()=>{ filtrosAtuais.programador = byId("filtro-programador").value; renderizarDemandas(); });
  byId("filtro-cliente")?.addEventListener("change", ()=>{ filtrosAtuais.cliente = byId("filtro-cliente").value; renderizarDemandas(); });
  byId("filtro-estado")?.addEventListener("change", ()=>{ filtrosAtuais.estado = byId("filtro-estado").value; renderizarDemandas(); });
  byId("filtro-tipo-entidade")?.addEventListener("change", ()=>{ filtrosAtuais.tipoEntidade = byId("filtro-tipo-entidade").value; renderizarDemandas(); });

  byId("filtro-ocultar-concluidas")?.addEventListener("change", ()=>{ filtrosAtuais.ocultarConcluidas = byId("filtro-ocultar-concluidas").checked; renderizarDemandas(); });
  byId("filtro-busca")?.addEventListener("keyup", ()=>{ filtrosAtuais.buscaTexto = byId("filtro-busca").value; renderizarDemandas(); });

  byId("filtro-consultar-todas")?.addEventListener("change", async ()=>{
    filtrosAtuais.consultarTodas = byId("filtro-consultar_todas")?.checked;
    await carregarDemandas();
  });

  byId("btn-fechar-modal")?.addEventListener("click", fecharModal);
  byId("modal-overlay")?.addEventListener("click", fecharModal);

  byId("btn-graficos")?.addEventListener("click", () => {
    alert("Gráficos: pode ser implementado com Chart.js usando demandasCache.");
  });

  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") fecharModal();
  });
}

window.addEventListener("load", inicializarApp);
