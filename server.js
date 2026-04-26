const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
app.use(cors())
app.use(express.json())

let works = [
  { id: 1, title: '作品1', likes: 10, views: 152 },
  { id: 2, title: '作品2', likes: 25, views: 320 }
]

// 静态文件托管
app.use(express.static(__dirname))

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// 获取作品
app.get('/works', (req, res) => {
  res.json(works)
})

// 点赞
app.post('/like/:id', (req, res) => {
  const id = Number(req.params.id)
  const work = works.find(w => w.id === id)
  if (work) {
    work.likes++
    res.json(work)
  } else {
    res.status(404).send('not found')
  }
})

app.listen(3001, () => {
  console.log('后端启动：http://localhost:3001')
})