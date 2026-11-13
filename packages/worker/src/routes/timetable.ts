import { BLOCKS, nowIso, timetableBulk, timetableMeta, timetableSlot } from "@starry/shared";
import type { TimetablePayload, TimetableMeta, TimetableSlot } from "@starry/shared";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getRow, listRows } from "../db";
import { conflict, json, notFound, parseBody, revOf } from "../util";
import type { Env } from "../types";

export async function getTimetable(env: Env): Promise<TimetablePayload> {
  const meta = await getRow<TimetableMeta>(
    env,
    "SELECT semester, student, start_date FROM timetable_meta WHERE id = 1",
  );
  const slots = await listRows<TimetableSlot>(env, "SELECT * FROM timetable_slots");
  return {
    meta: meta ?? { semester: "", student: "", startDate: "" },
    blocks: BLOCKS,
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
