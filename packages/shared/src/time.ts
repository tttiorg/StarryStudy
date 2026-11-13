// 全项目唯一允许直接 new Date() / Intl 的地方。
// Workers 与 D1 默认 UTC，直接用系统时间会让「今天」错一天（CF-06）。
// 业务代码一律调 todayInTZ() / nowIso()，不要自己算日期。

export const TIME_ZONE = "Asia/Shanghai";

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  weekday: number; // 1 = 周一，7 = 周日
}

function parts(now: Date): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  // getDay(): 0=周日，转成 1-7 与课表 day 字段对齐
  const jsDay = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" })
    .format(now);
  const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = order.indexOf(jsDay) === 0 ? 7 : order.indexOf(jsDay);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, weekday };
}

/** 本地日期 YYYY-MM-DD。所有「今天 / 逾期 / 待复习」判断都用它。 */
export function todayInTZ(now: Date = new Date()): string {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

export function hhmmInTZ(now: Date = new Date()): string {
  const p = parts(now);
  return `${p.hour}:${p.minute}`;
}

export function weekdayInTZ(now: Date = new Date()): number {
  return parts(now).weekday;
}

/** ISO 8601 UTC 字符串，用于 created_at / updated_at / deleted_at。 */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

/** 日期型字段的加减。用 UTC 正午做锚点，避免任何时区/夏令时把日期挪一天。 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 两个 YYYY-MM-DD 之间相差的天数（b - a）。只做字符串安全的整数比较。 */
export function diffDays(a: string, b: string): number {
  const ua = Date.parse(`${a}T12:00:00.000Z`);
  const ub = Date.parse(`${b}T12:00:00.000Z`);
  return Math.round((ub - ua) / 86_400_000);
}

export function isDateString(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function isTimeString(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/**
 * BB 给的 start 是「不带时区的本地时间字符串」（2026-09-17T23:59:00）。
 * 用 new Date(start) 会引入 UTC 偏移，把 23:59 挪到第二天，所以只切字符串。
 */
export function splitLocalDateTime(start: string): { date: string; hhmm: string } {
  return { date: start.slice(0, 10), hhmm: start.slice(11, 16) };
}

/** 毫秒时间戳转 YYYY-MM-DD（BB 成绩的 duedate / lastactivity）。 */
export function dateFromEpochMs(ms: number): string {
  if (!ms) return "";
  return todayInTZ(new Date(ms));
}
