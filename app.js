// =========================
// CONFIG (SUAS KEYS)
// =========================
const SUPABASE_URL = "https://dpbrwvtatufahxbwcyud.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwYnJ3dnRhdHVmYWh4YndjeXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0MTU1ODYsImV4cCI6MjA4MTk5MTU4Nn0.EAxDG7Lpt_4sldfGb22IGY0pjvc6ueOKbnnUi6QQa8c";

// NÃO use "supabase" como nome de variável aqui (a lib já expõe window.supabase)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================
// HELPERS
// =========================
const $ = (id) => document.getElementById(id);

function setMsg(el, text, type = "info") {
  if (!el) return;
  el.textContent = text || "";
  if (!text) return;
  if (type === "ok") el.textContent = "✅ " + text;
  if (type === "bad") el.textContent = "❌ " + text;
  if (type === "warn") el.textContent = "⚠️ " + text;
}

function parseTags(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function tagsToString(arr) {
  return (arr || []).join(", ");
}

function renderTags(container, tags) {
  if (!container) return;
  container.innerHTML = "";
  (tags || []).forEach(t => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = t;
    container.appendChild(span);
  });
}

function fmtDate(dt) {
  try { return new Date(dt).toLocaleString("pt-BR"); }
  catch { return dt || ""; }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function escapeAttr(str) { return escapeHtml(str); }

function statusLabel(s) {
  const map = {
    ABERTURA: "ABERTURA",
    PROGRAMACAO: "PROGRAMAÇÃO",
    EM_ANALISE: "EM ANÁLISE",
    CONCLUIDO: "CONCLUÍDO"
  };
  return map[s] || s;
}

function normalizeRole(role) {
  const r = String(role || "").trim().toUpperCase();
  return ["PROGRAMADOR","SUPORTE","GESTOR"].includes(r) ? r : null;
}

function isSupportOrManager() {
  return profile?.role === "SUPORTE" || profile?.role === "GESTOR";
}

// =========================
// STATE
// =========================
let sessionUser = null;
let profile = null;

let usersCache = [];
let clientsCache = [];

// Paginação
let demandPage = 1;
let demandPageSize = 10;
let demandTotal = 0;

// Modal edição
let editingDemand = null;

// =========================
// AUTH
// =========================
async function loadSession() {
  const { data } = await sb.auth.getSession();
  sessionUser = data?.session?.user || null;
  return sessionUser;
}

async function fetchMyProfile() {
  if (!sessionUser) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("user_id, login, full_name, role, status")
    .eq("user_id", sessionUser.id)
    .single();
  if (error) return null;
  return data;
}

function showAuthUI() {
  $("pageAuth")?.classList.remove("hidden");
  $("nav")?.classList.add("hidden");

  $("pageClients")?.classList.add("hidden");
  $("pageDemands")?.classList.add("hidden");
  $("pageManage")?.classList.add("hidden");
  $("pendingBox")?.classList.add("hidden");

  $("btnLogout")?.classList.add("hidden");
  $("userBadge")?.classList.add("hidden");
}

function showAppUI() {
  $("pageAuth")?.classList.add("hidden");
  $("nav")?.classList.remove("hidden");
  $("btnLogout")?.classList.remove("hidden");
  $("userBadge")?.classList.remove("hidden");
}

function setUserBadge() {
  const txt = `${profile.full_name} • ${profile.role} • ${profile.status}`;
  $("userBadge").textContent = txt;
  $("userBadge").classList.remove("hidden");
}

function configureTabsByRole() {
  const manageBtn = [...document.querySelectorAll(".tab")].find(b => b.dataset.tab === "manage");
  if (!manageBtn) return;
  if (profile.role === "GESTOR") manageBtn.classList.remove("hidden");
  else manageBtn.classList.add("hidden");
}

function activateTab(name) {
  [...document.querySelectorAll(".tab")].forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $("pageClients")?.classList.toggle("hidden", name !== "clients");
  $("pageDemands")?.classList.toggle("hidden", name !== "demands");
  $("pageManage")?.classList.toggle("hidden", name !== "manage");
}

async function ensureActiveOrPendingGate() {
  if (profile.status !== "ATIVO") {
    $("pendingBox")?.classList.remove("hidden");
    $("nav")?.classList.add("hidden");

    $("pageClients")?.classList.add("hidden");
    $("pageDemands")?.classList.add("hidden");
    $("pageManage")?.classList.add("hidden");
    return false;
  }
  $("pendingBox")?.classList.add("hidden");
  $("nav")?.classList.remove("hidden");
  return true;
}

// =========================
// LOADERS (USERS/CLIENTS)
// =========================
async function loadUsersForEncaminhar() {
  const { data, error } = await sb
    .from("profiles")
    .select("user_id, full_name, login, role, status, created_at")
    .order("full_name", { ascending: true });

  if (error) { usersCache = []; return; }
  usersCache = data || [];

  // Select de encaminhar no cadastro de demanda
  const sel = $("dEncaminhar");
  if (sel) {
    sel.innerHTML = `<option value="">— selecione —</option>`;
    usersCache.filter(u => u.status === "ATIVO").forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.user_id;
      opt.textContent = `${u.full_name} (${u.role})`;
      sel.appendChild(opt);
    });
  }
}

async function loadClients() {
  const { data, error } = await sb
    .from("clients")
    .select("id, cliente, entidade, tipo_entidade, estado, created_at")
    .order("cliente", { ascending: true });

  if (error) {
    clientsCache = [];
    renderClients([]);
    fillClientSelect([]);
    return;
  }
  clientsCache = data || [];
  renderClients(clientsCache);
  fillClientSelect(clientsCache);
}

// =========================
// DEMANDS: FILTERS + PAGINATION (server-side)
// =========================
function getDemandFilters() {
  const q = ($("demandSearch")?.value || "").trim();
  const status = $("demandStatusFilter")?.value || "";
  const mine = $("filterMine")?.checked || false;
  const assignedToMe = $("filterAssignedToMe")?.checked || false;
  return { q, status, mine, assignedToMe };
}

function applyRoleDefaultFilters() {
  if (!$("filterMine") || !$("filterAssignedToMe")) return;

  if (profile.role === "PROGRAMADOR") {
    $("filterAssignedToMe").checked = true;
    $("filterMine").checked = false;
    $("filterMine").disabled = true;
    $("filterAssignedToMe").disabled = false;
  } else if (profile.role === "SUPORTE") {
    $("filterMine").disabled = false;
    $("filterAssignedToMe").checked = false;
    $("filterAssignedToMe").disabled = true;
  } else {
    $("filterMine").disabled = false;
    $("filterAssignedToMe").disabled = false;
  }
}

async function loadDemandsPage(page = 1) {
  demandPage = Math.max(1, page);
  demandPageSize = parseInt($("pageSize")?.value || "10", 10) || 10;

  const { q, status, mine, assignedToMe } = getDemandFilters();

  let query = sb
    .from("v_demands")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (mine) query = query.eq("created_by", sessionUser.id);
  if (assignedToMe) query = query.eq("encaminhar_user_id", sessionUser.id);

  if (q) {
    const safe = q.replaceAll("%", "\\%").replaceAll("_", "\\_");
    query = query.or(
      [
        `cliente.ilike.%${safe}%`,
        `entidade.ilike.%${safe}%`,
        `responsavel.ilike.%${safe}%`,
        `atendimento.ilike.%${safe}%`,
        `email_codigo.ilike.%${safe}%`,
        `trello_link.ilike.%${safe}%`
      ].join(",")
    );
  }

  const from = (demandPage - 1) * demandPageSize;
  const to = from + demandPageSize - 1;

  const { data, error, count } = await query.range(from, to);

  if (error) {
    renderDemands([]);
    updatePager(0);
    return;
  }

  demandTotal = count || 0;
  renderDemands(data || []);
  updatePager(demandTotal);
}

function updatePager(total) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / demandPageSize));
  if (demandPage > totalPages) demandPage = totalPages;

  const pagerInfo = $("pagerInfo");
  if (pagerInfo) pagerInfo.textContent = `Página ${demandPage} de ${totalPages} • Total: ${total || 0}`;

  if ($("btnPrev")) $("btnPrev").disabled = demandPage <= 1;
  if ($("btnNext")) $("btnNext").disabled = demandPage >= totalPages;
}

// =========================
// DASHBOARD
// =========================
async function loadDashboard() {
  setMsg($("dashMsg"), "");

  const { data, error } = await sb
    .from("demands")
    .select("status, responsavel");

  if (error) {
    setMsg($("dashMsg"), error.message, "bad");
    if ($("dashStatus")) $("dashStatus").innerHTML = "";
    if ($("dashResp")) $("dashResp").innerHTML = "";
    return;
  }

  const rows = data || [];

  const statusCounts = { ABERTURA:0, PROGRAMACAO:0, EM_ANALISE:0, CONCLUIDO:0 };
  for (const r of rows) if (statusCounts[r.status] !== undefined) statusCounts[r.status] += 1;

  if ($("dashStatus")) {
    $("dashStatus").innerHTML = "";
    Object.entries(statusCounts).forEach(([k,v]) => {
      const div = document.createElement("div");
      div.className = "stat-pill";
      div.innerHTML = `<div class="muted">${escapeHtml(statusLabel(k))}</div><b>${v}</b>`;
      $("dashStatus").appendChild(div);
    });
  }

  const respMap = new Map();
  for (const r of rows) {
    const resp = (r.responsavel || "—").trim() || "—";
    respMap.set(resp, (respMap.get(resp) || 0) + 1);
  }

  const respSorted = [...respMap.entries()].sort((a,b) => b[1] - a[1]).slice(0, 12);
  if ($("dashResp")) {
    $("dashResp").innerHTML = "";
    if (!respSorted.length) {
      $("dashResp").innerHTML = `<div class="resp-line"><span class="name">Sem dados</span><span class="count">0</span></div>`;
    } else {
      respSorted.forEach(([name,count]) => {
        const line = document.createElement("div");
        line.className = "resp-line";
        line.innerHTML = `<span class="name">${escapeHtml(name)}</span><span class="count">${count}</span>`;
        $("dashResp").appendChild(line);
      });
    }
  }

  setMsg($("dashMsg"), `Dashboard calculado com ${rows.length} demandas visíveis para você.`, "ok");
}

// =========================
// RENDER: CLIENTS
// =========================
function renderClients(list) {
  const box = $("clientsList");
  if (!box) return;
  box.innerHTML = "";

  if (!list.length) {
    box.innerHTML = `<div class="item"><div class="meta">Sem clientes (ou você não tem permissão).</div></div>`;
    return;
  }

  list.forEach(c => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="top">
        <div>
          <div><b>${escapeHtml(c.cliente)}</b> — ${escapeHtml(c.entidade)}</div>
          <div class="meta">${escapeHtml(c.tipo_entidade)} • ${escapeHtml(c.estado)} • ${fmtDate(c.created_at)}</div>
        </div>
      </div>
    `;
    box.appendChild(div);
  });
}

function fillClientSelect(list) {
  const sel = $("dClientSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">— selecione —</option>`;
  list.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.cliente} — ${c.entidade} (${c.estado})`;
    opt.dataset.cliente = c.cliente;
    opt.dataset.entidade = c.entidade;
    opt.dataset.tipo = c.tipo_entidade;
    opt.dataset.estado = c.estado;
    sel.appendChild(opt);
  });
}

// =========================
// RENDER: DEMANDS
// =========================
function renderDemands(list) {
  const box = $("demandsList");
  if (!box) return;
  box.innerHTML = "";

  if (!list.length) {
    box.innerHTML = `<div class="item"><div class="meta">Sem demandas (ou você não tem permissão).</div></div>`;
    return;
  }

  list.forEach(d => {
    const isOwner = d.created_by === sessionUser.id;
    const canEdit = profile.role === "GESTOR" || (profile.role === "SUPORTE" && isOwner);
    const statusTxt = statusLabel(d.status);
    const tags = [...(d.assunto_tags || []), ...(d.canal_tags || [])].slice(0, 8);

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="top">
        <div>
          <div><b>${escapeHtml(d.cliente)}</b> — ${escapeHtml(d.entidade)}</div>
          <div class="meta">
            ${escapeHtml(d.tipo_entidade)} • ${escapeHtml(d.estado)} •
            Status: <b>${escapeHtml(statusTxt)}</b> •
            Responsável: <b>${escapeHtml(d.responsavel || "—")}</b> •
            Criado por: ${escapeHtml(d.created_by_name || "—")} •
            ${fmtDate(d.created_at)}
          </div>

          <div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
          ${d.encaminhar_name ? `<div class="meta">Encaminhado: <b>${escapeHtml(d.encaminhar_name)}</b></div>` : ""}
        </div>

        <div class="actions">
          <button class="btn ghost" data-act="comments" data-id="${d.id}">Atualizações</button>
          ${d.trello_link ? `<a class="btn ghost" href="${escapeAttr(d.trello_link)}" target="_blank" rel="noreferrer">Trello</a>` : ""}
          ${canEdit ? `<button class="btn" data-act="edit" data-id="${d.id}">Editar</button>` : ""}
          ${canEdit ? `<button class="btn danger" data-act="del" data-id="${d.id}">Excluir</button>` : ""}
        </div>
      </div>
    `;
    box.appendChild(div);

    div.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;

        if (act === "del") {
          if (!confirm("Excluir esta demanda?")) return;
          const { error } = await sb.from("demands").delete().eq("id", id);
          if (error) alert("Erro ao excluir: " + error.message);
          await loadDemandsPage(demandPage);
          await loadDashboard();
          return;
        }
        if (act === "edit") return openEditModal(id);
        if (act === "comments") return openCommentsModal(id);
      });
    });
  });
}

// =========================
// DEMAND FORM (CREATE)
// =========================
function resetDemandClientInfo() {
  if ($("dCliente")) $("dCliente").value = "";
  if ($("dEntidade")) $("dEntidade").value = "";
  if ($("dTipo")) $("dTipo").value = "";
  if ($("dEstado")) $("dEstado").value = "";
  $("dFields")?.classList.add("disabled");
}

function setDemandClientInfoFromOption(opt) {
  if ($("dCliente")) $("dCliente").value = opt.dataset.cliente || "";
  if ($("dEntidade")) $("dEntidade").value = opt.dataset.entidade || "";
  if ($("dTipo")) $("dTipo").value = opt.dataset.tipo || "";
  if ($("dEstado")) $("dEstado").value = opt.dataset.estado || "";
  $("dFields")?.classList.remove("disabled");
}

function configureDemandFormByRole() {
  const canCreate = isSupportOrManager();
  if ($("btnCreateDemand")) $("btnCreateDemand").disabled = !canCreate;
  if ($("btnCreateClient")) $("btnCreateClient").disabled = !canCreate;

  $("encaminharBox")?.classList.toggle("hidden", true);

  $("dStatus")?.addEventListener("change", () => {
    const isProg = $("dStatus").value === "PROGRAMACAO";
    $("encaminharBox")?.classList.toggle("hidden", !(isProg && canCreate));
  });
}

// =========================
// COMMENTS MODAL
// =========================
async function loadComments(demandId) {
  const { data, error } = await sb
    .from("demand_comments")
    .select("id, demand_id, user_id, content, created_at, updated_at")
    .eq("demand_id", demandId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

async function getDemandForModals(demandId) {
  const { data, error } = await sb
    .from("v_demands")
    .select("*")
    .eq("id", demandId)
    .single();
  if (error) return null;
  return data;
}

async function openCommentsModal(demandId) {
  const demand = await getDemandForModals(demandId);
  if (!demand) return alert("Você não tem acesso a essa demanda.");

  $("modal")?.classList.remove("hidden");
  if ($("modalTitle")) $("modalTitle").textContent = `Atualizações — ${demand.cliente} (${statusLabel(demand.status)})`;

  const comments = await loadComments(demand.id);
  const body = $("modalBody");
  if (!body) return;

  body.innerHTML = `
    <div class="block">
      <div class="meta"><b>Atendimento:</b> ${escapeHtml(demand.atendimento || "—")}</div>
      <div class="meta"><b>Responsável:</b> ${escapeHtml(demand.responsavel || "—")}</div>
      <div class="meta"><b>Encaminhado:</b> ${escapeHtml(demand.encaminhar_name || "—")}</div>
    </div>

    <div class="block">
      <h4>Escrever comentário</h4>
      <textarea id="newComment" rows="3" placeholder="Digite uma atualização..."></textarea>
      <button id="btnAddComment" class="btn primary">Comentar</button>
      <p id="commentMsg" class="msg"></p>
    </div>

    <div class="block">
      <h4>Histórico</h4>
      <div id="commentsList" class="list"></div>
    </div>
  `;

  const listBox = document.getElementById("commentsList");
  renderCommentsList(listBox, comments);

  document.getElementById("btnAddComment").addEventListener("click", async () => {
    const content = (document.getElementById("newComment").value || "").trim();
    if (!content) return setMsg(document.getElementById("commentMsg"), "Digite algo.", "warn");

    const { error } = await sb.from("demand_comments").insert({
      demand_id: demand.id,
      user_id: sessionUser.id,
      content
    });

    if (error) return setMsg(document.getElementById("commentMsg"), error.message, "bad");

    document.getElementById("newComment").value = "";
    setMsg(document.getElementById("commentMsg"), "Comentário adicionado.", "ok");

    const refreshed = await loadComments(demand.id);
    renderCommentsList(listBox, refreshed);
  });
}

function renderCommentsList(container, comments) {
  if (!container) return;
  container.innerHTML = "";

  if (!comments.length) {
    container.innerHTML = `<div class="item"><div class="meta">Sem comentários.</div></div>`;
    return;
  }

  comments.forEach(c => {
    const author = usersCache.find(u => u.user_id === c.user_id);
    const canManage = profile.role === "GESTOR" || c.user_id === sessionUser.id;

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="top">
        <div>
          <div><b>${escapeHtml(author?.full_name || "Usuário")}</b></div>
          <div class="meta">${fmtDate(c.created_at)}${c.updated_at && c.updated_at !== c.created_at ? " • editado " + fmtDate(c.updated_at) : ""}</div>
        </div>
        <div class="actions">
          ${canManage ? `<button class="btn" data-act="editc" data-id="${c.id}">Editar</button>` : ""}
          ${canManage ? `<button class="btn danger" data-act="delc" data-id="${c.id}">Excluir</button>` : ""}
        </div>
      </div>
      <div style="margin-top:10px; white-space:pre-wrap;">${escapeHtml(c.content)}</div>
    `;
    container.appendChild(div);

    div.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;

        if (act === "delc") {
          if (!confirm("Excluir comentário?")) return;
          const { error } = await sb.from("demand_comments").delete().eq("id", id);
          if (error) alert("Erro: " + error.message);
          return;
        }

        if (act === "editc") {
          const novo = prompt("Editar comentário:", c.content);
          if (novo === null) return;
          const content = novo.trim();
          if (!content) return alert("Conteúdo vazio.");
          const { error } = await sb.from("demand_comments").update({ content }).eq("id", id);
          if (error) alert("Erro: " + error.message);
          return;
        }
      });
    });
  });
}

// =========================
// EDIT MODAL (EDIÇÃO COMPLETA)
// =========================
function usersOptionsHtml(selectedId) {
  const activeUsers = usersCache.filter(u => u.status === "ATIVO");
  const opts = [`<option value="">— selecione —</option>`]
    .concat(activeUsers.map(u => {
      const sel = u.user_id === selectedId ? "selected" : "";
      return `<option value="${escapeAttr(u.user_id)}" ${sel}>${escapeHtml(u.full_name)} (${escapeHtml(u.role)})</option>`;
    }));
  return opts.join("");
}

async function openEditModal(demandId) {
  const d = await getDemandForModals(demandId);
  if (!d) return alert("Você não tem acesso a essa demanda.");

  editingDemand = d;

  $("modalEdit")?.classList.remove("hidden");
  if ($("editTitle")) $("editTitle").textContent = `Editar — ${d.cliente} (${statusLabel(d.status)})`;
  setMsg($("editMsg"), "");

  const body = $("editBody");
  if (!body) return;

  body.innerHTML = `
    <div class="block">
      <div class="grid2">
        <div><label>Cliente (somente leitura)</label><input type="text" value="${escapeAttr(d.cliente)}" readonly /></div>
        <div><label>Entidade (somente leitura)</label><input type="text" value="${escapeAttr(d.entidade)}" readonly /></div>
        <div><label>Tipo Entidade (somente leitura)</label><input type="text" value="${escapeAttr(d.tipo_entidade)}" readonly /></div>
        <div><label>Estado (somente leitura)</label><input type="text" value="${escapeAttr(d.estado)}" readonly /></div>
      </div>
    </div>

    <div class="block">
      <div class="grid2">
        <div>
          <label>Responsável</label>
          <input id="eResponsavel" type="text" value="${escapeAttr(d.responsavel || "")}" />
        </div>

        <div>
          <label>Status</label>
          <select id="eStatus">
            <option value="ABERTURA" ${d.status==="ABERTURA"?"selected":""}>ABERTURA</option>
            <option value="PROGRAMACAO" ${d.status==="PROGRAMACAO"?"selected":""}>PROGRAMAÇÃO</option>
            <option value="EM_ANALISE" ${d.status==="EM_ANALISE"?"selected":""}>EM ANÁLISE</option>
            <option value="CONCLUIDO" ${d.status==="CONCLUIDO"?"selected":""}>CONCLUÍDO</option>
          </select>
        </div>
      </div>

      <label>Assunto (tags por vírgula)</label>
      <input id="eAssunto" type="text" value="${escapeAttr(tagsToString(d.assunto_tags))}" />
      <div id="eAssuntoPreview" class="tags"></div>

      <label>Atendimento</label>
      <textarea id="eAtendimento" rows="4">${escapeHtml(d.atendimento || "")}</textarea>

      <div class="grid2">
        <div>
          <label>Trello (link)</label>
          <input id="eTrello" type="url" value="${escapeAttr(d.trello_link || "")}" />
        </div>
        <div>
          <label>Email (código)</label>
          <input id="eEmail" type="text" value="${escapeAttr(d.email_codigo || "")}" />
        </div>
      </div>

      <label>Canal de Atendimento (tags por vírgula)</label>
      <input id="eCanal" type="text" value="${escapeAttr(tagsToString(d.canal_tags))}" />
      <div id="eCanalPreview" class="tags"></div>

      <div id="eEncBox" class="${(d.status === "PROGRAMACAO") ? "" : "hidden"}">
        <label>Encaminhar</label>
        <select id="eEncaminhar">${usersOptionsHtml(d.encaminhar_user_id)}</select>
      </div>
    </div>
  `;

  renderTags($("eAssuntoPreview"), parseTags($("eAssunto").value));
  renderTags($("eCanalPreview"), parseTags($("eCanal").value));

  $("eAssunto")?.addEventListener("input", () => renderTags($("eAssuntoPreview"), parseTags($("eAssunto").value)));
  $("eCanal")?.addEventListener("input", () => renderTags($("eCanalPreview"), parseTags($("eCanal").value)));

  $("eStatus")?.addEventListener("change", () => {
    const show = $("eStatus").value === "PROGRAMACAO";
    $("eEncBox")?.classList.toggle("hidden", !show);
    if (!show) {
      const sel = $("eEncaminhar");
      if (sel) sel.value = "";
    }
  });
}

async function saveEditModal() {
  if (!editingDemand) return;

  const status = $("eStatus").value;
  const payload = {
    responsavel: ($("eResponsavel").value || "").trim() || null,
    status,
    assunto_tags: parseTags($("eAssunto").value),
    atendimento: ($("eAtendimento").value || "").trim() || null,
    trello_link: ($("eTrello").value || "").trim() || null,
    email_codigo: ($("eEmail").value || "").trim() || null,
    canal_tags: parseTags($("eCanal").value),
    encaminhar_user_id: (status === "PROGRAMACAO") ? ($("eEncaminhar")?.value || null) : null
  };

  const { error } = await sb
    .from("demands")
    .update(payload)
    .eq("id", editingDemand.id);

  if (error) return setMsg($("editMsg"), error.message, "bad");

  setMsg($("editMsg"), "Alterações salvas.", "ok");
  $("modalEdit")?.classList.add("hidden");
  editingDemand = null;

  await loadDemandsPage(demandPage);
  await loadDashboard();
}

// =========================
// GESTÃO (GESTOR)
// =========================
async function loadManage() {
  if (profile.role !== "GESTOR") return;

  // usuários
  const { data: users, error: uerr } = await sb
    .from("profiles")
    .select("user_id, login, full_name, role, status, created_at")
    .order("created_at", { ascending: false });

  if (!uerr) {
    usersCache = users || usersCache;
    renderUsersManage(users || []);
  } else {
    const box = $("usersList");
    if (box) box.innerHTML = `<div class="item"><div class="meta">Erro ao carregar usuários: ${escapeHtml(uerr.message)}</div></div>`;
  }

  // top 5 últimas demandas
  const { data: last5, error: lerr } = await sb
    .from("v_demands")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  if (lerr) {
    const c = $("top5last");
    if (c) c.innerHTML = `<div class="item"><div class="meta">Erro: ${escapeHtml(lerr.message)}</div></div>`;
  } else {
    renderSimpleDemandList($("top5last"), last5 || []);
  }

  // top5 por status (select atual)
  const st = $("top5Status")?.value || "ABERTURA";
  await loadTop5ByStatus(st);
}

async function loadTop5ByStatus(status) {
  const { data, error } = await sb
    .from("v_demands")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    const c = $("top5statusList");
    if (c) c.innerHTML = `<div class="item"><div class="meta">Erro: ${escapeHtml(error.message)}</div></div>`;
    return;
  }
  renderSimpleDemandList($("top5statusList"), data || []);
}

function renderSimpleDemandList(container, list) {
  if (!container) return;
  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = `<div class="item"><div class="meta">Sem itens.</div></div>`;
    return;
  }

  list.forEach(d => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div><b>${escapeHtml(d.cliente)}</b> — ${escapeHtml(d.entidade)}</div>
      <div class="meta">
        Status: <b>${escapeHtml(statusLabel(d.status))}</b> •
        Criado por: ${escapeHtml(d.created_by_name || "—")} •
        ${fmtDate(d.created_at)}
      </div>
    `;
    container.appendChild(div);
  });
}

function renderUsersManage(users) {
  const box = $("usersList");
  if (!box) return;
  box.innerHTML = "";

  if (!users.length) {
    box.innerHTML = `<div class="item"><div class="meta">Sem usuários.</div></div>`;
    return;
  }

  users.forEach(u => {
    const div = document.createElement("div");
    div.className = "item";

    const canActivate = u.status === "PENDENTE";
    div.innerHTML = `
      <div class="top">
        <div>
          <div><b>${escapeHtml(u.full_name)}</b> (${escapeHtml(u.role)})</div>
          <div class="meta">
            login: ${escapeHtml(u.login || "—")} • status: <b>${escapeHtml(u.status)}</b> • ${fmtDate(u.created_at)}
          </div>
        </div>
        <div class="actions">
          ${canActivate ? `<button class="btn primary" data-act="activate" data-id="${u.user_id}">Ativar</button>` : ""}
          <button class="btn" data-act="toggleRole" data-id="${u.user_id}">Trocar perfil</button>
        </div>
      </div>
    `;
    box.appendChild(div);

    div.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;

        if (act === "activate") {
          const { error } = await sb.from("profiles").update({ status: "ATIVO" }).eq("user_id", id);
          if (error) return alert("Erro: " + error.message);
          await loadManage();
          return;
        }

        if (act === "toggleRole") {
          const novo = prompt("Novo role (PROGRAMADOR, SUPORTE, GESTOR):", u.role);
          if (novo === null) return;
          const role = normalizeRole(novo);
          if (!role) return alert("Role inválido.");

          const { error } = await sb.from("profiles").update({ role }).eq("user_id", id);
          if (error) return alert("Erro: " + error.message);
          await loadManage();
        }
      });
    });
  });
}

// =========================
// EVENTS
// =========================
function bindEvents() {
  // Tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tab = btn.dataset.tab;
      if (tab === "manage" && profile.role !== "GESTOR") return;

      activateTab(tab);

      if (tab === "clients") await loadClients();
      if (tab === "demands") {
        await loadUsersForEncaminhar();
        await loadDashboard();
        await loadDemandsPage(1);
      }
      if (tab === "manage") {
        await loadUsersForEncaminhar();
        await loadManage();
      }
    });
  });

  // Login
  $("btnLogin")?.addEventListener("click", async () => {
    setMsg($("loginMsg"), "");
    const email = $("loginEmail")?.value.trim();
    const password = $("loginPass")?.value;
    if (!email || !password) return setMsg($("loginMsg"), "Informe email e senha.", "warn");

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return setMsg($("loginMsg"), error.message, "bad");
    setMsg($("loginMsg"), "Login ok!", "ok");
    await boot();
  });

  // Register
  $("btnRegister")?.addEventListener("click", async () => {
    setMsg($("regMsg"), "");
    const login = $("regLogin")?.value.trim();
    const full_name = $("regName")?.value.trim();
    const email = $("regEmail")?.value.trim();
    const pass1 = $("regPass")?.value;
    const pass2 = $("regPass2")?.value;
    const role = $("regRole")?.value;

    if (!full_name || !email || !pass1 || !pass2) return setMsg($("regMsg"), "Preencha os campos.", "warn");
    if (pass1 !== pass2) return setMsg($("regMsg"), "Senhas não conferem.", "bad");
    if (pass1.length < 6) return setMsg($("regMsg"), "Senha muito curta (mín 6).", "warn");

    const { error } = await sb.auth.signUp({
      email,
      password: pass1,
      options: { data: { login, full_name, role } }
    });

    if (error) return setMsg($("regMsg"), error.message, "bad");
    setMsg($("regMsg"), "Cadastro criado! Aguarde ativação do gestor.", "ok");
  });

  // Logout
  $("btnLogout")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    sessionUser = null;
    profile = null;
    showAuthUI();
  });

  // Refresh clients
  $("btnRefreshClients")?.addEventListener("click", loadClients);

  // Client search (client-side)
  $("clientSearch")?.addEventListener("input", () => {
    const q = ($("clientSearch").value || "").toLowerCase().trim();
    if (!q) return renderClients(clientsCache);
    renderClients(clientsCache.filter(c => {
      const blob = `${c.cliente} ${c.entidade} ${c.tipo_entidade} ${c.estado}`.toLowerCase();
      return blob.includes(q);
    }));
  });

  // Create client
  $("btnCreateClient")?.addEventListener("click", async () => {
    setMsg($("clientsMsg"), "");
    const payload = {
      cliente: $("cCliente")?.value.trim(),
      entidade: $("cEntidade")?.value.trim(),
      tipo_entidade: $("cTipo")?.value,
      estado: $("cEstado")?.value,
      created_by: sessionUser.id
    };
    if (!payload.cliente || !payload.entidade) return setMsg($("clientsMsg"), "Cliente e Entidade são obrigatórios.", "warn");

    const { error } = await sb.from("clients").insert(payload);
    if (error) return setMsg($("clientsMsg"), error.message, "bad");

    setMsg($("clientsMsg"), "Cliente salvo.", "ok");
    if ($("cCliente")) $("cCliente").value = "";
    if ($("cEntidade")) $("cEntidade").value = "";
    await loadClients();
  });

  // Demand client select
  $("dClientSelect")?.addEventListener("change", () => {
    const opt = $("dClientSelect").selectedOptions[0];
    if (!opt || !opt.value) return resetDemandClientInfo();
    setDemandClientInfoFromOption(opt);
  });

  // Tag previews (criação)
  $("dAssunto")?.addEventListener("input", () => renderTags($("assuntoPreview"), parseTags($("dAssunto").value)));
  $("dCanal")?.addEventListener("input", () => renderTags($("canalPreview"), parseTags($("dCanal").value)));

  // Demand create
  $("btnCreateDemand")?.addEventListener("click", async () => {
    setMsg($("demandsMsg"), "");
    const client_id = $("dClientSelect")?.value;
    if (!client_id) return setMsg($("demandsMsg"), "Selecione um cliente.", "warn");

    const status = $("dStatus")?.value || "ABERTURA";
    const isProg = status === "PROGRAMACAO";

    const payload = {
      client_id,
      created_by: sessionUser.id,
      responsavel: $("dResponsavel")?.value.trim() || null,
      assunto_tags: parseTags($("dAssunto")?.value),
      atendimento: $("dAtendimento")?.value.trim() || null,
      trello_link: $("dTrello")?.value.trim() || null,
      email_codigo: $("dEmailCod")?.value.trim() || null,
      canal_tags: parseTags($("dCanal")?.value),
      status,
      encaminhar_user_id: isProg ? ($("dEncaminhar")?.value || null) : null
    };

    const { error } = await sb.from("demands").insert(payload);
    if (error) return setMsg($("demandsMsg"), error.message, "bad");

    setMsg($("demandsMsg"), "Demanda salva.", "ok");

    // limpar campos editáveis
    if ($("dResponsavel")) $("dResponsavel").value = "";
    if ($("dAssunto")) $("dAssunto").value = "";
    if ($("dAtendimento")) $("dAtendimento").value = "";
    if ($("dTrello")) $("dTrello").value = "";
    if ($("dEmailCod")) $("dEmailCod").value = "";
    if ($("dCanal")) $("dCanal").value = "";
    if ($("assuntoPreview")) $("assuntoPreview").innerHTML = "";
    if ($("canalPreview")) $("canalPreview").innerHTML = "";
    if ($("dStatus")) $("dStatus").value = "ABERTURA";
    if ($("dEncaminhar")) $("dEncaminhar").value = "";
    $("encaminharBox")?.classList.add("hidden");

    await loadDemandsPage(1);
    await loadDashboard();
  });

  // Refresh demands/dashboard
  $("btnRefreshDashboard")?.addEventListener("click", loadDashboard);
  $("btnRefreshDemands")?.addEventListener("click", async () => {
    await loadDemandsPage(demandPage);
    await loadDashboard();
  });

  // Filters -> reset page 1
  $("demandSearch")?.addEventListener("input", () => loadDemandsPage(1));
  $("demandStatusFilter")?.addEventListener("change", () => loadDemandsPage(1));
  $("filterMine")?.addEventListener("change", () => loadDemandsPage(1));
  $("filterAssignedToMe")?.addEventListener("change", () => loadDemandsPage(1));
  $("pageSize")?.addEventListener("change", () => loadDemandsPage(1));

  // Pager
  $("btnPrev")?.addEventListener("click", () => loadDemandsPage(demandPage - 1));
  $("btnNext")?.addEventListener("click", () => loadDemandsPage(demandPage + 1));

  // Modal comments close
  $("btnCloseModal")?.addEventListener("click", () => $("modal")?.classList.add("hidden"));
  $("modal")?.addEventListener("click", (e) => { if (e.target.id === "modal") $("modal")?.classList.add("hidden"); });

  // Modal edit close/save
  $("btnCloseEdit")?.addEventListener("click", () => {
    $("modalEdit")?.classList.add("hidden");
    editingDemand = null;
  });
  $("modalEdit")?.addEventListener("click", (e) => {
    if (e.target.id === "modalEdit") {
      $("modalEdit")?.classList.add("hidden");
      editingDemand = null;
    }
  });
  $("btnSaveEdit")?.addEventListener("click", saveEditModal);

  // Gestão
  $("btnRefreshManage")?.addEventListener("click", loadManage);
  $("top5Status")?.addEventListener("change", async () => loadTop5ByStatus($("top5Status").value));
}

// =========================
// BOOT
// =========================
async function boot() {
  await loadSession();

  if (!sessionUser) {
    showAuthUI();
    return;
  }

  profile = await fetchMyProfile();
  if (!profile) {
    showAuthUI();
    setMsg($("loginMsg"), "Perfil ainda não encontrado. Refaça login.", "warn");
    return;
  }

  showAppUI();
  setUserBadge();
  configureTabsByRole();

  const ok = await ensureActiveOrPendingGate();
  if (!ok) return;

  applyRoleDefaultFilters();

  await loadUsersForEncaminhar();
  await loadClients();

  configureDemandFormByRole();

  // abre por padrão demandas
  activateTab("demands");
  await loadDashboard();
  await loadDemandsPage(1);

  if (profile.role === "GESTOR") {
    await loadManage();
  }
}

bindEvents();

sb.auth.onAuthStateChange(async () => {
  await boot();
});

boot();


