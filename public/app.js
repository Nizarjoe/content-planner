/* ContentPlanner — SPA */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view");
let user = null, token = localStorage.getItem("cp_token") || "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—";
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2600); }
const PLATFORM_ICON = { instagram: "📷", tiktok: "🎵", youtube: "▶️", x: "𝕏", facebook: "👍", linkedin: "💼" };
const STATUS_LABEL = { draft: "Draft", review: "Review", scheduled: "Terjadwal", published: "Tayang" };

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...opts,
  });
  if (res.status === 401) { showAuth(); throw new Error("Sesi berakhir."); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Terjadi kesalahan.");
  return d;
}

/* ============ FORM DELEGATION (anti-stale listener) ============ */
const formHandlers = {};
document.addEventListener("submit", (e) => {
  const h = formHandlers[e.target.id];
  if (h) { e.preventDefault(); h(e); }
});
function onForm(id, fn) { formHandlers[id] = fn; }

/* ============ AUTH ============ */
function showAuth() { $("#authScreen").style.display = "flex"; $("#appScreen").style.display = "none"; }
function showApp() {
  $("#authScreen").style.display = "none";
  $("#appScreen").style.display = "flex";
  const init = user.name.trim()[0]?.toUpperCase() || "A";
  for (const id of ["sbAvatar", "sbAvatar2"]) { const el = $("#" + id); el.textContent = init; el.style.background = user.avatar_color || "var(--blue)"; }
  $("#sbName").textContent = user.name; $("#sbName2").textContent = user.name;
  $("#sbRole").textContent = user.role === "superadmin" ? "Super Admin" : user.role === "admin" ? "Admin" : user.username;
  $("#sbUser2").textContent = "@" + user.username;
  $("#helloName").textContent = `Halo, ${user.name.split(" ")[0]} 👋`;
  $("#helloSub").textContent = user.role === "superadmin" ? "Super Admin" : user.role === "admin" ? "Admin" : "Social Media Specialist";
  $("#adminBtn").style.display = ["admin", "superadmin"].includes(user.role) ? "flex" : "none";
  $("#streakVal").textContent = user.streak; $("#pointsVal").textContent = user.points;
  route();
}
$("#showReg").addEventListener("click", (e) => { e.preventDefault(); $("#loginForm").style.display = "none"; $("#regForm").style.display = "block"; $("#regSwitch").style.display = "block"; $(".auth-switch").style.display = "none"; $("#authErr").style.display = "none"; });
$("#showLogin").addEventListener("click", (e) => { e.preventDefault(); $("#regForm").style.display = "none"; $("#regSwitch").style.display = "none"; $("#loginForm").style.display = "block"; $(".auth-switch").style.display = "block"; $("#regErr").style.display = "none"; });
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#authErr"); err.style.display = "none";
  try {
    const d = await api("/auth/login", { method: "POST", body: JSON.stringify({ username: $("#a-user").value, password: $("#a-pass").value }) });
    token = d.token; localStorage.setItem("cp_token", token); user = d.user; showApp();
  } catch (ex) { err.textContent = ex.message; err.style.display = "block"; }
});
$("#regForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#regErr"); err.style.display = "none";
  try {
    const d = await api("/auth/register", { method: "POST", body: JSON.stringify({ name: $("#r-name").value, username: $("#r-user").value, email: $("#r-email").value, password: $("#r-pass").value }) });
    if (d.pending) { err.style.color = "#047857"; err.textContent = d.message; err.style.display = "block"; setTimeout(() => $("#showLogin").click(), 2500); }
    else { toast("Pendaftaran berhasil — silakan masuk."); $("#showLogin").click(); }
  } catch (ex) { err.style.color = ""; err.textContent = ex.message; err.style.display = "block"; }
});
$("#logoutBtn").addEventListener("click", async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); localStorage.removeItem("cp_token"); token = ""; user = null; showAuth(); });
$("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#settingsBtn").addEventListener("click", () => { location.hash = "#/akun"; route(); });
$("#adminBtn").addEventListener("click", () => { location.hash = "#/admin"; route(); });

/* ============ MODAL ============ */
function openModal(html) { $("#modalBody").innerHTML = html; $("#modalBack").classList.add("open"); }
function closeModal() { $("#modalBack").classList.remove("open"); }
$("#modalBack").addEventListener("click", (e) => { if (e.target === $("#modalBack")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ============ DASHBOARD ============ */
async function pgDashboard() {
  const [s, latest, notes] = await Promise.all([api("/stats"), api("/contents"), api("/notes")]);
  const working = latest.filter(c => c.status !== "published").sort((a, b) => (b.progress || 0) - (a.progress || 0))[0];
  const ring = `<svg width="110" height="110"><circle cx="55" cy="55" r="46" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="11"/>
    <circle cx="55" cy="55" r="46" fill="none" stroke="#34d399" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${2 * Math.PI * 46}" stroke-dashoffset="${2 * Math.PI * 46 * (1 - s.progressPct / 100)}"/></svg>`;
  const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const menu = [
    ["#/konten", "🗂", "Konten", s.byStatus.draft || 0],
    ["#/campaign", "📣", "Campaign", 0],
    ["#/ideabank", "💡", "Idea Bank", s.top.length ? 0 : 0],
    ["#/resources", "📁", "Resources", 0],
    ["#/analytics", "📈", "Analytics", 0],
    ["#/akun", "👤", "Akun", 0],
  ];
  view.innerHTML = `
  <div class="hero-row">
    <div class="hero-progress">
      <div class="progress-ring">${ring}<div class="pct">${s.progressPct}%</div></div>
      <div style="flex:1">
        <h2>Progres Konten Bulan Ini</h2>
        <div class="sub"><b style="font-size:1.4rem">${s.publishedThisMonth}</b> dari ${s.monthlyGoal} konten <b>tayang</b></div>
        <div class="bar"><i style="width:${s.progressPct}%"></i></div>
        ${s.publishedThisMonth < s.monthlyGoal ? `<div class="sub" style="margin-top:8px">Tinggal ${s.monthlyGoal - s.publishedThisMonth} konten lagi menuju target minggu ini!</div>` : `<div class="sub" style="margin-top:8px">🎉 Target tercapai!</div>`}
      </div>
      <button class="btn btn-primary hero-cta" id="continueBtn">Lanjutkan Bekerja →</button>
    </div>
    <div class="card week-card">
      <h3>Target Mingguan</h3>
      <div class="big">${s.week.reduce((a, b) => a + b.n, 0)}<span style="font-size:.9rem;color:var(--muted)">/${Math.ceil(s.monthlyGoal / 4)} konten</span></div>
      <p class="muted small" style="margin-top:4px">${s.week.reduce((a, b) => a + b.n, 0) >= Math.ceil(s.monthlyGoal / 4) ? "Mantap, target mingguan tercapai! 🎉" : "Terus semangat! Cukup kurang 1 konten."}</p>
      <div class="week-days">${s.week.map(w => `<div><span class="${w.n ? "hit" : ""}">${dayNames[w.d][0]}</span><small>${w.n || ""}</small></div>`).join("")}</div>
    </div>
  </div>

  <section class="card">
    <h3>Menu Utama</h3>
    <div class="menu-grid">
      ${menu.map(([href, icon, label, badge], i) => `
        <a class="menu-tile ${location.hash === href || (!location.hash && i === 0) ? "on" : ""}" href="${href}" data-nav>
          ${badge ? `<span class="mbadge">${badge}</span>` : ""}
          <span class="mi">${icon}</span>${label}
        </a>`).join("")}
    </div>
  </section>

  <section class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <h3 style="margin:0">Konten Terbaik <span class="badge scheduled" style="margin-left:8px">Bulan ini</span></h3>
      <a href="#/analytics" data-nav class="small">Detail →</a>
    </div>
    ${s.top.length ? `<div class="top-list">${s.top.map(t => `
      <div class="top-item">
        <span class="rank">${t.rank}</span>
        <span style="font-size:1.1rem">${PLATFORM_ICON[t.platform] || "📄"}</span>
        <div class="ti-main"><b>${esc(t.title)}</b><small>${t.views.toLocaleString("id-ID")} tayangan · ${t.engagement.toLocaleString("id-ID")} interaksi</small></div>
        <span class="ti-val">${(t.views / 1000).toFixed(1)} rb</span>
      </div>`).join("")}</div>` : `<p class="muted small">Belum ada konten tayang bulan ini. Yuk mulai publish!</p>`}
  </section>

  ${working ? `
  <section class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0">Lanjutkan Bekerja</h3><a href="#/konten" data-nav class="small">Lihat Semua</a>
    </div>
    <div class="row-item">
      <div class="ri-ico">${PLATFORM_ICON[working.platform] || "📄"}</div>
      <div class="ri-main">
        <b>${esc(working.title)}</b>
        <div class="ri-sub">${PLATFORM_ICON[working.platform]} ${esc(working.platform)} · ${STATUS_LABEL[working.status]}${working.scheduled_at ? " · jadwal " + fmtDate(working.scheduled_at) : ""}</div>
      </div>
      <div class="ri-prog"><small>${working.progress}%</small><div class="bar"><i style="width:${working.progress}%"></i></div></div>
      <button class="btn btn-primary" data-open="${working.id}">▶ Buka</button>
    </div>
  </section>` : ""}

  <section class="card">
    <h3>Pipeline Konten</h3>
    <div class="pipeline">
      ${["draft", "review", "scheduled", "published"].map(st => `
        <div class="pipe-col">
          <h4>${STATUS_LABEL[st]} <span class="n">${latest.filter(c => c.status === st).length}</span></h4>
          ${latest.filter(c => c.status === st).slice(0, 4).map(c => `
            <div class="pipe-card">
              <b>${esc(c.title)}</b>
              <div class="meta">${PLATFORM_ICON[c.platform] || ""} ${esc(c.platform)} · ${c.progress}%</div>
              <div class="pbar"><i style="width:${c.progress}%"></i></div>
            </div>`).join("") || `<p class="muted small">Kosong</p>`}
        </div>`).join("")}
    </div>
  </section>`;
  $("#continueBtn").addEventListener("click", () => { location.hash = "#/konten"; route(); });
  $("#cntKonten").textContent = s.total;
  const dataOpen = view.querySelector("[data-open]");
  if (dataOpen) dataOpen.addEventListener("click", () => contentModal(working));
}

/* ============ KONTEN ============ */
async function pgKonten() {
  const q = $("#globalSearch").value.trim().toLowerCase();
  let items = await api("/contents");
  if (q) items = items.filter(c => c.title.toLowerCase().includes(q) || (c.caption || "").toLowerCase().includes(q));
  view.innerHTML = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px;flex-wrap:wrap">
      <h3 style="margin:0">Semua Konten (${items.length})</h3>
      <button class="btn btn-primary btn-sm" id="addContent">+ Konten baru</button>
    </div>
    ${items.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Konten</th><th>Platform</th><th>Status</th><th>Progres</th><th>Jadwal</th><th></th></tr></thead>
    <tbody>${items.map(c => `
      <tr>
        <td><b>${esc(c.title)}</b><br><span class="muted small">${esc(c.type)}${c.campaign_name ? " · 📣 " + esc(c.campaign_name) : ""}</span></td>
        <td>${PLATFORM_ICON[c.platform] || ""} ${esc(c.platform)}</td>
        <td><span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span></td>
        <td style="min-width:110px"><div class="pbar" style="height:5px;background:var(--blue-bg);border-radius:99px;overflow:hidden"><i style="display:block;height:100%;width:${c.progress}%;background:var(--blue)"></i></div><span class="muted small">${c.progress}%</span></td>
        <td class="muted small">${c.scheduled_at ? fmtDate(c.scheduled_at) : "—"}</td>
        <td><div class="acts">
          <button class="btn btn-ghost btn-sm" data-edit="${c.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${c.id}">Hapus</button>
        </div></td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="muted">Belum ada konten${q ? " yang cocok dengan pencarian" : ""}. Klik "+ Konten baru" untuk mulai.</p>`}
  </div>`;
  $("#addContent").addEventListener("click", () => contentModal());
  view.addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (ed) contentModal(items.find(c => c.id == ed.dataset.edit));
    if (del) {
      if (!confirm("Hapus konten ini?")) return;
      await api("/contents/" + del.dataset.del, { method: "DELETE" }); toast("Konten dihapus."); pgKonten();
    }
  }, { once: true });
}

function contentModal(c) {
  const isNew = !c;
  openModal(`
  <h3>${isNew ? "Konten Baru" : "Edit Konten"}</h3>
  <p class="m-sub">${isNew ? "Rencanakan konten berikutnya." : "Perbarui detail konten."}</p>
  <form id="cForm">
    <label for="c-title">Judul *</label>
    <input class="input" id="c-title" value="${esc(c?.title || "")}" required>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label for="c-platform">Platform</label>
        <select class="select" id="c-platform">${Object.keys(PLATFORM_ICON).map(p => `<option value="${p}" ${c?.platform === p ? "selected" : ""}>${PLATFORM_ICON[p]} ${p}</option>`).join("")}</select></div>
      <div><label for="c-type">Tipe</label>
        <select class="select" id="c-type">${["reels","carousel","single","story","video","article"].map(t => `<option value="${t}" ${c?.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    </div>
    <label for="c-caption">Caption / catatan</label>
    <textarea class="textarea" id="c-caption" rows="3">${esc(c?.caption || "")}</textarea>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div><label for="c-status">Status</label>
        <select class="select" id="c-status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${c?.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div><label for="c-progress">Progres %</label>
        <input class="input" id="c-progress" type="number" min="0" max="100" value="${c?.progress ?? 0}"></div>
      <div><label for="c-sched">Jadwal tayang</label>
        <input class="input" id="c-sched" type="date" value="${c?.scheduled_at ? c.scheduled_at.slice(0, 10) : ""}"></div>
    </div>
    <div class="m-actions">
      <button type="button" class="btn btn-ghost" id="mCancel">Batal</button>
      <button class="btn btn-primary" type="submit">${isNew ? "Buat" : "Simpan"}</button>
    </div>
  </form>`);
  $("#mCancel")?.addEventListener("click", closeModal);
  onForm("cForm", async (e) => {
    e.preventDefault();
    const body = {
      title: $("#c-title").value, platform: $("#c-platform").value, type: $("#c-type").value,
      caption: $("#c-caption").value, status: $("#c-status").value,
      progress: parseInt($("#c-progress").value) || 0, scheduled_at: $("#c-sched").value || null,
    };
    try {
      if (isNew) await api("/contents", { method: "POST", body: JSON.stringify(body) });
      else await api("/contents/" + c.id, { method: "PUT", body: JSON.stringify(body) });
      closeModal(); toast(isNew ? "Konten dibuat." : "Konten diperbarui."); refreshHeader(); route();
    } catch (ex) { toast(ex.message); }
  });
}

/* ============ CAMPAIGN ============ */
async function pgCampaign() {
  const items = await api("/campaigns");
  view.innerHTML = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">Campaign (${items.length})</h3>
      <button class="btn btn-primary btn-sm" id="addCamp">+ Campaign baru</button>
    </div>
    ${items.length ? items.map(c => `
      <div class="row-item">
        <div class="ri-ico" style="background:${esc(c.color)}22;color:${esc(c.color)}">📣</div>
        <div class="ri-main"><b>${esc(c.name)}</b><div class="ri-sub">${esc(c.description || "Tanpa deskripsi")}${c.start_date ? ` · ${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}` : ""}</div></div>
        <button class="btn btn-danger btn-sm" data-del="${c.id}">Hapus</button>
      </div>`).join("") : `<p class="muted">Belum ada campaign. Campaign membantu mengelompokkan konten bertema sama.</p>`}
  </div>`;
  $("#addCamp").addEventListener("click", () => openModal(`
    <h3>Campaign Baru</h3><p class="m-sub">Kelompokkan konten per tema/periode.</p>
    <form id="campForm">
      <label for="cp-name">Nama *</label><input class="input" id="cp-name" required>
      <label for="cp-desc">Deskripsi</label><textarea class="textarea" id="cp-desc" rows="2"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label for="cp-start">Mulai</label><input class="input" id="cp-start" type="date"></div>
        <div><label for="cp-end">Selesai</label><input class="input" id="cp-end" type="date"></div>
      </div>
      <div class="m-actions"><button type="button" class="btn btn-ghost" id="mCancel">Batal</button><button class="btn btn-primary">Buat</button></div>
    </form>`)), $("#mCancel")?.addEventListener("click", closeModal);
  onForm("campForm", async (e) => {
    e.preventDefault();
    await api("/campaigns", { method: "POST", body: JSON.stringify({ name: $("#cp-name").value, description: $("#cp-desc").value, start_date: $("#cp-start").value || null, end_date: $("#cp-end").value || null }) });
    closeModal(); toast("Campaign dibuat."); pgCampaign();
  });
  view.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del && confirm("Hapus campaign ini?")) { await api("/campaigns/" + del.dataset.del, { method: "DELETE" }); toast("Campaign dihapus."); pgCampaign(); }
  }, { once: true });
}

/* ============ IDEA BANK ============ */
async function pgIdeas() {
  const items = await api("/ideas");
  const LABEL = { baru: "Baru", diproses: "Diproses", terpakai: "Terpakai" };
  view.innerHTML = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">Idea Bank (${items.length})</h3>
      <button class="btn btn-primary btn-sm" id="addIdea">+ Ide baru</button>
    </div>
    ${items.length ? items.map(i => `
      <div class="row-item">
        <div class="ri-ico">💡</div>
        <div class="ri-main"><b>${esc(i.title)}</b><div class="ri-sub">${esc(i.notes || "")}</div></div>
        <select class="select" style="max-width:130px" data-status="${i.id}">
          ${Object.entries(LABEL).map(([k, v]) => `<option value="${k}" ${i.status === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <button class="btn btn-danger btn-sm" data-del="${i.id}">Hapus</button>
      </div>`).join("") : `<p class="muted">Belum ada ide. Catat setiap ide konten agar tidak hilang!</p>`}
  </div>`;
  $("#addIdea").addEventListener("click", () => openModal(`
    <h3>Ide Baru</h3><form id="ideaForm">
      <label for="i-title">Judul ide *</label><input class="input" id="i-title" required>
      <label for="i-notes">Catatan</label><textarea class="textarea" id="i-notes" rows="3"></textarea>
      <div class="m-actions"><button type="button" class="btn btn-ghost" id="mCancel">Batal</button><button class="btn btn-primary">Simpan</button></div>
    </form>`)), $("#mCancel")?.addEventListener("click", closeModal);
  onForm("ideaForm", async (e) => {
    e.preventDefault();
    await api("/ideas", { method: "POST", body: JSON.stringify({ title: $("#i-title").value, notes: $("#i-notes").value }) });
    closeModal(); toast("Ide disimpan."); pgIdeas();
  });
  view.addEventListener("change", async (e) => {
    const s = e.target.closest("[data-status]");
    if (s) { await api("/ideas/" + s.dataset.status, { method: "PUT", body: JSON.stringify({ status: s.value }) }); toast("Status ide diperbarui."); }
  }, { once: true });
  view.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del && confirm("Hapus ide ini?")) { await api("/ideas/" + del.dataset.del, { method: "DELETE" }); pgIdeas(); }
  }, { once: true });
}

/* ============ RESOURCES ============ */
async function pgResources() {
  const items = await api("/resources");
  view.innerHTML = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">Resources (${items.length})</h3>
      <button class="btn btn-primary btn-sm" id="addRes">+ Resource baru</button>
    </div>
    ${items.length ? items.map(r => `
      <div class="row-item">
        <div class="ri-ico">📁</div>
        <div class="ri-main"><b>${esc(r.title)}</b><div class="ri-sub">${esc(r.content || "")}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.slice(0, 40))}</a>` : ""}</div></div>
        <button class="btn btn-danger btn-sm" data-del="${r.id}">Hapus</button>
      </div>`).join("") : `<p class="muted">Simpan template caption, referensi, checklist, atau tautan penting di sini.</p>`}
  </div>`;
  $("#addRes").addEventListener("click", () => openModal(`
    <h3>Resource Baru</h3><form id="resForm">
      <label for="rs-title">Judul *</label><input class="input" id="rs-title" required>
      <label for="rs-url">URL (opsional)</label><input class="input" id="rs-url" type="url" placeholder="https://">
      <label for="rs-content">Isi / catatan</label><textarea class="textarea" id="rs-content" rows="4"></textarea>
      <div class="m-actions"><button type="button" class="btn btn-ghost" id="mCancel">Batal</button><button class="btn btn-primary">Simpan</button></div>
    </form>`)), $("#mCancel")?.addEventListener("click", closeModal);
  onForm("resForm", async (e) => {
    e.preventDefault();
    await api("/resources", { method: "POST", body: JSON.stringify({ title: $("#rs-title").value, url: $("#rs-url").value, content: $("#rs-content").value }) });
    closeModal(); toast("Resource disimpan."); pgResources();
  });
  view.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del && confirm("Hapus resource ini?")) { await api("/resources/" + del.dataset.del, { method: "DELETE" }); pgResources(); }
  }, { once: true });
}

/* ============ ANALYTICS ============ */
async function pgAnalytics() {
  const [s, items] = await Promise.all([api("/stats"), api("/contents")]);
  const published = items.filter(c => c.status === "published");
  const totalViews = published.reduce((a, c) => a + c.views, 0);
  const totalEng = published.reduce((a, c) => a + c.engagement, 0);
  const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const maxW = Math.max(...s.week.map(w => w.n), 1);
  view.innerHTML = `
  <div class="stat-grid">
    <div class="stat-card"><b>${s.total}</b><span>Total konten</span></div>
    <div class="stat-card"><b>${published.length}</b><span>Konten tayang</span></div>
    <div class="stat-card"><b>${totalViews.toLocaleString("id-ID")}</b><span>Total tayangan</span></div>
    <div class="stat-card"><b>${totalEng.toLocaleString("id-ID")}</b><span>Total interaksi</span></div>
    <div class="stat-card"><b>🔥 ${s.streak}</b><span>Streak</span></div>
    <div class="stat-card"><b>💎 ${s.points}</b><span>Poin</span></div>
  </div>
  <div class="card">
    <h3>Aktivitas 7 Hari Terakhir</h3>
    <div class="bar-chart">${s.week.map(w => `<div class="bc"><small style="font-weight:700">${w.n}</small><i style="height:${Math.round(w.n / maxW * 110)}px"></i><small>${dayNames[w.d]}</small></div>`).join("")}</div>
  </div>
  <div class="card">
    <h3>Per Status</h3>
    <div class="stat-grid">${["draft", "review", "scheduled", "published"].map(st => `
      <div class="stat-card"><b>${s.byStatus[st] || 0}</b><span>${STATUS_LABEL[st]}</span></div>`).join("")}</div>
  </div>`;
}

/* ============ AKUN ============ */
async function pgAkun() {
  view.innerHTML = `
  <div class="card" style="max-width:520px">
    <h3>Profil</h3>
    <form id="profForm">
      <label for="p-name">Nama</label><input class="input" id="p-name" value="${esc(user.name)}">
      <label for="p-email">Email</label><input class="input" id="p-email" type="email" value="${esc(user.email || "")}">
      <button class="btn btn-primary" style="margin-top:14px">Simpan profil</button>
    </form>
  </div>
  <div class="card" style="max-width:520px">
    <h3>Ganti Kata Sandi</h3>
    <form id="passForm">
      <label for="pw-old">Kata sandi lama</label><input class="input" id="pw-old" type="password" required>
      <label for="pw-new">Kata sandi baru (min. 8)</label><input class="input" id="pw-new" type="password" required minlength="8">
      <button class="btn btn-primary" style="margin-top:14px">Ganti sandi</button>
    </form>
  </div>
  <div class="card" style="max-width:520px">
    <h3>Info Akun</h3>
    <p class="small muted">Username: <b>@${esc(user.username)}</b> · Peran: <span class="badge ${user.role}">${user.role}</span> · Poin: 💎 ${user.points} · Streak: 🔥 ${user.streak}</p>
  </div>`;
  $("#profForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/profile", { method: "PUT", body: JSON.stringify({ name: $("#p-name").value, email: $("#p-email").value }) });
    user = (await api("/auth/me")).user; showApp(); toast("Profil disimpan.");
  });
  $("#passForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/password", { method: "PUT", body: JSON.stringify({ old_password: $("#pw-old").value, new_password: $("#pw-new").value }) }); toast("Kata sandi diganti."); $("#passForm").reset(); }
    catch (ex) { toast(ex.message); }
  });
}

/* ============ ADMIN PANEL (superadmin/admin) ============ */
async function pgAdmin() {
  if (!["admin", "superadmin"].includes(user.role)) { view.innerHTML = `<div class="card"><h3>403</h3><p class="muted">Akses hanya untuk Admin & Superadmin.</p></div>`; return; }
  const users = await api("/admin/users");
  const pending = users.filter(u => u.status === "pending").length;
  view.innerHTML = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:10px">
      <h3 style="margin:0">🛡️ Panel Admin — Kelola Pengguna (${users.length})</h3>
      <div style="display:flex;gap:8px">
        ${pending ? `<span class="badge pending">${pending} menunggu persetujuan</span>` : ""}
        <button class="btn btn-primary btn-sm" id="addUser">+ Tambah pengguna</button>
      </div>
    </div>
    <p class="muted small" style="margin-bottom:14px">${user.role === "superadmin" ? "Sebagai superadmin: setujui pendaftar, ubah peran, nonaktifkan/aktifkan, hapus akun." : "Sebagai admin: setujui pendaftar & kelola status akun."}</p>
    <div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>Pengguna</th><th>Peran</th><th>Status</th><th>Aktivitas</th><th>Aksi</th></tr></thead>
      <tbody>${users.map(u => `
        <tr>
          <td><b>${esc(u.name)}</b> ${u.id === user.id ? '<span class="badge user">kamu</span>' : ""}<br><span class="muted small">@${esc(u.username)}${u.email ? " · " + esc(u.email) : ""}</span></td>
          <td>${u.role === "superadmin" ? `<span class="badge superadmin">superadmin</span>` : user.role === "superadmin" ? `
            <select class="select" style="max-width:110px" data-role="${u.id}">
              <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
            </select>` : `<span class="badge ${u.role}">${u.role}</span>`}</td>
          <td><span class="badge ${u.status}">${u.status}</span></td>
          <td class="muted small">🔥 ${u.streak} · 💎 ${u.points}<br>${u.last_active ? "aktif " + fmtDate(u.last_active) : "belum aktif"}</td>
          <td><div class="acts">
            ${u.status === "pending" ? `<button class="btn btn-primary btn-sm" data-approve="${u.id}">Setujui</button>` : ""}
            ${u.status === "active" && u.role !== "superadmin" && u.id !== user.id ? `<button class="btn btn-ghost btn-sm" data-suspend="${u.id}">Nonaktifkan</button>` : ""}
            ${u.status === "suspended" ? `<button class="btn btn-primary btn-sm" data-activate="${u.id}">Aktifkan</button>` : ""}
            ${user.role === "superadmin" && u.role !== "superadmin" && u.id !== user.id ? `<button class="btn btn-danger btn-sm" data-delete="${u.id}">Hapus</button>` : ""}
          </div></td>
        </tr>`).join("")}</tbody></table></div>
  </div>`;
  $("#addUser").addEventListener("click", () => openModal(`
    <h3>Tambah Pengguna</h3><form id="uForm">
      <label for="nu-name">Nama *</label><input class="input" id="nu-name" required>
      <label for="nu-user">Username *</label><input class="input" id="nu-user" required>
      <label for="nu-email">Email</label><input class="input" id="nu-email" type="email">
      <label for="nu-pass">Kata sandi * (min. 8)</label><input class="input" id="nu-pass" type="password" required minlength="8">
      <label for="nu-role">Peran</label><select class="select" id="nu-role"><option value="user">user</option><option value="admin">admin</option></select>
      <div class="m-actions"><button type="button" class="btn btn-ghost" id="mCancel">Batal</button><button class="btn btn-primary">Buat</button></div>
    </form>`)), $("#mCancel")?.addEventListener("click", closeModal);
  onForm("uForm", async (e) => {
    e.preventDefault();
    try { await api("/admin/users", { method: "POST", body: JSON.stringify({ name: $("#nu-name").value, username: $("#nu-user").value, email: $("#nu-email").value, password: $("#nu-pass").value, role: $("#nu-role").value }) }); closeModal(); toast("Pengguna dibuat."); pgAdmin(); }
    catch (ex) { toast(ex.message); }
  });
  view.addEventListener("click", async (e) => {
    const act = (sel, url) => { const b = e.target.closest(sel); if (b) return b.dataset[Object.keys(b.dataset)[0]] && url(b.dataset[Object.keys(b.dataset)[0]]); };
    const get = (sel, key) => e.target.closest(sel)?.dataset[key];
    const id1 = get("[data-approve]", "approve");
    const id2 = get("[data-suspend]", "suspend");
    const id3 = get("[data-activate]", "activate");
    const id4 = get("[data-delete]", "delete");
    try {
      if (id1) { await api(`/admin/users/${id1}/approve`, { method: "POST" }); toast("Pengguna disetujui."); pgAdmin(); }
      else if (id2) { await api(`/admin/users/${id2}/suspend`, { method: "POST" }); toast("Pengguna dinonaktifkan."); pgAdmin(); }
      else if (id3) { await api(`/admin/users/${id3}/activate`, { method: "POST" }); toast("Pengguna diaktifkan."); pgAdmin(); }
      else if (id4) { if (confirm("Hapus pengguna ini PERMANEN? Semua datanya ikut terhapus.")) { await api(`/admin/users/${id4}`, { method: "DELETE" }); toast("Pengguna dihapus."); pgAdmin(); } }
    } catch (ex) { toast(ex.message); }
  }, { once: true });
  view.addEventListener("change", async (e) => {
    const s = e.target.closest("[data-role]");
    if (s) { try { await api(`/admin/users/${s.dataset.role}/role`, { method: "PUT", body: JSON.stringify({ role: s.value }) }); toast("Peran diubah."); } catch (ex) { toast(ex.message); pgAdmin(); } }
  }, { once: true });
}

/* ============ NOTES (sidebar) ============ */
async function loadNotes() {
  const notes = await api("/notes");
  $("#noteList").innerHTML = notes.length
    ? notes.map(n => `<div class="note"><span>${esc(n.body.slice(0, 60))}${n.body.length > 60 ? "…" : ""}</span><button data-nodedel="${n.id}" title="Hapus">✕</button></div>`).join("")
    : `<p class="muted small">Belum ada catatan. Ketuk + untuk mulai menulis.</p>`;
  $$("#noteList [data-nodedel]").forEach(b => b.addEventListener("click", async () => { await api("/notes/" + b.dataset.nodedel, { method: "DELETE" }); loadNotes(); }));
}
$("#noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!$("#noteInput").value.trim()) return;
  await api("/notes", { method: "POST", body: JSON.stringify({ body: $("#noteInput").value }) });
  $("#noteInput").value = ""; loadNotes();
});

/* ============ KALENDER EKSEKUSI ============ */
async function pgKalender() {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  async function draw() {
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const from = `${y}-${String(m + 1).padStart(2, "0")}-01`, to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
    const items = await api(`/calendar?from=${from}&to=${to} 23:59:59`);
    const byDay = {};
    for (const c of items) {
      const d = parseInt((c.scheduled_at || c.published_at || "").slice(8, 10));
      if (d) (byDay[d] = byDay[d] || []).push(c);
    }
    const dows = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
    const startDow = (first.getDay() + 6) % 7; // Senin=0
    const today = now.getFullYear() === y && now.getMonth() === m ? now.getDate() : -1;
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += "<div></div>";
    for (let d = 1; d <= last.getDate(); d++) {
      const evs = (byDay[d] || []).slice(0, 3).map(c => `<div class="cal-ev ${c.status}" title="${esc(c.title)}">${esc(c.title.slice(0, 22))}</div>`).join("");
      const more = (byDay[d] || []).length > 3 ? `<div class="muted small">+${byDay[d].length - 3} lagi</div>` : "";
      cells += `<div class="cal-day ${d === today ? "today" : ""}"><div class="dnum">${d}</div>${evs}${more}</div>`;
    }
    const monthName = first.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    view.innerHTML = `
    <div class="card">
      <div class="cal-head">
        <h3 style="margin:0">📅 Kalender Eksekusi — ${monthName}</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" id="calPrev">← Sebelumnya</button>
          <button class="btn btn-ghost btn-sm" id="calToday">Hari ini</button>
          <button class="btn btn-ghost btn-sm" id="calNext">Berikutnya →</button>
        </div>
      </div>
      <div class="cal-grid">${dows.map(d => `<div class="cal-dow">${d}</div>`).join("")}${cells}</div>
      <div class="cal-legend"><span class="l-pub">Tayang</span><span class="l-sch">Terjadwal</span><span class="l-dra">Draft/Review</span></div>
    </div>`;
    $("#calPrev").addEventListener("click", () => { m--; if (m < 0) { m = 11; y--; } draw(); });
    $("#calNext").addEventListener("click", () => { m++; if (m > 11) { m = 0; y++; } draw(); });
    $("#calToday").addEventListener("click", () => { y = now.getFullYear(); m = now.getMonth(); draw(); });
  }
  await draw();
}

/* ============ AUTO POST + GENERATOR CAPTION ============ */
let genTone = "edukasi";
async function pgAutopost() {
  const [aps, contents] = await Promise.all([api("/autoposts"), api("/contents")]);
  const ready = contents.filter(c => c.status !== "published");
  const tones = [["edukasi", "📚 Edukasi"], ["motivasi", "💪 Motivasi"], ["promosi", "🏷️ Promosi"], ["hiburan", "😄 Hiburan"]];
  view.innerHTML = `
  <div class="gen-box card" style="margin-bottom:18px">
    <h3>✨ Generator Caption</h3>
    <p class="muted small">Tulis topik, pilih gaya — caption + hashtag jadi otomatis.</p>
    <div class="cap-chips">${tones.map(([k, l]) => `<button class="chip ${genTone === k ? "on" : ""}" data-tone="${k}">${l}</button>`).join("")}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <input class="input" id="genTopic" placeholder="Topik, mis: manfaat tidur cukup" style="flex:1;min-width:220px">
      <button class="btn btn-primary" id="genBtn">✨ Generate</button>
    </div>
    <div id="genOut" class="gen-out" style="display:none"></div>
  </div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:10px">
      <h3 style="margin:0">⚡ Auto Post TikTok & Instagram (${aps.length})</h3>
      <button class="btn btn-primary btn-sm" id="addAp">+ Jadwalkan posting</button>
    </div>
    <p class="muted small" style="margin-bottom:14px">Worker cek jadwal tiap 60 detik. Saat jatuh tempo, konten otomatis berstatus tayang (mode demo: simulasi posting — hubungkan API resmi TikTok/IG untuk live).</p>
    ${aps.length ? aps.map(a => `
      <div class="ap-row">
        <div class="ri-ico">${a.platform === "tiktok" ? "🎵" : "📷"}</div>
        <div class="ri-main"><b>${esc(a.content_title || "Konten terhapus")}</b>
          <div class="ri-sub">${esc(a.caption?.slice(0, 60) || "")}</div></div>
        <span class="badge ${a.status}">${a.status}</span>
        <div class="muted small">${fmtDate(a.scheduled_at)} ${a.scheduled_at?.slice(11, 16) || ""}</div>
        ${a.status === "scheduled" ? `<button class="btn btn-ghost btn-sm" data-now="${a.id}">▶ Posting sekarang</button>
        <button class="btn btn-danger btn-sm" data-delap="${a.id}">Batal</button>` : `<span class="muted small" title="${esc(a.result || "")}">✓ ${a.posted_at?.slice(0, 16) || ""}</span>`}
      </div>`).join("") : `<p class="muted">Belum ada jadwal auto post. Klik "+ Jadwalkan posting".</p>`}
  </div>`;
  // chips tone
  view.querySelectorAll("[data-tone]").forEach(b => b.addEventListener("click", () => { genTone = b.dataset.tone; pgAutopost(); }));
  // generator
  $("#genBtn").addEventListener("click", async () => {
    const topic = $("#genTopic").value.trim();
    if (!topic) return toast("Tulis dulu topiknya.");
    $("#genBtn").textContent = "⏳ Membuat…";
    try {
      const d = await api("/generate-caption", { method: "POST", body: JSON.stringify({ topic, tone: genTone }) });
      const out = $("#genOut"); out.style.display = "block"; out.textContent = d.caption;
      out.onclick = () => { navigator.clipboard?.writeText(d.caption); toast("Caption disalin ke clipboard 📋"); };
      toast("Caption jadi! Klik teks untuk menyalin.");
    } catch (e) { toast(e.message); }
    $("#genBtn").textContent = "✨ Generate";
  });
  // add auto post
  $("#addAp").addEventListener("click", () => {
    if (!ready.length) return toast("Semua konten sudah tayang — buat konten dulu.");
    openModal(`
    <h3>Jadwalkan Auto Post</h3><p class="m-sub">Konten otomatis diposting saat waktunya tiba.</p>
    <form id="apForm">
      <label for="ap-content">Konten</label>
      <select class="select" id="ap-content">${ready.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("")}</select>
      <label for="ap-platform">Platform</label>
      <select class="select" id="ap-platform"><option value="tiktok">🎵 TikTok</option><option value="instagram">📷 Instagram</option></select>
      <label for="ap-caption">Caption (opsional — override)</label>
      <textarea class="textarea" id="ap-caption" rows="3" placeholder="Kosongkan untuk pakai caption konten"></textarea>
      <label for="ap-time">Waktu posting</label>
      <input class="input" id="ap-time" type="datetime-local" required>
      <div class="m-actions"><button type="button" class="btn btn-ghost" id="mCancel">Batal</button><button class="btn btn-primary">Jadwalkan</button></div>
    </form>`);
    $("#mCancel")?.addEventListener("click", closeModal);
    onForm("apForm", async (e) => {
      e.preventDefault();
      try {
        await api("/autoposts", { method: "POST", body: JSON.stringify({
          content_id: $("#ap-content").value, platform: $("#ap-platform").value,
          caption: $("#ap-caption").value, scheduled_at: $("#ap-time").value.replace("T", " ") + ":00",
        }) });
        closeModal(); toast("Auto post dijadwalkan ⚡"); pgAutopost();
      } catch (ex) { toast(ex.message); }
    });
  });
  view.addEventListener("click", async (e) => {
    const now = e.target.closest("[data-now]"), del = e.target.closest("[data-delap]");
    try {
      if (now) { const d = await api(`/autoposts/${now.dataset.now}/postnow`, { method: "POST" }); toast(d.message || "Terposting ✓"); pgAutopost(); }
      if (del && confirm("Batalkan auto post ini?")) { await api(`/autoposts/${del.dataset.delap}`, { method: "DELETE" }); toast("Dibatalkan."); pgAutopost(); }
    } catch (ex) { toast(ex.message); }
  }, { once: true });
}

/* ============ ROUTER ============ */
async function refreshHeader() {
  const s = await api("/stats");
  $("#streakVal").textContent = s.streak; $("#pointsVal").textContent = s.points;
  $("#cntKonten").textContent = s.total;
  const ideas = await api("/ideas").catch(() => []);
  const ic = $("#cntIdea"); if (ic) ic.textContent = ideas.length;
}
const routes = {
  dashboard: pgDashboard,
  konten: pgKonten,
  campaign: pgCampaign,
  ideabank: pgIdeas,
  resources: pgResources,
  kalender: pgKalender,
  autopost: pgAutopost,
  analytics: pgAnalytics,
  akun: pgAkun,
  admin: pgAdmin,
};
function route() {
  const name = (location.hash.replace(/^#\//, "") || "dashboard");
  $$("#sbNav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#/" + name));
  (routes[name] || pgDashboard)().catch(e => { view.innerHTML = `<div class="card"><h3>Ups</h3><p class="muted">${esc(e.message)}</p></div>`; });
  loadNotes().catch(() => {});
  refreshHeader().catch(() => {});
  $("#sidebar").classList.remove("open");
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (a) { e.preventDefault(); location.hash = a.getAttribute("href").slice(1); }
});
$("#newContentBtn").addEventListener("click", () => contentModal());
$("#globalSearch").addEventListener("input", () => { if (location.hash.replace("#/", "") === "konten" || location.hash === "") { if (location.hash !== "#/konten") location.hash = "#/konten"; else pgKonten(); } });

/* ============ DARK MODE ============ */
const themeBtn = $("#themeBtn");
function applyTheme(t) {
  document.documentElement.classList.toggle("dark", t === "dark");
  themeBtn.textContent = t === "dark" ? "☀️" : "🌙";
}
applyTheme(localStorage.getItem("cp_theme") || "light");
themeBtn.addEventListener("click", () => {
  const t = document.documentElement.classList.contains("dark") ? "light" : "dark";
  localStorage.setItem("cp_theme", t); applyTheme(t);
});

/* ============ INIT ============ */
(async () => {
  if (token) {
    try { const me = await api("/auth/me"); if (me.user) { user = me.user; showApp(); return; } } catch {}
  }
  showAuth();
})();
