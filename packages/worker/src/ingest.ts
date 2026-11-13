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
    return runIngest(env, "tasks", body.data.items, cfg);
  }
  const body = await parseBody(request, ingestGrades);
  if (!body.ok) return body.response;
  return runIngest(env, "grades", body.data.items, cfg);
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

// 更新已存在记录：只改白名单字段，rev 由服务端自增。
// 绝不动 done_manual / weight / note(成绩) / tags / pinned，也不用 INSERT OR REPLACE（D-02）。
function buildUpdate(
  env: Env,
  kind: Kind,
  old: Record<string, unknown>,
  item: Item,
  subjectId: string | null,
  now: string,
  today: string,
): D1PreparedStatement {
  const rev = Number(old.rev);
  const id = String(old.id);
  const emptySubject = old.subject_id === null || old.subject_id === undefined;

  if (kind === "tasks") {
    const t = item as IngestTask;
    const sets = ["title = ?", "due = ?", "time = ?", "type = ?", "place = ?", "note = ?"];
    const vals: unknown[] = [t.title, t.due, t.time, t.type, t.place, t.note];
    // subject_id 仅当当前为空才写，绝不覆盖用户后来手动归的学科
    if (emptySubject && subjectId) {
      sets.push("subject_id = ?");
      vals.push(subjectId);
    }
    sets.push("done = ?");
    vals.push(deriveDone(old, t, today));
    vals.push(now, id, rev);
    return env.DB.prepare(
      `UPDATE tasks SET ${sets.join(", ")}, rev = rev + 1, updated_at = ?
       WHERE id = ? AND rev = ? AND deleted_at IS NULL`,
    ).bind(...vals);
  }

  const g = item as IngestGrade;
  const sets = ["name = ?", "score = ?", "full = ?", "type = ?", "date = ?"];
  const vals: unknown[] = [g.name, g.score, g.full, g.type, g.date];
  if (emptySubject && subjectId) {
    sets.push("subject_id = ?");
    vals.push(subjectId);
  }
  vals.push(now, id, rev);
  return env.DB.prepare(
    `UPDATE grades SET ${sets.join(", ")}, rev = rev + 1, updated_at = ?
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

  for (const item of items) {
    // 不限 deleted_at：要先看见软删行才能按 D-01 跳过
    const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE src_key = ?`)
      .bind(item.srcKey).first();
    const row = existing as Record<string, unknown> | null;

    if (row) {
      // D-01：软删行仍占着 src_key 唯一索引，匹配到就跳过，绝不 upsert 复活
      if (row.deleted_at !== null && row.deleted_at !== undefined) {
        skipped += 1;
        continue;
      }
      const subjectId = await resolveSubjectId(env, item.srcKey, item.subjectId);
      updateOps.push({
        stmt: buildUpdate(env, kind, row, item, subjectId, now, today),
        srcKey: item.srcKey,
        item,
        subjectId,
      });
    } else {
      const subjectId = await resolveSubjectId(env, item.srcKey, item.subjectId);
      insertStmts.push(buildInsert(env, kind, item, subjectId, now, today));
    }
  }

  const stmts = [...insertStmts, ...updateOps.map((o) => o.stmt)];
  // 一次请求内多条写放进一个 batch，要么一起成功要么一起回滚（CF-02）
  const results: unknown[] = stmts.length ? await env.DB.batch(stmts) : [];
  created = insertStmts.length;

  for (let i = 0; i < updateOps.length; i += 1) {
    const op = updateOps[i];
    if (changesOf(results[insertStmts.length + i]) > 0) {
      updated += 1;
      continue;
    }
    // §8.6：读到旧 rev 就重读一次再写，最多重试 2 次
    let ok = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fresh = await env.DB.prepare(
        `SELECT * FROM ${table} WHERE src_key = ? AND deleted_at IS NULL`,
      ).bind(op.srcKey).first();
      if (!fresh) break;
      const retry = await buildUpdate(
        env, kind, fresh as Record<string, unknown>, op.item, op.subjectId, nowIso(), today,
      ).run();
      if (changesOf(retry) > 0) {
        ok = true;
        break;
      }
    }
    if (ok) updated += 1;
    else skipped += 1;
  }

  await env.DB.prepare(
    "INSERT INTO sync_runs (id, source, ok, created, updated, skipped, error, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(ids.syncRun(), kind, 1, created, updated, skipped, "", nowIso()).run();

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
