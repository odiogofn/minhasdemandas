
// =========================
// APP v7.4 - Sistema de Demandas
// Tabela de clientes: clientes
// Busca em tempo real no cadastro de demandas
// =========================

// CONFIG SUPABASE
const SUPABASE_URL = "https://cmxepgkkdvyfraesvqly.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGVwZ2trZHZ5ZnJhZXN2cWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3ODA2NDksImV4cCI6MjA4MDM1NjY0OX0.rQMjA0pyJ2gWvPlyuQr0DccdkUs24NQTdsQvgiN2QXY";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================
// ESTADO GLOBAL
// =========================
let clientesCache = [];
let selectedClienteDemanda = null;

// =========================
// HELPERS
// =========================
const byId = (id) => document.getElementById(id);

function normalizarEstadoSigla(v){
  const raw = (v || "").trim().toUpperCase();
  const mapa = {
    "CEARÁ": "CE",
    "CEARA": "CE",
    "RIO GRANDE DO NORTE": "RN",
    "AMAPÁ": "AM",
    "AMAPA": "AM",
    "MARANHÃO": "MA",
    "MARANHAO": "MA",
    "PARÁ": "PA",
    "PARA": "PA"
  };
  if(mapa[raw]) return mapa[raw];
  if(/^[A-Z]{2}$/.test(raw)) return raw;
  return raw;
}

// =========================
// CLIENTES
// =========================
async function carregarClientes(){
  const { data, error } = await supabaseClient
    .from("clientes")
    .select("id, cliente, municipio, estado, tipo_entidade, tipo")
    .order("cliente");

  if(error){
    console.error("Erro ao carregar clientes:", error);
    return;
  }
  clientesCache = data || [];
}

// =========================
// BUSCA EM TEMPO REAL (TYPEAHEAD)
// =========================
let buscaTimer = null;

async function buscarClientesTempoReal(termo){
  const t = (termo || "").trim();
  if(!t) return [];

  const like = `%${t}%`;

  const { data, error } = await supabaseClient
    .from("clientes")
    .select("id, cliente, municipio, estado, tipo_entidade, tipo")
    .or(
      `cliente.ilike.${like},
       municipio.ilike.${like},
       tipo_entidade.ilike.${like},
       tipo.ilike.${like}`
    )
    .order("cliente")
    .limit(10);

  if(error){
    console.error("Erro na busca:", error);
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

  if(!lista.length){
    box.innerHTML = '<div class="typeahead-empty">Nenhum resultado</div>';
    box.classList.remove("hidden");
    return;
  }

  box.innerHTML = "";
  lista.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "typeahead-item";
    btn.innerHTML = `
      <div class="t-main">${c.cliente}</div>
      <div class="t-sub">${c.municipio} · ${c.tipo_entidade}</div>
    `;
    btn.onclick = () => selecionarCliente(c);
    box.appendChild(btn);
  });

  box.classList.remove("hidden");
}

function selecionarCliente(c){
  selectedClienteDemanda = c;

  byId("dem-cliente-nome").value = c.cliente || "";
  byId("dem-cliente-tipo-entidade").value = c.tipo_entidade || "";
  byId("dem-municipio").value = c.municipio || "";
  byId("dem-cliente-estado").value = normalizarEstadoSigla(c.estado || "");

  byId("dem-cliente-resultados").classList.add("hidden");
  byId("dem-cliente-busca").value = c.cliente;
}

function instalarBuscaClientes(){
  const input = byId("dem-cliente-busca");
  const box = byId("dem-cliente-resultados");
  if(!input || !box) return;

  input.addEventListener("input", () => {
    const termo = input.value;

    selectedClienteDemanda = null;
    byId("dem-cliente-nome").value = "";
    byId("dem-cliente-tipo-entidade").value = "";
    byId("dem-municipio").value = "";
    byId("dem-cliente-estado").value = "";

    if(buscaTimer) clearTimeout(buscaTimer);
    buscaTimer = setTimeout(async () => {
      const lista = await buscarClientesTempoReal(termo);
      renderResultadosClientes(lista);
    }, 250);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => box.classList.add("hidden"), 200);
  });
}

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", async () => {
  await carregarClientes();
  instalarBuscaClientes();
});
