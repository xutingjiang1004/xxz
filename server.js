const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true,
  },
});

const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');
const dbFile = path.join(dataDir, 'db.json');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

function defaultDB() {
  return {
    users: [],
    posts: [],
    publicVisits: [],
    likeKeys: {},
    counters: {
      siteVisits: 0,
    },
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(dbFile)) {
      const initial = defaultDB();
      initial.users.push({
        id: randomUUID(),
        username: ADMIN_USERNAME,
        passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
        role: 'admin',
        banned: false,
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(dbFile, JSON.stringify(initial, null, 2));
      return initial;
    }

    const raw = fs.readFileSync(dbFile, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed.likeKeys) parsed.likeKeys = {};
    if (!parsed.counters) parsed.counters = { siteVisits: 0 };
    if (!Array.isArray(parsed.publicVisits)) parsed.publicVisits = [];
    if (!Array.isArray(parsed.posts)) parsed.posts = [];
    if (!Array.isArray(parsed.users)) parsed.users = [];

    return parsed;
  } catch (error) {
    const fallback = defaultDB();
    fallback.users.push({
      id: randomUUID(),
      username: ADMIN_USERNAME,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: 'admin',
      banned: false,
      createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(dbFile, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function ensureAdminExists() {
  const hasAdmin = db.users.some((u) => u.role === 'admin' && u.username === ADMIN_USERNAME);
  if (!hasAdmin) {
    db.users.push({
      id: randomUUID(),
      username: ADMIN_USERNAME,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: 'admin',
      banned: false,
      createdAt: new Date().toISOString(),
    });
    saveDB();
  }
}
ensureAdminExists();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })
);

function sanitizeText(input, maxLen = 5000) {
  return String(input ?? '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/[<>]/g, '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLen);
}

function allowedFile(file) {
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
  return [...imageTypes, ...videoTypes].includes(file.mimetype);
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const safeBase = path
      .parse(file.originalname)
      .name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
      .slice(0, 40) || 'file';

    const ext = path.extname(file.originalname).toLowerCase() || '';
    cb(null, `${Date.now()}-${randomUUID()}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!allowedFile(file)) {
      return cb(new Error('只允许图片或视频文件'));
    }
    cb(null, true);
  },
});

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: '缺少登录令牌' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((u) => u.id === payload.id);
    if (!user) {
      return res.status(401).json({ message: '账号不存在' });
    }
    if (user.banned) {
      return res.status(403).json({ message: '账号已被封禁' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: '令牌无效或已过期' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '仅管理员可用' });
    }
    next();
  });
}

function findPost(postId) {
  return db.posts.find((post) => post.id === postId);
}

function publicPostView(post) {
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
    text: post.text,
    fileUrl: post.fileUrl,
    originalName: post.originalName,
    mimeType: post.mimeType,
    fileSize: post.fileSize,
    createdAt: post.createdAt,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
  };
}

function emitStats() {
  io.emit('stats:update', {
    siteVisits: db.counters.siteVisits,
    onlineUsers: io.engine.clientsCount,
    latestVisits: db.publicVisits.slice(0, 30),
  });
}

function emitPosts() {
  io.emit('posts:update', db.posts.map(publicPostView));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/public/visit', (req, res) => {
  const guestId = sanitizeText(req.body.guestId, 120);
  const pathName = sanitizeText(req.body.path, 200) || '/';
  const visitor = sanitizeText(req.body.visitor, 80) || '游客';

  db.counters.siteVisits += 1;
  db.publicVisits.unshift({
    id: randomUUID(),
    guestId,
    visitor,
    path: pathName,
    time: new Date().toISOString(),
  });
  db.publicVisits = db.publicVisits.slice(0, 50);

  saveDB();
  emitStats();

  res.json({ ok: true, siteVisits: db.counters.siteVisits });
});

app.get('/api/public/stats', (req, res) => {
  res.json({
    siteVisits: db.counters.siteVisits,
    onlineUsers: io.engine.clientsCount,
    latestVisits: db.publicVisits,
  });
});

app.post(
  '/api/auth/register',
  rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }),
  async (req, res) => {
    const username = sanitizeText(req.body.username, 30);
    const password = String(req.body.password || '');

    if (username.length < 2) {
      return res.status(400).json({ message: '用户名至少2个字' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少6位' });
    }
    if (db.users.some((u) => u.username === username)) {
      return res.status(409).json({ message: '用户名已存在' });
    }

    const user = {
      id: randomUUID(),
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'user',
      banned: false,
      createdAt: new Date().toISOString(),
    };

    db.users.push(user);
    saveDB();

    const token = createToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }
);

app.post(
  '/api/auth/login',
  rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }),
  async (req, res) => {
    const username = sanitizeText(req.body.username, 30);
    const password = String(req.body.password || '');
    const user = db.users.find((u) => u.username === username);

    if (!user) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }
    if (user.banned) {
      return res.status(403).json({ message: '账号已被封禁' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    const token = createToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }
);

app.get('/api/auth/me', requireAuth, (req, res) => {
  const { id, username, role, createdAt, banned } = req.user;
  res.json({ id, username, role, createdAt, banned });
});

app.get('/api/posts', (req, res) => {
  res.json(db.posts.map(publicPostView));
});

app.post(
  '/api/posts',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false }),
  upload.single('file'),
  (req, res) => {
    const text = sanitizeText(req.body.text, 3000);
    const file = req.file;

    if (!text && !file) {
      return res.status(400).json({ message: '至少要有文字或文件其中一个' });
    }

    let fileUrl = '';
    let originalName = '';
    let mimeType = '';
    let fileSize = 0;

    if (file) {
      fileUrl = `/uploads/${file.filename}`;
      originalName = file.originalname;
      mimeType = file.mimetype;
      fileSize = file.size;
    }

    const post = {
      id: randomUUID(),
      authorId: req.user.id,
      authorName: req.user.username,
      text,
      fileUrl,
      originalName,
      mimeType,
      fileSize,
      createdAt: new Date().toISOString(),
      views: 0,
      likes: 0,
      comments: [],
    };

    db.posts.unshift(post);
    saveDB();
    io.emit('post:new', publicPostView(post));
    emitPosts();

    res.status(201).json(publicPostView(post));
  }
);

app.post('/api/posts/:id/view', (req, res) => {
  const post = findPost(req.params.id);
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  post.views += 1;
  saveDB();
  io.emit('post:view', { id: post.id, views: post.views });
  emitPosts();

  res.json({ ok: true, views: post.views });
});

app.post(
  '/api/posts/:id/like',
  rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }),
  (req, res) => {
    const post = findPost(req.params.id);
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    const guestId = sanitizeText(req.body.guestId || req.headers['x-guest-id'], 120);
    if (!guestId) {
      return res.status(400).json({ message: '缺少游客标识' });
    }

    const likeKey = `${guestId}:${post.id}`;
    if (db.likeKeys[likeKey]) {
      return res.json({ ok: true, alreadyLiked: true, likes: post.likes });
    }

    db.likeKeys[likeKey] = true;
    post.likes += 1;
    saveDB();

    io.emit('post:like', { id: post.id, likes: post.likes });
    emitPosts();

    res.json({ ok: true, likes: post.likes });
  }
);

app.post(
  '/api/posts/:id/comments',
  rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false }),
  (req, res) => {
    const post = findPost(req.params.id);
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    const text = sanitizeText(req.body.text, 500);
    const nickname = sanitizeText(req.body.nickname, 20);
    const guestId = sanitizeText(req.body.guestId || req.headers['x-guest-id'] || '', 120);

    if (!text) {
      return res.status(400).json({ message: '评论不能为空' });
    }

    const comment = {
      id: randomUUID(),
      nickname: nickname || (guestId ? `游客${guestId.slice(-4)}` : '游客'),
      text,
      guestId,
      createdAt: new Date().toISOString(),
    };

    post.comments.unshift(comment);
    saveDB();

    io.emit('comment:new', { postId: post.id, comment });
    emitPosts();

    res.status(201).json(comment);
  }
);

app.get('/api/posts/:id/download', (req, res) => {
  const post = findPost(req.params.id);
  if (!post || !post.fileUrl) {
    return res.status(404).json({ message: '文件不存在' });
  }

  const filePath = path.join(uploadDir, path.basename(post.fileUrl));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: '文件已丢失' });
  }

  const downloadName = post.originalName || path.basename(filePath);
  return res.download(filePath, downloadName);
});

app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
  const index = db.posts.findIndex((post) => post.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  const [removed] = db.posts.splice(index, 1);
  saveDB();

  io.emit('post:delete', { id: removed.id });
  emitPosts();

  res.json({ ok: true });
});

app.delete('/api/admin/comments/:postId/:commentId', requireAdmin, (req, res) => {
  const post = findPost(req.params.postId);
  if (!post) {
    return res.status(404).json({ message: '帖子不存在' });
  }

  const index = post.comments.findIndex((comment) => comment.id === req.params.commentId);
  if (index === -1) {
    return res.status(404).json({ message: '评论不存在' });
  }

  post.comments.splice(index, 1);
  saveDB();

  io.emit('comment:delete', { postId: post.id, commentId: req.params.commentId });
  emitPosts();

  res.json({ ok: true });
});

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  res.json({
    users: db.users.map(({ passwordHash, ...safe }) => safe),
    posts: db.posts.map(publicPostView),
    siteVisits: db.counters.siteVisits,
    latestVisits: db.publicVisits,
    onlineUsers: io.engine.clientsCount,
  });
});

app.post('/api/admin/ban/:userId', requireAdmin, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.userId);
  if (!user) {
    return res.status(404).json({ message: '用户不存在' });
  }
  if (user.role === 'admin') {
    return res.status(400).json({ message: '不能封禁管理员' });
  }

  user.banned = !user.banned;
  saveDB();

  io.emit('admin:update', { type: 'ban', userId: user.id, banned: user.banned });
  res.json({ ok: true, banned: user.banned });
});

app.get('/api/admin/visits', requireAdmin, (req, res) => {
  res.json({
    siteVisits: db.counters.siteVisits,
    latestVisits: db.publicVisits,
  });
});

app.use(
  '/uploads',
  express.static(uploadDir, {
    setHeaders(res) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);

app.use((err, req, res, next) => {
  const message = err && err.message ? err.message : '服务器出错';
  res.status(400).json({ message });
});

io.on('connection', (socket) => {
  socket.emit('stats:update', {
    siteVisits: db.counters.siteVisits,
    onlineUsers: io.engine.clientsCount,
    latestVisits: db.publicVisits.slice(0, 30),
  });
  socket.emit('posts:update', db.posts.map(publicPostView));
});

setInterval(() => {
  emitStats();
}, 15000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
