# xxz - Moments Secure

## 已实现需求

- 登录顾客可发布图文/视频（原文件保存）。
- 游客无需登录可评论。
- 点赞功能（每个游客对同一作品仅记一次）。
- 公共浏览记录 + 作品浏览量（所有访问者可见）。
- 发布入口已放到“二次菜单”，默认只展示浏览入口。
- 支持原画质图片/视频下载（下载按钮在每条作品下）。
- 实时互联更新：新发布、评论、点赞、浏览变化会实时推送到在线用户页面。
- 基础安全防护：输入清洗、令牌鉴权、限流、安全响应头、文件类型/大小限制。

## 为什么手机打不开（常见原因）

1. 手机和电脑不在同一 Wi-Fi / 局域网。
2. 访问了 `localhost`，手机应访问电脑的局域网 IP。
3. 电脑防火墙阻止了 3000 端口。

## 运行

```bash
npm start
```

启动后在电脑访问：

- `http://localhost:3000`

手机访问：

- `http://<你的电脑局域网IP>:3000`

例如 `http://192.168.1.25:3000`。

## 变成“公网网址”给别人直接打开（推荐）

先启动服务：

```bash
npm start
```

新开一个终端执行：

```bash
npm run tunnel
```

终端会输出一个 `https://xxxx.loca.lt` 的公网地址，把这个网址发给别人，手机和电脑都能直接访问。

> 说明：这是临时公网地址，重启后会变化。正式长期使用建议部署到云服务器（如 Railway/Render/VPS）并绑定固定域名。

## 固定域名部署（Railway / Render）

### 方案 A：Render（推荐新手）

1. 把本仓库推到 GitHub。
2. Render 新建 **Web Service**，选择该仓库。
3. Render 会自动识别 `render.yaml` 并创建服务与持久化磁盘。
4. 首次部署成功后，会得到一个固定 `onrender.com` 子域名。
5. 绑定你自己的域名：  
   `Service -> Settings -> Custom Domains -> Add Custom Domain`，按提示配置 DNS 并 Verify。

> Render 官方文档（自定义域名）：https://render.com/docs/custom-domains

### 方案 B：Railway

1. Railway 新建项目并连接 GitHub 仓库。
2. 使用仓库内 `railway.json` 启动服务。
3. 在 Service 的 **Public Networking** 里先点击 `Generate Domain`，得到固定 `*.up.railway.app`。
4. 需要自己域名时，点 `+ Custom Domain`，按 Railway 给出的 CNAME/TXT 配置 DNS。

> Railway 官方文档（域名）：https://docs.railway.com/networking/domains/working-with-domains

### 生产环境必配（两家平台都一样）

- `APP_SECRET`：改成强随机字符串（不要用默认值）。
- `DATA_DIR` / `UPLOAD_DIR`：必须指向**持久化磁盘**目录，不然重启会丢数据。
- 域名生效后，全站默认 HTTPS，可直接在手机和电脑稳定访问。

## 检查

```bash
npm run check
```
