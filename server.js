// 引入依赖
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const sanitizeHtml = require('sanitize-html');

// 创建必要文件夹
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// 应用实例
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// ==================== 安全中间件 ====================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"]
    }
  }
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: '请求过于频繁，请稍后再试'
});
app.use(limiter);

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: '上传过于频繁，请稍后再试'
});

// ==================== 文件上传配置 ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/', 'video/'];
    if (allowedTypes.some(t => file.mimetype.startsWith(t))) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片和视频文件'));
    }
  }
});

// ==================== 基础中间件 ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// ==================== 内存数据库 ====================
let db = {
  users: [
    { id: 1, username: 'admin', password: '123456', nickname: '管理员', avatar: '', createdAt: new Date() },
    { id: 2, username: 'user', password: '123456', nickname: '普通用户', avatar: '', createdAt: new Date() }
  ],
  posts: [],
  comments: [],
  likes: [], // { postId, visitorId }
  views: [], // { postId, visitorId }
  viewCounts: {}, // postId -> count
  tokens: {}
};

// ==================== 工具函数 ====================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function generateToken(username) {
  const str = `${username}:${Date.now()}:secret`;
  return crypto.createHash('sha256').update(str).digest('hex');
}

function sanitize(text) {
  return sanitizeHtml(text || '', {
    allowedTags: [],
    allowedAttributes: {}
  });
}

function getVisitorId(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || 'unknown';
  return crypto.createHash('md5').update(ip + ua).digest('hex');
}

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ==================== WebSocket ====================
wss.on('connection', (ws) => {
  console.log('新客户端连接');
  ws.on('close', () => console.log('客户端断开连接'));
});

// ==================== 登录接口 ====================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.json({ code: 400, message: '用户名和密码不能为空' });
  }
  const user = db.users.find(u => u.username === username && u.password === password);
  if (user) {
    const token = generateToken(user.username);
    db.tokens[token] = user;
    res.json({
      code: 200,
      message: '登录成功',
      token: token,
      user: { id: user.id, username: user.username, nickname: user.nickname }
    });
  } else {
    res.json({ code: 401, message: '用户名或密码错误' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    delete db.tokens[token];
  }
  res.json({ code: 200, message: '退出成功' });
});

app.get('/api/check-login', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = db.tokens[token];
  if (user) {
    res.json({ code: 200, isLogin: true, user: { id: user.id, username: user.username, nickname: user.nickname } });
  } else {
    res.json({ code: 200, isLogin: false });
  }
});

// ==================== 作品接口 ====================
app.get('/api/posts', (req, res) => {
  const posts = db.posts.map(p => ({
    ...p,
    comments: db.comments.filter(c => c.postId === p.id),
    likeCount: db.likes.filter(l => l.postId === p.id).length,
    viewCount: db.viewCounts[p.id] || 0
  })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ code: 200, data: posts });
});

app.post('/api/posts', uploadLimiter, upload.array('files', 10), (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = db.tokens[token];
  if (!user) {
    return res.json({ code: 401, message: '请先登录' });
  }
  const { title, content } = req.body;
  if (!title && !content && !req.files?.length) {
    return res.json({ code: 400, message: '请至少填写标题、内容或上传文件' });
  }
  const post = {
    id: generateId(),
    title: sanitize(title),
    content: sanitize(content),
    files: (req.files || []).map(f => ({
      path: '/uploads/' + f.filename,
      originalName: sanitize(f.originalname),
      mimetype: f.mimetype,
      size: f.size
    })),
    userId: user.id,
    username: user.nickname,
    createdAt: new Date().toISOString()
  };
  db.posts.unshift(post);
  db.viewCounts[post.id] = 0;
  broadcast({ type: 'newPost', data: post });
  res.json({ code: 200, message: '发布成功', data: post });
});

// ==================== 评论接口 ====================
app.post('/api/posts/:id/comments', (req, res) => {
  const { id } = req.params;
  const { content, guestName } = req.body;
  if (!content) {
    return res.json({ code: 400, message: '评论内容不能为空' });
  }
  const post = db.posts.find(p => p.id === id);
  if (!post) {
    return res.json({ code: 404, message: '作品不存在' });
  }
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = db.tokens[token];
  const visitorId = getVisitorId(req);
  const comment = {
    id: generateId(),
    postId: id,
    content: sanitize(content),
    userId: user?.id || null,
    username: user?.nickname || sanitize(guestName) || '游客',
    visitorId: user ? null : visitorId,
    createdAt: new Date().toISOString()
  };
  db.comments.push(comment);
  broadcast({ type: 'newComment', data: { postId: id, comment } });
  res.json({ code: 200, message: '评论成功', data: comment });
});

// ==================== 点赞接口 ====================
app.post('/api/posts/:id/like', (req, res) => {
  const { id } = req.params;
  const post = db.posts.find(p => p.id === id);
  if (!post) {
    return res.json({ code: 404, message: '作品不存在' });
  }
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = db.tokens[token];
  const visitorId = getVisitorId(req);
  const uniqueId = user?.id || visitorId;
  const existingLike = db.likes.find(l => l.postId === id && l.visitorId === uniqueId);
  let isLiked;
  if (existingLike) {
    db.likes = db.likes.filter(l => !(l.postId === id && l.visitorId === uniqueId));
    isLiked = false;
  } else {
    db.likes.push({ postId: id, visitorId: uniqueId });
    isLiked = true;
  }
  const likeCount = db.likes.filter(l => l.postId === id).length;
  broadcast({ type: 'likeUpdate', data: { postId: id, likeCount, isLiked } });
  res.json({ code: 200, data: { likeCount, isLiked } });
});

// ==================== 浏览接口 ====================
app.post('/api/posts/:id/view', (req, res) => {
  const { id } = req.params;
  const post = db.posts.find(p => p.id === id);
  if (!post) {
    return res.json({ code: 404, message: '作品不存在' });
  }
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = db.tokens[token];
  const visitorId = getVisitorId(req);
  const uniqueId = user?.id || visitorId;
  const existingView = db.views.find(v => v.postId === id && v.visitorId === uniqueId);
  if (!existingView) {
    db.views.push({ postId: id, visitorId: uniqueId });
    db.viewCounts[id] = (db.viewCounts[id] || 0) + 1;
    broadcast({ type: 'viewUpdate', data: { postId: id, viewCount: db.viewCounts[id] } });
  }
  res.json({ code: 200, data: { viewCount: db.viewCounts[id] || 0 } });
});

// ==================== 下载接口 ====================
app.get('/api/download/*', (req, res) => {
  const filePath = req.params[0];
  const fullPath = path.join(__dirname, filePath);
  const post = db.posts.find(p => p.files?.some(f => f.path === '/' + filePath));
  if (!post) {
    return res.status(404).json({ code: 404, message: '文件不存在' });
  }
  res.download(fullPath, path.basename(fullPath));
});

// ==================== 网站路由 ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.all('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ==================== 启动服务 ====================
server.listen(port, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log(`✅ 服务已启动，运行端口：${port}`);
  console.log(`📌 访问地址：http://localhost:${port}`);
  console.log(`📌 管理员账号：admin / 123456`);
  console.log(`📌 普通用户账号：user / 123456`);
  console.log('='.repeat(50));
});
