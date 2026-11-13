-- 完全虚构的演示数据（§4.3 规则二）。目的是让别人 clone 下来就能看到界面。
-- 里面没有任何真实课程、成绩、姓名或学校链接。
-- 生产部署请先删掉本文件再执行 migrations apply；已经执行过的话，
-- 按 id 前缀 demo_ 删除即可，不会碰到真实数据。
-- 日期用 date('now','+8 hours') 取 Asia/Shanghai 的「今天」：D1 的 datetime('now') 是 UTC，
-- 直接用会差一天（CF-06）。

INSERT OR IGNORE INTO subjects (id, name, color, sort, note, course, faculty, bb_course_id, rev, created_at, updated_at, deleted_at)
VALUES
  ('s_demo_math',   '高等数学', '#4f9cf9', 0, '示例学科', '{"fullName":"高等数学 A","teacher":"","room":"","weeks":"1-16","classCode":"","homepage":""}', NULL, NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('s_demo_linalg', '线性代数', '#c58af9', 1, '示例学科', '{"fullName":"线性代数","teacher":"","room":"","weeks":"1-16","classCode":"","homepage":""}', NULL, NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

INSERT OR IGNORE INTO timetable_slots (day, block, name, room, teacher, weeks, subject_id, rev, updated_at)
VALUES
  (1, 1, '高等数学', 'A-101', '', '1-16', 's_demo_math',   1, '2026-01-01T00:00:00.000Z'),
  (3, 2, '线性代数', 'B-203', '', '1-16', 's_demo_linalg', 1, '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO tasks (id, title, due, time, type, place, note, subject_id, done, done_manual, src, src_key, rev, created_at, updated_at, deleted_at)
VALUES
  ('d_demo_1', '完成第 3 章习题', date('now','+8 hours'), '',       'assignment', '', '演示任务：空 time 表示没有具体时刻', 's_demo_math',   0, NULL, 'manual', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('d_demo_2', '复习特征值',     date('now','+3 days'),   '19:30', 'task',       '', '演示日程：不带学科时显示在主页',       NULL,            0, NULL, 'manual', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

INSERT OR IGNORE INTO grades (id, name, subject_id, score, full, weight, type, date, note, src, src_key, rev, created_at, updated_at, deleted_at)
VALUES
  ('g_demo_1', '第一次作业', 's_demo_math',   92, 100, NULL, 'homework', '2026-10-10', '', 'manual', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('g_demo_2', '期中考试',   's_demo_math',   85, 100, NULL, 'exam',     '2026-10-24', '', 'manual', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('g_demo_3', '小测 1',     's_demo_linalg', 18, 20,  NULL, 'quiz',     '2026-10-18', '', 'manual', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

INSERT OR IGNORE INTO notes (id, title, content, subject_id, rev, created_at, updated_at, deleted_at)
VALUES ('n_demo_1', '示例笔记', '这里可以写笔记，正文最长 200KB。自动保存有 800ms 防抖，只写变化的那一条。', 's_demo_math', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

INSERT OR IGNORE INTO knowledge (id, title, content, subject_id, stage, next_review, mastered, log, rev, created_at, updated_at, deleted_at)
VALUES ('k_demo_1', '示例知识点：泰勒展开', '按 1/2/4/7/15/30/60 天复习', 's_demo_math', 0, date('now','+8 hours'), 0, '[]', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

INSERT OR IGNORE INTO links (id, name, url, icon, sort, rev, created_at, updated_at, deleted_at)
VALUES
  ('l_demo_1', '示例站点 A', 'https://example.com', '', 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('l_demo_2', '示例站点 B', 'https://example.org', '', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);
