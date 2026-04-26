const express = require('express');
const cors = require('cors');
const app = express();

// 基础配置
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 纯内存数据（无任何文件操作，绝对不报错）
let posts = [];
let postId = 1;

// 首页
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 获取动态
app.get('/api/posts', (req, res) => {
  res.json({ code: 200, data: posts.sort((a, b) => b.createTime - a.createTime) });
});

// 发布动态
app.post('/api/posts', (req, res) => {
  const { nickname, content } = req.body;
  if (!content) return res.json({ code: 400, msg: '内容不能为空' });
  
  const newPost = {
    id: postId++,
    nickname: nickname || '匿名用户',
    content,
    like: 0,
    view: 0,
    comments: [],
    createTime: Date.now()
  };
  posts.unshift(newPost);
  res.json({ code: 200, msg: '发布成功' });
});

// 点赞
app.post('/api/posts/:id/like', (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  if (post) post.like++;
  res.json({ code: 200 });
});

// 浏览量
app.post('/api/posts/:id/view', (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  if (post) post.view++;
  res.json({ code: 200 });
});

// 评论
app.post('/api/posts/:id/comment', (req, res) => {
  const post = posts.find(p => p.id == req.params.id);
  const { nickname, content } = req.body;
  if (!post || !content) return res.json({ code: 400 });
  
  post.comments.push({
    nickname: nickname || '匿名',
    content,
    time: Date.now()
  });
  res.json({ code: 200 });
});

// ========== Render 必须的启动配置 ==========
// 读取 Render 自动分配的端口
const port = process.env.PORT || 3000;
// 监听 0.0.0.0（Render 强制要求，不能只监听 localhost）
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Render 服务器启动成功！端口：${port}`);
});

// 兼容 Vercel（不影响 Render）
module.exports = app;
