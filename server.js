// 引入依赖
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

// 创建服务实例
const app = express();
const port = process.env.PORT || 3000;

// 简单用户数据（生产环境应使用数据库）
const users = [
  { id: 1, username: 'admin', password: '123456', nickname: '管理员' },
  { id: 2, username: 'user', password: '123456', nickname: '普通用户' }
];

// 存储token的黑名单（用于退出登录）
const tokenBlacklist = new Set();

// 基础配置
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 生成token
function generateToken(username) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2);
  const str = `${username}:${timestamp}:${random}:secret`;
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 验证token
function verifyToken(token) {
  if (!token || tokenBlacklist.has(token)) {
    return null;
  }
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      return { username: parts[0], exp: parseInt(parts[1]) };
    }
    return null;
  } catch {
    return null;
  }
}

// 登录接口
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ code: 400, message: '用户名和密码不能为空' });
  }

  const user = users.find(u => u.username === username && u.password === password);

  if (user) {
    const token = generateToken(user.username);
    res.json({
      code: 200,
      message: '登录成功',
      token: token,
      username: user.nickname
    });
  } else {
    res.json({ code: 401, message: '用户名或密码错误' });
  }
});

// 退出登录接口
app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    tokenBlacklist.add(token);
  }
  res.json({ code: 200, message: '退出成功' });
});

// 验证登录状态
app.get('/api/check-login', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = verifyToken(token);

  if (user) {
    res.json({ code: 200, isLogin: true, username: user.username });
  } else {
    res.json({ code: 200, isLogin: false });
  }
});

// 测试接口
app.get('/api/hello', (req, res) => {
  res.json({
    code: 200,
    message: '🎉 恭喜你！前后端互联成功！这是后端返回的消息'
  });
});

// 网站根路径
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 兜底路由
app.all('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`✅ 服务已启动，运行端口：${port}`);
  console.log(`📌 测试账号：admin / 123456`);
  console.log(`📌 测试账号：user / 123456`);
});
