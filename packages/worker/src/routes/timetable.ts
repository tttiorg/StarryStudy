import {
  BLOCKS, MAX_BLOCKS, MIN_BLOCK, nowIso, parseJson,
  timetableBlocks, timetableBulk, timetableMeta, timetableSlot,
} from "@starry/shared";
import type { TimetableBlock, TimetablePayload, TimetableMeta, TimetableSlot } from "@starry/shared";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getRow, listRows } from "../db";
import { conflict, json, notFound, parseBody, revOf } from "../util";
import type { Env } from "../types";

const BLOCKS_KEY = "timetable.blocks";

/**
 * 读自定义节次。settings 里没有、JSON 坏了、字段类型不对或序号不连续，
 * 一律回退默认 BLOCKS —— 自动派生字段必须有回退路径，宁可用默认值也不能白屏。
 */
async function readBlocks(env: Env): Promise<TimetableBlock[]> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(BLOCKS_KEY).first();
  const parsed = parseJson<unknown>((row as { value?: string } | null)?.value, null);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_BLOCKS) return BLOCKS;
  const blocks: TimetableBlock[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const b = parsed[i] as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || b.index !== i + 1) return BLOCKS;
    if (typeof b.label !== "string" || typeof b.time !== "string") return BLOCKS;
    if (b.label.length > 24 || b.time.length > 40) return BLOCKS;
    blocks.push({ index: i + 1, label: b.label, time: b.time });
  }
  return blocks;
}

export async function getTimetable(env: Env): Promise<TimetablePayload> {
  const meta = await getRow<TimetableMeta>(
    env,
    "SELECT semester, student, start_date FROM timetable_meta WHERE id = 1",
  );
  const allSlots = await listRows<TimetableSlot>(env, "SELECT * FROM timetable_slots");
  const blocks = await readBlocks(env);
  // 只下发当前节次范围内的格子。减少节数时不删 DB 里的旧课（数据不丢），
  // 用户把节数加回去后它们会重新出现；前端看到的格子数始终等于 blocks 数。
  const maxIndex = blocks.length;
  const slots = allSlots.filter((s) => s.block >= MIN_BLOCK && s.block <= maxIndex);
  return {
    meta: meta ?? { semester: "", student: "", startDate: "" },
    blocks,
    slots,
  };
}

type SlotShape = {
  name: string; room: string; teacher: string; weeks: string; subjectId: string | null;
};

function isEmptySlot(s: SlotShape): boolean {
  return !s.name && !s.room && !s.teacher && !s.weeks && !s.subjectId;
}

const UPSERT_SLOT =
  `INSERT INTO timetable_slots (day, block, name, room, teacher, weeks, subject_id, rev, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
   ON CONFLICT(day, block) DO UPDATE SET
     name = excluded.name, room = excluded.room, teacher = excluded.teacher,
     weeks = excluded.weeks, subject_id = excluded.subject_id,
     rev = timetable_slots.rev + 1, updated_at = excluded.updated_at`;

export async function handleTimetable(
  request: Request,
  env: Env,
  parts: string[],
  method: string,
): Promise<Response> {
  const now = nowIso();

  if (parts.length === 0 && method === "GET") {
    return json(await getTimetable(env));
  }

  if (parts.length === 1 && parts[0] === "meta" && method === "PUT") {
    const body = await parseBody(request, timetableMeta);
    if (!body.ok) return body.response;
    const data = body.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (data.semester !== undefined) { sets.push("semester = ?"); vals.push(data.semester); }
    if (data.student !== undefined) { sets.push("student = ?"); vals.push(data.student); }
    if (data.startDate !== undefined) { sets.push("start_date = ?"); vals.push(data.startDate); }
    if (sets.length) {
      await env.DB.prepare(`UPDATE timetable_meta SET ${sets.join(", ")} WHERE id = 1`).bind(...vals).run();
    }
    const item = await getRow(env, "SELECT semester, student, start_date FROM timetable_meta WHERE id = 1");
    return json({ item });
  }

  if (parts.length === 1 && parts[0] === "blocks" && method === "PUT") {
    // 节次是 settings 里的一行单点配置，不是带 rev 的业务记录；沿用
    // sync.requestedAt / bb.map 的既有写法整体替换，不引入伪 rev。
    const body = await parseBody(request, timetableBlocks);
    if (!body.ok) return body.response;
    const blocks = body.data.blocks;
    await env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).bind(BLOCKS_KEY, JSON.stringify(blocks)).run();
    return json({ ok: true, blocks });
  }

  if (parts.length === 1 && parts[0] === "slot" && method === "PUT") {
    const body = await parseBody(request, timetableSlot);
    if (!body.ok) return body.response;
    const s = body.data;
    const existing = await getRow<Record<string, unknown>>(
      env,
      "SELECT * FROM timetable_slots WHERE day = ? AND block = ?",
      [s.day, s.block],
    );
    // 带 rev 就先校验旧 rev，不匹配直接 409，让前端展示服务端当前这一格
    if (s.rev !== undefined && existing && Number(existing.rev) !== s.rev) return conflict(existing);

    if (isEmptySlot(s)) {
      // 字段全空 = 清空这一格，删掉该行即可，绝不整份覆盖
      if (existing) {
        await env.DB.prepare("DELETE FROM timetable_slots WHERE day = ? AND block = ?")
          .bind(s.day, s.block).run();
      }
      return json({ item: null, rev: 0 });
    }
    // 只写 (day, block) 这一格：平板昨天打开今天才保存也只影响自己改的格（§8.1）
    await env.DB.prepare(UPSERT_SLOT)
      .bind(s.day, s.block, s.name, s.room, s.teacher, s.weeks, s.subjectId, now).run();
    const item = await getRow(
      env,
      "SELECT * FROM timetable_slots WHERE day = ? AND block = ?",
      [s.day, s.block],
    );
    return json({ item, rev: revOf(item, 1) });
  }

  if (parts.length === 1 && parts[0] === "bulk" && method === "PUT") {
    // 仅供导入使用：日常编辑一律走单格（§5.3 已删除整份替换的常规入口）
    const body = await parseBody(request, timetableBulk);
    if (!body.ok) return body.response;
    const { slots, mode } = body.data;
    const stmts: D1PreparedStatement[] = [];
    if (mode === "replace") {
      stmts.push(env.DB.prepare("DELETE FROM timetable_slots"));
    }
    for (const s of slots) {
      if (isEmptySlot(s)) {
        // merge 下提交的全空格表示清掉这一格；replace 已经先清空，无需再删
        if (mode === "merge") {
          stmts.push(env.DB.prepare("DELETE FROM timetable_slots WHERE day = ? AND block = ?")
            .bind(s.day, s.block));
        }
        continue;
      }
      stmts.push(env.DB.prepare(UPSERT_SLOT)
        .bind(s.day, s.block, s.name, s.room, s.teacher, s.weeks, s.subjectId, now));
    }
    if (stmts.length) await env.DB.batch(stmts); // 多条写放一个事务（CF-02）
    return json({ ok: true });
  }

  return notFound();
}
