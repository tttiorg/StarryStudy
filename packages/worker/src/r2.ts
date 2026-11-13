import { nowIso } from "@starry/shared";
import { bytesToHex, hmacSha256, sha256Hex, toArrayBuffer, utf8 } from "./util";
import type { Env } from "./types";

export function r2Key(sha: string): string {
  // key 里不放文件名/学科：改名、换学科都不该动对象（§6.3）
  return `blob/${sha.slice(0, 2)}/${sha}`;
}

function fixMojibake(s: string): string {
  // multipart 文件名常被按 latin1 解读，中文变成一串 U+00XX。
  // 用 latin1 编码回字节再按 utf-8 解码即可还原；不是合法 utf-8 就保持原样。
  if (!/[\u0080-\u00ff]/.test(s)) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i) & 0xff;
    return new TextDecoder("utf-8", { fatal: true }).decode(toArrayBuffer(bytes));
  } catch {
    return s;
  }
}

export function safeName(name: string): string {
  const fixed = fixMojibake(name || "");
  // 去掉路径分隔符与控制字符，避免用户提供的名字被用成路径或注入响应头
  const cleaned = fixed
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  // 与 shared 的 fileUpdate.name 上限保持一致，避免校验后再被截断
  return (cleaned || "unnamed").slice(0, 120);
}

export interface PresignSecrets {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function readPresignSecrets(env: Env): PresignSecrets | null {
  const s: PresignSecrets = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET_NAME,
  };
  if (!s.accountId || !s.accessKeyId || !s.secretAccessKey || !s.bucket) return null;
  return s;
}

// SigV4 要求 RFC3986 编码，encodeURIComponent 会漏掉这几个字符
const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// 自写 SigV4 预签名，避免为了一个 URL 引入运行时依赖。
// R2 的 S3 兼容端点用 region=auto / service=s3，payload 恒为 UNSIGNED-PAYLOAD。
export async function presignUrl(
  secrets: PresignSecrets,
  key: string,
  method: "GET" | "PUT",
  ttlSeconds: number,
): Promise<string> {
  const host = `${secrets.accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";
  const amzDate = `${nowIso().slice(0, 19).replace(/[-:]/g, "")}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${rfc3986(secrets.bucket)}/${key.split("/").map(rfc3986).join("/")}`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${secrets.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(ttlSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(utf8(canonicalRequest)),
  ].join("\n");
  const kDate = await hmacSha256(utf8(`AWS4${secrets.secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
