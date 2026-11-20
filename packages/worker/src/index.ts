import type { Request as WorkerRequest } from "@cloudflare/workers-types";
import { verifyCollectorToken, verifySession } from "./auth";
import { handleIngest } from "./ingest";
import { handleAuth } from "./routes/auth";
import {
  bootstrapResponse, collectorBootstrapResponse, noticeSeenResponse,
  syncAckResponse, syncFailResponse, syncRequestResponse, syncStatusResponse,
} from "./routes/bootstrap";
import { handleCrud } from "./routes/crud";
import type { CrudResource } from "./routes/crud";
import { handleFiles } from "./routes/files";
import { handleFavicon } from "./routes/favicon";
import { handleTimetable } from "./routes/timetable";
import { handleWallpaper } from "./routes/wallpaper";
import { json, notFound, unauthorized } from "./util";
import type { Env } from "./types";

const CRUD_RESOURCES = new Set([
  "subjects", "tasks", "grades", "notes", "knowledge", "links",
]);

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const rest = url.pathname === "/api" ? "" : url.pathname.slice("/api/".length);
  const segs = rest.split("/").filter(Boolean);
  const head = segs[0] ?? "";
  const parts = segs.slice(1);

  if (!head) return notFound();

  // 探活不含任何环境信息
  if (head === "health" && parts.length === 0 && method === "GET") {
    return json({ ok: true });
  }

  // status/setup/login 免鉴权：登录门控要先知道有没有设过密码。
  // status 额外放行 GET，避免前端用 GET 时被 401 误判成「未登录」。
  const publicAuth = head === "auth" && parts.length === 1 && (
    (parts[0] === "status" && (method === "POST" || method === "GET")) ||
    ((parts[0] === "setup" || parts[0] === "login") && method === "POST")
  );
  if (publicAuth) return handleAuth(request, env, parts, method);

  // 采集器带自己的令牌，不走会话
  if (head === "ingest") return handleIngest(request, env, parts);

  // 采集器专用：跑完清标记（ack）与上报失败（fail）都只认令牌。
  // 合并守卫是为了让「带会话 Cookie 但没令牌」明确 401，而不是漏到路由末尾变 404。
  if (head === "sync" && parts.length === 1 && method === "POST" &&
      (parts[0] === "ack" || parts[0] === "fail")) {
    if (!verifyCollectorToken(request, env)) return unauthorized();
    if (parts[0] === "ack") return syncAckResponse(env);
    // 上报失败：让无人值守下的故障在「数据概览」可见，而不是永远 ok=1
    let body: unknown = null;
    try { body = await request.json(); } catch { /* 空 body 也写一条通用失败 */ }
    return syncFailResponse(env, body);
  }

  const sessionOk = await verifySession(request, env);
  // 采集器只带令牌读学科与手工映射（collector 的 fetchSubjects / fetchBootstrapMap），
  // 其中 /api/subjects 是必须项，401 会让整个采集流程直接抛错。这是鉴权白名单里
  // 唯一的例外：仅这两个只读 GET 放行，其余接口仍一律要求会话。
  const collectorRead = !sessionOk && method === "GET" && (
    (head === "subjects" && parts.length === 0) ||
    (head === "bootstrap" && parts.length === 0)
  ) && verifyCollectorToken(request, env);
  if (!sessionOk && !collectorRead) return unauthorized();

  if (head === "auth") return handleAuth(request, env, parts, method);
  if (CRUD_RESOURCES.has(head)) {
    return handleCrud(request, env, head as CrudResource, parts, method, url);
  }
  if (head === "timetable") return handleTimetable(request, env, parts, method);
  if (head === "files") return handleFiles(request, env, parts, method, url);
  if (head === "wallpaper") return handleWallpaper(request, parts, method, url);

  if (head === "bootstrap" && parts.length === 0 && method === "GET") {
    // 令牌路径只回手工映射，不把课表、外链与登录状态交给令牌持有者
    return sessionOk ? bootstrapResponse(env) : collectorBootstrapResponse(env);
  }
  if (head === "favicon" && parts.length === 0 && method === "GET") {
    return handleFavicon(request);
  }
  if (head === "sync" && parts.length === 1 && parts[0] === "status" && method === "GET") {
    return syncStatusResponse(env);
  }
  if (head === "sync" && parts.length === 1 && parts[0] === "request" && method === "POST") {
    return syncRequestResponse(env);
  }
  if (head === "settings" && parts.length === 1 && parts[0] === "notice-seen" && method === "POST") {
    return noticeSeenResponse(env);
  }
  // /api/* 未匹配一律返回 JSON 404，绝不落到静态资源
  return notFound();
}

async function serveAsset(request: Request, env: Env): Promise<Response> {
  // lib.dom 与 @cloudflare/workers-types 各声明了一套 Request/Response，
  // ASSETS 绑定用的是后者；边界上做一次类型转换，运行时其实是同一个对象。
  const resp = await env.ASSETS.fetch(request as unknown as WorkerRequest);
  const pathname = new URL(request.url).pathname;
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  const ext = dot > 0 ? last.slice(dot).toLowerCase() : "";
  const htmlLike = ext === "" || ext === ".html" || ext === ".htm";
  const isHtml = (resp.headers.get("content-type") || "").toLowerCase().includes("text/html");
  // SPA fallback 会把未命中的路径也塞成 index.html（200 + text/html）。
  // 带扩展名的资源（js/css/png/pdf…）必须返回真 404，否则手机端 <script>/<img>
  // 会拿到一份 HTML，表现为白屏或解析错误（v1 教训、CF-05）。
  if (!htmlLike && (resp.status === 404 || isHtml)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // 经过 Worker 返回的 HTML（含 SPA fallback 的兜底首页）不缓存，避免 deploy 后
  // 边缘仍吐旧 index.html、里面引用上一版 JS chunk，表现为「部署了但页面没变」。
  // 真实存在的 /index.html 由资产层直接返回、不经 Worker，其默认
  // public, max-age=0, must-revalidate 同样保证每次校验，两条路都有兜底。
  // SW 自己缓存的离线副本不受这个头影响，断网兜底仍然可用。
  if (isHtml) {
    const src = resp as unknown as Response;
    const h = new Headers(src.headers);
    h.set("cache-control", "no-cache, must-revalidate");
    return new Response(src.body, { status: src.status, headers: h });
  }
  return resp as unknown as Response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const pathname = new URL(request.url).pathname;
      // 先处理所有 /api/*，最后才回退静态资源（CF-05）
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return await handleApi(request, env);
      }
      return await serveAsset(request, env);
    } catch (e) {
      return json(
        { error: "internal_error", message: e instanceof Error ? e.message : "unknown" },
        500,
      );
    }
  },
};
