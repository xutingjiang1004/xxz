const express = require('express');
const path = require('path');
const app = express();

// 适配Render线上端口，本地默认3000
const port = process.env.PORT || 3000;

// 关键修改：直接读取根目录的index.html，不用public文件夹
app.use(express.static(__dirname));

// 首页路由，精准匹配根目录的index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 监听所有网卡，适配所有环境
app.listen(port, '0.0.0.0', () => {
  console.log('✅ 服务启动成功！');
  console.log('💻 本地访问：http://localhost:' + port);
  console.log('🌐 线上访问：https://xxz-ij5l.onrender.com');
});
