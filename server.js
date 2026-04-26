const express = require('express');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// ========== 1. 安全防护配置 ==========
// 安全响应头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    }
  }
}));

// 限流：防止恶意请求
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 每个IP最多100个请求
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// 基础配置
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 限制JSON大小
app.use(express.static(__dirname));

// ========== 2. 文件上传配置（支持图片/视频） ==========
// 内存存储（Render免费实例本地文件不持久，用内存存储）
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 限制10MB
  },
  fileFilter: (req, file, cb) => {
    // 只允许图片和视频
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，仅支持图片/视频'), false);
    }
  }
});

// ========== 3. 数据存储 ==========
let posts = [];
let postId = 1;
// 点赞记录：{ postId: { ip: true } }，防止重复点赞
const likeRecords = {};
// 浏览记录：{ postId: [{ time, ip }] }
const viewRecords = {};
// 在线用户（SSE连接）
const clients = new Set();

// ========== 4. 工具函数 ==========
// 输入清洗，防止XSS
const sanitize = (str) => {
  return str.replace(/[&<>"']/g, (char) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[char];
  });
};

// 获取用户IP（简化版，用于防重复点赞）
const getUserIp = (req) => {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
};

// SSE推送更新
const broadcastUpdate = (type, data) => {
  const message = `data: ${JSON.stringify({ type, data })}\n\n`;
  clients.forEach(client => {
    client.write(message);
  });
};

// ========== 5. 接口实现 ==========
// 首页
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// SSE实时更新接口
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.add(res);

  // 客户端断开连接时移除
  req.on('close', () => {
    clients.delete(res);
  });
});

// 获取所有动态（带浏览记录和点赞数）
app.get('/api/posts', (req, res) => {
  const formattedPosts = posts.map(p => ({
    ...p,
    viewCount: viewRecords[p.id]?.length || 0,
    viewRecords: viewRecords[p.id] || [], // 公共浏览记录
    likeCount: Object.keys(likeRecords[p.id] || {}).length
  })).sort((a, b) => b.createTime - a.createTime);
  
  res.json({ code: 200, data: formattedPosts });
});

// 发布动态（带文件上传，仅登录用户）
app.post('/api/posts', upload.single('media'), (req, res) => {
  const { nickname, content, token } = req.body;
  // 简单登录校验：token不为空即视为登录用户（前端登录时生成）
  if (!token) {
    return res.json({ code: 401, msg: '请先登录后再发布' });
  }

  // 输入清洗
  const safeContent = sanitize(content || '');
  const safeNickname = sanitize(nickname || '匿名用户');

  // 处理文件（图片/视频）
  let media = null;
  if (req.file) {
    // 转base64，用于前端显示和下载（内存存储，不保存文件）
    const mimeType = req.file.mimetype;
    const base64 = req.file.buffer.toString('base64');
    media = {
      type: mimeType,
      data: `data:${mimeType};base64,${base64}`,
      name: req.file.originalname
    };
  }

  const newPost = {
    id: postId++,
    nickname: safeNickname,
    content: safeContent,
    media, // 图片/视频数据
    comments: [],
    createTime: Date.now()
  };

  posts.unshift(newPost);
  // 初始化点赞和浏览记录
  likeRecords[newPost.id] = {};
  viewRecords[newPost.id] = [];

  // 推送新动态更新
  broadcastUpdate('newPost', newPost);

  res.json({ code: 200, msg: '发布成功', data: newPost });
});

// 游客评论（无需登录）
app.post('/api/posts/:id/comment', (req, res) => {
  const postId = parseInt(req.params.id);
  const { nickname, content } = req.body;
  const post = posts.find(p => p.id === postId);

  if (!post) return res.json({ code: 404, msg: '动态不存在' });
  if (!content) return res.json({ code: 400, msg: '评论内容不能为空' });

  // 输入清洗
  const safeNickname = sanitize(nickname || '匿名用户');
  const safeContent = sanitize(content);

  const newComment = {
    id: post.comments.length + 1,
    nickname: safeNickname,
    content: safeContent,
    time: Date.now()
  };

  post.comments.push(newComment);

  // 推送评论更新
  broadcastUpdate('newComment', { postId, comment: newComment });

  res.json({ code: 200, msg: '评论成功', data: newComment });
});

// 点赞功能（每个游客仅一次）
app.post('/api/posts/:id/like', (req, res) => {
  const postId = parseInt(req.params.id);
  const userIp = getUserIp(req);
  const post = posts.find(p => p.id === postId);

  if (!post) return res.json({ code: 404, msg: '动态不存在' });

  // 检查是否已经点赞
  if (likeRecords[postId][userIp]) {
    return res.json({ code: 400, msg: '您已经点过赞了' });
  }

  // 记录点赞
  likeRecords[postId][userIp] = true;
  const likeCount = Object.keys(likeRecords[postId]).length;

  // 推送点赞更新
  broadcastUpdate('likeUpdate', { postId, likeCount });

  res.json({ code: 200, msg: '点赞成功', data: { likeCount } });
});

// 浏览量统计（每次访问+1，记录公共浏览记录）
app.post('/api/posts/:id/view', (req, res) => {
  const postId = parseInt(req.params.id);
  const userIp = getUserIp(req);
  const post = posts.find(p => p.id === postId);

  if (!post) return res.json({ code: 404, msg: '动态不存在' });

  // 添加浏览记录（去重，同一个IP短时间内多次访问不重复记录）
  const recentViews = viewRecords[postId].filter(v => 
    v.ip === userIp && Date.now() - v.time < 60 * 1000 // 1分钟内不重复记录
  );
  if (recentViews.length === 0) {
    viewRecords[postId].push({
      time: Date.now(),
      ip: userIp.split(':').pop() // 简化IP显示，保护隐私
    });
  }

  const viewCount = viewRecords[postId].length;

  // 推送浏览更新
  broadcastUpdate('viewUpdate', { postId, viewCount });

  res.json({ code: 200, data: { viewCount } });
});

// 登录接口（简单版，生成临时token）
app.post('/api/login', (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.json({ code: 400, msg: '请输入昵称' });

  // 生成简单token（实际生产环境建议用JWT）
  const token = uuidv4();
  res.json({ code: 200, msg: '登录成功', data: { token, nickname } });
});

// 启动服务器
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Render 服务器启动成功！端口：${port}`);
});
