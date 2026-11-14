import type { D1Database, Fetcher } from "@cloudflare/workers-types";

// Worker 的全部绑定与可变配置。配置值统一经 util 的 workerConfig -> readConfig 读取，
// 业务代码不允许直接读取环境变量，也不直接把绑定当配置读。
// 对象存储走 B2 的 S3 兼容 API，不需要任何 binding，凭据全在下面的字符串里。
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  AUTH_SECRET: string;
  AUTH_COLLECTOR_TOKEN: string;
  NOTICE_WEBHOOK_URL: string;

  // B2（S3 兼容）凭据。五项缺一不可：缺了 createStorage 返回 null，
  // 文件上传 / 下载 / 预签名接口明确回 503，而不是抛 500。
  B2_ENDPOINT: string;
  B2_REGION: string;
  B2_KEY_ID: string;
  B2_APP_KEY: string;
  B2_BUCKET_NAME: string;

  // 可选的数值调优项，由 secret 注入，缺省时 shared/config 给默认值
  PBKDF2_ITERATIONS: string;
  SESSION_TTL_DAYS: string;
  PRESIGN_THRESHOLD_BYTES: string;
}
