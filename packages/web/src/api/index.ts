/* 全前端唯一允许出现 fetch 的地方（§12）。组件与 store 一律从这里取数据。
 * v2 用 HttpOnly Cookie 会话：同源请求带 credentials，不写 localStorage token、
 * 不带 Authorization 头。<img>/<iframe> 这类浏览器自发请求也靠 Cookie 通过鉴权。 */
import type {
  BootstrapPayload,
  FileStats,
  Grade,
  Knowledge,
  Link,
  Note,
  StudyFile,
  Subject,
  Task,
  TimetableBlock,
  TimetableMeta,
  TimetablePayload,
  TimetableSlot,
  WriteResult,
} from "@starry/shared";

const BASE = "/api";

/* ---------------- 错误类型 ---------------- */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 409 专用：把服务端当前完整记录带上，交给用户自己决定保留哪份（§8.6）。 */
export class ConflictError<T = Record<string, unknown>> extends Error {
  readonly status = 409;
  readonly server: T;
  constructor(server: T) {
    super("这条已在别处修改");
    this.name = "ConflictError";
    this.server = server;
  }
}

// 打包后可能出现多份模块实例，instanceof  alone 不可靠，补一个 name 判定
export function isConflictError(e: unknown): e is ConflictError<Record<string, unknown>> {
  return (
    e instanceof ConflictError ||
    (typeof e === "object" && e !== null && (e as { name?: string }).name === "ConflictError")
  );
}

export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

export function msgOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e ?? "未知错误");
}

/** 写响应 {item, rev} → 可放回列表的记录；rev 以响应为准 */
export function normalizeWrite<T extends object>(res: WriteResult<T> | T): T {
  if (res && typeof res === "object" && "item" in res && "rev" in res) {
    const w = res as WriteResult<T>;
    return { ...(w.item as object), rev: w.rev } as T;
  }
  return res as T;
}

/* ---------------- 鉴权钩子 ---------------- */

type Handler = () => void;
let onUnauthorizedHandler: Handler | null = null;
let onNeedSetupHandler: Handler | null = null;

export function onUnauthorized(fn: Handler): void {
  onUnauthorizedHandler = fn;
}
export function onNeedSetup(fn: Handler): void {
  onNeedSetupHandler = fn;
}

/* ---------------- 请求核心 ---------------- */

type ParamValue = string | number | boolean | undefined | null;

function qs(params?: Record<string, ParamValue>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init.body !== undefined && !isForm && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
  } catch {
    throw new ApiError(0, "网络不可达，请检查连接");
  }

  let body: unknown = null;
  if (res.status !== 204) {
    const ct = res.headers.get("content-type") || "";
    try {
      body = ct.includes("application/json") ? await res.json() : await res.text();
    } catch {
      body = null;
    }
  }

  if (res.status === 401) {
    onUnauthorizedHandler?.();
  }

  if (!res.ok) {
    const b = body as { error?: string; message?: string; server?: unknown } | null;
    if (res.status === 409 && b?.error === "conflict") {
      throw new ConflictError((b.server ?? {}) as Record<string, unknown>);
    }
    if (b?.error === "needSetup") {
      onNeedSetupHandler?.();
    }
    throw new ApiError(res.status, b?.message || b?.error || `请求失败 (${res.status})`);
  }

  return body as T;
}

/* ---------------- 集合 CRUD ---------------- */

export interface ListResult<T> {
  items: T[];
  dueCount?: number;
  total?: number;
}

export interface Crud<T> {
  list: (params?: Record<string, ParamValue>) => Promise<ListResult<T>>;
  create: (body: unknown) => Promise<WriteResult<T>>;
  update: (id: string, body: unknown) => Promise<WriteResult<T>>;
  remove: (id: string) => Promise<WriteResult<T>>;
}

function crud<T>(path: string): Crud<T> {
  return {
    list: (params) => request<ListResult<T>>(path + qs(params)),
    create: (body) => request<WriteResult<T>>(path, { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) =>
      request<WriteResult<T>>(`${path}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    remove: (id) =>
      request<WriteResult<T>>(`${path}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}

export type CollectionName =
  | "subjects"
  | "tasks"
  | "grades"
  | "notes"
  | "knowledge"
  | "links"
  | "files";

const subjectsApi = {
  ...crud<Subject>("/subjects"),
  reorder: (ids: string[]) =>
    request<unknown>("/subjects/reorder", { method: "PUT", body: JSON.stringify({ ids }) }),
};

const linksApi = {
  ...crud<Link>("/links"),
  reorder: (ids: string[]) =>
    request<unknown>("/links/reorder", { method: "PUT", body: JSON.stringify({ ids }) }),
};

const knowledgeApi = {
  ...crud<Knowledge>("/knowledge"),
  review: (id: string, action: "review" | "master" | "reset" | "forgot", rev: number) =>
    request<WriteResult<Knowledge>>(`/knowledge/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ action, rev }),
    }),
};

/** 上传响应兼容两种形状：契约的 {items:[...]} 与单文件的 {item,rev} */
export interface UploadResult {
  items?: StudyFile[];
  item?: StudyFile | null;
  rev?: number;
}

const filesApi = {
  ...crud<StudyFile>("/files"),
  upload: (form: FormData) =>
    request<UploadResult>("/files/upload", { method: "POST", body: form }),
  stats: () => request<FileStats>("/files/stats"),
  /** PDF 内联渲染用；不带任何查询参数，#view=FitH 由组件追加 */
  rawUrl: (id: string) => `${BASE}/files/${encodeURIComponent(id)}/raw`,
};

/** 单格写入的响应形状不固定：可能是 {item,rev}，也可能是整张课表。三种都兼容。 */
export interface TimetableWriteResult {
  item?: TimetableSlot;
  slots?: TimetableSlot[];
  meta?: TimetableMeta;
  blocks?: TimetableBlock[];
  rev?: number;
}

const timetableApi = {
  get: () => request<TimetablePayload>("/timetable"),
  /** 日常编辑：body 只有一个 slot，绝不发整张课表（§8.1，验收 #4） */
  slot: (slot: Record<string, unknown>) =>
    request<TimetableWriteResult>("/timetable/slot", {
      method: "PUT",
      body: JSON.stringify(slot),
    }),
  meta: (meta: Partial<TimetableMeta>) =>
    request<TimetableWriteResult>("/timetable/meta", {
      method: "PUT",
      body: JSON.stringify(meta),
    }),
  /** 仅导入 / 清空使用；mode=replace 才整份替换 */
  bulk: (slots: TimetableSlot[], mode: "merge" | "replace" = "merge") =>
    request<TimetableWriteResult>("/timetable/bulk", {
      method: "PUT",
      body: JSON.stringify({ slots, mode }),
    }),
};

const tasksApi = crud<Task>("/tasks");
const gradesApi = crud<Grade>("/grades");
const notesApi = crud<Note>("/notes");

export const api = {
  health: () => request<{ ok: boolean }>("/health"),
  bootstrap: () => request<BootstrapPayload>("/bootstrap"),

  auth: {
    status: () =>
      request<{ registered: boolean; needSetup: boolean }>("/auth/status", { method: "POST" }),
    setup: (password: string) =>
      request<{ ok: boolean }>("/auth/setup", { method: "POST", body: JSON.stringify({ password }) }),
    login: (password: string) =>
      request<{ ok: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    password: (oldPassword: string, newPassword: string) =>
      request<{ ok: boolean }>("/auth/password", {
        method: "POST",
        body: JSON.stringify({ oldPassword, newPassword }),
      }),
  },

  subjects: subjectsApi,
  tasks: tasksApi,
  grades: gradesApi,
  notes: notesApi,
  knowledge: knowledgeApi,
  links: linksApi,
  files: filesApi,
  timetable: timetableApi,

  settings: {
    noticeSeen: () => request<{ ok: boolean }>("/settings/notice-seen", { method: "POST" }),
  },
  sync: {
    status: () => request<Record<string, unknown>>("/sync/status"),
  },
};

/** 给 store 做泛型遍历用；额外的 reorder / review 等方法不影响 CRUD 形状。 */
export const collections: Record<CollectionName, Crud<unknown>> = {
  subjects: subjectsApi as unknown as Crud<unknown>,
  tasks: tasksApi as unknown as Crud<unknown>,
  grades: gradesApi as unknown as Crud<unknown>,
  notes: notesApi as unknown as Crud<unknown>,
  knowledge: knowledgeApi as unknown as Crud<unknown>,
  links: linksApi as unknown as Crud<unknown>,
  files: filesApi as unknown as Crud<unknown>,
};
