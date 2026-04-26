const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/api/hello', (req, res) => {
  res.json({ 
    code: 200,
    message: "🎉 恭喜你！前后端互联成功！这是后端返回的消息" 
  });
});

app.listen(port, () => {
  console.log(`✅ 本地服务已启动！请在浏览器打开：http://localhost:${port}`);
});