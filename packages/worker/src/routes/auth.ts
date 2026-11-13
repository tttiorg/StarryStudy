import { authLogin, authPassword, authSetup } from "@starry/shared";
import {
  authState, clearCookie, hashPassword, newSessionId, sessionCookie, signToken, verifyPassword,
} from "../auth";
import { apiError, json, notFound, parseBody, unauthorized, workerConfig } from "../util";
import type { Env } from "../types";

// status/setup/login 由入口判定为免鉴权（登录门控需要先知道有没有设过密码），
// logout/password 走会话鉴权。这里只负责处理这五个动作本身。
export async function handleAuth(
  request: Request,
  env: Env,
  parts: string[],
  method: string,
): Promise<Response> {
  const action = parts[0];
  const cfg = workerConfig(env).worker;

  if (parts.length === 1 && action === "status" && (method === "POST" || method === "GET")) {
    return json(await authState(env));
  }

  if (parts.length === 1 && action === "setup" && method === "POST") {
    const body = await parseBody(request, authSetup);
    if (!body.ok) return body.response;
    const state = await authState(env);
    if (state.registered) {
      return apiError("already_registered", "已经设置过密码，不提供注册入口", 409);
    }
    const hash = await hashPassword(body.data.password, cfg.pbkdf2Iterations);
    const sid = newSessionId();
    await env.DB.prepare("UPDATE auth SET hash = ?, session_id = ? WHERE id = 1").bind(hash, sid).run();
    const token = await signToken(sid, cfg.authSecret, cfg.sessionTtlDays);
    return json(
      { ok: true, registered: true, needSetup: false },
      200,
      { "set-cookie": sessionCookie(token, cfg.sessionTtlDays) },
    );
  }

  if (parts.length === 1 && action === "login" && method === "POST") {
    const body = await parseBody(request, authLogin);
    if (!body.ok) return body.response;
    const row = await env.DB.prepare("SELECT hash, session_id FROM auth WHERE id = 1").first();
    const stored = row as { hash: string; session_id: string } | null;
    if (!stored || !stored.hash) return apiError("need_setup", "尚未设置密码", 412);
    if (!(await verifyPassword(body.data.password, stored.hash))) return unauthorized();
    // session_id 缺失时补一个，避免历史数据把用户锁死
    const sid = stored.session_id || newSessionId();
    if (!stored.session_id) {
      await env.DB.prepare("UPDATE auth SET session_id = ? WHERE id = 1").bind(sid).run();
    }
    const token = await signToken(sid, cfg.authSecret, cfg.sessionTtlDays);
    return json(
      { ok: true, registered: true, needSetup: false },
      200,
      { "set-cookie": sessionCookie(token, cfg.sessionTtlDays) },
    );
  }

  if (parts.length === 1 && action === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (parts.length === 1 && action === "password" && method === "POST") {
    const body = await parseBody(request, authPassword);
    if (!body.ok) return body.response;
    const row = await env.DB.prepare("SELECT hash FROM auth WHERE id = 1").first();
    const stored = row as { hash: string } | null;
    if (!stored || !stored.hash) return apiError("need_setup", "尚未设置密码", 412);
    if (!(await verifyPassword(body.data.oldPassword, stored.hash))) return unauthorized();
    const hash = await hashPassword(body.data.newPassword, cfg.pbkdf2Iterations);
    // 换 session_id 让所有其它设备上的旧签名立即失效；当前设备重签一个继续用
    const sid = newSessionId();
    await env.DB.prepare("UPDATE auth SET hash = ?, session_id = ? WHERE id = 1").bind(hash, sid).run();
    const token = await signToken(sid, cfg.authSecret, cfg.sessionTtlDays);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, cfg.sessionTtlDays) });
  }

  return notFound();
}
