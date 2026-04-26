// 引入依赖
const express = require('express');
const cors = require('cors');
const path = require('path');

// 创建服务实例
const app = express();
// 关键修复：Vercel会自动分配端口，不能写死3000！
const port = process.env.PORT || 3000;

// 基础配置
app.use(cors());
app.use(express.json());
// 强制指定：网站的页面文件就在当前文件夹
app.use(express.static(__dirname));

// 关键修复：显式处理网站根路径，解决Cannot GET /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 测试前后端互联的接口
app.get('/api/hello', (req, res) => {
  res.json({ 
    code: 200,
    message: "🎉 恭喜你！前后端互联成功！这是后端返回的消息" 
  });
});

// 兜底：所有没匹配到的路径，都返回首页，避免404
app.all('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 关键修复：Vercel要求必须监听0.0.0.0，否则服务启动失败
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ 服务已启动，运行端口：${port}`);
});
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || 'local-dev';

// 纯内存数据（Serverless 实例重启会丢失，属预期）
const store = {
  users: {},
  posts: []
};

const sseClients = new Set();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function broadcast(event, payload) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((res) => res.write(chunk));
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !store.users[token]) {
    return res.status(401).json({ message: '请先登录后发布。' });
  }
  req.user = store.users[token];
  next();
}

function postView(post) {
  return {
    id: post.id,
    author: post.author,
    content: post.content,
    createdAt: post.createdAt,
    likes: Object.keys(post.likes).length,
    comments: post.comments,
    viewCount: post.viewCount,
    recentViewers: post.viewers.slice(-8).reverse()
  };
}

app.get('/api/stream', (req, res) => {
  // 统一关闭 SSE，前端改为轮询，避免 Serverless 长连接导致 5xx
  res.status(204).end();
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  if (username.length < 2) {
    return res.status(400).json({ message: '昵称至少2个字符。' });
  }

  const token = crypto.randomUUID();
  store.users[token] = {
    id: crypto.randomUUID(),
    username,
    loginAt: new Date().toISOString()
  };

  res.json({ token, user: store.users[token] });
});

app.get('/api/posts', (req, res) => {
  res.json(store.posts.map(postView));
});

app.post('/api/posts', auth, (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) {
    return res.status(400).json({ message: '动态内容不能为空。' });
  }

  const post = {
    id: crypto.randomUUID(),
    author: req.user.username,
    content,
    createdAt: new Date().toISOString(),
    likes: {},
    comments: [],
    viewCount: 0,
    viewers: []
  };

  store.posts.unshift(post);
  const payload = postView(post);
  broadcast('post', payload);
  res.status(201).json(payload);
});

app.get('/api/posts/:id', (req, res) => {
  const post = store.posts.find((item) => item.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: '动态不存在。' });
  }

  const viewer = String(req.query.name || '游客').trim() || '游客';
  post.viewCount += 1;
  post.viewers.push({ viewer, at: new Date().toISOString() });
  if (post.viewers.length > 100) {
    post.viewers = post.viewers.slice(-100);
  }

  const payload = postView(post);
  broadcast('view', { id: post.id, viewCount: post.viewCount });
  res.json(payload);
});

app.post('/api/posts/:id/comments', (req, res) => {
  const post = store.posts.find((item) => item.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: '动态不存在。' });
  }

  const nickname = String(req.body.nickname || '游客').trim() || '游客';
  const content = String(req.body.content || '').trim();
  if (!content) {
    return res.status(400).json({ message: '评论不能为空。' });
  }

  const comment = {
    id: crypto.randomUUID(),
    nickname,
    content,
    createdAt: new Date().toISOString()
  };
  post.comments.push(comment);

  broadcast('comment', { postId: post.id, comment });
  res.status(201).json(comment);
});

app.post('/api/posts/:id/likes', (req, res) => {
  const post = store.posts.find((item) => item.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: '动态不存在。' });
  }

  const visitorId = String(req.headers['x-visitor-id'] || req.ip || 'guest');
  if (post.likes[visitorId]) {
    delete post.likes[visitorId];
  } else {
    post.likes[visitorId] = true;
  }

  const likes = Object.keys(post.likes).length;
  broadcast('like', { postId: post.id, likes });
  res.json({ likes, liked: Boolean(post.likes[visitorId]) });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, storage: 'memory', version: APP_VERSION, ts: new Date().toISOString() });
});

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


app.use((err, req, res, next) => {
  console.error('server error:', err);
  res.status(500).json({ message: '服务内部错误', version: APP_VERSION });
});

if (process.env.VERCEL !== '1') {
  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`server ready on ${port}`);
  });
}

module.exports = app;
