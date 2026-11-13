import {
  REVIEW_INTERVALS, addDays, gradeCreate, gradeUpdate, ids, isDateString,
  knowledgeCreate, knowledgeReview, knowledgeUpdate, linkCreate, linkUpdate,
  noteCreate, noteUpdate, nowIso, reorder, subjectCreate, subjectUpdate,
  taskCreate, taskUpdate, todayInTZ,
} from "@starry/shared";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { changesOf, getRow, listRows } from "../db";
import {
  apiError, conflict, json, notFound, parseBody, readOptionalRev, revOf,
  type SchemaLike,
} from "../util";
import type { Env } from "../types";

export type CrudResource = "subjects" | "tasks" | "grades" | "notes" | "knowledge" | "links";

type Transform = (v: unknown) => unknown;
type FieldMap = Record<string, [column: string, transform?: Transform]>;

interface WhereResult {
  clause: string;
  vals: unknown[];
  error?: string;
}

interface CrudDef {
  table: string;
  idFn: () => string;
  create: SchemaLike;
  update: SchemaLike;
  fields: FieldMap;
  // 新建时额外写入的固定列（src 归属、艾宾浩斯初值等），不参与更新
  fixed: (now: string, today: string) => Record<string, unknown>;
  order: string;
  listWhere?: (url: URL, today: string) => WhereResult;
}

const asJsonObject = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);
const asBool = (v: unknown): number => (v ? 1 : 0);
const asNullableBool = (v: unknown): number | null =>
  v === null || v === undefined ? null : (v ? 1 : 0);

function subjectFilter(url: URL): WhereResult {
  const sid = url.searchParams.get("subjectId");
  return sid ? { clause: " AND subject_id = ?", vals: [sid] } : { clause: "", vals: [] };
}

const DEFS: Record<CrudResource, CrudDef> = {
  subjects: {
    table: "subjects",
    idFn: ids.subject,
    create: subjectCreate,
    update: subjectUpdate,
    fields: {
      name: ["name"], color: ["color"], note: ["note"], sort: ["sort"],
      course: ["course", asJsonObject], faculty: ["faculty", asJsonObject],
      bbCourseId: ["bb_course_id"],
    },
    fixed: () => ({}),
    order: "sort ASC, created_at ASC",
  },
  tasks: {
    table: "tasks",
    idFn: ids.task,
    create: taskCreate,
    update: taskUpdate,
    fields: {
      title: ["title"], due: ["due"], time: ["time"], type: ["type"],
      place: ["place"], note: ["note"], subjectId: ["subject_id"],
      done: ["done", asBool], doneManual: ["done_manual", asNullableBool],
    },
    fixed: () => ({ src: "manual", src_key: null }),
    order: "due ASC, created_at ASC",
    listWhere: (url) => {
      const w = subjectFilter(url);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (from) {
        if (!isDateString(from)) return { ...w, error: "from 应为 YYYY-MM-DD" };
        w.clause += " AND due >= ?";
        w.vals.push(from);
      }
      if (to) {
        if (!isDateString(to)) return { ...w, error: "to 应为 YYYY-MM-DD" };
        w.clause += " AND due <= ?";
        w.vals.push(to);
      }
      return w;
    },
  },
  grades: {
    table: "grades",
    idFn: ids.grade,
    create: gradeCreate,
    update: gradeUpdate,
    fields: {
      name: ["name"], subjectId: ["subject_id"], score: ["score"], full: ["full"],
      weight: ["weight"], type: ["type"], date: ["date"], note: ["note"],
    },
    fixed: () => ({ src: "manual", src_key: null }),
    order: "date DESC, created_at DESC",
    listWhere: (url) => subjectFilter(url),
  },
  notes: {
    table: "notes",
    idFn: ids.note,
    create: noteCreate,
    update: noteUpdate,
    fields: { title: ["title"], content: ["content"], subjectId: ["subject_id"] },
    fixed: () => ({}),
    order: "updated_at DESC",
    listWhere: (url) => subjectFilter(url),
  },
  knowledge: {
    table: "knowledge",
    idFn: ids.knowledge,
    create: knowledgeCreate,
    update: knowledgeUpdate,
    fields: { title: ["title"], content: ["content"], subjectId: ["subject_id"] },
    // 新建的知识点当天就进入待复习；stage/mastered/log 只能通过 review 动作推进
    fixed: (_now, today) => ({ stage: 0, next_review: today, mastered: 0, log: "[]" }),
    order: "next_review ASC, created_at ASC",
    listWhere: (url, today) => {
      const w = subjectFilter(url);
      if (url.searchParams.get("due") === "1") {
        // 空日期不算到期；掌握的不再出现在待复习里
        w.clause += " AND mastered = 0 AND next_review <> '' AND next_review <= ?";
        w.vals.push(today);
      }
      return w;
    },
  },
  links: {
    table: "links",
    idFn: ids.link,
    create: linkCreate,
    update: linkUpdate,
    fields: { name: ["name"], url: ["url"], icon: ["icon"], sort: ["sort"] },
    fixed: () => ({}),
    order: "sort ASC, created_at ASC",
  },
};

// 艾宾浩斯复习动作。日期一律用 addDays(todayInTZ(), n)，不碰系统时钟（CF-06）。
async function reviewKnowledge(request: Request, env: Env, id: string): Promise<Response> {
  const body = await parseBody(request, knowledgeReview);
  if (!body.ok) return body.response;
  const { action, rev } = body.data;
  const row = await getRow<{
    rev: number; stage: number; mastered: boolean; nextReview: string; log: unknown[];
  }>(env, "SELECT * FROM knowledge WHERE id = ? AND deleted_at IS NULL", [id]);
  if (!row) return notFound();

  const today = todayInTZ();
  const now = nowIso();
  const log = Array.isArray(row.log) ? [...row.log] : [];
  let stage = Number(row.stage) || 0;
  let mastered = row.mastered ? 1 : 0;
  let nextReview = row.nextReview || "";

  if (action === "review") {
    stage += 1;
    // 越过 60 天那一轮后固定 90 天一轮，避免 stage 越界拿到 undefined
    const interval = stage >= 0 && stage < REVIEW_INTERVALS.length ? REVIEW_INTERVALS[stage] : 90;
    nextReview = addDays(today, interval);
  } else if (action === "forgot") {
    stage = 0;
    nextReview = addDays(today, 1);
  } else if (action === "master") {
    mastered = 1;
  } else {
    stage = 0;
    mastered = 0;
    nextReview = today; // 重置后当天重新进入待复习
  }
  log.push({ at: now, action, stage });

  const result = await env.DB.prepare(
    `UPDATE knowledge SET stage = ?, next_review = ?, mastered = ?, log = ?,
     rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ? AND deleted_at IS NULL`,
  ).bind(stage, nextReview, mastered, JSON.stringify(log), now, id, rev).run();
  if (changesOf(result) === 0) {
    const current = await getRow(env, "SELECT * FROM knowledge WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!current) return notFound();
    return conflict(current);
  }
  const item = await getRow(env, "SELECT * FROM knowledge WHERE id = ?", [id]);
  return json({ item, rev: revOf(item, rev + 1) });
}

export async function handleCrud(
  request: Request,
  env: Env,
  resource: CrudResource,
  parts: string[],
  method: string,
  url: URL,
): Promise<Response> {
  const def = DEFS[resource];
  const now = nowIso();
  const today = todayInTZ();

  // reorder 必须在 /:id 之前匹配，否则 "reorder" 会被当成一条记录的 id（v1 踩过）
  if (parts.length === 1 && parts[0] === "reorder" && method === "PUT") {
    if (resource !== "subjects" && resource !== "links") return notFound();
    const body = await parseBody(request, reorder);
    if (!body.ok) return body.response;
    const stmts: D1PreparedStatement[] = body.data.ids.map((id, index) =>
      env.DB.prepare(
        `UPDATE ${def.table} SET sort = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      ).bind(index, now, id),
    );
    if (stmts.length) await env.DB.batch(stmts); // 多条写放一个事务（CF-02）
    return json({ ok: true });
  }

  // 复习动作是知识点的专用写路径，放在 /:id 之前
  if (resource === "knowledge" && parts.length === 2 && parts[1] === "review" && method === "POST") {
    return reviewKnowledge(request, env, parts[0]);
  }

  if (parts.length === 0 && method === "GET") {
    const where: WhereResult = def.listWhere ? def.listWhere(url, today) : { clause: "", vals: [] };
    if (where.error) return apiError("bad_request", where.error);
    const items = await listRows(
      env,
      `SELECT * FROM ${def.table} WHERE deleted_at IS NULL${where.clause} ORDER BY ${def.order}`,
      where.vals,
    );
    return json({ items });
  }

  if (parts.length === 0 && method === "POST") {
    const body = await parseBody(request, def.create);
    if (!body.ok) return body.response;
    const data = body.data as Record<string, unknown>;
    const id = def.idFn();
    const cols: string[] = ["id"];
    const vals: unknown[] = [id];
    for (const [camel, raw] of Object.entries(data)) {
      const m = def.fields[camel];
      if (!m) continue;
      cols.push(m[0]);
      vals.push(m[1] ? m[1](raw) : raw);
    }
    for (const [col, val] of Object.entries(def.fixed(now, today))) {
      cols.push(col);
      vals.push(val);
    }
    cols.push("rev", "created_at", "updated_at");
    vals.push(1, now, now);
    await env.DB.prepare(
      `INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ).bind(...vals).run();
    const item = await getRow(env, `SELECT * FROM ${def.table} WHERE id = ?`, [id]);
    return json({ item, rev: 1 });
  }

  if (parts.length === 1 && method === "PUT") {
    const id = parts[0];
    const body = await parseBody(request, def.update);
    if (!body.ok) return body.response;
    const data = body.data as Record<string, unknown>;
    const rev = Number(data.rev);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [camel, raw] of Object.entries(data)) {
      if (camel === "rev") continue;
      const m = def.fields[camel];
      if (!m) continue;
      sets.push(`${m[0]} = ?`);
      vals.push(m[1] ? m[1](raw) : raw);
    }
    const prefix = sets.length ? `${sets.join(", ")}, ` : "";
    const result = await env.DB.prepare(
      `UPDATE ${def.table} SET ${prefix}rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ? AND deleted_at IS NULL`,
    ).bind(...vals, now, id, rev).run();
    if (changesOf(result) === 0) {
      const current = await getRow(env, `SELECT * FROM ${def.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
      if (!current) return notFound();
      // 409 把服务端当前完整记录交给前端，让用户自己选保留哪份，绝不静默合并
      return conflict(current);
    }
    const item = await getRow(env, `SELECT * FROM ${def.table} WHERE id = ?`, [id]);
    return json({ item, rev: revOf(item, rev + 1) });
  }

  if (parts.length === 1 && method === "DELETE") {
    const id = parts[0];
    const rev = await readOptionalRev(request);
    const current = await getRow(env, `SELECT * FROM ${def.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!current) return notFound();
    if (rev !== null && revOf(current, 0) !== rev) return conflict(current);

    const delStmt = env.DB.prepare(
      `UPDATE ${def.table} SET deleted_at = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    ).bind(now, now, id);
    // 删除学科只解除文件与课表里的引用，资料行与格子的文本都保留，不删任何记录
    const extras: D1PreparedStatement[] = resource === "subjects"
      ? [
          env.DB.prepare(
            "UPDATE files SET subject_id = NULL, rev = rev + 1, updated_at = ? WHERE subject_id = ? AND deleted_at IS NULL",
          ).bind(now, id),
          env.DB.prepare(
            "UPDATE timetable_slots SET subject_id = NULL, rev = rev + 1, updated_at = ? WHERE subject_id = ?",
          ).bind(now, id),
        ]
      : [];
    const results = extras.length
      ? await env.DB.batch([delStmt, ...extras]) // 一次请求内多条写放一个事务（CF-02）
      : [await delStmt.run()];
    if (changesOf(results[0]) === 0) return conflict(current);
    return json({ ok: true });
  }

  return notFound();
}
