import { verifyCollectorToken } from "./auth";
import {
  ids, ingestGrades, ingestTasks, nowIso, parseJson, todayInTZ,
} from "@starry/shared";
import type {
  IngestGrade, IngestTask, IngestSummary, WorkerConfig,
} from "@starry/shared";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { changesOf } from "./db";
import { json, notFound, parseBody, unauthorized, workerConfig } from "./util";
import type { Env } from "./types";

type Kind = "tasks" | "grades";
type Item = IngestTask | IngestGrade;

// 采集器与浏览器走同一套 API，区别只是采集器带令牌、只能写 src=bb 的记录。
export async function handleIngest(
  request: Request,
  env: Env,
  parts: string[],
): Promise<Response> {
  const kind = parts[0] as Kind;
  if (parts.length !== 1 || (kind !== "tasks" && kind !== "grades") ||
      request.method.toUpperCase() !== "POST") {
    return notFound();
  }
  const cfg = workerConfig(env).worker;
  // 常量时间比对；没配令牌时一律拒绝，避免空令牌被当成匹配
  if (!verifyCollectorToken(request, env)) return unauthorized();

  if (kind === "tasks") {
    const body = await parseBody(request, ingestTasks);
    if (!body.ok) return body.response;
    return guardedIngest(env, "tasks", body.data.items, cfg);
  }
  const body = await parseBody(request, ingestGrades);
  if (!body.ok) return body.response;
  return guardedIngest(env, "grades", body.data.items, cfg);
}

/** batch 异常会整批回滚；以前这时顶层直接 500，sync_runs 一条记录都没有，故障不可见。 */
async function guardedIngest(
  env: Env, kind: Kind, items: Item[], cfg: WorkerConfig,
): Promise<Response> {
  try {
    return await runIngest(env, kind, items, cfg);
  } catch (e) {
    const error = `写入异常：${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
    try {
      await env.DB.prepare(
        "INSERT INTO sync_runs (id, source, ok, created, updated, skipped, error, ran_at) VALUES (?, ?, 0, 0, 0, 0, ?, ?)",
      ).bind(ids.syncRun(), kind, error, nowIso()).run();
    } catch { /* 记录失败不能盖住原始异常 */ }
    throw e;
  }
}

/**
 * §8.7 学科匹配：采集器已按 calendarName 精确匹配出 subjectId（它手里有事件上下文，
 * 服务端只有 srcKey，拿不到 calendarName），先信任；再用 course_id 精确匹配兜底：
 * subjects.bb_course_id -> settings['bb.map'] 手工映射。都对不上就返回 NULL。
 * 绝不按课程名做模糊匹配：名字相近的两门课会被错配到别的学科。
 */
async function resolveSubjectId(
  env: Env,
  srcKey: string,
  provided: string | null,
): Promise<string | null> {
  if (provided) {
    const found = await env.DB.prepare(
      "SELECT 1 FROM subjects WHERE id = ? AND deleted_at IS NULL",
    ).bind(provided).first();
    if (found) return provided;
  }
  // grades 的 srcKey 形如 bb:<courseId>:<rowId>，能抠出 courseId 做精确匹配
  const m = /^bb:([^:]+):/.exec(srcKey);
  if (!m) return null;
  const courseId = m[1];
  const byCourse = await env.DB.prepare(
    "SELECT id FROM subjects WHERE bb_course_id = ? AND deleted_at IS NULL",
  ).bind(courseId).first();
  if (byCourse) return String((byCourse as { id: string }).id);

  const mapRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'bb.map'").first();
  const map = parseJson<Record<string, string>>((mapRow as { value?: string } | null)?.value, {});
  const mapped = map[courseId];
  if (mapped) {
    const found = await env.DB.prepare(
      "SELECT 1 FROM subjects WHERE id = ? AND deleted_at IS NULL",
    ).bind(mapped).first();
    if (found) return mapped;
  }
  return null;
}

/**
 * done 的唯一派生处（§8.2）。三条规则缺一不可：
 * ① done_manual 有值 = 人手动勾过，永远听人的，自动派生不许覆盖；
 * ② 今天之前的条目只升不降（done = old.done || bbDone）；
 * ③ 今天及以后完全以 BB 为准。
 *
 * 为什么不能写成单向锁：v1 曾经把当天到期的一条作业误标成完成，之后状态再也回不来，
 * 页面上这条直接消失，用户以为抓漏了、排查很久才发现数据一直在库里。
 * 规则②同样不能省：历史作业若被翻回未完成，会冒出一堆无用的「逾期 N 天」，
 * 同样是灾难，所以历史就让它保持原样。
 *
 * 通用原则：任何自动派生字段都必须有回退路径，没有回退路径的自动写入迟早固化一次错误。
 */
function deriveDone(old: Record<string, unknown> | null, item: IngestTask, today: string): number {
  const manual = old ? old.done_manual : null;
  if (manual !== null && manual !== undefined) return Number(manual) === 1 ? 1 : 0;
  if (String(item.due) < today) {
    const oldDone = old ? Number(old.done) === 1 : false;
    return oldDone || item.bbDone ? 1 : 0;
  }
  return item.bbDone ? 1 : 0;
}

// 新建记录：除白名单外写 src / src_key / created_at；手填字段不碰
function buildInsert(
  env: Env,
  kind: Kind,
  item: Item,
  subjectId: string | null,
  now: string,
  today: string,
): D1PreparedStatement {
  if (kind === "tasks") {
    const t = item as IngestTask;
    return env.DB.prepare(
      `INSERT INTO tasks
       (id, title, due, time, type, place, note, subject_id, done, done_manual, src, src_key, rev, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'bb', ?, 1, ?, ?)`,
    ).bind(
      ids.task(), t.title, t.due, t.time, t.type, t.place, t.note,
      subjectId, deriveDone(null, t, today), t.srcKey, now, now,
    );
  }
  const g = item as IngestGrade;
  return env.DB.prepare(
    `INSERT INTO grades
     (id, name, subject_id, score, full, weight, type, date, note, src, src_key, rev, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, '', 'bb', ?, 1, ?, ?)`,
  ).bind(
    ids.grade(), g.name, subjectId, g.score, g.full, g.type, g.date, g.srcKey, now, now,
  );
}

/** 值相等（含 null / undefined / "" 归一）时不写，避免每小时无故 bump rev。 */
function differs(old: unknown, next: unknown): boolean {
  const norm = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  return norm(old) !== norm(next);
}

// 更新已存在记录：只改白名单字段且只在真的变化时改，rev 由服务端自增。
// 绝不动 done_manual / weight / note / tags / pinned，也不用 INSERT OR REPLACE（D-02）。
// 返回 null 表示本条没有任何变化：以前无条件 UPDATE 会让每小时采集都把 rev+1，
// 用户编辑带着旧 rev 就必然 409，还会把用户改过的 note/时间覆盖回 BB 的值。
function buildUpdate(
  env: Env,
  kind: Kind,
  old: Record<string, unknown>,
  item: Item,
  subjectId: string | null,
  now: string,
  today: string,
): D1PreparedStatement | null {
  const rev = Number(old.rev);
  const id = String(old.id);
  const emptySubject = old.subject_id === null || old.subject_id === undefined;
  const sets: string[] = [];
  const vals: unknown[] = [];
  const put = (column: string, oldVal: unknown, nextVal: unknown): void => {
    if (differs(oldVal, nextVal)) {
      sets.push(`${column} = ?`);
      vals.push(nextVal);
    }
  };

  if (kind === "tasks") {
    const t = item as IngestTask;
    put("title", old.title, t.title);
    put("due", old.due, t.due);
    put("time", old.time, t.time);
    put("type", old.type, t.type);
    put("place", old.place, t.place);
    // note 是用户可编辑字段，采集器只在新建时给初始值，之后绝不覆盖（与 grades 一致）
    put("done", old.done, deriveDone(old, t, today));
    if (emptySubject && subjectId) put("subject_id", old.subject_id, subjectId);
  } else {
    const g = item as IngestGrade;
    put("name", old.name, g.name);
    put("score", old.score, g.score);
    put("full", old.full, g.full);
    put("type", old.type, g.type);
    put("date", old.date, g.date);
    if (emptySubject && subjectId) put("subject_id", old.subject_id, subjectId);
  }

  if (!sets.length) return null;
  vals.push(now, id, rev);
  return env.DB.prepare(
    `UPDATE ${kind === "tasks" ? "tasks" : "grades"} SET ${sets.join(", ")}, rev = rev + 1, updated_at = ?
     WHERE id = ? AND rev = ? AND deleted_at IS NULL`,
  ).bind(...vals);
}

async function runIngest(
  env: Env,
  kind: Kind,
  items: Item[],
  cfg: WorkerConfig,
): Promise<Response> {
  const table = kind === "tasks" ? "tasks" : "grades";
  const today = todayInTZ();
  const now = nowIso();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const insertStmts: D1PreparedStatement[] = [];
  const updateOps: Array<{
    stmt: D1PreparedStatement;
    srcKey: string;
    item: Item;
    subjectId: string | null;
  }> = [];

  let unchanged = 0;     // 值没变化，连 UPDATE 都不发：每小时跑时不该白白 bump rev
  let softDeleted = 0;    // D-01 软删行跳过，是正常行为，不算失败
  for (const item of items) {
    // 不限 deleted_at：要先看见软删行才能按 D-01 跳过
    const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE src_key = ?`)
      .bind(item.srcKey).first();
    const row = existing as Record<string, unknown> | null;

    if (row) {
      // D-01：软删行仍占着 src_key 唯一索引，匹配到就跳过，绝不 upsert 复活
      if (row.deleted_at !== null && row.deleted_at !== undefined) {
        softDeleted += 1;
        continue;
      }
      const subjectId = await resolveSubjectId(env, item.srcKey, item.subjectId);
      const stmt = buildUpdate(env, kind, row, item, subjectId, now, today);
      if (!stmt) {
        unchanged += 1;
        continue;
      }
      updateOps.push({ stmt, srcKey: item.srcKey, item, subjectId });
    } else {
      const subjectId = await resolveSubjectId(env, item.srcKey, item.subjectId);
      insertStmts.push(buildInsert(env, kind, item, subjectId, now, today));
    }
  }

  const stmts = [...insertStmts, ...updateOps.map((o) => o.stmt)];
  // 一次请求内多条写放进一个 batch，要么一起成功要么一起回滚（CF-02）
  const results: unknown[] = stmts.length ? await env.DB.batch(stmts) : [];
  created = insertStmts.length;

  let failedWrites = 0; // 重试后仍写不进去的条目，才算真的失败
  for (let i = 0; i < updateOps.length; i += 1) {
    const op = updateOps[i];
    if (changesOf(results[insertStmts.length + i]) > 0) {
      updated += 1;
      continue;
    }
    // §8.6：读到旧 rev 就重读一次再写，最多重试 2 次
    let settled = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fresh = await env.DB.prepare(
        `SELECT * FROM ${table} WHERE src_key = ? AND deleted_at IS NULL`,
      ).bind(op.srcKey).first();
      if (!fresh) break;
      const retry = buildUpdate(
        env, kind, fresh as Record<string, unknown>, op.item, op.subjectId, nowIso(), today,
      );
      // 重读后发现本来就没变化，不算失败：不写、不冲突、不 bump rev
      if (!retry) { unchanged += 1; settled = true; break; }
      if (changesOf(await retry.run()) > 0) { updated += 1; settled = true; break; }
    }
    if (!settled) { skipped += 1; failedWrites += 1; }
  }
  skipped += softDeleted + unchanged;

  // ok 由真实结果决定：软删跳过与「无变化」都正常，只有写不进去才算失败。
  // 失败也照实写进 sync_runs，网页「数据概览」才不会永远只显示成功。
  const ok = failedWrites === 0 ? 1 : 0;
  const error = failedWrites > 0 ? `${failedWrites} 条写入失败（rev 冲突）` : "";
  await env.DB.prepare(
    "INSERT INTO sync_runs (id, source, ok, created, updated, skipped, error, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(ids.syncRun(), kind, ok, created, updated, skipped, error, nowIso()).run();

  // 通知失败不能影响写入结果；内容只报条数，不含任何课程名或成绩
  if (created > 0 && cfg.noticeWebhookUrl) {
    try {
      await fetch(cfg.noticeWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: {
            content: `学习工作台采集完成：新增 ${created} 条${kind === "tasks" ? "日程" : "成绩"}`,
          },
        }),
      });
    } catch {
      // 通知是尽力而为，落库已完成
    }
  }

  const summary: IngestSummary = { created, updated, skipped };
  return json(summary);
}
