/* 应用外壳缓存。
 * 业务数据一律不进缓存：/api/* 直接放行给浏览器走网络，
 * 否则手机端会读到过期的成绩 / 笔记，比离线更糟。
 * 这里出现的 fetch 是 Service Worker 拦截请求用的基础设施，
 * 不是应用侧的 API 调用（那些集中在 src/api/index.ts）。 */
const CACHE = "starry-shell-v1";
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
  if (url.pathname.indexOf("/api/") === 0) return;
  if (req.method !== "GET") return;

  // 页面导航：优先网络，断网时回落到缓存的首页（SPA 入口）
  if (req.mode === "navigate") {
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
