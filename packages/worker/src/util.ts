import { readConfig } from "@starry/shared";
import type { AppConfig } from "@starry/shared";
import type { Env } from "./types";

// shared 导出的都是 zod schema 实例。这里用结构化类型承接，
// worker 不直接依赖 zod，免得 workspace 里出现两份不同版本的类型定义。
interface SafeParseIssue {
  path?: (string | number)[];
  message?: string;
}
export interface SchemaLike {
  readonly _output: unknown;
  safeParse(data: unknown):
    | { success: true; data: unknown }
    | { success: false; error: { issues: SafeParseIssue[] } };
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json; charset=utf-8");
  // API 数据全是私有的，禁止中间层缓存
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function apiError(error: string, message: string, status = 400): Response {
  return json({ error, message }, status);
}

export function notFound(): Response {
  return json({ error: "not_found", message: "接口不存在" }, 404);
}

export function unauthorized(): Response {
  return json({ error: "unauthorized", message: "未登录或登录已失效" }, 401);
}

export function conflict(server: unknown): Response {
  return json({ error: "conflict", server }, 409);
}

// 写请求入参一律交给 shared 导出的 zod schema 校验，失败统一 400，
// 不在业务代码里堆 if 判断（§12）。
export async function parseBody<S extends SchemaLike>(
  request: Request,
  schema: S,
): Promise<BodyResult<S["_output"]>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError("bad_request", "请求体不是合法 JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${(i.path ?? []).join(".") || "body"}: ${i.message ?? ""}`)
      .join("; ");
    return { ok: false, response: apiError("bad_request", message || "参数校验失败") };
  }
  return { ok: true, data: parsed.data as S["_output"] };
}

// 全项目唯一读取环境值的出口：把绑定里的字符串交给 shared 的 readConfig，
// 避免业务代码各处直接读环境变量（§4.3 规则三）。
export function workerConfig(env: Env): AppConfig {
  return readConfig({
    AUTH_SECRET: env.AUTH_SECRET,
    AUTH_COLLECTOR_TOKEN: env.AUTH_COLLECTOR_TOKEN,
    NOTICE_WEBHOOK_URL: env.NOTICE_WEBHOOK_URL,
    PBKDF2_ITERATIONS: env.PBKDF2_ITERATIONS,
    SESSION_TTL_DAYS: env.SESSION_TTL_DAYS,
    PRESIGN_THRESHOLD_BYTES: env.PRESIGN_THRESHOLD_BYTES,
    B2_ENDPOINT: env.B2_ENDPOINT,
    B2_REGION: env.B2_REGION,
    B2_KEY_ID: env.B2_KEY_ID,
    B2_APP_KEY: env.B2_APP_KEY,
    B2_BUCKET_NAME: env.B2_BUCKET_NAME,
  });
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

// DELETE 允许不带 body；带了 rev 就顺手做一次乐观锁校验，语义与 PUT 对齐。
export async function readOptionalRev(request: Request): Promise<number | null> {
  try {
    const raw: unknown = await request.json();
    if (raw && typeof raw === "object") {
      const rev = (raw as Record<string, unknown>).rev;
      if (typeof rev === "number" && Number.isInteger(rev) && rev > 0) return rev;
    }
  } catch {
    // 没有请求体是合法的
  }
  return null;
}

export function truthy(v: string | undefined | null): boolean {
  return v === "1" || v === "true" || v === "on";
}

// 从行对象里取 rev，避免各处重复写类型断言
export function revOf(row: unknown, fallback: number): number {
  const n = Number((row as { rev?: unknown } | null | undefined)?.rev);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// --- 字节 / 编码 / WebCrypto 辅助（签名与摘要都要走 WebCrypto，Node 的 crypto 不在 Worker 里） ---

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const b = new ArrayBuffer(u.byteLength);
  new Uint8Array(b).set(u);
  return b;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function b64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", toArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, toArrayBuffer(utf8(message)));
  return new Uint8Array(sig);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  return bytesToHex(await hmacSha256(utf8(secret), message));
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof ArrayBuffer ? data : toArrayBuffer(data);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(d));
}
