import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ENV (VITE / VERCEL)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// HELPERS
const byId = id => document.getElementById(id);
const hide = id => byId(id)?.classList.add("hidden");
const show = id => byId(id)?.classList.remove("hidden");

const forceHideApp = () => byId("app-container").style.display = "none";
const forceShowApp = () => byId("app-container").style.display = "block";

forceHideApp();

// ===== AUTH =====
async function refreshSession() {
  forceHideApp();
  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    show("auth-container");
    return;
  }

  hide("auth-container");
  forceShowApp();
  instalarBuscaCliente();
}

async function login() {
  byId("auth-status").textContent = "";

  const email = byId("auth-email").value.trim();
  const password = byId("auth-pass").value.trim();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    byId("auth-status").textContent = error.message;
  }
}

async function signup() {
  byId("auth-status").textContent = "";

  const email = byId("auth-email").value.trim();
  const password = byId("auth-pass").value.trim();

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error("Signup error:", error);
    byId("auth-status").textContent = error.message;
    return;
  }

  byId("auth-status").textContent =
    "Conta criada. Verifique o email se confirmação estiver ativa.";
}

// ===== BUSCA CLIENTE =====
let timer = null;
let clienteSelecionado = null;

async function buscarClientes(termo) {
  const like = `%${termo}%`;

  const { data } = await supabase
    .from("clientes")
    .select("id,cliente,municipio,estado,tipo_entidade")
    .or(
      `cliente.ilike.${like},municipio.ilike.${like},tipo_entidade.ilike.${like}`
    )
    .limit(10);

  return data || [];
}

function instalarBuscaCliente() {
  const input = byId("dem-cliente-busca");
  const box = byId("dem-cliente-resultados");

  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);

    timer = setTimeout(async () => {
      box.innerHTML = "";
      const lista = await buscarClientes(input.value);

      lista.forEach(c => {
        const btn = document.createElement("button");
        btn.textContent = `${c.cliente} · ${c.municipio} · ${c.tipo_entidade}`;
        btn.onclick = () => selecionarCliente(c);
        box.appendChild(btn);
      });
    }, 300);
  });
}

function selecionarCliente(c) {
  clienteSelecionado = c;
  byId("dem-cliente-nome").value = c.cliente;
  byId("dem-cliente-tipo-entidade").value = c.tipo_entidade;
  byId("dem-municipio").value = c.municipio;
  byId("dem-cliente-estado").value = c.estado;
  byId("dem-cliente-resultados").innerHTML = "";
}

// ===== DEMANDA =====
async function salvarDemanda() {
  if (!clienteSelecionado) {
    byId("dem-status-msg").textContent = "Selecione um cliente.";
    return;
  }

  const payload = {
    cliente_id: clienteSelecionado.id,
    cliente_nome: clienteSelecionado.cliente,
    cliente_tipo_entidade: clienteSelecionado.tipo_entidade,
    cliente_municipio: clienteSelecionado.municipio,
    cliente_estado: clienteSelecionado.estado,
    assunto: byId("dem-assunto").value,
    descricao: byId("dem-descricao").value,
    status: "Abertura"
  };

  const { error } = await supabase.from("demandas").insert([payload]);

  if (error) {
    byId("dem-status-msg").textContent = error.message;
  } else {
    byId("dem-status-msg").textContent = "Demanda salva com sucesso.";
  }
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", async () => {
  byId("btn-login").onclick = login;
  byId("btn-signup").onclick = signup;
  byId("btn-salvar-demanda").onclick = salvarDemanda;

  supabase.auth.onAuthStateChange(refreshSession);
  await refreshSession();
});
