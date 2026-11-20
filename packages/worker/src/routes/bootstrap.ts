import { addDays, ids, nowIso, parseJson, todayInTZ } from "@starry/shared";
import type { BootstrapPayload, Link, NoticeCounts, Subject, SyncRun, SyncStatus } from "@starry/shared";
import { authState } from "../auth";
import { listRows } from "../db";
import { getTimetable } from "./timetable";
import { json } from "../util";
import type { Env } from "../types";

async function count(env: Env, sql: string, params: unknown[] = []): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...params).first();
  return Number((row as { c?: number } | null)?.c ?? 0) || 0;
}

async function noticeCounts(env: Env): Promise<NoticeCounts> {
  const today = todayInTZ();
  const seenRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'noticeSeenAt'").first();
  const seenAt = (seenRow as { value?: string } | null)?.value || "";
  // §8.9：第一次打开没有水位时全部算新，不能把启动时刻当水位，
  // 否则历史成绩永远不算新，用户会觉得铃铛坏了。
  const cutoff = seenAt ? " AND created_at > ?" : "";
  const cutoffVals = seenAt ? [seenAt] : [];
  const newTasks = await count(
    env, `SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL${cutoff}`, cutoffVals,
  );
  const newGrades = await count(
    env, `SELECT COUNT(*) AS c FROM grades WHERE deleted_at IS NULL${cutoff}`, cutoffVals,
  );
  const urgent = await count(
    env,
    "SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND done = 0 AND due <= ?",
    [addDays(today, 1)],
  );
  // 红点的最终判定由前端 localStorage 里的 id 集合负责（§8.9）：比对「有没有新增的 id」，
  // 不是「集合是否相同」。这里三组计数只是 bootstrap 的粗粒度提示，不能拿它当红点开关。
  return { urgent, newTasks, newGrades };
}

async function readBbMap(env: Env): Promise<Record<string, string>> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'bb.map'").first();
  return parseJson<Record<string, string>>((row as { value?: string } | null)?.value, {});
}

export async function bootstrapResponse(env: Env): Promise<Response> {
  const payload: BootstrapPayload = {
    auth: await authState(env),
    subjects: await listRows<Subject>(
      env, "SELECT * FROM subjects WHERE deleted_at IS NULL ORDER BY sort ASC, created_at ASC",
    ),
    timetable: await getTimetable(env),
    links: await listRows<Link>(
      env, "SELECT * FROM links WHERE deleted_at IS NULL ORDER BY sort ASC, created_at ASC",
    ),
    notice: await noticeCounts(env),
    // 采集器靠它把 BB 课程精确对上学科；随 bootstrap 一起下发，免得再单独取一次
    bbMap: await readBbMap(env),
  };
  return json(payload);
}

// 采集器只需要手工映射。令牌持有者不该顺便拿到课表、外链、通知计数与登录状态。
export async function collectorBootstrapResponse(env: Env): Promise<Response> {
  return json({ bbMap: await readBbMap(env) });
}

export async function syncStatusResponse(env: Env): Promise<Response> {
  const items = await listRows<SyncRun>(
    env, "SELECT * FROM sync_runs ORDER BY ran_at DESC LIMIT 20",
  );
  const pendingRow = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'sync.requestedAt'",
  ).first();
  const payload: SyncStatus = {
    items,
    lastRunAt: items[0]?.ranAt ?? null,
    pendingAt: (pendingRow as { value?: string } | null)?.value || null,
  };
  return json(payload);
}

// 网页跑在云端，没法直接启动用户电脑上的采集器。「手动抓取」只登记一次请求，
// 本机采集器下次运行（npm run collect）时消费掉，抓取结果由 /api/ingest/* 写进
// sync_runs，设置页刷新后就能看到新的最近抓取时间。
export async function syncRequestResponse(env: Env): Promise<Response> {
  const at = nowIso();
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('sync.requestedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(at).run();
  return json({ ok: true, requestedAt: at });
}

// 只认采集器令牌：跑完才清标记，没跑成/没配置时请求一直留着，状态不会假装成功。
export async function syncAckResponse(env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM settings WHERE key = 'sync.requestedAt'").run();
  return json({ ok: true });
}

/** 保留最近 200 条抓取记录；每小时跑会稳定写入，不清会一直涨。 */
async function pruneSyncRuns(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "DELETE FROM sync_runs WHERE id IN (SELECT id FROM sync_runs ORDER BY ran_at DESC LIMIT -1 OFFSET 200)",
    ).run();
  } catch {
    // 清理失败不能影响写入与状态展示
  }
}

/**
 * 采集器上报一轮失败。以前失败只打在本机 stdout，云端 sync_runs 永远只有 ok=1，
 * 无人值守下「每小时都成功但数据不再更新」这种故障完全不可见。
 */
export async function syncFailResponse(env: Env, body: unknown): Promise<Response> {
  const b = (body && typeof body === "object" ? body : {}) as { source?: unknown; error?: unknown };
  const source = b.source === "tasks" ? "tasks" : "grades";
  const error = String(b.error ?? "采集失败").slice(0, 500);
  await env.DB.prepare(
    "INSERT INTO sync_runs (id, source, ok, created, updated, skipped, error, ran_at) VALUES (?, ?, 0, 0, 0, 0, ?, ?)",
  ).bind(ids.syncRun(), source, error, nowIso()).run();
  await pruneSyncRuns(env);
  return json({ ok: true });
}

export async function noticeSeenResponse(env: Env): Promise<Response> {
  // 跨设备共用的水位时间；写入后其它设备下次 bootstrap 就按这个时间算新增
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('noticeSeenAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(nowIso()).run();
  return json({ ok: true });
}
