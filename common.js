import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const setText = (id, t) => { const el = $(id); if(el) el.textContent = t ?? ""; };
const show = (id) => $(id)?.classList.remove("hidden");
const hide = (id) => $(id)?.classList.add("hidden");

function currentPage(){
  const s = document.currentScript;
  return s?.dataset?.page || "";
}

function setActiveNav(page){
  document.querySelectorAll(".nav a").forEach(a => {
    a.classList.toggle("active", a.dataset.page === page);
  });
}

async function guard({ requireAuth }){
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if(session){
    setText("whoami", session.user.email || session.user.id);
    show("btn-logout");
    hide("btn-login-nav");
  } else {
    setText("whoami", "Deslogado");
    hide("btn-logout");
    show("btn-login-nav");
  }

  if(requireAuth && !session){
    window.location.replace("./index.html");
    return null;
  }
  return session;
}

async function logout(){
  await supabase.auth.signOut();
  window.location.replace("./index.html");
}

function wireTopbar(){
  $("btn-logout")?.addEventListener("click", logout);
  $("btn-login-nav")?.addEventListener("click", () => window.location.href = "./index.html");
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// -------- index (login/cadastro) ----------
async function pageIndex(){
  const session = await guard({ requireAuth:false });
  wireTopbar();
  setActiveNav("index");

  if(session){
    window.location.replace("./demandas.html");
    return;
  }

  $("btn-login")?.addEventListener("click", async () => {
    setText("auth-status", "");
    const email = ($("auth-email")?.value || "").trim();
    const password = ($("auth-pass")?.value || "").trim();
    if(!email || !password){ setText("auth-status", "Preencha email e senha."); return; }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error){ setText("auth-status", error.message); return; }
    window.location.replace("./demandas.html");
  });

  $("btn-signup")?.addEventListener("click", async () => {
    setText("signup-status", "");
    const email = ($("signup-email")?.value || "").trim();
    const password = ($("signup-pass")?.value || "").trim();
    if(!email || !password){ setText("signup-status", "Preencha email e senha."); return; }

    const { error } = await supabase.auth.signUp({ email, password });
    if(error){ setText("signup-status", error.message); return; }
    setText("signup-status", "Conta criada! Se exigir confirmação por email, confirme e depois faça login.");
  });
}

// -------- clientes ----------
function normalizarEstadoSigla(v){
  const raw = (v || "").toString().trim().toUpperCase();
  const mapa = {"CEARÁ":"CE","CEARA":"CE","RIO GRANDE DO NORTE":"RN","AMAPÁ":"AM","AMAPA":"AM","MARANHÃO":"MA","MARANHAO":"MA","PARÁ":"PA","PARA":"PA"};
  if (mapa[raw]) return mapa[raw];
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return raw;
}

async function pageClientes(){
  await guard({ requireAuth:true });
  wireTopbar();
  setActiveNav("clientes");

  $("btn-salvar-cliente")?.addEventListener("click", async () => {
    setText("cli-status-msg", "");
    const cliente = ($("cli-nome")?.value || "").trim();
    const tipoEntidade = ($("cli-tipo-entidade")?.value || "").trim().toUpperCase();
    const municipio = ($("cli-municipio")?.value || "").trim();
    const estado = normalizarEstadoSigla($("cli-estado")?.value || "");

    if(!cliente || !tipoEntidade || !municipio || !estado){
      setText("cli-status-msg", "Preencha Cliente, Tipo Entidade, Município e Estado.");
      return;
    }

    const payload = { cliente, tipo_entidade: tipoEntidade, tipo: tipoEntidade, municipio, estado };
    const { error } = await supabase.from("clientes").insert([payload]);
    if(error){ setText("cli-status-msg", "Erro ao salvar cliente: " + error.message); return; }

    setText("cli-status-msg", "Cliente salvo!");
    $("cli-nome").value = ""; $("cli-tipo-entidade").value = ""; $("cli-municipio").value = ""; $("cli-estado").value = "";
  });
}

// -------- demandas ----------
let selectedCliente = null;
let timer = null;

async function buscarClientes(termo){
  const t = (termo || "").trim();
  if(!t) return [];
  const like = `%${t}%`;

  const { data, error } = await supabase
    .from("clientes")
    .select("id,cliente,municipio,estado,tipo_entidade,tipo")
    .or(`cliente.ilike.${like},municipio.ilike.${like},tipo_entidade.ilike.${like},tipo.ilike.${like}`)
    .order("cliente", { ascending:true })
    .limit(10);

  if(error){ console.error(error); return []; }
  return (data || []).map(c => ({ ...c, tipo_entidade: c.tipo_entidade || c.tipo || "" }));
}

function renderResultados(lista){
  const box = $("dem-cliente-resultados");
  if(!box) return;

  if(!lista.length){
    box.innerHTML = '<div class="typeahead-item"><div class="t-sub">Nenhum resultado.</div></div>';
    box.classList.remove("hidden");
    return;
  }

  box.innerHTML = "";
  for(const c of lista){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "typeahead-item";
    btn.innerHTML = `<div class="t-main">${escapeHtml(c.cliente||"")}</div><div class="t-sub">${escapeHtml(c.municipio||"")} · ${escapeHtml(c.tipo_entidade||"")}</div>`;
    btn.addEventListener("click", () => selecionarCliente(c));
    box.appendChild(btn);
  }
  box.classList.remove("hidden");
}

function selecionarCliente(c){
  selectedCliente = c;
  $("dem-cliente-id").value = c.id || "";
  $("dem-cliente-nome").value = c.cliente || "";
  $("dem-cliente-tipo-entidade").value = c.tipo_entidade || "";
  $("dem-municipio").value = c.municipio || "";
  $("dem-cliente-estado").value = normalizarEstadoSigla(c.estado || "");
  $("dem-cliente-busca").value = c.cliente || "";
  $("dem-cliente-resultados").classList.add("hidden");
}

async function pageDemandas(){
  const session = await guard({ requireAuth:true });
  wireTopbar();
  setActiveNav("demandas");

  const input = $("dem-cliente-busca");
  const box = $("dem-cliente-resultados");

  input?.addEventListener("input", () => {
    selectedCliente = null;
    $("dem-cliente-id").value = "";
    $("dem-cliente-nome").value = "";
    $("dem-cliente-tipo-entidade").value = "";
    $("dem-municipio").value = "";
    $("dem-cliente-estado").value = "";

    if(timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const lista = await buscarClientes(input.value);
      renderResultados(lista);
    }, 250);
  });

  input?.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 180));
  input?.addEventListener("focus", async () => {
    if((input.value||"").trim().length >= 2){
      const lista = await buscarClientes(input.value);
      renderResultados(lista);
    }
  });

  $("btn-salvar-demanda")?.addEventListener("click", async () => {
    setText("dem-status-msg", "");
    if(!selectedCliente?.id){ setText("dem-status-msg", "Pesquise e selecione um cliente antes de salvar."); return; }

    const assunto = ($("dem-assunto")?.value || "").trim();
    const descricao = ($("dem-descricao")?.value || "").trim();
    const status = $("dem-status")?.value || "Abertura";
    const prioridade = $("dem-prioridade")?.value || "Média";

    if(!assunto || !descricao){ setText("dem-status-msg", "Preencha Assunto e Descrição."); return; }

    const payload = {
      created_by: session?.user?.id || null,
      cliente_id: selectedCliente.id,
      cliente_nome: selectedCliente.cliente,
      cliente_tipo_entidade: selectedCliente.tipo_entidade,
      cliente_municipio: selectedCliente.municipio,
      cliente_estado: normalizarEstadoSigla(selectedCliente.estado),
      municipio: selectedCliente.municipio,
      assunto, descricao, status, prioridade
    };

    const { error } = await supabase.from("demandas").insert([payload]);
    if(error){ setText("dem-status-msg", "Erro ao salvar demanda: " + error.message); return; }

    setText("dem-status-msg", "Demanda salva!");
    $("dem-assunto").value = ""; $("dem-descricao").value = "";
  });
}

// -------- usuários ----------
async function pageUsuarios(){
  await guard({ requireAuth:true });
  wireTopbar();
  setActiveNav("usuarios");

  $("btn-criar-usuario")?.addEventListener("click", async () => {
    setText("usr-status-msg", "");
    const email = ($("usr-email")?.value || "").trim();
    const password = ($("usr-pass")?.value || "").trim();
    const perfil = ($("usr-perfil")?.value || "").trim();

    if(!email || !password || !perfil){
      setText("usr-status-msg", "Preencha Email, Senha e Perfil.");
      return;
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if(error){ setText("usr-status-msg", "Erro ao criar: " + error.message); return; }

    // opcional: salvar perfil em tabela 'usuarios'
    try{
      const userId = data?.user?.id;
      if(userId){
        await supabase.from("usuarios").insert([{ user_id: userId, email, perfil }]);
      }
    }catch(e){
      console.warn("Perfil não gravado (tabela/RLS):", e);
    }

    setText("usr-status-msg", "Usuário criado! Se houver confirmação por email, confirme.");
    $("usr-email").value = ""; $("usr-pass").value = ""; $("usr-perfil").value = "SUPORTE";
  });
}

// -------- boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  const page = currentPage();
  setActiveNav(page);

  if(page === "index") return pageIndex();
  if(page === "clientes") return pageClientes();
  if(page === "demandas") return pageDemandas();
  if(page === "usuarios") return pageUsuarios();
});
