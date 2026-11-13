import { bool, camelize, parseJson } from "@starry/shared";
import type { Env } from "./types";

// 行 → 对象只在 Worker 里做一次：数据库是 snake_case，API 一律 camelCase。
// JSON 子对象还原、布尔字段还原也集中在这里，路由里拿到的就是最终形状。
const JSON_ARRAY_FIELDS = new Set(["tags", "log"]);
const JSON_OBJECT_FIELDS = new Set(["course", "faculty"]);
const BOOL_FIELDS = new Set(["done", "pinned", "mastered", "ok", "localOnly"]);

export function rowToObject<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const obj = camelize<Record<string, unknown>>(row);
  for (const key of Object.keys(obj)) {
    if (JSON_ARRAY_FIELDS.has(key)) obj[key] = parseJson<unknown[]>(obj[key], []);
    else if (JSON_OBJECT_FIELDS.has(key)) obj[key] = parseJson<Record<string, unknown> | null>(obj[key], null);
    else if (BOOL_FIELDS.has(key)) obj[key] = bool(obj[key]);
  }
  // done_manual 是三态（NULL / 0 / 1）：NULL 表示「人没手动勾过」。
  // 压成布尔会让 §8.2 规则① 把「没勾过」误判成「手动勾了未完成」。
  if ("doneManual" in obj) {
    obj.doneManual = obj.doneManual === null || obj.doneManual === undefined ? null : bool(obj.doneManual);
  }
  return obj as T;
}

// D1 在不同运行时把变更数放在 meta.changes 或顶层 changes，两处都兼容。
export function changesOf(result: unknown): number {
  const r = result as { meta?: { changes?: number }; changes?: number } | null | undefined;
  return Number(r?.meta?.changes ?? r?.changes ?? 0) || 0;
}

export async function listRows<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await env.DB.prepare(sql).bind(...params).all();
  const rows = (r.results ?? []) as unknown as Record<string, unknown>[];
  return rows.map((row) => rowToObject<T>(row));
}

export async function getRow<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const row = await env.DB.prepare(sql).bind(...params).first();
  return row ? rowToObject<T>(row as Record<string, unknown>) : null;
}
