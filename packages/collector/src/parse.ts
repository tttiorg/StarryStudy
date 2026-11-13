// 把 BB 返回的 JSON/HTML 解析成与学校无关的中间结构。
// 只做解析，不联网、不写库、不落盘，方便单独核对解析规则。
import {
  decodeHtml,
  stripTags,
  splitLocalDateTime,
  dateFromEpochMs,
  PLACEHOLDER_TIMES,
  TOTAL_ROW_RE,
  type GradeType,
  type TaskType,
} from "@starry/shared";

export interface BbCourse {
  id: string;   // 形如 _8497_1
  name: string; // 课程名，来自 choices / se_context
}

export interface BbGradeRow {
  rowId: string;
  name: string;
  score: number | null; // null = 未评分，不进库
  full: number;
  type: GradeType;
  date: string;         // YYYY-MM-DD 或 ""，已用 dateFromEpochMs 转好
  dueAt: number;        // epoch ms，保留给排序/诊断
}

export interface BbCalendarEvent {
  id: string;
  title: string;
  due: string;
  time: string;
  type: TaskType;
  place: string;
  note: string;
  calendarName: string;
  itemSourceId: string;
  courseId: string;     // 由 calendarName 精确对上课程列表得到，对不上为 ""
}

/** 抠 CAS 登录页里的隐藏令牌；找不到要让调用方报「CAS 可能改版了」。 */
export function pickInput(html: string, name: string): string {
  const re = new RegExp(`<input[^>]*name=["']${name}["'][^>]*>`, "i");
  const tag = html.match(re);
  if (!tag) return "";
  const v = tag[0].match(/value=["']([^"']*)["']/i);
  return v ? decodeHtml(v[1]) : "";
}

export function numOrNull(v: unknown): number | null {
  const raw = String(v ?? "");
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return raw.trim() === "" || !Number.isFinite(n) ? null : n;
}

/** choices 在不同版本里可能是对象或数组，两种都吃下，避免整门课没名字。 */
function normalizeChoices(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  if (Array.isArray(raw)) {
    for (const it of raw) {
      const o = (it ?? {}) as { id?: string; value?: string; label?: string; name?: string };
      const k = String(o.id ?? o.value ?? "");
      const v = String(o.label ?? o.name ?? "");
      if (k) map.set(k, v);
    }
    return map;
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      map.set(k, String(v ?? ""));
    }
  }
  return map;
}

/**
 * streamViewer 的 loadStream 响应：课程 id 在 sv_streamEntries，
 * 课程名在 sv_extras.sx_filters[attribute=se_courseId].choices。
 * 绝不用 itemSpecificData.gradeDetails.grade 当总分：它的 pointsPossible 恒为 0。
 */
export function parseCourseList(data: unknown): BbCourse[] {
  const root = (data ?? {}) as {
    sv_streamEntries?: Array<{ se_courseId?: string; se_context?: string }>;
    sv_extras?: { sx_filters?: Array<{ attribute?: string; choices?: unknown }> };
  };
  const filter = (root.sv_extras?.sx_filters ?? []).find((f) => f.attribute === "se_courseId");
  const choices = normalizeChoices(filter?.choices);

  const seen = new Set<string>();
  const out: BbCourse[] = [];
  for (const e of root.sv_streamEntries ?? []) {
    const id = String(e.se_courseId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: choices.get(id) || String(e.se_context ?? "").trim() || id });
  }
  return out;
}

/** 从条目名与分类猜应用内的成绩类型；猜不出就 other，绝不瞎归类。 */
export function guessGradeType(name: string, cat: string): GradeType {
  const t = `${name} ${cat}`.toLowerCase();
  if (/exam|mid\s*term|final|\bfnl\b|期中|期末|考试/.test(t)) return "exam";
  if (/quiz|\bqz\b|\btest|小测|测验|测试/.test(t)) return "quiz";
  if (/project|大作业|项目/.test(t)) return "project";
  if (/assignment|homework|\bhw\b|\bpa\s*#|^week\s*\d|作业|实验/.test(t)) return "homework";
  return "other";
}

/**
 * 解析一门课的成绩明细页。行以 <div id="数字" position=...> 开头切块。
 * duedate 常为 0，必须回退 lastactivity，否则成绩没日期、列表排序全乱。
 * 中文标题是 HTML 实体，stripTags 会解码，不解码就是乱码（BB-05）。
 */
export function parseCoursePage(html: string): BbGradeRow[] {
  const at = String(html).indexOf('id="grades_wrapper"');
  if (at < 0) return [];
  let seg = String(html).slice(at);
  const foot = seg.indexOf("gradeTableFooter");
  if (foot > 0) seg = seg.slice(0, foot);

  const blocks = seg.split(/(?=<div id="\d+"\s+position=)/).slice(1);
  const rows: BbGradeRow[] = [];
  for (const b of blocks) {
    const head = b.match(
      /<div id="(\d+)"[^>]*?position="(\d+)"[^>]*?lastactivity="(\d+)"[^>]*?duedate="(\d+)"/
    );
    if (!head) continue;
    const rowId = head[1];
    const due = Number(head[4]) || Number(head[3]) || 0;

    const nameM =
      b.match(/<a id="_\d+_\d+"[^>]*>([\s\S]*?)<\/a>/) ||
      b.match(/<span id="_\d+_\d+"[^>]*>([\s\S]*?)<\/span>/);
    const name = nameM ? stripTags(nameM[1]) : "";
    if (!name || TOTAL_ROW_RE.test(name.trim())) continue;

    const scoreM = b.match(/<span class="grade"[^>]*>([\s\S]*?)<\/span>/);
    const possM = b.match(/<span class="pointsPossible[^"]*">\s*\/\s*([\d.]+)/);
    const catM = b.match(/<div class="itemCat">([\s\S]*?)<\/div>/);

    const score = scoreM ? numOrNull(stripTags(scoreM[1])) : null;
    const poss = possM ? Number(possM[1]) : null;
    const cat = catM ? stripTags(catM[1]) : "";

    rows.push({
      rowId,
      name: name.slice(0, 80),
      score,
      full: poss && poss > 0 ? poss : 100,
      type: guessGradeType(name, cat),
      date: dateFromEpochMs(due),
      dueAt: due,
    });
  }
  return rows;
}

/** 事件类型 → 应用里的日程类型。先认考试，但排除 final submission 这类假考试。 */
export function guessTaskType(eventType: string, title: string): TaskType {
  const t = `${eventType} ${title}`.toLowerCase();
  if (/exam|mid\s*term|期中|期末|考试/.test(t)) return "exam";
  if (/quiz|\btest|测验|小测/.test(t)) return "exam";
  if (/project|大作业|项目/.test(t)) return "project";
  if (/assignment|homework|\bpa\s*#|submission|essay|chapter|report|论文|作业|实验/.test(t))
    return "assignment";
  return "task";
}

/**
 * 日历接口返回两套时间：start 是本地字符串、startDate 才是 UTC。
 * 只切字符串，绝不 new Date(start)——那会把 23:59 挪到第二天（§8.4）。
 * allDay 或占位时刻都没有具体时间，time 写空，但 due 日期必须保留。
 * courseId 用 calendarName 精确对课程名得到，只做等值匹配、不做模糊匹配。
 */
export function normalizeCalendarEvents(data: unknown, courses: BbCourse[]): BbCalendarEvent[] {
  if (!Array.isArray(data)) return [];
  const nameToId = new Map(courses.map((c) => [c.name, c.id]));
  const placeholders = PLACEHOLDER_TIMES as readonly string[];
  const out: BbCalendarEvent[] = [];

  for (const raw of data) {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (!e.start) continue;
    const { date, hhmm } = splitLocalDateTime(String(e.start));
    const allDay = e.allDay === true || e.allDay === 1;
    const time = allDay || placeholders.includes(hhmm) ? "" : hhmm;

    const id = String(e.id ?? e.itemSourceId ?? "").trim();
    const title = stripTags(String(e.title ?? "")).slice(0, 100);
    if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const calendarName = String(e.calendarName ?? "").trim();
    const note = calendarName ? `来自 Blackboard · ${calendarName}` : "来自 Blackboard";
    out.push({
      id,
      title,
      due: date,
      time,
      type: guessTaskType(String(e.eventType ?? ""), title),
      place: stripTags(String(e.location ?? "")).slice(0, 80),
      note: note.slice(0, 200),
      calendarName,
      itemSourceId: String(e.itemSourceId ?? ""),
      courseId: nameToId.get(calendarName) ?? "",
    });
  }
  out.sort((a, b) => (a.due + a.time).localeCompare(b.due + b.time));
  return out;
}
