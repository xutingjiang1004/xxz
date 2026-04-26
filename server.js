const express = require('express');
const path = require('path');
const app = express();

// 关键修复1：适配Render线上端口，本地默认3000
const port = process.env.PORT || 3000;

// 关键修复2：用绝对路径定位public文件夹，线上线下都能精准找到文件
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// 首页路由，兜底确保能找到index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// 监听所有网卡，适配所有环境
app.listen(port, '0.0.0.0', () => {
  console.log('✅ 服务启动成功！');
  console.log('💻 本地访问：http://localhost:' + port);
  console.log('🌐 线上访问：https://xxz-ij5l.onrender.com');
});