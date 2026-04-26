const express = require('express');
const app = express();
const port = 3000;

// 关键配置：监听0.0.0.0，支持手机局域网访问
app.listen(port, '0.0.0.0', () => {
  console.log('✅ 服务启动成功！');
  console.log('💻 电脑本地访问：http://localhost:' + port);
  console.log('📱 手机局域网访问：http://[你的电脑IP]:' + port);
});

// 让页面能正常访问
app.use(express.static('public'));

// 首页路由
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});