// 首页配图：必应每日壁纸。v1 是 Express 拉完存磁盘，v2 跑在 Worker 上没有磁盘，
// 改用 Cloudflare 的边缘缓存：list 缓存 1 小时、图片缓存 7 天，比每台端各自
// 直连必应更省流量，也绕开必应图片没有 CORS 的问题。
//
// 图片路由接受一个 URL 参数，必须做 SSRF 收敛：只放行 *.bing.com、https、
// 逐跳检查重定向、限制大小与超时、只回图片类型。拿不到就 404，让前端退回本地图。
import { json, notFound } from "../util";
import type { WallpaperList } from "@starry/shared";

const API = "https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN";
const BING_HOST = /(^|\.)bing\.com$/i;
const IMAGE_RE = /^image\/(jpe?g|png|webp|avif)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 StarryStudy/2";

interface EdgeCacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, value: Response): Promise<void>;
}

function edgeCache(): EdgeCacheLike | null {
  const holder = globalThis as unknown as { caches?: { default?: EdgeCacheLike } };
  return holder.caches?.default ?? null;
}

/** 只认 *.bing.com 的 https 地址；其余（含内网、file:、带用户名密码）一律拒绝。 */
function bingUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (!BING_HOST.test(u.hostname)) return null;
  return u;
}

interface BingImage {
  urlbase?: string;
  copyright?: string;
  startdate?: string;
}

async function fetchList(): Promise<WallpaperList> {
  const res = await fetch(API, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    // 必应挂起时不能让首页一直等；失败分支会写一个短 TTL 空响应做负缓存
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`wallpaper list ${res.status}`);
  const data = (await res.json()) as { images?: BingImage[] };
  const items = (Array.isArray(data.images) ? data.images : [])
    .filter((i): i is BingImage & { urlbase: string } => typeof i.urlbase === "string" && !!i.urlbase)
    .map((i) => ({
      // 1920x1080 够用且比原图小；这里是相对路径，交给 img 路由代理。
      src: `/api/wallpaper/img?u=${encodeURIComponent("https://cn.bing.com" + i.urlbase + "_1920x1080.jpg")}`,
      credit: String(i.copyright || "").replace(/\s*\(©.*?\)\s*$/, "").trim(),
      date: String(i.startdate || ""),
    }));
  return { items };
}

/** 手动跟重定向，每一跳都重新过 bingUrl，防止「必应 302 到内网」被绕过。 */
async function fetchImage(rawUrl: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    const u = bingUrl(current);
    if (!u) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_RE.test(type)) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) return null;
    // 分块传输时没有 content-length，arrayBuffer() 会把整个响应读进内存才返回，
    // 超大 body 会撑爆 Worker 限制。改为流式累计，超限立刻取消并丢弃。
    if (!res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }
    if (!size) return null;
    const merged = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { merged.set(c, at); at += c.byteLength; }
    return { body: merged.buffer, type };
  }
  return null;
}

export async function handleWallpaper(
  request: Request,
  parts: string[],
  method: string,
  url: URL,
): Promise<Response> {
  if (method !== "GET" || parts.length !== 1) return notFound();
  const cache = edgeCache();
  const cacheKey = new Request(request.url);

  if (parts[0] === "list") {
    const hit = cache ? await cache.match(cacheKey) : null;
    if (hit) return hit;
    try {
      const payload = await fetchList();
      const resp = json(payload);
      resp.headers.set("cache-control", "public, max-age=3600");
      if (cache) {
        try { await cache.put(cacheKey, resp.clone()); } catch { /* 缓存失败不影响本次返回 */ }
      }
      return resp;
    } catch (e) {
      // 拿不到就回空列表，前端自动退回本地 campus.jpg（自动派生字段必须有回退路径）。
      // 同时写一个 5 分钟负缓存：必应故障期间不放大请求量，恢复后自动重新回源。
      const resp = json({ items: [], error: e instanceof Error ? e.message : "unknown" });
      resp.headers.set("cache-control", "public, max-age=300");
      if (cache) {
        try { await cache.put(cacheKey, resp.clone()); } catch { /* 同上 */ }
      }
      return resp;
    }
  }

  if (parts[0] === "img") {
    const raw = url.searchParams.get("u") ?? "";
    if (!bingUrl(raw)) return notFound();
    const hit = cache ? await cache.match(cacheKey) : null;
    if (hit) return hit;
    const img = await fetchImage(raw);
    if (!img) return notFound();
    const resp = new Response(img.body, {
      status: 200,
      headers: {
        "content-type": img.type,
        "cache-control": "public, max-age=604800",
        "x-content-type-options": "nosniff",
      },
    });
    if (cache) {
      try { await cache.put(cacheKey, resp.clone()); } catch { /* 同上 */ }
    }
    return resp;
  }

  return notFound();
}
