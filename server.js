const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const emptyDb = {
  users: {},
  posts: []
};

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    return { ...emptyDb };
  }
}

let db = readDb();
const sseClients = new Set();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendSse(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((res) => res.write(msg));
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, UPLOADS_DIR);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname);
      const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
      cb(null, `${Date.now()}_${safeName}${ext}`);
    }
  }),
  limits: {
    files: 9,
    fileSize: 1024 * 1024 * 500
  }
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(ROOT));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !db.users[token]) {
    return res.status(401).json({ message: '请先登录后发布。' });
  }
  req.user = db.users[token];
  next();
}

function visitorId(req) {
  return String(req.headers['x-visitor-id'] || req.ip || 'guest');
}

function postOut(post) {
  return {
    id: post.id,
    author: post.author,
    type: post.type,
    title: post.title,
    content: post.content,
    media: post.media,
    likes: Object.keys(post.likes || {}).length,
    comments: post.comments,
    viewCount: post.viewCount,
    views: post.views.slice(-20).reverse(),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  };
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  req.on('close', () => sseClients.delete(res));
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  if (username.length < 2) {
    return res.status(400).json({ message: '昵称至少 2 个字符。' });
  }
  const token = crypto.randomUUID();
  db.users[token] = {
    id: crypto.randomUUID(),
    username,
    createdAt: new Date().toISOString()
  };
  saveDb();
  res.json({ token, user: db.users[token] });
});

app.get('/api/posts', (req, res) => {
  res.json(db.posts.map(postOut));
});

app.post('/api/posts', auth, upload.array('media', 9), (req, res) => {
  const content = String(req.body.content || '').trim();
  const title = String(req.body.title || '').trim();
  const type = req.body.type === 'diary' ? 'diary' : 'moment';

  if (!content) {
    return res.status(400).json({ message: '内容不能为空。' });
  }

  const media = (req.files || []).map((f) => ({
    id: crypto.randomUUID(),
    originalName: f.originalname,
    mime: f.mimetype,
    size: f.size,
    kind: f.mimetype.startsWith('video') ? 'video' : 'image',
    url: `/uploads/${f.filename}`,
    downloadUrl: `/api/media/${f.filename}/download`
  }));

  const now = new Date().toISOString();
  const post = {
    id: crypto.randomUUID(),
    author: req.user.username,
    type,
    title: title || (type === 'diary' ? '我的日记' : '朋友圈动态'),
    content,
    media,
    likes: {},
    comments: [],
    viewCount: 0,
    views: [],
    createdAt: now,
    updatedAt: now
  };

  db.posts.unshift(post);
  saveDb();

  const out = postOut(post);
  sendSse('post', out);
  res.status(201).json(out);
});

app.get('/api/posts/:id', (req, res) => {
  const post = db.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ message: '动态不存在。' });

  const name = String(req.query.name || '').trim() || '游客';
  post.viewCount += 1;
  post.views.push({
    name,
    visitorId: visitorId(req),
    at: new Date().toISOString()
  });
  if (post.views.length > 200) post.views = post.views.slice(-200);
  post.updatedAt = new Date().toISOString();

  saveDb();
  const out = postOut(post);
  sendSse('view', { id: post.id, viewCount: post.viewCount });
  res.json(out);
});

app.post('/api/posts/:id/comments', (req, res) => {
  const post = db.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ message: '动态不存在。' });

  const content = String(req.body.content || '').trim();
  const nickname = String(req.body.nickname || '游客').trim() || '游客';
  if (!content) return res.status(400).json({ message: '评论不能为空。' });

  const comment = {
    id: crypto.randomUUID(),
    nickname,
    content,
    createdAt: new Date().toISOString()
  };
  post.comments.push(comment);
  post.updatedAt = new Date().toISOString();
  saveDb();

  sendSse('comment', { postId: post.id, comment });
  res.status(201).json(comment);
});

app.post('/api/posts/:id/likes', (req, res) => {
  const post = db.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ message: '动态不存在。' });

  const id = visitorId(req);
  if (post.likes[id]) {
    delete post.likes[id];
  } else {
    post.likes[id] = new Date().toISOString();
  }
  post.updatedAt = new Date().toISOString();
  saveDb();

  const likes = Object.keys(post.likes).length;
  sendSse('like', { postId: post.id, likes });
  res.json({ likes, liked: Boolean(post.likes[id]) });
});

app.get('/api/media/:name/download', (req, res) => {
  const file = path.join(UPLOADS_DIR, path.basename(req.params.name));
  if (!fs.existsSync(file)) {
    return res.status(404).json({ message: '文件不存在。' });
  }
  res.download(file);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`server ready on ${port}`);
});
