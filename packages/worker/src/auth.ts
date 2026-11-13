import { SESSION_COOKIE, nowIso, timingSafeEqual } from "@starry/shared";
import {
  b64url, b64urlDecode, bytesToHex, hexToBytes, hmacHex, parseCookies,
  toArrayBuffer, utf8, workerConfig,
} from "./util";
import type { Env } from "./types";

export interface AuthState {
  registered: boolean;
  needSetup: boolean;
}

export async function authState(env: Env): Promise<AuthState> {
  const row = await env.DB.prepare("SELECT hash FROM auth WHERE id = 1").first();
  const hash = (row as { hash?: string } | null)?.hash ?? "";
  const registered = Boolean(hash);
  return { registered, needSetup: !registered };
}

export function newSessionId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveBitsHex(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", toArrayBuffer(utf8(password)), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

// 格式 pbkdf2$<iter>$<saltHex>$<keyHex>。迭代次数随哈希一起存，
// 以后用 secret 调高迭代次数也不会让旧密码失效。
export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyHex = await deriveBitsHex(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToHex(salt)}$${keyHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array;
  try {
    salt = hexToBytes(parts[2]);
  } catch {
    return false;
  }
  const calc = await deriveBitsHex(password, salt, iterations);
  // 比较完整十六进制串，长度不同也要走完循环，避免按哈希内容泄密
  return timingSafeEqual(calc, parts[3]);
}

// token = base64url(body) + "." + base64url(HMAC 字节)，body = sessionId.exp.nonce
export async function signToken(sessionId: string, secret: string, ttlDays: number): Promise<string> {
  const exp = Math.floor(Date.parse(nowIso()) / 1000) + Math.max(1, ttlDays) * 86_400;
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(12)));
  const body = `${sessionId}.${exp}.${nonce}`;
  const mac = await hmacHex(secret, body);
  return `${b64url(utf8(body))}.${b64url(hexToBytes(mac))}`;
}

async function verifyToken(token: string, secret: string): Promise<{ sessionId: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let body: string;
  try {
    body = new TextDecoder().decode(toArrayBuffer(b64urlDecode(parts[0])));
  } catch {
    return null;
  }
  const expected = b64url(hexToBytes(await hmacHex(secret, body)));
  if (!timingSafeEqual(parts[1], expected)) return null;
  const segs = body.split(".");
  if (segs.length !== 3 || !segs[0] || !segs[2]) return null;
  const exp = Number(segs[1]);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.parse(nowIso()) / 1000)) return null;
  return { sessionId: segs[0] };
}

export async function verifySession(request: Request, env: Env): Promise<boolean> {
  const token = parseCookies(request.headers.get("cookie") || "")[SESSION_COOKIE];
  if (!token) return false;
  const cfg = workerConfig(env).worker;
  const payload = await verifyToken(token, cfg.authSecret);
  if (!payload) return false;
  const row = await env.DB.prepare("SELECT session_id FROM auth WHERE id = 1").first();
  const stored = (row as { session_id?: string } | null)?.session_id ?? "";
  if (!stored) return false;
  // 改密码会换 session_id，旧签名即便没过期也会在这里被挡掉
  return timingSafeEqual(payload.sessionId, stored);
}

export function sessionCookie(token: string, ttlDays: number): string {
  const maxAge = Math.max(1, Math.floor(ttlDays * 86_400));
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// 采集器只带令牌、不带会话 cookie；令牌是高权限凭据，用它换取两个只读端点。
export function verifyCollectorToken(request: Request, env: Env): boolean {
  const expected = workerConfig(env).worker.collectorToken;
  if (!expected) return false;
  const got = request.headers.get("X-Collector-Token") || "";
  return timingSafeEqual(got, expected);
}

export function clearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
