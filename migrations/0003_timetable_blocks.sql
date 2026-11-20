-- 让「自定义每天课表的节数与时间」在已经跑过 0001 的库上也能生效。
-- 0001 里 timetable_slots.block 的 CHECK 是 1..6，SQLite 不能 ALTER CHECK，
-- 只能重建表；INSERT ... SELECT 会把已有课程原样搬过去，不丢数据。
-- 本文件可重复执行：timetable_slots_rebuild 每次都是新空表，搬完即被 rename 走。

CREATE TABLE IF NOT EXISTS timetable_slots_rebuild (
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
  block      INTEGER NOT NULL CHECK (block BETWEEN 1 AND 12),
  name       TEXT NOT NULL DEFAULT '',
  room       TEXT NOT NULL DEFAULT '',
  teacher    TEXT NOT NULL DEFAULT '',
  weeks      TEXT NOT NULL DEFAULT '',
  subject_id TEXT,
  rev        INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, block)
);

INSERT OR IGNORE INTO timetable_slots_rebuild
  (day, block, name, room, teacher, weeks, subject_id, rev, updated_at)
SELECT day, block, name, room, teacher, weeks, subject_id, rev, updated_at
FROM timetable_slots;

DROP TABLE IF EXISTS timetable_slots;
ALTER TABLE timetable_slots_rebuild RENAME TO timetable_slots;

-- 自定义节次存 settings['timetable.blocks']（JSON 数组）。这里不预置记录：
-- 查不到 key 就是「用默认 BLOCKS」，属于有回退路径的自动派生字段。
