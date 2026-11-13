// 把 BB 中间数据转成 /api/ingest/* 要的 IngestGrade / IngestTask，
// 并按 §8.7 的优先级定学科。这里不联网、不写库，纯函数便于核对。
import {
  round2,
  TOTAL_ROW_RE,
  type IngestGrade,
  type IngestTask,
  type Subject,
  type GradeType,
} from "@starry/shared";
import type { BbCourseGrades, BbCalendarEvent } from "./adapters";

export interface CloudContext {
  subjects: Subject[];
  manualMap: Record<string, string>; // bbCourseId -> subjectId，来自云端 bb.map + 本地环境变量
}

export interface CourseSummary {
  courseId: string;
  courseName: string;
  subjectId: string | null;
  graded: number;
  total: { score: number; full: number };
  error: string;
}

export interface GradePlan {
  items: IngestGrade[];
  gradedRowIds: Set<string>; // 给任务判完成用
  courses: CourseSummary[];
}

export interface TaskPlan {
  items: IngestTask[];
  unmatched: number;
  withoutTime: number;
}

// v1 把 course_id 藏在课程主页链接里；v2 学科已有专门的 bbCourseId 字段，
// 两者都认，优先用规整过的字段。
const BB_LINK_ID_RE = /[?&]id=(_\d+_\d+)/;

function bbCourseIdOf(subject: Subject): string {
  const direct = String(subject.bbCourseId ?? "").trim();
  if (direct) return direct;
  const homepage = String(subject.course?.homepage ?? "");
  return (homepage.match(BB_LINK_ID_RE) ?? [])[1] ?? "";
}

/**
 * 学科匹配优先级（§8.7）：
 *   ① subject.bbCourseId 精确等于 courseId
 *   ② settings['bb.map'] / BB_SUBJECT_MAP 手工映射
 *   ③ 日历 calendarName 精确对上 BB 课程名 -> course_id -> 再走 ①②
 *      （normalizeCalendarEvents 已把 calendarName 换成 courseId，故与成绩共用本函数）
 *   ④ 都对不上 -> null，绝不按课程名模糊匹配（「课程甲」会错配到「课程甲(上)」）
 */
function buildSubjectResolver(ctx: CloudContext): (courseId: string) => string | null {
  const byBbId = new Map<string, string>();
  for (const s of ctx.subjects) {
    const id = bbCourseIdOf(s);
    if (id && !byBbId.has(id)) byBbId.set(id, s.id);
  }
  const manual = ctx.manualMap ?? {};
  return (courseId) => {
    if (!courseId) return null;
    const auto = byBbId.get(courseId);
    if (auto) return auto;
    const mapped = manual[courseId];
    if (mapped) return mapped;
    return null;
  };
}

/** 只用有分数的行；合计行再兜一次；课程总分 = 已评分行 score/full 各自求和。 */
export function buildGradePlan(data: BbCourseGrades[], ctx: CloudContext): GradePlan {
  const resolve = buildSubjectResolver(ctx);
  const items: IngestGrade[] = [];
  const gradedRowIds = new Set<string>();
  const courses: CourseSummary[] = [];

  for (const c of data) {
    const graded = c.rows.filter(
      (r) => r.score !== null && !TOTAL_ROW_RE.test(r.name.trim())
    );
    const subjectId = resolve(c.courseId);
    const score = round2(graded.reduce((s, r) => s + (r.score ?? 0), 0));
    const full = round2(graded.reduce((s, r) => s + r.full, 0));
    courses.push({
      courseId: c.courseId,
      courseName: c.courseName,
      subjectId,
      graded: graded.length,
      total: { score, full },
      error: c.error,
    });

    for (const r of graded) {
      gradedRowIds.add(r.rowId);
      const type: GradeType = r.type;
      items.push({
        srcKey: `bb:${c.courseId}:${r.rowId}`,
        name: r.name.slice(0, 80),
        subjectId,
        score: r.score as number,
        full: r.full > 0 ? r.full : 100,
        type,
        date: r.date,
      });
    }
  }
  items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { items, gradedRowIds, courses };
}

/**
 * bbDone 只回答「BB 认为这条作业完成了吗」：日历事件的 itemSourceId 对应
 * 成绩行 rowId，能在本次采集的成绩里查到即算完成。
 *
 * v1 把 done 写成单向锁（true 之后永不回退），一次误标把当天到期的作业
 * 永久隐藏，排查两小时才发现数据其实一直在库里。所以采集器绝不自己决定
 * done、也不发送 done/doneManual/weight/rev，只上报 bbDone；最终 done 由
 * 服务端按 §8.2 三条规则算：
 *   ① 人手动勾过 -> 永远听人的；② 今天之前只升不降；③ 今天及以后完全以 BB 为准。
 */
export function buildTaskPlan(
  events: BbCalendarEvent[],
  grade: GradePlan,
  ctx: CloudContext
): TaskPlan {
  const resolve = buildSubjectResolver(ctx);
  const items: IngestTask[] = events.map((ev) => {
    const rowId = (ev.itemSourceId.match(/(\d+)/) ?? [])[1] ?? "";
    const bbDone = rowId ? grade.gradedRowIds.has(rowId) : false;
    return {
      srcKey: `bbcal:${ev.id}`.slice(0, 120),
      title: ev.title,
      due: ev.due,
      time: ev.time,
      type: ev.type,
      place: ev.place,
      note: ev.note,
      subjectId: resolve(ev.courseId),
      bbDone,
    };
  });
  items.sort((a, b) => (a.due + a.time).localeCompare(b.due + b.time));
  return {
    items,
    unmatched: items.filter((x) => x.subjectId === null).length,
    withoutTime: items.filter((x) => x.time === "").length,
  };
}
