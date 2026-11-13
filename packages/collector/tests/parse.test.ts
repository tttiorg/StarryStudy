// 解析层是拿真实 BB 页面调出来的规则，一旦被「顺手优化」就会静默错数据，
// 所以单独固化：中文实体、合计行、日期回退、占位时刻都在这里有断言。
import test from "node:test";
import assert from "node:assert/strict";
import { dateFromEpochMs, PLACEHOLDER_TIMES } from "@starry/shared";
import {
  pickInput,
  numOrNull,
  parseCoursePage,
  parseCourseList,
  normalizeCalendarEvents,
} from "../src/parse";

const COURSE_HTML = `
<div id="grades_wrapper">
<div id="427170" position="100025" lastactivity="1700000000000" duedate="0" class="sortable_item_row">
  <div class="cell gradable"><a id="_427170_1">&#x671f;&#x4e2d; Exam</a></div>
  <div class="itemCat">Exam</div>
  <div class="cell grade"><span class="grade">48.00</span><span class="pointsPossible">/100</span></div>
</div>
<div id="427171" position="100026" lastactivity="1700000000000" duedate="1700100000000" class="sortable_item_row">
  <div class="cell gradable"><span id="_427171_1">&#x603b;&#x8ba1;</span></div>
  <div class="cell grade"><span class="grade">100</span><span class="pointsPossible">/100</span></div>
</div>
<div id="427172" position="100027" lastactivity="1700000000000" duedate="1700200000000" class="sortable_item_row">
  <div class="cell gradable"><a id="_427172_1">Homework 1</a></div>
  <div class="itemCat">Assignment</div>
  <div class="cell grade"><span class="grade">9.5</span><span class="pointsPossible">/10</span></div>
</div>
<div id="427173" position="100028" lastactivity="1700000000000" duedate="1700300000000" class="sortable_item_row">
  <div class="cell gradable"><a id="_427173_1">Not graded</a></div>
  <div class="cell grade"><span class="grade">-</span><span class="pointsPossible">/10</span></div>
</div>
<div id="gradeTableFooter"></div>
`;

test("pickInput 抠出 CAS execution 并解码 HTML 实体", () => {
  const html = `<form><input type="hidden" name="execution" value="e1s1&#45;x" /></form>`;
  assert.equal(pickInput(html, "execution"), "e1s1-x");
  assert.equal(pickInput(html, "not-there"), "");
});

test("numOrNull 只认带数字的分数，空值给 null", () => {
  assert.equal(numOrNull("48.00"), 48);
  assert.equal(numOrNull("-"), null);
  assert.equal(numOrNull(""), null);
});

test("成绩明细：中文实体解码、合计行过滤、duedate=0 回退 lastactivity", () => {
  const rows = parseCoursePage(COURSE_HTML);
  const by = new Map(rows.map((r) => [r.rowId, r]));

  assert.equal(rows.length, 3, "合计行不是成绩条目，必须被过滤");
  assert.equal(by.get("427170")?.name, "期中 Exam", "不解码实体标题全是乱码");
  assert.equal(by.get("427170")?.score, 48);
  assert.equal(by.get("427170")?.full, 100);
  assert.equal(by.get("427170")?.type, "exam");
  assert.equal(by.get("427172")?.score, 9.5);
  assert.equal(by.get("427172")?.full, 10);
  assert.equal(by.get("427173")?.score, null, "未评分行保留 null，交给 plan 过滤");

  // duedate 为 0 的那行必须用 lastactivity；非 0 的那行用 duedate，两者不能串
  assert.equal(by.get("427170")?.date, dateFromEpochMs(1_700_000_000_000));
  assert.equal(by.get("427172")?.date, dateFromEpochMs(1_700_200_000_000));
  assert.notEqual(by.get("427170")?.date, by.get("427172")?.date);
});

test("课程列表：choices 为对象或数组都能拿到课程名", () => {
  const entries = [{ se_courseId: "_100_1", se_context: "" }];
  const asObject = parseCourseList({
    sv_streamEntries: entries,
    sv_extras: { sx_filters: [{ attribute: "se_courseId", choices: { _100_1: "课程甲" } }] },
  });
  const asArray = parseCourseList({
    sv_streamEntries: entries,
    sv_extras: {
      sx_filters: [{ attribute: "se_courseId", choices: [{ id: "_100_1", label: "课程甲" }] }],
    },
  });
  assert.deepEqual(asObject, [{ id: "_100_1", name: "课程甲" }]);
  assert.deepEqual(asArray, asObject);
});

test("日历：allDay / 23:59 / 00:00 都 time 为空但保留 due，正常时刻保留", () => {
  const courses = [{ id: "_100_1", name: "课程甲" }];
  const events = normalizeCalendarEvents(
    [
      { id: "e1", title: "占位 23:59", start: "2026-09-17T23:59:00", allDay: false,
        calendarName: "课程甲", itemSourceId: "_427170_1", eventType: "Assignment" },
      { id: "e2", title: "占位 00:00", start: "2026-09-18T00:00:00", allDay: false,
        calendarName: "课程甲", itemSourceId: "", eventType: "Assignment" },
      { id: "e3", title: "全天", start: "2026-09-19T08:30:00", allDay: true,
        calendarName: "课程甲", itemSourceId: "", eventType: "Activity" },
      { id: "e4", title: "有具体时刻", start: "2026-09-20T14:05:00", allDay: false,
        calendarName: "课程甲", itemSourceId: "", eventType: "Exam" },
    ],
    courses
  );
  const by = new Map(events.map((e) => [e.id, e]));

  assert.ok((PLACEHOLDER_TIMES as readonly string[]).includes("23:59"));
  assert.ok((PLACEHOLDER_TIMES as readonly string[]).includes("00:00"));
  for (const id of ["e1", "e2", "e3"]) {
    assert.equal(by.get(id)?.time, "", `${id} 属于占位，不能有具体时刻`);
  }
  // 只切字符串、绝不当 UTC 解析：23:59 仍属于当天
  assert.equal(by.get("e1")?.due, "2026-09-17");
  assert.equal(by.get("e2")?.due, "2026-09-18");
  assert.equal(by.get("e3")?.due, "2026-09-19");
  assert.equal(by.get("e4")?.time, "14:05");
  assert.equal(by.get("e4")?.due, "2026-09-20");
  assert.equal(by.get("e1")?.courseId, "_100_1", "calendarName 精确对上课程名得到 courseId");
  assert.equal(by.get("e4")?.type, "exam");
});
