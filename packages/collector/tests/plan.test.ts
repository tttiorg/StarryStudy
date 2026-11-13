// 计划层决定写进云端的是什么。学科匹配、bbDone、稳定键、zod 形状都是
// 出过事故或会被服务端强校验的地方，逐一固化，避免回归。
import test from "node:test";
import assert from "node:assert/strict";
import { ingestGrades, ingestTasks, type Subject } from "@starry/shared";
import type { BbGradeRow, BbCourseGrades, BbCalendarEvent } from "../src/adapters";
import { buildGradePlan, buildTaskPlan } from "../src/plan";
import type { CloudContext } from "../src/plan";

function subject(id: string, bbCourseId: string | null, name: string): Subject {
  return {
    id, name, bbCourseId,
    color: "#4f9cf9", sort: 0, note: "", course: null, faculty: null,
    rev: 1, createdAt: "", updatedAt: "", deletedAt: null,
  } as Subject;
}

const ROWS: BbGradeRow[] = [
  { rowId: "427170", name: "期中 Exam", score: 48, full: 100, type: "exam",
    date: "2023-11-15", dueAt: 1_700_000_000_000 },
  { rowId: "427172", name: "Homework 1", score: 9.5, full: 10, type: "homework",
    date: "2023-11-17", dueAt: 1_700_200_000_000 },
  { rowId: "427173", name: "Not graded", score: null, full: 10, type: "other",
    date: "2023-11-18", dueAt: 1_700_300_000_000 },
  { rowId: "427174", name: "总计", score: 100, full: 100, type: "other",
    date: "2023-11-18", dueAt: 0 },
];

const GRADE_DATA: BbCourseGrades[] = [
  { courseId: "_100_1", courseName: "课程甲", rows: ROWS, error: "" },
];

function event(id: string, itemSourceId: string, courseId = "_100_1"): BbCalendarEvent {
  return {
    id, title: "PA #1", due: "2026-09-17", time: "", type: "assignment",
    place: "", note: "来自 Blackboard", calendarName: "课程甲",
    itemSourceId, courseId,
  };
}

test("成绩计划：稳定键 bb:<cid>:<rid>、总分求和、合计行与未评分行过滤", () => {
  const ctx: CloudContext = { subjects: [subject("s_1", "_100_1", "课程甲")], manualMap: {} };
  const plan = buildGradePlan(GRADE_DATA, ctx);
  const by = new Map(plan.items.map((i) => [i.srcKey, i]));

  assert.equal(plan.items.length, 2, "合计行与未评分行都不能进库");
  assert.ok(by.has("bb:_100_1:427170"));
  assert.ok(by.has("bb:_100_1:427172"));
  assert.equal(by.get("bb:_100_1:427170")?.score, 48);
  assert.equal(by.get("bb:_100_1:427172")?.score, 9.5);
  assert.equal(plan.courses[0].total.score, 57.5, "已评分行 score 求和");
  assert.equal(plan.courses[0].total.full, 110, "已评分行 full 求和");
  assert.ok(plan.gradedRowIds.has("427170"));
  assert.ok(!plan.gradedRowIds.has("427173"));
  assert.ok(!plan.gradedRowIds.has("427174"));
});

test("学科匹配四级优先级，且绝不按课程名模糊匹配", () => {
  const auto = subject("s_auto", "_100_1", "名字无关紧要");
  const byNameOnly = subject("s_byname", null, "课程甲"); // 名字撞上了，但没有 bbCourseId

  // ① bbCourseId 精确匹配，且优先于 ② 手工映射
  const p1 = buildGradePlan(
    [{ courseId: "_100_1", courseName: "课程甲", rows: [], error: "" }],
    { subjects: [auto], manualMap: { _100_1: "s_manual" } }
  );
  assert.equal(p1.courses[0].subjectId, "s_auto", "① 必须压过 ②");

  // ② 手工映射（云端 bb.map / BB_SUBJECT_MAP）
  const ctx: CloudContext = {
    subjects: [auto, byNameOnly],
    manualMap: { _200_1: "s_manual" },
  };
  const p2 = buildGradePlan(
    [{ courseId: "_200_1", courseName: "课程乙", rows: [], error: "" }], ctx
  );
  assert.equal(p2.courses[0].subjectId, "s_manual");

  // ③ 日历 calendarName -> courseId -> 学科（courseId 由解析层精确映射得到）
  const gplan = buildGradePlan(GRADE_DATA, ctx);
  const t3 = buildTaskPlan([event("ev3", "_427170_1", "_100_1")], gplan, ctx);
  assert.equal(t3.items[0].subjectId, "s_auto");

  // ④ 都对不上 -> null；课程名与 s_byname 完全相同也不许撞上去
  const p4 = buildGradePlan(
    [{ courseId: "_999_1", courseName: "课程甲", rows: [], error: "" }], ctx
  );
  assert.equal(p4.courses[0].subjectId, null);
  const t4 = buildTaskPlan([event("ev4", "", "_999_1")], gplan, ctx);
  assert.equal(t4.items[0].subjectId, null);
});

test("bbDone 反查成绩行，且不发送用户手填 / 服务端字段", () => {
  const ctx: CloudContext = { subjects: [subject("s_1", "_100_1", "课程甲")], manualMap: {} };
  const gplan = buildGradePlan(GRADE_DATA, ctx);
  const events = [
    event("ev1", "_427170_1"), // itemSourceId 里的 rowId 能在成绩里查到
    event("ev2", "_999999_1"), // 查不到
    event("ev3", ""),          // 没有 itemSourceId
  ];
  const plan = buildTaskPlan(events, gplan, ctx);
  const by = new Map(plan.items.map((i) => [i.srcKey, i]));

  assert.equal(by.get("bbcal:ev1")?.bbDone, true);
  assert.equal(by.get("bbcal:ev2")?.bbDone, false);
  assert.equal(by.get("bbcal:ev3")?.bbDone, false);
  for (const it of plan.items) {
    assert.equal("done" in it, false, "最终 done 由服务端算，采集器不许发");
    assert.equal("doneManual" in it, false);
    assert.equal("weight" in it, false);
    assert.equal("rev" in it, false);
  }
});

test("产出形状通过服务端 ingestGrades / ingestTasks 的 zod 校验", () => {
  const ctx: CloudContext = { subjects: [subject("s_1", "_100_1", "课程甲")], manualMap: {} };
  const gplan = buildGradePlan(GRADE_DATA, ctx);
  const tplan = buildTaskPlan([event("ev1", "_427170_1")], gplan, ctx);

  const g = ingestGrades.safeParse({ items: gplan.items });
  assert.ok(g.success, `成绩形状没过 zod：${g.success ? "" : g.error.message}`);
  const t = ingestTasks.safeParse({ items: tplan.items });
  assert.ok(t.success, `任务形状没过 zod：${t.success ? "" : t.error.message}`);
});
