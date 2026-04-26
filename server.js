const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "server-data.json");
const INDEX_FILE = path.join(__dirname, "index.html");

function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    return { accounts: {}, profiles: {}, levels: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { accounts: {}, profiles: {}, levels: [] };
  }
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

function mergeDb(base, incoming) {
  const out = {
    accounts: { ...(base.accounts || {}) },
    profiles: { ...(base.profiles || {}) },
    levels: Array.isArray(base.levels) ? [...base.levels] : []
  };

  for (const [nick, pass] of Object.entries(incoming.accounts || {})) {
    if (!out.accounts[nick]) out.accounts[nick] = pass;
  }

  for (const [nick, p] of Object.entries(incoming.profiles || {})) {
    const prev = out.profiles[nick] || { points: 0, stars: 0, creatorPoints: 0, bestTimes: { easy: null, normal: null, hard: null } };
    out.profiles[nick] = {
      points: Math.max(prev.points || 0, p.points || 0),
      stars: Math.max(prev.stars || 0, p.stars || 0),
      creatorPoints: Math.max(prev.creatorPoints || 0, p.creatorPoints || 0),
      bestTimes: {
        easy: bestMin(prev.bestTimes?.easy, p.bestTimes?.easy),
        normal: bestMin(prev.bestTimes?.normal, p.bestTimes?.normal),
        hard: bestMin(prev.bestTimes?.hard, p.bestTimes?.hard)
      }
    };
  }

  const byId = new Map(out.levels.map((l) => [String(l.id), l]));
  for (const lv of incoming.levels || []) {
    const key = String(lv.id);
    if (!byId.has(key)) {
      out.levels.push(lv);
      byId.set(key, lv);
      continue;
    }
    const prev = byId.get(key);
    prev.views = Math.max(prev.views || 0, lv.views || 0);
    prev.likes = Math.max(prev.likes || 0, lv.likes || 0);
    prev.dislikes = Math.max(prev.dislikes || 0, lv.dislikes || 0);
    prev.published = prev.published || lv.published;
    prev.publishDate = prev.publishDate || lv.publishDate || null;
    prev.comments = dedupeComments([...(prev.comments || []), ...(lv.comments || [])]);
    prev.completedBy = dedupeStrings([...(prev.completedBy || []), ...(lv.completedBy || [])]);
    prev.starAwardedTo = dedupeStrings([...(prev.starAwardedTo || []), ...(lv.starAwardedTo || [])]);
    prev.likedBy = dedupeStrings([...(prev.likedBy || []), ...(lv.likedBy || [])]);
    prev.dislikedBy = dedupeStrings([...(prev.dislikedBy || []), ...(lv.dislikedBy || [])]);
  }
  return out;
}

function bestMin(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a ?? null;
  return Math.min(a, b);
}

function dedupeStrings(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function dedupeComments(arr) {
  const seen = new Set();
  const out = [];
  for (const c of arr) {
    const key = `${c.user || ""}|${c.text || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  if (req.url === "/api/shared" && req.method === "GET") {
    return sendJson(res, 200, readDb());
  }

  if (req.url === "/api/shared" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const incoming = parsed.data || {};
        const merged = mergeDb(readDb(), incoming);
        writeDb(merged);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: "invalid_json" });
      }
    });
    return;
  }

  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(INDEX_FILE));
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, () => {
  console.log(`MegaFuse server running at http://localhost:${PORT}`);
});
