// 唯一读取环境的地方（§4.3 规则三）。业务代码里出现 process.env 视为 bug。
// 默认值一律为空：没配置时采集器直接不启动，而不是拿一个学校地址去崩掉。

import { PRESIGN_THRESHOLD_BYTES, SESSION_TTL_DAYS } from "./constants";

export type EnvSource = Record<string, string | undefined>;

export interface BbConfig {
  casUrl: string;
  baseUrl: string;
  servicePath: string;
  streamPath: string;
  myGradesPath: string;
  calendarPath: string;
  user: string;
  password: string;
  subjectMap: Record<string, string>;
}

export interface CollectorConfig {
  apiBaseUrl: string;
  token: string;
}

export interface WorkerConfig {
  authSecret: string;
  collectorToken: string;
  noticeWebhookUrl: string;
  pbkdf2Iterations: number;
  sessionTtlDays: number;
  presignThresholdBytes: number;
}

export interface AppConfig {
  bb: BbConfig;
  collector: CollectorConfig;
  worker: WorkerConfig;
}

const v = (raw: EnvSource, key: string): string => (raw[key] ?? "").trim();

function num(raw: EnvSource, key: string, fallback: number): number {
  const n = Number(v(raw, key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function jsonMap(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([k, val]) => /^_\d+_\d+$/.test(k) && typeof val === "string")
        .map(([k, val]) => [k, String(val).slice(0, 64)]),
    );
  } catch {
    return {};
  }
}

export function readConfig(raw: EnvSource): AppConfig {
  return {
    bb: {
      casUrl: v(raw, "BB_CAS_URL"),
      baseUrl: v(raw, "BB_BASE_URL"),
      servicePath: v(raw, "BB_SERVICE_PATH") || "/webapps/bb-sso-BBLEARN/index.jsp",
      streamPath: v(raw, "BB_STREAM_PATH") || "/webapps/streamViewer/streamViewer",
      myGradesPath: v(raw, "BB_MYGRADES_PATH") || "/webapps/bb-mygrades-BBLEARN/myGrades",
      calendarPath: v(raw, "BB_CALENDAR_PATH") || "/webapps/calendar/calendarData/selectedCalendarEvents",
      user: v(raw, "BB_USER"),
      password: v(raw, "BB_PASSWORD"),
      subjectMap: jsonMap(v(raw, "BB_SUBJECT_MAP")),
    },
    collector: {
      apiBaseUrl: v(raw, "API_BASE_URL"),
      token: v(raw, "COLLECTOR_TOKEN"),
    },
    worker: {
      // Worker 的线上值走 secret，名称与本机 .env 一致，方便两边对账
      authSecret: v(raw, "AUTH_SECRET"),
      collectorToken: v(raw, "AUTH_COLLECTOR_TOKEN") || v(raw, "COLLECTOR_TOKEN"),
      noticeWebhookUrl: v(raw, "NOTICE_WEBHOOK_URL"),
      // CF-01：免费版 CPU 10ms，PBKDF2 十万次会 1102。默认 1 万次，可用 secret 调
      pbkdf2Iterations: num(raw, "PBKDF2_ITERATIONS", 10_000),
      sessionTtlDays: num(raw, "SESSION_TTL_DAYS", SESSION_TTL_DAYS),
      presignThresholdBytes: num(raw, "PRESIGN_THRESHOLD_BYTES", PRESIGN_THRESHOLD_BYTES),
    },
  };
}

/** Node 侧唯一入口。Worker 侧请传 env 对象，不要调这个函数。 */
export function readNodeConfig(): AppConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process;
  return readConfig((proc?.env ?? {}) as EnvSource);
}

/** 四项缺一不可：地址、账号、云端目标、令牌。缺了就明确不启动。 */
export function collectorConfigured(c: AppConfig): boolean {
  return Boolean(
    c.bb.casUrl && c.bb.baseUrl && c.bb.user && c.bb.password &&
    c.collector.apiBaseUrl && c.collector.token,
  );
}

export function collectorMissing(c: AppConfig): string[] {
  const pairs: [boolean, string][] = [
    [!!c.bb.casUrl, "BB_CAS_URL"],
    [!!c.bb.baseUrl, "BB_BASE_URL"],
    [!!c.bb.user, "BB_USER"],
    [!!c.bb.password, "BB_PASSWORD"],
    [!!c.collector.apiBaseUrl, "API_BASE_URL"],
    [!!c.collector.token, "COLLECTOR_TOKEN"],
  ];
  return pairs.filter(([ok]) => !ok).map(([, key]) => key);
}
