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