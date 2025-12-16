// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://SEU_PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "SUA_ANON_KEY_AQUI";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// ========================
// ESTADO GLOBAL
// ========================
let currentUser = null;
let currentProfile = null;

// ========================
// HELPERS
// ========================
const $ = id => document.getElementById(id);

function tipoPerfil(){
  return (currentProfile?.tipo || "").trim().toUpperCase();
}

function ehGestor(){ return tipoPerfil() === "GESTOR"; }
function ehSuporte(){ return tipoPerfil() === "SUPORTE"; }
function ehProgramador(){ return tipoPerfil() === "PROGRAMADOR"; }

// ========================
// AUTH
// ========================
async function login(){
  const email = $("login-email").value;
  const password = $("login-senha").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email, password
  });

  if(error){
    alert("Erro ao autenticar: " + error.message);
    return;
  }

  currentUser = data.user;
  await carregarPerfil();
  iniciarApp();
}

async function cadastrar(){
  const nome = $("cad-nome").value;
  const email = $("cad-email").value;
  const senha = $("cad-senha").value;
  const senha2 = $("cad-senha2").value;
  const tipo = $("cad-tipo").value;
  const unidade = $("cad-unidade").value;
  const dtNasc = $("cad-dt-nasc").value;

  if(senha !== senha2){
    alert("Senhas não conferem");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password: senha
  });

  if(error){
    alert(error.message);
    return;
  }

  await supabaseClient.from("usuarios").insert({
    id: data.user.id,
    nome,
    email,
    tipo,
    unidade,
    data_nascimento: dtNasc,
    status: "PENDENTE"
  });

  alert("Cadastro realizado. Aguarde aprovação do gestor.");
}

async function carregarPerfil(){
  const { data } = await supabaseClient.auth.getUser();
  if(!data?.user) return;

  const { data: perfil } = await supabaseClient
    .from("usuarios")
    .select("*")
    .eq("id", data.user.id)
    .single();

  if(!perfil || perfil.status !== "ATIVO"){
    await supabaseClient.auth.signOut();
    alert("Usuário não aprovado.");
    return;
  }

  currentProfile = perfil;
}

// ========================
// UI
// ========================
function iniciarApp(){
  $("auth-container").classList.add("hidden");
  $("app-container").classList.remove("hidden");

  $("user-label").innerText =
    `${currentProfile.nome} (${tipoPerfil()})`;

  ajustarInterface();
  carregarClientes();
  carregarDemandas();
  if(ehGestor()) carregarUsuarios();
}

function ajustarInterface(){
  if(ehGestor()){
    $("tab-usuarios").classList.remove("hidden");
  }

  $("ajuda-perfil").innerText =
    ehGestor() ? "Perfil Gestor"
    : ehSuporte() ? "Perfil Suporte"
    : "Perfil Programador";
}

// ========================
// ABAS
// ========================
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;

    document.querySelectorAll(".tab-btn").forEach(b =>
      b.classList.remove("active")
    );
    btn.classList.add("active");

    document.querySelectorAll(".tab-content").forEach(sec =>
      sec.classList.toggle("hidden", sec.dataset.tab !== tab)
    );
  });
});

// ========================
// CLIENTES
// ========================
async function carregarClientes(){
  const { data } = await supabaseClient
    .from("clientes")
    .select("*")
    .order("cliente");

  const tbody = $("lista-clientes");
  tbody.innerHTML = "";

  data.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.cliente}</td>
      <td>${c.tipo}</td>
      <td>${c.municipio}</td>
      <td>
        <button onclick="excluirCliente('${c.id}')">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const select = $("demanda-cliente");
  select.innerHTML = `<option value="">Selecione</option>`;
  data.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.cliente;
    opt.dataset.tipo = c.tipo;
    opt.dataset.municipio = c.municipio;
    select.appendChild(opt);
  });
}

$("btn-salvar-cliente").onclick = async () => {
  await supabaseClient.from("clientes").insert({
    cliente: $("cliente-nome").value,
    tipo: $("cliente-tipo").value,
    estado: $("cliente-estado").value,
    municipio: $("cliente-municipio").value
  });
  carregarClientes();
};

async function excluirCliente(id){
  await supabaseClient.from("clientes").delete().eq("id", id);
  carregarClientes();
}

// ========================
// DEMANDAS
// ========================
$("demanda-cliente").onchange = e => {
  const opt = e.target.selectedOptions[0];
  $("demanda-tipo-entidade").value = opt?.dataset.tipo || "";
  $("demanda-municipio").value = opt?.dataset.municipio || "";
};

$("btn-salvar-demanda").onclick = async () => {
  await supabaseClient.from("demandas").insert({
    cliente_id: $("demanda-cliente").value,
    tipo_entidade: $("demanda-tipo-entidade").value,
    municipio: $("demanda-municipio").value,
    assunto: $("demanda-assunto").value,
    descricao: $("demanda-descricao").value,
    prioridade: $("demanda-prioridade").value,
    usuario_id: currentProfile.id,
    status: "ABERTA"
  });
  carregarDemandas();
};

async function carregarDemandas(){
  const { data } = await supabaseClient
    .from("demandas")
    .select("*, clientes(cliente)")
    .order("created_at", { ascending: false });

  const tbody = $("lista-demandas");
  tbody.innerHTML = "";

  data.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.id}</td>
      <td>${d.clientes?.cliente || ""}</td>
      <td>${d.status}</td>
      <td>
        ${(ehGestor() || ehSuporte()) ?
          `<button onclick="excluirDemanda('${d.id}')">Excluir</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function excluirDemanda(id){
  if(!confirm("Excluir demanda?")) return;
  await supabaseClient.from("demandas").delete().eq("id", id);
  carregarDemandas();
}

// ========================
// USUÁRIOS (GESTOR)
// ========================
async function carregarUsuarios(){
  const { data } = await supabaseClient
    .from("usuarios")
    .select("*")
    .order("nome");

  const tbody = $("lista-usuarios");
  tbody.innerHTML = "";

  data.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.nome}</td>
      <td>${u.email}</td>
      <td>${u.tipo}</td>
      <td>${u.status}</td>
      <td>
        ${u.status === "PENDENTE" ?
          `<button onclick="aprovarUsuario('${u.id}')">Aprovar</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function aprovarUsuario(id){
  await supabaseClient
    .from("usuarios")
    .update({ status: "ATIVO" })
    .eq("id", id);
  carregarUsuarios();
}

// ========================
// EVENTOS
// ========================
$("btn-login").onclick = login;
$("btn-cadastrar").onclick = cadastrar;

$("btn-logout").onclick = async () => {
  await supabaseClient.auth.signOut();
  location.reload();
};
