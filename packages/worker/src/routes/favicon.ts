// 外链图标代理：直接让浏览器去取目标站的 /favicon.ico 会被证书、登录墙或
// CORS 挡掉，表现为所有外链都只剩首字色块（v1 用的是同一个思路）。
// 这里由 Worker 同源代取，<img> 自带会话 Cookie，不会把本服务变成公开代理。
//
// 因为会按用户给的 URL 发外部请求，必须做 SSRF 收敛：只放行公网 http(s)、
// 逐跳检查重定向、限制大小与超时、只回图片类型。拿不到就 404，让前端回落。
import { notFound } from "../util";

const IMAGE_RE = /^image\/(png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml|bmp)$/i;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 StarryStudy/2";

/** 私网 / 回环 / 链路本地 / 常见内网域名一律拒绝，避免被拿来探内网。 */
function isSafeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("fe80:") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^0\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    return null;
  }
  return u;
}

interface Guarded {
  body: ArrayBuffer;
  type: string;
  text?: string;
}

/**
 * 自己跟重定向而不是交给 fetch：每一跳都重新过一遍 isSafeUrl，
 * 否则「公网 302 到 127.0.0.1」这种绕过就拦不住。
 */
async function guardedFetch(rawUrl: string, want: "image" | "html"): Promise<Guarded | null> {
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    const u = isSafeUrl(current);
    if (!u) return null;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          Accept: want === "image" ? "image/avif,image/webp,image/*,*/*;q=0.8" : "text/html,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
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

    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (want === "image" && !IMAGE_RE.test(type)) return null;

    const cap = want === "image" ? MAX_ICON_BYTES : MAX_HTML_BYTES;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > cap) return null;
    const body = await res.arrayBuffer();
    if (!body.byteLength || body.byteLength > cap) return null;
    return {
      body,
      type,
      text: want === "html" ? new TextDecoder().decode(body) : undefined,
    };
  }
  return null;
}

/** 只认 <link rel~="icon" href>，属性顺序任意；找不到就让调用方回落。 */
function iconHrefFrom(html: string): string | null {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags.slice(0, 40)) {
    if (!/rel\s*=\s*["']?[^"'>]*icon/i.test(tag)) continue;
    const quoted = /href\s*=\s*(["'])(.*?)\1/i.exec(tag);
    const bare = /href\s*=\s*([^\s>]+)/i.exec(tag);
    const href = (quoted?.[2] ?? bare?.[1] ?? "").trim().replace(/&amp;/gi, "&");
    if (href && !href.startsWith("data:")) return href;
  }
  return null;
}

// 边缘缓存只在 Cloudflare 运行时有 caches.default；本地 wrangler dev 可能没有。
// 用结构化类型取（和 files.ts 同一套写法），不依赖某套 lib.dom 的 caches 声明，
// 取不到就当没缓存、一律回源。
interface EdgeCacheLike {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, value: Response): Promise<void>;
}

function edgeCache(): EdgeCacheLike | null {
  const holder = globalThis as unknown as { caches?: { default?: EdgeCacheLike } };
  return holder.caches?.default ?? null;
}

export async function handleFavicon(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url") ?? "";
  const site = isSafeUrl(target);
  if (!site) return notFound();

  const cache = edgeCache();
  const cacheKey = new Request(request.url);
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) return hit;

  // 先试站点根目录；很多站点把它放在 HTML 的 link 标签里，再退一步解析首页。
  let icon = await guardedFetch(new URL("/favicon.ico", site.origin).toString(), "image");
  if (!icon) {
    const page = await guardedFetch(site.toString(), "html");
    const href = page?.text ? iconHrefFrom(page.text) : null;
    if (href) {
      const absolute = new URL(href, site).toString();
      icon = await guardedFetch(absolute, "image");
    }
  }
  // 抓不到就 404，前端 @error 会显示名称首字色块，不留破图
  if (!icon) return notFound();

  const resp = new Response(icon.body, {
    status: 200,
    headers: {
      "content-type": icon.type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
  if (cache) {
    try {
      await cache.put(cacheKey, resp.clone());
    } catch {
      // 边缘缓存写失败不影响本次返回
    }
  }
  return resp;
}
