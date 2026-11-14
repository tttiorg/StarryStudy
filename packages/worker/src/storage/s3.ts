// B2 的 S3 兼容 API 适配器。签名全部用 WebCrypto 自己算，不引运行时依赖：
// Worker 里没有 Node 的 crypto，也不该为每个对象请求多装一个包。
import type { StorageConfig } from "@starry/shared";
import { bytesToHex, hmacSha256, sha256Hex, toArrayBuffer, utf8 } from "../util";
import type { ObjectGet, ObjectMeta, ObjectRange, StorageAdapter } from "./adapter";

const SERVICE = "s3";

// SigV4 要求 RFC3986 编码，encodeURIComponent 会漏掉这几个字符
const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// SigV4 的协议时间戳必须是 UTC，不是业务时间；业务时间仍统一走 shared/time.ts。
// 这里刻意不用 nowIso()，避免把 Asia/Shanghai 语义混进签名。
function stamp(): { amzDate: string; dateStamp: string } {
  const amzDate = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

async function signingKey(cfg: StorageConfig, dateStamp: string): Promise<Uint8Array> {
  let k = await hmacSha256(utf8(`AWS4${cfg.appKey}`), dateStamp);
  k = await hmacSha256(k, cfg.region);
  k = await hmacSha256(k, SERVICE);
  return hmacSha256(k, "aws4_request");
}

function canonicalUri(cfg: StorageConfig, key: string): string {
  return `/${rfc3986(cfg.bucketName)}/${key.split("/").map(rfc3986).join("/")}`;
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");
}

interface SignOptions {
  method: "GET" | "HEAD" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: Uint8Array;
}

async function signedFetch(cfg: StorageConfig, key: string, opts: SignOptions): Promise<Response> {
  const { amzDate, dateStamp } = stamp();
  const body = opts.body ?? new Uint8Array(0);
  const payloadHash = await sha256Hex(body);
  const uri = canonicalUri(cfg, key);
  const merged: Record<string, string> = {
    host: cfg.endpoint,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(opts.headers ?? {}),
  };
  const lower: Record<string, string> = {};
  for (const [k, val] of Object.entries(merged)) lower[k.toLowerCase()] = String(val).trim();
  const signed = Object.keys(lower).sort();
  const signedHeaders = signed.join(";");
  const canonicalHeaders = signed.map((k) => `${k}:${lower[k]}\n`).join("");
  const scope = `${dateStamp}/${cfg.region}/${SERVICE}/aws4_request`;
  const canonicalRequest = [
    opts.method, uri, "", canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(utf8(canonicalRequest)),
  ].join("\n");
  const signature = bytesToHex(await hmacSha256(await signingKey(cfg, dateStamp), stringToSign));

  const headers = new Headers();
  // host 由 fetch 依 URL 自动带上，签名里已经包含；手动再设一次反而可能被运行时改写。
  for (const [k, val] of Object.entries(merged)) {
    if (k.toLowerCase() !== "host") headers.set(k, val);
  }
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${cfg.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  const init: RequestInit = { method: opts.method, headers };
  if (opts.method === "PUT") init.body = toArrayBuffer(body);
  return fetch(`https://${cfg.endpoint}${uri}`, init);
}

async function drain(res: Response): Promise<void> {
  // 连接复用要求把 body 读完；HEAD/DELETE 的 body 为空，读一下也无副作用。
  try { await res.arrayBuffer(); } catch { /* 忽略 */ }
}

function metaOf(res: Response, fallbackSize = 0): ObjectMeta {
  return {
    etag: res.headers.get("etag") ?? "",
    size: Number(res.headers.get("content-length") ?? 0) || fallbackSize,
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

async function presign(
  cfg: StorageConfig,
  key: string,
  method: "GET" | "PUT",
  ttl: number,
): Promise<string> {
  const { amzDate, dateStamp } = stamp();
  const scope = `${dateStamp}/${cfg.region}/${SERVICE}/aws4_request`;
  const uri = canonicalUri(cfg, key);
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.keyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(ttl),
    // 只签 host：客户端 PUT 时带不带 Content-Type 都不会破坏签名。
    "X-Amz-SignedHeaders": "host",
  };
  const cq = canonicalQuery(params);
  const canonicalRequest = [
    method, uri, cq, `host:${cfg.endpoint}\n`, "host", "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(utf8(canonicalRequest)),
  ].join("\n");
  const signature = bytesToHex(await hmacSha256(await signingKey(cfg, dateStamp), stringToSign));
  return `https://${cfg.endpoint}${uri}?${cq}&X-Amz-Signature=${signature}`;
}

export function createS3Adapter(cfg: StorageConfig): StorageAdapter {
  return {
    async put(key, data, contentType) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      const res = await signedFetch(cfg, key, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: bytes,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        await drain(res).catch(() => undefined);
        throw new Error(`B2 PUT ${res.status}: ${text.slice(0, 200)}`);
      }
      const etag = res.headers.get("etag") ?? "";
      await drain(res);
      return { etag };
    },

    async head(key) {
      const res = await signedFetch(cfg, key, { method: "HEAD" });
      if (res.status === 404) { await drain(res); return null; }
      if (!res.ok) {
        await drain(res);
        throw new Error(`B2 HEAD ${res.status}`);
      }
      const meta = metaOf(res);
      await drain(res);
      return meta;
    },

    async get(key, range?: ObjectRange) {
      const headers: Record<string, string> = {};
      if (range) headers.range = `bytes=${range.offset}-${range.end ?? ""}`;
      const res = await signedFetch(cfg, key, { method: "GET", headers });
      if (res.status === 404) { await drain(res); return null; }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`B2 GET ${res.status}: ${text.slice(0, 200)}`);
      }
      const partial = res.status === 206;
      let size = Number(res.headers.get("content-length") ?? 0);
      // 206 的 content-length 只是片段长度，总大小要从 content-range 的 /total 取。
      if (partial) {
        const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
        if (m) size = Number(m[1]);
      }
      const result: ObjectGet = {
        body: res.body ?? new ReadableStream(),
        etag: res.headers.get("etag") ?? "",
        size,
        contentType: res.headers.get("content-type") || "application/octet-stream",
        partial,
      };
      return result;
    },

    async presignGet(key, ttl) {
      return presign(cfg, key, "GET", ttl);
    },

    async presignPut(key, _contentType, ttl) {
      // contentType 只影响客户端请求头，不进签名；保留参数是为了让调用方契约完整。
      return presign(cfg, key, "PUT", ttl);
    },

    async delete(key) {
      const res = await signedFetch(cfg, key, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        await drain(res);
        throw new Error(`B2 DELETE ${res.status}`);
      }
      await drain(res);
    },
  };
}
