-- StarryStudy v2 · D1 初始建表
-- 约定：所有表都有 id / rev / created_at / updated_at / deleted_at（timetable_slots 除外，
-- 它一格一行，清空即删行，不需要软删）。deleted_at 非空即视为删除，所有查询都要带
-- WHERE deleted_at IS NULL，漏一处统计就多算（D-05）。
-- 时间：时间戳统一 ISO 8601 UTC 字符串；日期型（due / date / next_review）只存 YYYY-MM-DD。

CREATE TABLE IF NOT EXISTS subjects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#4f9cf9',
  sort          INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  course        TEXT,
  faculty       TEXT,
  bb_course_id  TEXT,
  rev           INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS subjects_sort ON subjects(sort) WHERE deleted_at IS NULL;

-- 一格一行，主键就是 (day, block)，天然不会整份覆盖（§8.1）
CREATE TABLE IF NOT EXISTS timetable_slots (
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
  block      INTEGER NOT NULL CHECK (block BETWEEN 1 AND 6),
  name       TEXT NOT NULL DEFAULT '',
  room       TEXT NOT NULL DEFAULT '',
  teacher    TEXT NOT NULL DEFAULT '',
  weeks      TEXT NOT NULL DEFAULT '',
  subject_id TEXT,
  rev        INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, block)
);

CREATE TABLE IF NOT EXISTS timetable_meta (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  semester   TEXT NOT NULL DEFAULT '',
  student    TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO timetable_meta (id, semester, student, start_date) VALUES (1, '', '', '');

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  due         TEXT NOT NULL,
  time        TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'task',
  place       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  subject_id  TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  done_manual INTEGER,
  src         TEXT NOT NULL DEFAULT 'manual',
  src_key     TEXT,
  rev         INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_src_key ON tasks(src_key) WHERE src_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS grades (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  subject_id TEXT,
  score      REAL,
  full       REAL NOT NULL DEFAULT 100,
  weight     REAL,
  type       TEXT NOT NULL DEFAULT 'other',
  date       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  src        TEXT NOT NULL DEFAULT 'manual',
  src_key    TEXT,
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS grades_src_key ON grades(src_key) WHERE src_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS grades_subject ON grades(subject_id, date DESC);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '无标题',
  content    TEXT NOT NULL DEFAULT '',
  subject_id TEXT,
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS notes_subject ON notes(subject_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  subject_id  TEXT,
  stage       INTEGER NOT NULL DEFAULT 0,
  next_review TEXT NOT NULL DEFAULT '',
  mastered    INTEGER NOT NULL DEFAULT 0,
  log         TEXT NOT NULL DEFAULT '[]',
  rev         INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS knowledge_review ON knowledge(next_review) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS links (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  icon       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  size       INTEGER NOT NULL,
  mime       TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  subject_id TEXT,
  category   TEXT NOT NULL DEFAULT 'material',
  pinned     INTEGER NOT NULL DEFAULT 0,
  tags       TEXT NOT NULL DEFAULT '[]',
  note       TEXT NOT NULL DEFAULT '',
  local_only INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS files_sha ON files(sha256);
CREATE INDEX IF NOT EXISTS files_subject ON files(subject_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('bb.map', '{}');
INSERT OR IGNORE INTO settings (key, value) VALUES ('lastSyncAt', '');

CREATE TABLE IF NOT EXISTS sync_runs (
  id         TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  created    INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  error      TEXT NOT NULL DEFAULT '',
  ran_at     TEXT NOT NULL
);

-- 密码哈希存这里。单账号模型：没有 users 表，永远只有一个用户。
CREATE TABLE IF NOT EXISTS auth (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  hash       TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO auth (id, hash, session_id) VALUES (1, '', '');
