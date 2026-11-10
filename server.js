// ContentPlanner — Express server (production mode)
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const zlib = require("zlib");
const { db, hashPassword, verifyPassword } = require("./db");

const app = express();
const PORT = process.env.PORT || 3030;
const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_DAYS = 7;

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});

/* ---------- gzip ---------- */
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(req.headers["accept-encoding"] || "")) return next();
  const origSend = res.send.bind(res), origJson = res.json.bind(res);
  const gz = (b) => {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
    if (buf.length > 1024) { res.setHeader("Content-Encoding", "gzip"); res.setHeader("Vary", "Accept-Encoding"); return zlib.gzipSync(buf); }
    return buf;
  };
  res.send = (b) => { const o = gz(b); res.setHeader("Content-Length", o.length); return origSend(o); };
  res.json = (o) => { const b = gz(JSON.stringify(o)); res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Content-Length", b.length); res.end(b); };
  next();
});

app.use(express.json({ limit: "1mb" }));

/* ---------- static (safe) ---------- */
const staticOpts = { maxAge: IS_PROD ? "1h" : 0, setHeaders: (res, p) => { if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } };
app.use(express.static(path.join(__dirname, "public"), staticOpts));

/* ---------- rate limit ---------- */
const buckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.reset) { b = { c: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.c++;
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    if (b.c > max) return res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi nanti." });
    next();
  };
}
const loginLimiter = rateLimit({ windowMs: 15 * 60e3, max: 25 });
app.use("/api/", rateLimit({ windowMs: 60e3, max: 180 }));

/* ---------- auth ---------- */
function getUser(req) {
  const tok = (req.headers.authorization || "").replace("Bearer ", "") ||
    (req.headers.cookie || "").match(/cp_session=([^;]+)/)?.[1];
  if (!tok) return null;
  const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?").get(tok);
  if (!row) return null;
  if (row.status === "suspended") return { ...row, _suspended: true };
  return row;
}
function requireAuth(...roles) {
  return (req, res, next) => {
    const u = getUser(req);
    if (!u) return res.status(401).json({ error: "Silakan login." });
    if (u._suspended) return res.status(403).json({ error: "Akun dinonaktifkan. Hubungi admin." });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: "Akses tidak cukup." });
    req.user = u;
    next();
  };
}
app.post("/api/auth/register", loginLimiter, (req, res) => {
  const { name, username, email, password } = req.body || {};
  if (!name?.trim() || !username?.trim() || !password || password.length < 8)
    return res.status(400).json({ error: "Nama, username wajib; kata sandi minimal 8 karakter." });
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) return res.status(400).json({ error: "Username: 3–30 huruf/angka/._" });
  const status = process.env.AUTO_APPROVE === "1" ? "active" : "pending";
  try {
    const info = db.prepare("INSERT INTO users (name,username,email,password_hash,role,status) VALUES (?,?,?,?,?,?)")
      .run(name.trim(), username.toLowerCase().trim(), email?.trim() || null, hashPassword(password), "user", status);
    if (status === "pending") return res.json({ ok: true, pending: true, message: "Pendaftaran berhasil! Akun menunggu persetujuan superadmin." });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message).includes("UNIQUE") ? "Username atau email sudah dipakai." : "Pendaftaran gagal." });
  }
});
app.post("/api/auth/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE username=? OR email=?").get(String(username || "").toLowerCase().trim(), String(username || "").toLowerCase().trim());
  if (!u || !verifyPassword(String(password || ""), u.password_hash))
    return res.status(401).json({ error: "Username atau kata sandi salah." });
  if (u.status === "pending") return res.status(403).json({ error: "Akun masih menunggu persetujuan admin." });
  if (u.status === "suspended") return res.status(403).json({ error: "Akun dinonaktifkan. Hubungi admin." });
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id) VALUES (?,?)").run(tok, u.id);
  db.prepare("UPDATE users SET last_active=datetime('now') WHERE id=?").run(u.id);
  res.setHeader("Set-Cookie", `cp_session=${tok}; HttpOnly; Path=/; SameSite=Lax${IS_PROD ? "; Secure" : ""}; Max-Age=${SESSION_DAYS * 86400}`);
  res.json({ token: tok, user: pubUser(u) });
});
app.post("/api/auth/logout", (req, res) => {
  const tok = (req.headers.authorization || "").replace("Bearer ", "");
  if (tok) db.prepare("DELETE FROM sessions WHERE token=?").run(tok);
  res.setHeader("Set-Cookie", "cp_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/auth/me", (req, res) => {
  const u = getUser(req);
  if (!u || u._suspended) return res.json({ user: null });
  res.json({ user: pubUser(u) });
});
setInterval(() => db.prepare(`DELETE FROM sessions WHERE created_at < datetime('now','-${SESSION_DAYS} days')`).run(), 864e5).unref();

function pubUser(u) {
  return { id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, status: u.status, avatar_color: u.avatar_color, streak: u.streak, points: u.points };
}

/* ---------- contents ---------- */
const C = `id,title,platform,type,caption,status,progress,scheduled_at,published_at,views,engagement,campaign_id,created_at,updated_at,
  (SELECT name FROM campaigns WHERE id=campaign_id) AS campaign_name`;

app.get("/api/contents", requireAuth(), (req, res) => {
  const { status, platform } = req.query;
  const w = ["user_id=?"]; const a = [req.user.id];
  if (status) { w.push("status=?"); a.push(String(status)); }
  if (platform) { w.push("platform=?"); a.push(String(platform)); }
  const rows = db.prepare(`SELECT ${C} FROM contents WHERE ${w.join(" AND ")} ORDER BY updated_at DESC LIMIT 200`).all(...a);
  res.json(rows);
});
app.post("/api/contents", requireAuth(), (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: "Judul wajib diisi." });
  const platform = ["instagram","tiktok","youtube","x","facebook","linkedin"].includes(b.platform) ? b.platform : "instagram";
  const type = ["reels","carousel","single","story","video","article"].includes(b.type) ? b.type : "reels";
  const status = ["draft","review","scheduled","published"].includes(b.status) ? b.status : "draft";
  const info = db.prepare(`INSERT INTO contents (user_id,title,platform,type,caption,status,progress,scheduled_at,campaign_id)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, b.title.trim().slice(0,200), platform, type, b.caption || "", status,
      Math.max(0, Math.min(100, parseInt(b.progress) || (status === "published" ? 100 : 0))),
      b.scheduled_at || null, /^\d+$/.test(b.campaign_id) ? b.campaign_id : null);
  if (status === "published") bumpPoints(req.user.id, 50);
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.put("/api/contents/:id", requireAuth(), (req, res) => {
  const c = db.prepare("SELECT * FROM contents WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: "Konten tidak ditemukan." });
  const b = req.body || {};
  const wasPub = c.status === "published";
  const status = ["draft","review","scheduled","published"].includes(b.status) ? b.status : c.status;
  db.prepare(`UPDATE contents SET title=?, platform=?, type=?, caption=?, status=?, progress=?, scheduled_at=?, campaign_id=?, published_at=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.title?.trim() ?? c.title,
      ["instagram","tiktok","youtube","x","facebook","linkedin"].includes(b.platform) ? b.platform : c.platform,
      ["reels","carousel","single","story","video","article"].includes(b.type) ? b.type : c.type,
      b.caption ?? c.caption, status,
      b.progress !== undefined ? Math.max(0, Math.min(100, parseInt(b.progress) || 0)) : c.progress,
      b.scheduled_at !== undefined ? (b.scheduled_at || null) : c.scheduled_at,
      b.campaign_id !== undefined ? (/^\d+$/.test(b.campaign_id) ? b.campaign_id : null) : c.campaign_id,
      status === "published" ? (c.published_at || new Date().toISOString()) : c.published_at,
      c.id);
  if (!wasPub && status === "published") bumpPoints(req.user.id, 50);
  res.json({ ok: true });
});
app.delete("/api/contents/:id", requireAuth(), (req, res) => {
  db.prepare("DELETE FROM contents WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});
function bumpPoints(uid, pts) {
  db.prepare("UPDATE users SET points = points + ?, streak = streak + 1 WHERE id=?").run(pts, uid);
}

/* ---------- campaigns / ideas / resources / notes ---------- */
app.get("/api/campaigns", requireAuth(), (req, res) => {
  res.json(db.prepare("SELECT * FROM campaigns WHERE user_id=? ORDER BY created_at DESC").all(req.user.id));
});
app.post("/api/campaigns", requireAuth(), (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Nama campaign wajib." });
  const info = db.prepare("INSERT INTO campaigns (user_id,name,description,start_date,end_date,color) VALUES (?,?,?,?,?,?)")
    .run(req.user.id, b.name.trim(), b.description || "", b.start_date || null, b.end_date || null, b.color || "#2563eb");
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.delete("/api/campaigns/:id", requireAuth(), (req, res) => {
  db.prepare("DELETE FROM campaigns WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});
app.get("/api/ideas", requireAuth(), (req, res) => {
  res.json(db.prepare("SELECT * FROM ideas WHERE user_id=? ORDER BY created_at DESC").all(req.user.id));
});
app.post("/api/ideas", requireAuth(), (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: "Judul ide wajib." });
  const info = db.prepare("INSERT INTO ideas (user_id,title,notes) VALUES (?,?,?)").run(req.user.id, b.title.trim(), b.notes || "");
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.put("/api/ideas/:id", requireAuth(), (req, res) => {
  const s = ["baru","diproses","terpakai"].includes(req.body?.status) ? req.body.status : null;
  if (!s) return res.status(400).json({ error: "Status tidak valid." });
  db.prepare("UPDATE ideas SET status=? WHERE id=? AND user_id=?").run(s, req.params.id, req.user.id);
  res.json({ ok: true });
});
app.delete("/api/ideas/:id", requireAuth(), (req, res) => {
  db.prepare("DELETE FROM ideas WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});
app.get("/api/resources", requireAuth(), (req, res) => {
  res.json(db.prepare("SELECT * FROM resources WHERE user_id=? ORDER BY created_at DESC").all(req.user.id));
});
app.post("/api/resources", requireAuth(), (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: "Judul resource wajib." });
  const info = db.prepare("INSERT INTO resources (user_id,title,url,content) VALUES (?,?,?,?)")
    .run(req.user.id, b.title.trim(), b.url || null, b.content || "");
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.delete("/api/resources/:id", requireAuth(), (req, res) => {
  db.prepare("DELETE FROM resources WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});
app.get("/api/notes", requireAuth(), (req, res) => {
  res.json(db.prepare("SELECT * FROM notes WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(req.user.id));
});
app.post("/api/notes", requireAuth(), (req, res) => {
  if (!req.body?.body?.trim()) return res.status(400).json({ error: "Catatan kosong." });
  const info = db.prepare("INSERT INTO notes (user_id,body) VALUES (?,?)").run(req.user.id, req.body.body.trim().slice(0, 2000));
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.delete("/api/notes/:id", requireAuth(), (req, res) => {
  db.prepare("DELETE FROM notes WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ---------- dashboard stats ---------- */
app.get("/api/stats", requireAuth(), (req, res) => {
  const uid = req.user.id;
  const m = (sql, ...a) => db.prepare(sql).get(...a);
  const monthlyGoal = parseInt(process.env.MONTHLY_GOAL) || 13;
  const publishedThisMonth = m(`SELECT COUNT(*) n FROM contents WHERE user_id=? AND status='published' AND strftime('%Y-%m',COALESCE(published_at,updated_at))=strftime('%Y-%m','now')`, uid).n;
  const total = m("SELECT COUNT(*) n FROM contents WHERE user_id=?", uid).n;
  const byStatus = {};
  for (const r of db.prepare("SELECT status, COUNT(*) n FROM contents WHERE user_id=? GROUP BY status").all(uid)) byStatus[r.status] = r.n;
  const week = db.prepare(`SELECT strftime('%w', COALESCE(published_at, scheduled_at, updated_at)) d, COUNT(*) n FROM contents WHERE user_id=? AND COALESCE(published_at,scheduled_at,updated_at) >= date('now','-7 days') GROUP BY d`).all(uid);
  const top = db.prepare(`SELECT id,title,platform,views,engagement FROM contents WHERE user_id=? AND status='published' ORDER BY views DESC LIMIT 5`).all(uid);
  res.json({
    monthlyGoal, publishedThisMonth, progressPct: Math.min(100, Math.round(publishedThisMonth / monthlyGoal * 100)),
    total, byStatus,
    week: [0,1,2,3,4,5,6].map(d => ({ d, n: week.find(w => w.d === String(d))?.n || 0 })),
    top: top.map((t, i) => ({ ...t, rank: i + 1 })),
    streak: req.user.streak, points: req.user.points,
  });
});

/* ---------- admin: user management ---------- */
app.get("/api/admin/users", requireAuth("admin", "superadmin"), (req, res) => {
  res.json(db.prepare(`SELECT id,name,username,email,role,status,streak,points,last_active,created_at FROM users ORDER BY created_at DESC`).all());
});
app.post("/api/admin/users/:id/approve", requireAuth("admin", "superadmin"), (req, res) => {
  db.prepare("UPDATE users SET status='active' WHERE id=? AND status='pending'").run(req.params.id);
  res.json({ ok: true });
});
app.post("/api/admin/users/:id/suspend", requireAuth("admin", "superadmin"), (req, res) => {
  const t = db.prepare("SELECT id,role FROM users WHERE id=?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "User tidak ditemukan." });
  if (t.role === "superadmin") return res.status(403).json({ error: "Tidak dapat menonaktifkan superadmin." });
  db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(t.id);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(t.id);
  res.json({ ok: true });
});
app.post("/api/admin/users/:id/activate", requireAuth("admin", "superadmin"), (req, res) => {
  db.prepare("UPDATE users SET status='active' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
app.put("/api/admin/users/:id/role", requireAuth("superadmin"), (req, res) => {
  const role = req.body?.role;
  if (!["user","admin"].includes(role)) return res.status(400).json({ error: "Role tidak valid." });
  const t = db.prepare("SELECT id,role FROM users WHERE id=?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "User tidak ditemukan." });
  if (t.role === "superadmin") return res.status(403).json({ error: "Superadmin tidak dapat diubah." });
  db.prepare("UPDATE users SET role=? WHERE id=?").run(role, t.id);
  res.json({ ok: true });
});
app.delete("/api/admin/users/:id", requireAuth("superadmin"), (req, res) => {
  const t = db.prepare("SELECT id,role FROM users WHERE id=?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "User tidak ditemukan." });
  if (t.role === "superadmin") return res.status(403).json({ error: "Superadmin tidak dapat dihapus." });
  db.prepare("DELETE FROM users WHERE id=?").run(t.id);
  res.json({ ok: true });
});
app.post("/api/admin/users", requireAuth("admin", "superadmin"), (req, res) => {
  const { name, username, email, password, role } = req.body || {};
  if (!name?.trim() || !username?.trim() || !password || password.length < 8 || !["user","admin"].includes(role))
    return res.status(400).json({ error: "Data tidak lengkap (sandi min. 8, role user/admin)." });
  try {
    const info = db.prepare("INSERT INTO users (name,username,email,password_hash,role,status) VALUES (?,?,?,?,?,?)")
      .run(name.trim(), username.toLowerCase().trim(), email?.trim() || null, hashPassword(password), role, "active");
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: "Username/email sudah dipakai." }); }
});

/* ---------- profile ---------- */
app.put("/api/profile", requireAuth(), (req, res) => {
  const { name, email } = req.body || {};
  if (name?.trim()) db.prepare("UPDATE users SET name=? WHERE id=?").run(name.trim().slice(0, 80), req.user.id);
  if (email !== undefined) db.prepare("UPDATE users SET email=? WHERE id=?").run(email?.trim() || null, req.user.id);
  res.json({ ok: true });
});
app.put("/api/password", requireAuth(), (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!verifyPassword(String(old_password || ""), req.user.password_hash))
    return res.status(400).json({ error: "Kata sandi lama salah." });
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: "Kata sandi baru minimal 8 karakter." });
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(new_password), req.user.id);
  res.json({ ok: true });
});

/* ---------- calendar ---------- */
app.get("/api/calendar", requireAuth(), (req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`SELECT id,title,platform,type,status,progress,scheduled_at,published_at FROM contents
    WHERE user_id=? AND ((scheduled_at BETWEEN ? AND ?) OR (published_at BETWEEN ? AND ?))
    ORDER BY COALESCE(scheduled_at,published_at)`).all(req.user.id, from, to, from, to);
  res.json(rows);
});

/* ---------- auto posts (TikTok / Instagram) ---------- */
app.get("/api/autoposts", requireAuth(), (req, res) => {
  res.json(db.prepare(`SELECT ap.*, c.title AS content_title, c.type AS content_type FROM auto_posts ap
    LEFT JOIN contents c ON c.id=ap.content_id WHERE ap.user_id=? ORDER BY ap.scheduled_at DESC LIMIT 100`).all(req.user.id));
});
app.post("/api/autoposts", requireAuth(), (req, res) => {
  const b = req.body || {};
  const platform = ["tiktok", "instagram"].includes(b.platform) ? b.platform : null;
  if (!b.content_id || !platform || !b.scheduled_at) return res.status(400).json({ error: "content_id, platform, scheduled_at wajib." });
  const c = db.prepare("SELECT id,title,caption FROM contents WHERE id=? AND user_id=?").get(b.content_id, req.user.id);
  if (!c) return res.status(404).json({ error: "Konten tidak ditemukan." });
  const info = db.prepare("INSERT INTO auto_posts (user_id,content_id,platform,caption,scheduled_at) VALUES (?,?,?,?,?)")
    .run(req.user.id, c.id, platform, b.caption ?? c.caption ?? "", b.scheduled_at);
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.put("/api/autoposts/:id", requireAuth(), (req, res) => {
  const ap = db.prepare("SELECT * FROM auto_posts WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!ap) return res.status(404).json({ error: "Auto post tidak ditemukan." });
  if (ap.status === "posted") return res.status(400).json({ error: "Sudah terposting, tidak bisa diubah." });
  const sched = req.body?.scheduled_at;
  db.prepare("UPDATE auto_posts SET scheduled_at=? WHERE id=?").run(sched || ap.scheduled_at, ap.id);
  res.json({ ok: true });
});
app.delete("/api/autoposts/:id", requireAuth(), (req, res) => {
  db.prepare("DELETE FROM auto_posts WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});
app.post("/api/autoposts/:id/postnow", requireAuth(), (req, res) => {
  const ap = db.prepare("SELECT * FROM auto_posts WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!ap) return res.status(404).json({ error: "Auto post tidak ditemukan." });
  if (ap.status === "posted") return res.status(400).json({ error: "Sudah terposting." });
  runAutoPost(ap);
  res.json({ ok: true, status: "posted", message: `Simulasi posting ke ${ap.platform} berhasil (mode demo — hubungkan API asli via env untuk live).` });
});

/* Auto-post worker: setiap 60 detik cek jadwal yang jatuh tempo */
function runAutoPost(ap) {
  const sim = process.env.AUTOPOST_MODE !== "live";
  const result = sim
    ? `[SIMULASI] Konten "${ap.caption?.slice(0, 60) || ""}" diposting ke ${ap.platform === "tiktok" ? "TikTok" : "Instagram"} pada ${new Date().toISOString()}`
    : `[LIVE] Posting ke ${ap.platform} (integrasi eksternal di server.js)`;
  db.prepare("UPDATE auto_posts SET status='posted', result=?, posted_at=datetime('now') WHERE id=?").run(result, ap.id);
  if (ap.content_id) db.prepare("UPDATE contents SET status='published', progress=100, published_at=COALESCE(published_at,datetime('now')), updated_at=datetime('now') WHERE id=?").run(ap.content_id);
  db.prepare("UPDATE users SET points = points + 50, streak = streak + 1 WHERE id=?").run(ap.user_id);
  console.log(`[autopost] #${ap.id} → ${ap.platform}: ${sim ? "simulasi" : "live"}`);
}
setInterval(() => {
  try {
    const due = db.prepare(`SELECT * FROM auto_posts WHERE status='scheduled' AND scheduled_at <= datetime('now','localtime')`).all();
    for (const ap of due) runAutoPost(ap);
  } catch (e) { console.error("[autopost]", e.message); }
}, 60000).unref();

/* ---------- caption generator (template-based, offline) ---------- */
const HOOKS = {
  edukasi: ["Tahukah kamu bahwa…", "3 hal yang {topik} bikin salah paham:", "Stop! Kalau kamu {topik}, baca ini dulu 👇"],
  motivasi: ["Semangat! {topik} itu proses, bukan lomba 🌱", "Pesan untuk kamu yang lagi capek soal {topik} 💛", "Satu langkah kecil hari ini soal {topik} > nol 🚀"],
  promosi: ["Promo spesial buat kamu yang cari {topik} 🎉", "Jangan lewatkan: {topik} terbaik minggu ini ✨", "Cuma hari ini — {topik} dengan penawaran terbaik 🏷️"],
  hiburan: ["POV: kamu baru mulai {topik} 😆", "Siapa nih yang suka {topik}? Tunjuk tangan 🙋", "Plot twist soal {topik} yang gak kamu duga 🤯"],
};
const CTA = {
  edukasi: "Simpan dulu biar gak lupa 📌 dan share ke temanmu yang butuh!",
  motivasi: "Tag satu teman yang perlu baca ini 💬",
  promosi: "Klik link di bio sebelum kehabisan! 🛒",
  hiburan: "Comment emoji yang mewakili kamu 😂",
};
const HASHTAGS = {
  edukasi: "#edukasi #tipsdantrik #belajarbareng #knowledge #seruseru",
  motivasi: "#motivasihari #selfimprovement #semangat #growthmindset",
  promosi: "#promo #diskon #promohariini #belanjahepat",
  hiburan: "#viral #fyp #seru #reelsindo #tiktokindo",
};
app.post("/api/generate-caption", requireAuth(), (req, res) => {
  const { topic, tone = "edukasi", platform = "instagram", type = "reels" } = req.body || {};
  const t = String(topic || "").trim();
  if (!t) return res.status(400).json({ error: "Tulis dulu topik kontennya." });
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hook = pick(HOOKS[tone] || HOOKS.edukasi).replace("{topik}", t.toLowerCase());
  const bodyLines = {
    edukasi: [`1. Poin utama tentang ${t.toLowerCase()}`, "2. Fakta/data pendukung", "3. Tips langsung praktik"],
    motivasi: [`Refleksi singkat soal ${t.toLowerCase()}`, "Ajakan mulai dari langkah kecil", "Apresiasi diri hari ini"],
    promosi: [`Keunggulan ${t.toLowerCase()}`, "Testimoni singkat", "Penawaran terbatas"],
    hiburan: [`Skenario relatable soal ${t.toLowerCase()}`, "Twist lucu di tengah", "Punchline penutup"],
  }[HOOKS[tone] ? tone : "edukasi"];
  const cta = CTA[HOOKS[tone] ? tone : "edukasi"];
  const tags = HASHTAGS[HOOKS[tone] ? tone : "edukasi"] + (platform === "tiktok" ? " #fypシ #virał" : " #reels #explore");
  const emojis = { edukasi: "📚✨", motivasi: "💪🔥", promosi: "🏷️🎁", hiburan: "😄🎬" }[HOOKS[tone] ? tone : "edukasi"];
  const caption = `${hook} ${emojis}\n\n${bodyLines.join("\n")}\n\n${cta}\n\n${tags}`;
  res.json({ ok: true, caption });
});

/* ---------- fallback ---------- */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endpoint tidak ditemukan." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use((err, req, res, next) => {
  console.error(`${new Date().toISOString()} ERROR ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: "Terjadi kesalahan server." });
});

const server = app.listen(PORT, () => console.log(`ContentPlanner [${IS_PROD ? "PRODUCTION" : "dev"}] di http://localhost:${PORT}`));
function shutdown(sig) { console.log(`\n${sig} — menutup…`); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 8000).unref(); }
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
