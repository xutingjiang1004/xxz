const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SECRET = process.env.APP_SECRET || "moments-secure-demo";
const sseClients = new Set();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], posts: [], logs: [] }, null, 2));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm"
};

const limiter = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const bucket = limiter.get(ip) || [];
  const recent = bucket.filter((t) => now - t < 60_000);
  recent.push(now);
  limiter.set(ip, recent);
  return recent.length <= 180;
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function send(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self';"
  });
  res.end(JSON.stringify(payload));
}

function broadcast(event, payload = {}) {
  const body = `event: ${event}\ndata: ${JSON.stringify({ event, ...payload, ts: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(body);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sanitize(text, max = 500) {
  return String(text || "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 30 * 1024 * 1024) {
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", () => reject(new Error("读取失败")));
  });
}

function hashPassword(password, salt = crypto.randomBytes(8).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, digest) {
  const [salt] = String(digest).split(":");
  return hashPassword(password, salt) === digest;
}

function signToken(username) {
  const exp = Date.now() + 7 * 24 * 3600_000;
  const raw = `${username}|${exp}`;
  const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  return Buffer.from(`${raw}|${sig}`).toString("base64url");
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const [username, exp, sig] = Buffer.from(token, "base64url").toString("utf8").split("|");
    const raw = `${username}|${exp}`;
    const expected = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    if (sig !== expected) return null;
    if (Date.now() > Number(exp)) return null;
    return username;
  } catch {
    return null;
  }
}

function requireAuth(req) {
  const bearer = (req.headers.authorization || "").replace("Bearer ", "");
  return verifyToken(bearer);
}

function saveMedia(media) {
  if (!media || !media.base64) return null;
  const type = String(media.type || "");
  const kind = type.startsWith("video/") ? "video" : type.startsWith("image/") ? "image" : null;
  if (!kind) throw new Error("仅支持图片或视频");

  const maxBytes = kind === "video" ? 200 * 1024 * 1024 : 25 * 1024 * 1024;
  const buffer = Buffer.from(media.base64, "base64");
  if (!buffer.length || buffer.length > maxBytes) {
    throw new Error(`文件大小不合法，${kind === "video" ? "视频" : "图片"}大小超限`);
  }

  const safeName = sanitize(media.name || `${Date.now()}`, 80).replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = path.extname(safeName) || (kind === "video" ? ".mp4" : ".jpg");
  const fileName = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return {
    kind,
    name: safeName,
    size: buffer.length,
    type,
    fileName,
    url: `/uploads/${fileName}`
  };
}

function serveStatic(req, res, pathname) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const file = path.join(ROOT, path.normalize(target));
  if (!file.startsWith(ROOT)) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      send(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!rateLimit(ip)) {
    send(res, 429, { error: "请求过于频繁，请稍后再试" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  try {
    if (pathname === "/api/login" && req.method === "POST") {
      const { username, password } = await parseBody(req);
      const user = sanitize(username, 24);
      const pass = String(password || "");
      if (!user || pass.length < 4) {
        send(res, 400, { error: "用户名或密码不合法" });
        return;
      }
      const db = readDB();
      let existing = db.users.find((u) => u.username === user);
      if (!existing) {
        existing = { username: user, digest: hashPassword(pass), createdAt: new Date().toISOString() };
        db.users.push(existing);
        writeDB(db);
      } else if (!verifyPassword(pass, existing.digest)) {
        send(res, 401, { error: "密码错误" });
        return;
      }
      send(res, 200, { username: user, token: signToken(user) });
      return;
    }

    if (pathname === "/api/posts" && req.method === "GET") {
      const db = readDB();
      const posts = db.posts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      send(res, 200, { posts, logs: db.logs.slice(-30).reverse() });
      return;
    }

    if (pathname === "/healthz" && req.method === "GET") {
      send(res, 200, { ok: true, uptime: process.uptime() });
      return;
    }

    if (pathname === "/api/stream" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write(`event: connected\ndata: {"ok":true}\n\n`);
      sseClients.add(res);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    if (pathname === "/api/posts" && req.method === "POST") {
      const username = requireAuth(req);
      if (!username) {
        send(res, 401, { error: "请先登录" });
        return;
      }
      const { title, content, media } = await parseBody(req);
      const safeTitle = sanitize(title, 60);
      const safeContent = sanitize(content, 500);
      if (!safeTitle || !safeContent) {
        send(res, 400, { error: "标题和内容不能为空" });
        return;
      }
      const db = readDB();
      const mediaInfo = media ? saveMedia(media) : null;
      db.posts.push({
        id: crypto.randomUUID(),
        title: safeTitle,
        content: safeContent,
        author: username,
        media: mediaInfo,
        likes: 0,
        likedBy: [],
        views: 0,
        viewedBy: [],
        comments: [],
        createdAt: new Date().toISOString()
      });
      writeDB(db);
      broadcast("post_created", { author: username, title: safeTitle });
      send(res, 200, { ok: true });
      return;
    }

    const idMatch = pathname.match(/^\/api\/posts\/([a-zA-Z0-9-]+)\/(comments|like|view|download)$/);
    if (idMatch) {
      const [, postId, action] = idMatch;
      const db = readDB();
      const post = db.posts.find((p) => p.id === postId);
      if (!post) {
        send(res, 404, { error: "作品不存在" });
        return;
      }

      if (action === "download" && req.method === "GET") {
        if (!post.media?.fileName) {
          send(res, 404, { error: "没有可下载文件" });
          return;
        }
        const file = path.join(UPLOAD_DIR, post.media.fileName);
        if (!fs.existsSync(file)) {
          send(res, 404, { error: "文件不存在" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": post.media.type || "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(post.media.name || post.media.fileName)}`,
          "X-Content-Type-Options": "nosniff"
        });
        fs.createReadStream(file).pipe(res);
        return;
      }

      if (action === "comments" && req.method === "POST") {
        const { guest, text } = await parseBody(req);
        const safeGuest = sanitize(guest || "游客", 20) || "游客";
        const safeText = sanitize(text, 120);
        if (!safeText) {
          send(res, 400, { error: "评论不能为空" });
          return;
        }
        post.comments.push({ guest: safeGuest, text: safeText, time: new Date().toISOString() });
        writeDB(db);
        broadcast("comment_created", { postId, guest: safeGuest });
        send(res, 200, { ok: true });
        return;
      }

      if (action === "like" && req.method === "POST") {
        const { guest } = await parseBody(req);
        const safeGuest = sanitize(guest || "游客", 20);
        if (!safeGuest) {
          send(res, 400, { error: "访客标识无效" });
          return;
        }
        if (!post.likedBy.includes(safeGuest)) {
          post.likedBy.push(safeGuest);
          post.likes += 1;
          writeDB(db);
          broadcast("post_liked", { postId, guest: safeGuest, likes: post.likes });
        }
        send(res, 200, { ok: true, likes: post.likes });
        return;
      }

      if (action === "view" && req.method === "POST") {
        const { guest } = await parseBody(req);
        const safeGuest = sanitize(guest || "游客", 20);
        if (!safeGuest) {
          send(res, 400, { error: "访客标识无效" });
          return;
        }
        if (!post.viewedBy.includes(safeGuest)) {
          post.viewedBy.push(safeGuest);
          post.views += 1;
          db.logs.push({
            postId: post.id,
            postTitle: post.title,
            guest: safeGuest,
            time: new Date().toISOString()
          });
          db.logs = db.logs.slice(-200);
          writeDB(db);
          broadcast("post_viewed", { postId, guest: safeGuest, views: post.views });
        }
        send(res, 200, { ok: true, views: post.views });
        return;
      }
    }

    if (pathname.startsWith("/uploads/")) {
      const file = path.join(UPLOAD_DIR, path.basename(pathname));
      if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) {
        send(res, 404, { error: "not found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    send(res, 500, { error: err.message || "服务器异常" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Moments Secure running: http://localhost:${PORT}`);
});
