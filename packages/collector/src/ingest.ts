// 采集器唯一的云端出口：数据写入只走 /api/ingest/*，绝不直连 D1；
// 另有一个 /api/sync/ack 只用来清除「手动抓取」标记，不携带任何学习数据。
// 提交体里只有 IngestGrade / IngestTask 的字段，不含 done/doneManual/weight/rev
// 这类用户手填或由服务端维护的字段（白名单由服务端执行，采集器也不发送）。
import type {
  CollectorConfig,
  IngestGrade,
  IngestTask,
  IngestSummary,
  Subject,
} from "@starry/shared";
import type { CloudContext } from "./plan";

function tokenHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Collector-Token": token,
  };
}

function normalizeMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^_\d+_\d+$/.test(k) && typeof v === "string" && v) out[k] = v.slice(0, 64);
  }
  return out;
}

function normalizeSubjects(raw: unknown): Subject[] {
  const boxed = (raw ?? {}) as { subjects?: unknown; items?: unknown };
  const list = Array.isArray(raw) ? raw : (boxed.subjects ?? boxed.items ?? []);
  return (Array.isArray(list) ? list : [])
    .map((x) => x as Subject)
    .filter((s) => s && typeof s.id === "string");
}

/** 映射可能直接是对象，也可能被序列化成 JSON 字符串；坏数据一律当作空。 */
function asRecord(raw: unknown): Record<string, unknown> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * bootstrap 的手工映射可能在 settings['bb.map']，也可能在顶层 bbMap。
 * 两路都收并合并（settings 优先）：用 ?? 二选一时，一个空的 settings 对象
 * 会把同时返回的 bbMap 整路挡掉，Worker 换成顶层 bbMap 后就读不到映射了。
 */
function extractBootstrapMap(boot: unknown): unknown {
  const b = (boot ?? {}) as {
    settings?: Record<string, unknown> | string;
    bbMap?: unknown;
  };
  const settings = asRecord(b.settings);
  return { ...asRecord(b.bbMap), ...asRecord(settings["bb.map"]) };
}

export class IngestClient {
  constructor(private readonly cfg: CollectorConfig) {}

  private url(path: string): string {
    return `${this.cfg.apiBaseUrl.replace(/\/+$/, "")}${path}`;
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const url = this.url(path);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      // 不静默吞掉网络错误：本机全局代理会让裸 curl 502，给出可诊断的提示（W-01）
      throw new Error(
        `${path} 请求失败：${e instanceof Error ? e.message : String(e)}；` +
          `检查 API_BASE_URL 与网络，本机命令行验证请用 curl --noproxy '*'`
      );
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      throw new Error(`${path} 响应读取失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      throw new Error(
        `${path} 返回 HTTP ${res.status} ${res.statusText}；响应片段 ${text.slice(0, 200)}；` +
          `检查 COLLECTOR_TOKEN 与 API_BASE_URL`
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${path} 返回的不是 JSON：${text.slice(0, 200)}`);
    }
  }

  private async get(path: string): Promise<unknown> {
    return this.requestJson(path, { method: "GET", headers: tokenHeaders(this.cfg.token) });
  }

  private async postItems(path: string, items: unknown[]): Promise<IngestSummary> {
    const data = (await this.requestJson(path, {
      method: "POST",
      headers: tokenHeaders(this.cfg.token),
      body: JSON.stringify({ items }),
    })) as { created?: number; updated?: number; skipped?: number };
    return {
      created: Number(data.created ?? 0),
      updated: Number(data.updated ?? 0),
      skipped: Number(data.skipped ?? 0),
    };
  }

  postGrades(items: IngestGrade[]): Promise<IngestSummary> {
    return this.postItems("/api/ingest/grades", items);
  }

  postTasks(items: IngestTask[]): Promise<IngestSummary> {
    return this.postItems("/api/ingest/tasks", items);
  }

  /**
   * 消费一次「手动抓取」请求。采集器本来就是一次性跑全量，跑到这一步说明确实
   * 抓过了，把云端标记清掉；失败只记日志，不能让清除动作反过来毁掉采集结果。
   */
  async ackSync(): Promise<void> {
    try {
      await this.requestJson("/api/sync/ack", {
        method: "POST",
        headers: tokenHeaders(this.cfg.token),
        body: "{}",
      });
    } catch (e) {
      console.warn(
        `[collector] 清除手动抓取请求失败（不影响本次采集）：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** 把本轮失败写进云端 sync_runs。上报失败不抛给调用方，避免盖住原始故障。 */
  async reportFailure(source: "grades" | "tasks", error: string): Promise<void> {
    try {
      await this.requestJson("/api/sync/fail", {
        method: "POST",
        headers: tokenHeaders(this.cfg.token),
        body: JSON.stringify({ source, error }),
      });
    } catch (e) {
      console.warn(
        `[collector] 上报失败状态未成功（不影响本次采集）：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async fetchSubjects(): Promise<Subject[]> {
    return normalizeSubjects(await this.get("/api/subjects"));
  }

  async fetchBootstrapMap(): Promise<Record<string, string>> {
    return normalizeMap(extractBootstrapMap(await this.get("/api/bootstrap")));
  }
}

/**
 * 学科与手工映射：/api/subjects 是必须项（缺了会让所有条目没有归属，属数据事故，
 * 直接抛错不静默降级）；bootstrap 的 bb.map 是尽力项，字段没上线也不算失败，
 * 本地 BB_SUBJECT_MAP 仍然生效。两者合并时本地明确配置优先。
 */
export async function fetchCloudContext(
  cloud: CollectorConfig,
  subjectMap: Record<string, string>
): Promise<CloudContext> {
  const client = new IngestClient(cloud);
  const subjects = await client.fetchSubjects();
  if (!subjects.length) {
    throw new Error("/api/subjects 没返回学科；先在新站建好学科再采集，否则条目会全部没有归属");
  }

  let bootMap: Record<string, string> = {};
  try {
    bootMap = await client.fetchBootstrapMap();
  } catch (e) {
    console.warn(
      `[collector] /api/bootstrap 读取失败，忽略云端 bb.map：${e instanceof Error ? e.message : String(e)}`
    );
  }

  return { subjects, manualMap: { ...bootMap, ...subjectMap } };
}
