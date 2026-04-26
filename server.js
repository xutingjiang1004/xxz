// 引入依赖（仅保留Vercel兼容的包）
const express = require('express');
const cors = require('cors');

// 创建服务实例
const app = express();
const port = process.env.PORT || 3000;

// 基础配置
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ========== 纯内存存储（完全兼容Vercel，无本地文件操作） ==========
// 重启服务后数据会清空，仅做功能演示
let posts = []; // 存储朋友圈动态
let postIdCounter = 1; // 动态ID计数器

// ========== 页面路由 ==========
// 网站首页
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// ========== 功能接口 ==========
// 1. 获取所有动态
app.get('/api/posts', (req, res) => {
  // 按发布时间倒序返回
  const sortedPosts = posts.sort((a, b) => b.createTime - a.createTime);
  res.json({ code: 200, data: sortedPosts });
});

// 2. 发布新动态
app.post('/api/posts', (req, res) => {
  const { nickname, content } = req.body;
  
  if (!content) {
    return res.json({ code: 400, message: '动态内容不能为空' });
  }

  const newPost = {
    id: postIdCounter++,
    nickname: nickname || '匿名用户',
    content: content,
    likeCount: 0,
    viewCount: 0,
    comments: [],
    createTime: Date.now()
  };

  posts.unshift(newPost);
  res.json({ code: 200, message: '发布成功', data: newPost });
});

// 3. 给动态点赞
app.post('/api/posts/:id/like', (req, res) => {
  const postId = parseInt(req.params.id);
  const post = posts.find(item => item.id === postId);

  if (!post) {
    return res.json({ code: 404, message: '动态不存在' });
  }

  post.likeCount += 1;
  res.json({ code: 200, message: '点赞成功', data: { likeCount: post.likeCount } });
});

// 4. 给动态添加评论
app.post('/api/posts/:id/comments', (req, res) => {
  const postId = parseInt(req.params.id);
  const { nickname, content } = req.body;
  const post = posts.find(item => item.id === postId);

  if (!post) {
    return res.json({ code: 404, message: '动态不存在' });
  }
  if (!content) {
    return res.json({ code: 400, message: '评论内容不能为空' });
  }

  const newComment = {
    id: post.comments.length + 1,
    nickname: nickname || '匿名用户',
    content: content,
    createTime: Date.now()
  };

  post.comments.push(newComment);
  res.json({ code: 200, message: '评论成功', data: newComment });
});

// 5. 增加动态浏览量
app.post('/api/posts/:id/view', (req, res) => {
  const postId = parseInt(req.params.id);
  const post = posts.find(item => item.id === postId);

  if (post) {
    post.viewCount += 1;
    res.json({ code: 200, data: { viewCount: post.viewCount } });
  } else {
    res.json({ code: 404, message: '动态不存在' });
  }
});

// 健康检查接口
app.get('/api/health', (req, res) => {
  res.json({ code: 200, message: '服务运行正常' });
});

// 兜底路由
app.all('*', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 启动服务
app.listen(port, '0.0.0.0', () => {
  console.log(`服务运行在端口${port}`);
});
