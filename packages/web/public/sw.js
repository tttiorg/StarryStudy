/* 应用外壳缓存。
 * 业务数据一律不进缓存：/api/* 直接放行给浏览器走网络，
 * 否则手机端会读到过期的成绩 / 笔记，比离线更糟。
 * 这里出现的 fetch 是 Service Worker 拦截请求用的基础设施，
 * 不是应用侧的 API 调用（那些集中在 src/api/index.ts）。 */
// 每次改 SW / 外壳资源都要升版本：activate 会清掉旧缓存，强制三端（电脑 / 手机 / 平板）
// 换成新脚本，避免旧 SW 继续把 /api/ 的导航请求兜成首页。
// v3：品牌名统一为 StarryStudy（index.html / manifest / 启动动画都改了），
// 已安装的 PWA 必须重新拉一次 manifest 与外壳，桌面图标名称才会跟着变。
// v4：主页壁纸/渐变改为同元素双层背景（修掉四周的缝），Home 的 CSS/JS hash 变了；
// 静态资源是 stale-while-revalidate，不升版本三端会先看到旧样式。
// v5：壁纸换成必应每日图（同源代理 /api/wallpaper）+ 近期日程纳入课程任务，
// Home 的 CSS/JS 又变了，同样要升版本强制三端换新资源。
const CACHE = "starry-shell-v5";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.svg",
  "/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 单个资源失败不能让整个 SW 安装失败，否则离线兜底反而没了
      await Promise.all(SHELL.map((u) => cache.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;
  // /api/* 一律放行给网络，包括 iframe 与「新窗口打开」这类 req.mode === "navigate"
  // 的请求。一旦被下面的导航兜底换成 index.html，Vue Router 会拿 /api/files/xx/raw
  // 去匹配路由，结果就是「套娃的应用窗口 + 404 页面」。
  if (url.pathname.startsWith("/api/")) return;
  if (req.method !== "GET") return;

  // 页面导航：优先网络，断网时回落到缓存的首页（SPA 入口）
  if (req.mode === "navigate") {
    // 防御性再挡一次：任何情况下都不要把接口路径交给 SPA 兜底
    if (url.pathname.startsWith("/api/")) return;
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html")),
    );
    return;
  }

  // 静态资源：命中缓存先用，后台顺手更新一次（stale-while-revalidate）
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await caches.match(req);
      const refresh = (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        } catch (e) {
          return hit || Response.error();
        }
      })();
      return hit || refresh;
    })(),
  );
});
