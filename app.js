const API = "";
const AUTH_KEY = "moments_auth_v2";
const GUEST_KEY = "moments_guest_v2";
const VIEWED_KEY = "moments_viewed_post_ids";

const authPanel = document.getElementById("auth-panel");
const timeline = document.getElementById("timeline");
const browseLog = document.getElementById("browse-log");
const postTemplate = document.getElementById("post-template");
const navMore = document.getElementById("nav-more");
const secondaryMenu = document.getElementById("secondary-menu");
const openPublish = document.getElementById("open-publish");
const dialog = document.getElementById("publish-dialog");
const cancelPublish = document.getElementById("cancel-publish");
const postForm = document.getElementById("post-form");
const postTitle = document.getElementById("post-title");
const postContent = document.getElementById("post-content");
const postMedia = document.getElementById("post-media");
const mediaPreviewWrap = document.getElementById("media-preview-wrap");

let auth = loadJSON(AUTH_KEY, null);
let posts = [];
let logs = [];
let uploadMedia = null;
const guestId = getGuestId();
const viewedIds = new Set(loadJSON(VIEWED_KEY, []));
let streamStarted = false;

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getGuestId() {
  let id = localStorage.getItem(GUEST_KEY);
  if (!id) {
    id = `游客${Math.floor(Math.random() * 9000 + 1000)}`;
    localStorage.setItem(GUEST_KEY, id);
  }
  return id;
}

function headers() {
  const basic = { "Content-Type": "application/json" };
  if (auth?.token) {
    basic.Authorization = `Bearer ${auth.token}`;
  }
  return basic;
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `请求失败(${response.status})`);
  }
  return data;
}

function renderAuth() {
  if (auth?.username) {
    authPanel.innerHTML = `
      <div>
        <span>顾客：${auth.username}</span>
        <button class="btn" id="logout">退出</button>
      </div>
    `;
    document.getElementById("logout").onclick = () => {
      auth = null;
      localStorage.removeItem(AUTH_KEY);
      renderAuth();
    };
    return;
  }

  authPanel.innerHTML = `
    <form id="login-form" class="auth-form">
      <input id="u" required placeholder="用户名" maxlength="20" />
      <input id="p" required type="password" minlength="4" placeholder="密码" />
      <button class="btn" type="submit">登录</button>
    </form>
  `;

  document.getElementById("login-form").onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById("u").value.trim();
    const password = document.getElementById("p").value;
    if (!username || password.length < 4) return;
    try {
      const res = await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      auth = res;
      saveJSON(AUTH_KEY, auth);
      renderAuth();
      alert("登录成功");
    } catch (err) {
      alert(err.message);
    }
  };
}

function renderLogs() {
  browseLog.innerHTML = "";
  if (!logs.length) {
    browseLog.innerHTML = "<li>暂无记录</li>";
    return;
  }
  logs.forEach((log) => {
    const li = document.createElement("li");
    li.textContent = `${log.guest} 浏览《${log.postTitle}》 · ${new Date(log.time).toLocaleString("zh-CN")}`;
    browseLog.appendChild(li);
  });
}

function renderPosts() {
  timeline.innerHTML = "";
  if (!posts.length) {
    timeline.innerHTML = "<p>还没有动态，点击二次菜单发布吧。</p>";
    return;
  }

  posts.forEach((post) => {
    const node = postTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".title").textContent = post.title;
    node.querySelector(".time").textContent = new Date(post.createdAt).toLocaleString("zh-CN");
    node.querySelector(".content").textContent = post.content;
    node.querySelector(".meta").textContent = `作者：${post.author} ｜ 评论 ${post.comments.length} ｜ 作品浏览量 ${post.views}`;
    node.querySelector(".like-count").textContent = post.likes;
    node.querySelector(".view-count").textContent = post.views;

    const mediaWrap = node.querySelector(".media-wrap");
    const downloadLink = node.querySelector(".download-link");
    downloadLink.href = `/api/posts/${post.id}/download`;
    if (post.media?.url) {
      if (post.media.kind === "video") {
        const video = document.createElement("video");
        video.src = post.media.url;
        video.controls = true;
        video.preload = "metadata";
        mediaWrap.appendChild(video);
      } else {
        const img = document.createElement("img");
        img.src = post.media.url;
        img.alt = post.title;
        mediaWrap.appendChild(img);
      }
    } else {
      downloadLink.classList.add("hidden");
    }

    if (!viewedIds.has(post.id)) {
      viewedIds.add(post.id);
      saveJSON(VIEWED_KEY, Array.from(viewedIds));
      api(`/api/posts/${post.id}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guest: guestId })
      }).then(refresh).catch(() => {});
    }

    node.querySelector(".like-btn").onclick = async () => {
      try {
        await api(`/api/posts/${post.id}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guest: guestId })
        });
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    };

    const commentList = node.querySelector(".comment-list");
    post.comments.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = `${c.guest}: ${c.text}`;
      commentList.appendChild(li);
    });

    const commentForm = node.querySelector(".comment-form");
    commentForm.onsubmit = async (e) => {
      e.preventDefault();
      const input = commentForm.querySelector(".comment-input");
      const text = input.value.trim();
      if (!text) return;
      try {
        await api(`/api/posts/${post.id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guest: guestId, text })
        });
        input.value = "";
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    };

    timeline.appendChild(node);
  });
}

postMedia.onchange = async () => {
  const file = postMedia.files?.[0];
  if (!file) {
    uploadMedia = null;
    mediaPreviewWrap.innerHTML = "";
    mediaPreviewWrap.classList.add("hidden");
    return;
  }

  const max = file.type.startsWith("video/") ? 200 : 25;
  if (file.size > max * 1024 * 1024) {
    alert(`文件太大，限制 ${max}MB`);
    postMedia.value = "";
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  const base64 = dataUrl.split(",")[1];
  uploadMedia = {
    name: file.name,
    type: file.type,
    size: file.size,
    base64
  };

  mediaPreviewWrap.classList.remove("hidden");
  mediaPreviewWrap.innerHTML = `<p>已选择原文件：${file.name} (${Math.round(file.size / 1024)}KB)</p>`;
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

postForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!auth?.token) {
    alert("请先登录后发布");
    return;
  }
  try {
    await api("/api/posts", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: postTitle.value.trim(),
        content: postContent.value.trim(),
        media: uploadMedia
      })
    });
    postForm.reset();
    uploadMedia = null;
    mediaPreviewWrap.innerHTML = "";
    mediaPreviewWrap.classList.add("hidden");
    dialog.close();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
};

async function refresh() {
  const data = await api("/api/posts");
  posts = data.posts;
  logs = data.logs;
  renderPosts();
  renderLogs();
}

function startRealtimeStream() {
  if (streamStarted || !window.EventSource) return;
  streamStarted = true;
  const source = new EventSource("/api/stream");
  source.addEventListener("post_created", handleRemoteUpdate);
  source.addEventListener("comment_created", handleRemoteUpdate);
  source.addEventListener("post_liked", handleRemoteUpdate);
  source.addEventListener("post_viewed", handleRemoteUpdate);
  source.onerror = () => {
    source.close();
    streamStarted = false;
    setTimeout(startRealtimeStream, 2000);
  };
}

function handleRemoteUpdate() {
  refresh().catch(() => {});
}

navMore.onclick = () => secondaryMenu.classList.toggle("hidden");
openPublish.onclick = () => {
  secondaryMenu.classList.add("hidden");
  dialog.showModal();
};
cancelPublish.onclick = () => dialog.close();

document.addEventListener("click", (e) => {
  if (!secondaryMenu.contains(e.target) && e.target !== navMore) {
    secondaryMenu.classList.add("hidden");
  }
});

renderAuth();
refresh().catch((err) => {
  timeline.innerHTML = `<p>加载失败：${err.message}</p>`;
});
startRealtimeStream();
