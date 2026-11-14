// 存储层的唯一装配点。业务代码只从这里拿 StorageAdapter 与 key 规则。
import { workerConfig } from "../util";
import type { Env } from "../types";
import { toArrayBuffer } from "../util";
import { createS3Adapter } from "./s3";
import type { StorageAdapter } from "./adapter";

export type { StorageAdapter, ObjectMeta, ObjectGet, ObjectRange } from "./adapter";

export function objectKey(sha: string): string {
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

export function createStorage(env: Env): StorageAdapter | null {
  const cfg = workerConfig(env).worker.storage;
  // 五项缺一不可。配置不全时明确返回 null，由接口回 503；
  // 不让 SigV4 拿空字符串去签一个必然 403 的请求。
  if (!cfg.endpoint || !cfg.region || !cfg.keyId || !cfg.appKey || !cfg.bucketName) return null;
  return createS3Adapter(cfg);
}
