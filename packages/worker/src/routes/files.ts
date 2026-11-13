import { fileUpdate, ids, nowIso, presign } from "@starry/shared";
import { changesOf, getRow, listRows, rowToObject } from "../db";
import { presignUrl, r2Key, readPresignSecrets, safeName } from "../r2";
import {
  apiError, conflict, json, notFound, parseBody, readOptionalRev, revOf, sha256Hex,
  truthy, workerConfig,
} from "../util";
import type { Env } from "../types";

// raw 读取时真正用到的 R2 对象字段，统一转成这个形状
interface R2Body {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

interface FileRow {
  id: string;
  name: string;
  r2Key: string;
  mime: string;
  size: number;
  sha256: string;
  localOnly: boolean;
  rev: number;
}

function guessMime(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

function asciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

interface ParsedRange {
  offset: number;
  length: number;
  start: number;
  end: number;
}

// 自己解析 Range 头再传给 R2，并据此构造 Content-Range。
// 不同运行时对 object.range 的暴露不一致，只依赖它会让部分请求退化成 200，
// 手机 Edge 的 PDF 阅读器就翻不了页（CF-07）。
function parseRange(header: string | null, size: number): ParsedRange | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  let start: number;
  let end: number;
  if (a === "" && b !== "") {
    const suffix = Number(b);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (a !== "") {
    start = Number(a);
    end = b === "" ? size - 1 : Number(b);
  } else {
    return null;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
      start >= size || end < start) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1, start, end };
}

// multipart 没有专用 zod schema，复用 shared 的 fileUpdate 去掉 rev 后校验元数据；
// 字段值先按字符串规范化，避免把表单原值直接当类型用。
function formMeta(form: FormData, displayName: string): Record<string, unknown> {
  const g = (k: string): string | undefined => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const o: Record<string, unknown> = { name: displayName };
  const subjectId = g("subjectId");
  if (subjectId !== undefined) o.subjectId = subjectId || null;
  const category = g("category");
  if (category !== undefined) o.category = category;
  const note = g("note");
  if (note !== undefined) o.note = note;
  const tags = g("tags");
  if (tags !== undefined) {
    try {
      o.tags = JSON.parse(tags);
    } catch {
      o.tags = [];
    }
  }
  const pinned = g("pinned");
  if (pinned !== undefined) o.pinned = truthy(pinned);
  const localOnly = g("localOnly");
  if (localOnly !== undefined) o.localOnly = truthy(localOnly);
  return o;
}

type UploadMeta = {
  name?: string;
  subjectId?: string | null;
  category?: string;
  pinned?: boolean;
  tags?: string[];
  note?: string;
  localOnly?: boolean;
};

// 单个文件的去重 / 上传 / 落库。key 只由 sha256 决定，与显示名、学科无关（§6.3）。
async function storeUploadedFile(
  env: Env,
  file: File,
  displayName: string,
  m: UploadMeta,
  now: string,
): Promise<Record<string, unknown> | null> {
  const bytes = await file.arrayBuffer();
  const sha = await sha256Hex(bytes);
  const key = r2Key(sha);
  const mime = file.type || guessMime(displayName);
  const size = bytes.byteLength;

  // 内容寻址去重：sha256 在 files 表上有唯一索引（软删行也占着），
  // 命中就复用那条记录，既不重复 PUT 对象，也不会撞唯一约束。
  const duplicate = await env.DB.prepare("SELECT * FROM files WHERE sha256 = ?").bind(sha).first();
  if (duplicate) {
    const row = duplicate as Record<string, unknown>;
    const wasDeleted = row.deleted_at !== null && row.deleted_at !== undefined;
    const wasLocalOnly = Number(row.local_only) === 1;
    // 只有本地引用的行从来没有对象；这次是真实上传时补一次 PUT，其余情况对象已存在
    if (wasLocalOnly && !m.localOnly) {
      await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
    }
    if (wasDeleted || wasLocalOnly) {
      // 用户主动重新上传 = 恢复这条记录（不是采集器的复活），对象复用
      await env.DB.prepare(
        `UPDATE files SET deleted_at = NULL, name = ?, r2_key = ?, size = ?, mime = ?,
         subject_id = ?, category = ?, pinned = ?, tags = ?, note = ?, local_only = ?,
         rev = rev + 1, updated_at = ? WHERE id = ?`,
      ).bind(
        displayName, key, size, mime,
        m.subjectId ?? null, m.category ?? "material", m.pinned ? 1 : 0,
        JSON.stringify(m.tags ?? []), m.note ?? "", m.localOnly ? 1 : 0, now, row.id,
      ).run();
      return getRow(env, "SELECT * FROM files WHERE id = ?", [row.id]);
    }
    return rowToObject(row);
  }

  // local_only 的文件永远不上传对象（v1 的 link 型），只在电脑上能点开
  if (!m.localOnly) {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
  }
  const id = ids.file();
  await env.DB.prepare(
    `INSERT INTO files
     (id, name, r2_key, size, mime, sha256, subject_id, category, pinned, tags, note, local_only, rev, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(
    id, displayName, key, size, mime, sha,
    m.subjectId ?? null, m.category ?? "material", m.pinned ? 1 : 0,
    JSON.stringify(m.tags ?? []), m.note ?? "", m.localOnly ? 1 : 0,
    now, now,
  ).run();
  return getRow(env, "SELECT * FROM files WHERE id = ?", [id]);
}

async function uploadFile(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("bad_request", "需要 multipart/form-data 请求体");
  }
  // 契约字段名是 files（前端与冒烟脚本都用）；file 仅作单数字段名的输入兜底。
  // 只取其中一组，避免同一请求里两个字段名都出现时把同一内容重复落库。
  const fromFiles = form.getAll("files");
  const chosen = fromFiles.length ? fromFiles : form.getAll("file");
  const files = chosen.filter((v): v is File => v instanceof File);
  if (!files.length) return apiError("bad_request", "缺少 file 字段");

  const explicitName = form.get("name");
  const now = nowIso();
  const items: Record<string, unknown>[] = [];
  for (const file of files) {
    // 多文件时显示名各用各的文件名；只有单文件才允许表单里显式指定 name
    const rawName = files.length === 1 && typeof explicitName === "string"
      ? explicitName : file.name;
    const displayName = safeName(rawName);
    const meta = fileUpdate.omit({ rev: true }).safeParse(formMeta(form, displayName));
    if (!meta.success) {
      return apiError("bad_request", meta.error.issues.map((i) => i.message).join("; "));
    }
    const item = await storeUploadedFile(env, file, displayName, meta.data as UploadMeta, now);
    if (item) items.push(item);
  }
  // 契约是多文件 {items:[...]}；同时带 item/rev，兼容单文件写响应与冒烟脚本的取法
  return json({ items, item: items[0] ?? null, rev: revOf(items[0], 1) });
}

async function rawFile(request: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!row) return notFound();
  const f = rowToObject<FileRow>(row as Record<string, unknown>);
  if (f.localOnly) return json({ error: "local_only", message: "仅电脑可用" }, 410);

  const range = parseRange(request.headers.get("range"), f.size);
  let object: unknown;
  try {
    object = await env.BUCKET.get(
      f.r2Key,
      range ? { range: { offset: range.offset, length: range.length } } : {},
    );
  } catch {
    return new Response("Range Not Satisfiable", { status: 416 });
  }
  if (!object) return notFound();
  const o = object as unknown as R2Body;

  const headers = new Headers();
  headers.set("etag", o.httpEtag);
  headers.set("cache-control", "private, max-age=0");
  headers.set("accept-ranges", "bytes");
  headers.set("content-type", o.httpMetadata?.contentType || f.mime || "application/octet-stream");
  // PDF 必须 inline 且 Content-Type 正确，手机 Edge 才能在页面内翻页渲染而不是下载
  headers.set(
    "content-disposition",
    `inline; filename="${asciiFilename(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  );

  // ETag 命中返回 304 且无 body，省流量也不会让手机看到旧版本（CF-08）
  const inm = request.headers.get("if-none-match");
  if (inm && inm === o.httpEtag) return new Response(null, { status: 304, headers });

  let status = 200;
  if (range) {
    status = 206;
    headers.set("content-range", `bytes ${range.start}-${range.end}/${o.size}`);
  }
  return new Response(o.body, { status, headers });
}

async function presignFile(request: Request, env: Env, id: string, url: URL): Promise<Response> {
  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = presign.safeParse(raw ?? {});
  if (!parsed.success) {
    return apiError("bad_request", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const row = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!row) return notFound();
  const f = rowToObject<FileRow>(row as Record<string, unknown>);
  if (f.localOnly) return apiError("local_only", "仅电脑可用，无法生成直链", 410);

  const cfg = workerConfig(env).worker;
  // 小文件走 Worker 代理能逐请求校验权限，没必要绕开 Worker
  if (f.size <= cfg.presignThresholdBytes) {
    return apiError("too_small", "文件未超过直传阈值，请走 /raw", 400);
  }
  const secrets = readPresignSecrets(env);
  if (!secrets) {
    return apiError("r2_not_configured", "需要配置 R2 API 令牌才能生成预签名直链", 503);
  }
  const wantsPut = url.searchParams.get("method") === "PUT" ||
    (typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).method === "PUT");
  const signedUrl = await presignUrl(secrets, f.r2Key, wantsPut ? "PUT" : "GET", parsed.data.ttl);
  return json({ url: signedUrl });
}

export async function handleFiles(
  request: Request,
  env: Env,
  parts: string[],
  method: string,
  url: URL,
): Promise<Response> {
  const now = nowIso();

  // upload / stats 必须在 /:id 之前匹配，否则会被当成文件 id
  if (parts.length === 1 && parts[0] === "upload" && method === "POST") {
    return uploadFile(request, env);
  }

  if (parts.length === 1 && parts[0] === "stats" && method === "GET") {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS count,
       COALESCE(SUM(size), 0) AS totalSize,
       COALESCE(SUM(CASE WHEN local_only = 1 THEN 1 ELSE 0 END), 0) AS localOnly
       FROM files WHERE deleted_at IS NULL`,
    ).first();
    // 所有统计都带 deleted_at IS NULL，漏一处就多算（D-05）
    return json(row);
  }

  if (parts.length === 0 && method === "GET") {
    const where: string[] = [];
    const vals: unknown[] = [];
    const sid = url.searchParams.get("subjectId");
    if (sid) { where.push("subject_id = ?"); vals.push(sid); }
    const q = url.searchParams.get("q");
    if (q) { where.push("(name LIKE ? OR note LIKE ?)"); vals.push(`%${q}%`, `%${q}%`); }
    const tag = url.searchParams.get("tag");
    // tags 是 JSON 数组文本，粗粒度包含匹配即可，不做 JSON 解析
    if (tag) { where.push("tags LIKE ?"); vals.push(`%${tag}%`); }
    const category = url.searchParams.get("category");
    if (category) { where.push("category = ?"); vals.push(category); }
    const items = await listRows(
      env,
      `SELECT * FROM files WHERE deleted_at IS NULL${where.length ? ` AND ${where.join(" AND ")}` : ""}
       ORDER BY pinned DESC, created_at DESC`,
      vals,
    );
    return json({ items });
  }

  if (parts.length === 2 && parts[1] === "raw" && method === "GET") {
    return rawFile(request, env, parts[0]);
  }

  if (parts.length === 2 && parts[1] === "presign" && method === "POST") {
    return presignFile(request, env, parts[0], url);
  }

  if (parts.length === 1 && method === "PUT") {
    const id = parts[0];
    const body = await parseBody(request, fileUpdate);
    if (!body.ok) return body.response;
    const data = body.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); vals.push(safeName(data.name)); }
    if (data.subjectId !== undefined) { sets.push("subject_id = ?"); vals.push(data.subjectId); }
    if (data.category !== undefined) { sets.push("category = ?"); vals.push(data.category); }
    if (data.pinned !== undefined) { sets.push("pinned = ?"); vals.push(data.pinned ? 1 : 0); }
    if (data.tags !== undefined) { sets.push("tags = ?"); vals.push(JSON.stringify(data.tags)); }
    if (data.note !== undefined) { sets.push("note = ?"); vals.push(data.note); }
    if (data.localOnly !== undefined) { sets.push("local_only = ?"); vals.push(data.localOnly ? 1 : 0); }
    const prefix = sets.length ? `${sets.join(", ")}, ` : "";
    const result = await env.DB.prepare(
      `UPDATE files SET ${prefix}rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ? AND deleted_at IS NULL`,
    ).bind(...vals, now, id, data.rev).run();
    if (changesOf(result) === 0) {
      const current = await getRow(env, "SELECT * FROM files WHERE id = ? AND deleted_at IS NULL", [id]);
      if (!current) return notFound();
      return conflict(current);
    }
    const item = await getRow(env, "SELECT * FROM files WHERE id = ?", [id]);
    return json({ item, rev: revOf(item, data.rev + 1) });
  }

  if (parts.length === 1 && method === "DELETE") {
    const id = parts[0];
    const rev = await readOptionalRev(request);
    const current = await getRow(env, "SELECT * FROM files WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!current) return notFound();
    if (rev !== null && revOf(current, 0) !== rev) return conflict(current);
    const result = await env.DB.prepare(
      "UPDATE files SET deleted_at = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    ).bind(now, now, id).run();
    if (changesOf(result) === 0) return conflict(current);
    // 只软删行，R2 对象保留等 GC，绝不 delete object（§8.8）
    return json({ ok: true });
  }

  return notFound();
}
