import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const byId = (id) => document.getElementById(id);
const show = (id) => byId(id)?.classList.remove("hidden");
const hide = (id) => byId(id)?.classList.add("hidden");
const setText = (id, t) => { const el = byId(id); if (el) el.textContent = t ?? ""; };

function forceHideApp(){ const app = byId("app-container"); if(app) app.style.display = "none"; }
function forceShowApp(){ const app = byId("app-container"); if(app) app.style.display = "block"; }

forceHideApp();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Variáveis do Supabase não encontradas (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).");
  setText("whoami", "Config faltando (.env/Vercel)");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function normalizarEstadoSigla(v){
  const raw = (v || "").toString().trim().toUpperCase();
  const mapa = {"CEARÁ":"CE","CEARA":"CE","RIO GRANDE DO NORTE":"RN","AMAPÁ":"AM","AMAPA":"AM","MARANHÃO":"MA","MARANHAO":"MA","PARÁ":"PA","PARA":"PA"};
  if (mapa[raw]) return mapa[raw];
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return raw;
}

async function refreshSessionUI(){
  forceHideApp();
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if(!session){
    show("auth-container");
    hide("btn-logout");
    setText("whoami", "Deslogado");
    return;
  }

  hide("auth-container");
  show("btn-logout");
  setText("whoami", session.user.email || session.user.id);

  forceShowApp();
  instalarTabs();
  instalarBuscaClientesTempoReal();
}

async function login(){
  setText("auth-status", "");
  const email = (byId("auth-email")?.value || "").trim();
  const password = (byId("auth-pass")?.value || "").trim();
  if(!email || !password){ setText("auth-status", "Preencha email e senha."); return; }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if(error) setText("auth-status", "Erro no login: " + error.message);
}

async function signup(){
  setText("auth-status", "");
  const email = (byId("auth-email")?.value || "").trim();
  const password = (byId("auth-pass")?.value || "").trim();
  if(!email || !password){ setText("auth-status", "Preencha email e senha."); return; }
  const { error } = await supabase.auth.signUp({ email, password });
  if(error) setText("auth-status", "Erro ao criar conta: " + error.message);
  else setText("auth-status", "Conta criada! (pode exigir confirmação por email)");
}

async function logout(){ await supabase.auth.signOut(); }

function instalarTabs(){
  document.querySelectorAll(".tab").forEach(btn => {
    if(btn.dataset.__wired) return;
    btn.dataset.__wired = "1";
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");
      document.querySelectorAll("#tab-demandas,#tab-clientes").forEach(p => p.classList.add("hidden"));
      byId(target)?.classList.remove("hidden");
    });
  });
}

async function salvarCliente(){
  setText("cli-status-msg", "");
  const cliente = (byId("cli-nome")?.value || "").trim();
  const tipoEntidade = (byId("cli-tipo-entidade")?.value || "").trim().toUpperCase();
  const municipio = (byId("cli-municipio")?.value || "").trim();
  const estado = normalizarEstadoSigla(byId("cli-estado")?.value || "");
  if(!cliente || !tipoEntidade || !municipio || !estado){ setText("cli-status-msg","Preencha Cliente, Tipo Entidade, Município e Estado."); return; }
  const payload = { cliente, tipo_entidade: tipoEntidade, tipo: tipoEntidade, municipio, estado };
  const { error } = await supabase.from("clientes").insert([payload]);
  if(error) setText("cli-status-msg","Erro ao salvar cliente: " + error.message);
  else setText("cli-status-msg","Cliente salvo!");
}

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
    .order("cliente", { ascending: true })
    .limit(10);
  if(error){ console.error("Erro buscar clientes:", error); return []; }
  return (data || []).map(c => ({ ...c, tipo_entidade: c.tipo_entidade || c.tipo || "" }));
}

function renderResultados(lista){
  const box = byId("dem-cliente-resultados");
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
    btn.innerHTML = `<div class="t-main">${c.cliente||""}</div><div class="t-sub">${c.municipio||""} · ${c.tipo_entidade||""}</div>`;
    btn.addEventListener("click", () => selecionarCliente(c));
    box.appendChild(btn);
  }
  box.classList.remove("hidden");
}

function selecionarCliente(c){
  selectedCliente = c;
  byId("dem-cliente-id").value = c.id || "";
  byId("dem-cliente-nome").value = c.cliente || "";
  byId("dem-cliente-tipo-entidade").value = c.tipo_entidade || "";
  byId("dem-municipio").value = c.municipio || "";
  byId("dem-cliente-estado").value = normalizarEstadoSigla(c.estado || "");
  byId("dem-cliente-busca").value = c.cliente || "";
  byId("dem-cliente-resultados").classList.add("hidden");
}

function instalarBuscaClientesTempoReal(){
  const input = byId("dem-cliente-busca");
  const box = byId("dem-cliente-resultados");
  if(!input || !box) return;
  if(input.dataset.__wired) return;
  input.dataset.__wired = "1";

  input.addEventListener("input", () => {
    selectedCliente = null;
    byId("dem-cliente-id").value = "";
    byId("dem-cliente-nome").value = "";
    byId("dem-cliente-tipo-entidade").value = "";
    byId("dem-municipio").value = "";
    byId("dem-cliente-estado").value = "";

    if(timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const lista = await buscarClientes(input.value);
      renderResultados(lista);
    }, 250);
  });

  input.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 180));
  input.addEventListener("focus", async () => {
    if((input.value||"").trim().length >= 2){
      const lista = await buscarClientes(input.value);
      renderResultados(lista);
    }
  });
}

async function salvarDemanda(){
  setText("dem-status-msg", "");
  if(!selectedCliente?.id){ setText("dem-status-msg","Pesquise e selecione um cliente antes de salvar."); return; }
  const assunto = (byId("dem-assunto")?.value || "").trim();
  const descricao = (byId("dem-descricao")?.value || "").trim();
  const status = byId("dem-status")?.value || "Abertura";
  const prioridade = byId("dem-prioridade")?.value || "Média";
  if(!assunto || !descricao){ setText("dem-status-msg","Preencha Assunto e Descrição."); return; }

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;

  const payload = {
    created_by: user?.id || null,
    cliente_id: selectedCliente.id,
    cliente_nome: selectedCliente.cliente,
    cliente_tipo_entidade: selectedCliente.tipo_entidade,
    cliente_municipio: selectedCliente.municipio,
    cliente_estado: normalizarEstadoSigla(selectedCliente.estado),
    municipio: selectedCliente.municipio,
    assunto, descricao, status, prioridade
  };

  const { error } = await supabase.from("demandas").insert([payload]);
  if(error) setText("dem-status-msg","Erro ao salvar demanda: " + error.message);
  else setText("dem-status-msg","Demanda salva!");
}

document.addEventListener("DOMContentLoaded", async () => {
  forceHideApp();
  byId("btn-login")?.addEventListener("click", login);
  byId("btn-signup")?.addEventListener("click", signup);
  byId("btn-logout")?.addEventListener("click", logout);
  byId("btn-salvar-cliente")?.addEventListener("click", salvarCliente);
  byId("btn-salvar-demanda")?.addEventListener("click", salvarDemanda);

  supabase.auth.onAuthStateChange(() => refreshSessionUI());
  await refreshSessionUI();
});
