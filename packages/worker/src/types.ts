import type { D1Database, R2Bucket, Fetcher } from "@cloudflare/workers-types";

// Worker 的全部绑定与可变配置。配置值统一经 util 的 workerConfig -> readConfig 读取，
// 业务代码不允许直接读取环境变量，也不直接把绑定当配置读。
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;

  AUTH_SECRET: string;
  AUTH_COLLECTOR_TOKEN: string;
  NOTICE_WEBHOOK_URL: string;

  // 仅大文件预签名直传需要；缺失时 presign 返回 503，不影响其它接口
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;

  // 可选的数值调优项，由 secret 注入，缺省时 shared/config 给默认值
  PBKDF2_ITERATIONS: string;
  SESSION_TTL_DAYS: string;
  PRESIGN_THRESHOLD_BYTES: string;
}
