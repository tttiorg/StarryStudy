/** D1 的 snake_case 行 → API 的 camelCase 对象。只在 Worker 的 db.ts 里调用。 */
export function camelize<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out as T;
}

/** D1 里用 TEXT 存的子对象，读出来要还原；坏数据不能让整个请求 500。 */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function bool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

export function clampText(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 常量时间字符串比较。Workers 没有 timingSafeEqual，自己实现：
 * 长度不同也要走完循环，避免按内容长度泄密。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/** HTML 实体解码。BB 把中文写成 &#x8bbf;，不解码标题全是乱码。 */
export function decodeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function stripTags(s: string): string {
  return decodeHtml(String(s ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
