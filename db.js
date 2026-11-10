// ContentPlanner — database layer (node:sqlite)
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "planner.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin','superadmin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','suspended')),
  avatar_color TEXT DEFAULT '#2563eb',
  streak INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  last_active TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'instagram' CHECK(platform IN ('instagram','tiktok','youtube','x','facebook','linkedin')),
  type TEXT NOT NULL DEFAULT 'reels' CHECK(type IN ('reels','carousel','single','story','video','article')),
  caption TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','scheduled','published')),
  progress INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  published_at TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  engagement INTEGER NOT NULL DEFAULT 0,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  color TEXT DEFAULT '#2563eb',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'baru' CHECK(status IN ('baru','diproses','terpakai')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  content TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auto_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id INTEGER REFERENCES contents(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('tiktok','instagram')),
  caption TEXT DEFAULT '',
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','posted','failed')),
  result TEXT DEFAULT '',
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contents_user ON contents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_autopost_due ON auto_posts(status, scheduled_at);
`);

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex");
}
function verifyPassword(pw, stored) {
  const [salt, h] = String(stored).split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(h, "hex"), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- first boot: superadmin ----
if (db.prepare("SELECT COUNT(*) n FROM users").get().n === 0) {
  let pass = process.env.SUPERADMIN_PASSWORD || crypto.randomBytes(10).toString("base64url").slice(0, 14);
  db.prepare("INSERT INTO users (name,username,role,password_hash,avatar_color,status) VALUES (?,?,?,?,?,?)")
    .run("Super Admin", "superadmin", "superadmin", hashPassword(pass), "#1d4ed8", "active");
  if (!process.env.SUPERADMIN_PASSWORD) {
    fs.writeFileSync(path.join(DATA_DIR, "initial-superadmin.txt"),
      `Username: superadmin\nKata sandi: ${pass}\n\nSegera ganti sandi ini, lalu hapus file ini.\n`, { mode: 0o600 });
    console.log(`[init] Super admin dibuat — kredensial: data/initial-superadmin.txt`);
  }
}

module.exports = { db, hashPassword, verifyPassword, DATA_DIR };

/* ---------- demo seed (SEED_DEMO=1) ---------- */
if (process.env.SEED_DEMO === "1") {
  const cnt = db.prepare("SELECT COUNT(*) n FROM contents").get().n;
  if (cnt === 0) {
    const uid = db.prepare("SELECT id FROM users WHERE role='superadmin'").get().id;
    const insC = db.prepare(`INSERT INTO contents (user_id,title,platform,type,caption,status,progress,scheduled_at,published_at,views,engagement,campaign_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insCamp = db.prepare("INSERT INTO campaigns (user_id,name,description,start_date,end_date,color) VALUES (?,?,?,?,?,?)");
    const camp1 = insCamp.run(uid, "Challenge 21 Hari Gerak", "Serial konten komunitas olahraga", "2026-11-01", "2026-11-21", "#2563eb").lastInsertRowid;
    const camp2 = insCamp.run(uid, "Edu Nursing November", "Konten edukasi keperawatan", "2026-11-05", "2026-11-30", "#7c3aed").lastInsertRowid;
    const pubs = [
      ["Checklist pagi sebelum praktik klinis", "instagram", "carousel", 4820, 356, 5, camp2],
      ["3 miskonsepsi tentang vaksin", "tiktok", "video", 12400, 980, 8, camp2],
      ["Stretching 5 menit untuk pekerja WFH", "instagram", "reels", 8300, 640, 12, camp1],
      ["Story: behind the scene demo PTS", "instagram", "story", 2100, 150, 3, null],
      ["Tips mencatat jurnal keperawatan", "tiktok", "video", 6700, 520, 9, camp2],
    ];
    const dstr = (d) => `datetime('now','-${d} days')`;
    for (const [t, p, ty, v, e, d, cid] of pubs)
      db.prepare(`INSERT INTO contents (user_id,title,platform,type,caption,status,progress,published_at,views,engagement,campaign_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,100,?,?,?,?,datetime('now','-${d} days'),datetime('now','-${d} days'))`)
        .run(uid, t, p, ty, `Halo! ${t} — simpan dulu biar tidak lupa 📌 #edukasi #tips`, "published", `2026-11-${10 + d} 09:00:00`, v, e, cid);
    insC.run(uid, "Peserta challenge cerita: minggu pertama", "instagram", "reels", "Rekap peserta minggu pertama ✨", "draft", 83, null, null, 0, 0, camp1, 1, 0);
    insC.run(uid, "Reels produktif pagi", "tiktok", "reels", "Routine pagi ala mahasiswa sibuk ☀️", "review", 65, null, null, 0, 0, null, 2, 1);
    insC.run(uid, "Carousel tips stretching", "instagram", "carousel", "5 gerakan simple di rumah", "scheduled", 100, "2026-11-12 10:00", null, 0, 0, camp1, 1, 1);
    insC.run(uid, "Video Q&A perawatan luka", "tiktok", "video", "Jawab pertanyaan followers", "scheduled", 90, "2026-11-13 16:00", null, 0, 0, camp2, 1, 1);
    insC.run(uid, "Ide konten week-end vlog", "youtube", "video", "", "draft", 20, null, null, 0, 0, null, 0, 0);
    const insI = db.prepare("INSERT INTO ideas (user_id,title,notes,status) VALUES (?,?,?,?)");
    insI.run(uid, "Challenge cerita mingguan", "Serial 4 minggu bareng followers", "diproses");
    insI.run(uid, "Mitos vs fakta tidur", "Format carousel perbandingan", "baru");
    insI.run(uid, "Kolaborasi dengan alumni", "Live IG bareng alumni FKep", "baru");
    insI.run(uid, "Behind the scene UKS", "Vlog singkat kegiatan harian", "terpakai");
    const insR = db.prepare("INSERT INTO resources (user_id,title,url,content) VALUES (?,?,?,?)");
    insR.run(uid, "Template caption hooks", null, "1. 'Tahukah kamu…?'\n2. 'Stop bikin ini…'\n3. '3 hal yang…'\n4. 'Cara cepat…'\n5. 'Ini yang nggak dibilang orang…'");
    insR.run(uid, "Referensi warna brand", "https://colorhunt.co", "Palet biru-ungu untuk feed konsisten");
    insR.run(uid, "Checklist sebelum posting", null, "✅ Caption rapi\n✅ Hashtag relevan\n✅ Jam tayang optimal\n✅ Thumbnail jelas");
    const insN = db.prepare("INSERT INTO notes (user_id,body) VALUES (?,?)");
    insN.run(uid, "Jangan lupa approval konten kampanye nursing sebelum Kamis.");
    insN.run(uid, "Coba jam posting 19.00 untuk TikTok minggu depan.");
    console.log("[seed] Data demo dimuat (5 tayang, 5 pipeline, kampanye, ide, resources, catatan).");
  }
}

