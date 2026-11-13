#!/usr/bin/env node
// v1 -> v2 一次性导出脚本（交接书 §10.3）。
//
// 只做三件事：读 v1 数据目录里的 db/*.json，生成一份 D1 SQL，生成一份「文件 -> R2」待上传
// 清单。它**只读** v1 目录，不修改 v1、不连接任何数据库、不上传任何文件；标准输出只打印
// 逐集合条数，不打印任何真实姓名 / 课程名 / 成绩（产物文件里会有，但那是要落到 gitignore
// 目录里供用户自己核对的，不进仓库）。
//
// 用法：
//   node scripts/migrate-v1.mjs --data <v1 数据目录>
//   node scripts/migrate-v1.mjs --data <v1 数据目录> --out <输出目录>
//
// --data 没有默认值：绝不把真实本机路径写死在仓库里。它指向 v1 的「数据根目录」，
// 其下有 db/*.json 与 files/（上传副本）。--out 默认是仓库里已被 gitignore 的
// data/migrations-output/，不要把它改到会被提交的位置。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const NOW = new Date().toISOString();

// ---------------------------------------------------------------- 参数解析

function arg(name) {
  const flag = "--" + name;
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === flag) return process.argv[i + 1];
    if (process.argv[i].startsWith(flag + "=")) return process.argv[i].slice(flag.length + 1);
  }
  return undefined;
}

const dataArg = arg("data");
if (!dataArg) {
  console.error("必须传入 --data <v1 数据目录>；该参数没有默认值，避免写死真实路径。");
  console.error("用法：node scripts/migrate-v1.mjs --data <v1 数据目录> [--out <输出目录>]");
  process.exit(1);
}

const DATA = resolve(dataArg);
const DB_DIR = join(DATA, "db");
if (!existsSync(DB_DIR)) {
  console.error("未在 --data 目录下找到 db/ 子目录，请确认指向的是 v1 的数据根目录。");
  process.exit(1);
}

const OUT_DIR = arg("out") ? resolve(arg("out")) : join(ROOT, "data", "migrations-output");
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------- 工具

function loadJson(file) {
  const p = join(DB_DIR, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    console.error("  跳过（无法解析）：" + file);
    return null;
  }
}

const itemsOf = (file) => {
  const raw = loadJson(file);
  return raw && Array.isArray(raw.items) ? raw.items : [];
};

const pick = (o, ...keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const S = (o, ...keys) => {
  const v = pick(o, ...keys);
  return v === undefined ? "" : String(v);
};
const NUM = (o, def, ...keys) => {
  const v = pick(o, ...keys);
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const nullableNum = (o, ...keys) => {
  const v = pick(o, ...keys);
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const nullable = (v) => (v === "" || v === undefined || v === null ? null : v);
const ts = (o, ...keys) => {
  const v = pick(o, ...keys);
  return typeof v === "string" && v.trim() ? v.trim() : NOW;
};

// 结构化子对象字段：v2 用 TEXT 存 JSON。已经是字符串就原样用，数组 / 对象序列化。
const jsonText = (o, keys, fallback) => {
  const v = pick(o, ...keys);
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
};

// SQL 字面量：NULL / 数字 / 字符串（单引号转义）。对象必须先经 jsonText 变字符串。
function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function insert(table, row) {
  const cols = Object.keys(row);
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => q(row[c])).join(", ")});`;
}

function common(o) {
  return {
    rev: NUM(o, 1, "rev"),
    created_at: ts(o, "createdAt", "created_at"),
    updated_at: ts(o, "updatedAt", "updated_at") || ts(o, "createdAt", "created_at"),
    deleted_at: null,
  };
}

const subjectId = (o) => nullable(S(o, "subjectId", "subject_id"));
const srcKey = (o) => nullable(S(o, "srcKey", "src_key"));

// ---------------------------------------------------------------- 集合映射

const sql = [];
const counts = {};

function mapSubjects(items) {
  for (const o of items) {
    // v1 把 BB 课程 id 藏在 bbUrl 的查询串里，v2 有专用列；没有就留空，不猜。
    let bb = S(o, "bbCourseId", "bb_course_id");
    if (!bb) {
      const m = S(o, "bbUrl", "bb_url").match(/[?&]id=(_\d+_\d+)/);
      if (m) bb = m[1];
    }
    sql.push(
      insert("subjects", {
        id: S(o, "id"),
        name: S(o, "name"),
        color: S(o, "color") || "#4f9cf9",
        sort: NUM(o, 0, "order", "sort"),
        note: S(o, "note"),
        course: jsonText(o, ["course"], null),
        faculty: jsonText(o, ["faculty"], null),
        bb_course_id: nullable(bb),
        ...common(o),
      }),
    );
  }
  counts.subjects = items.length;
}

function mapTasks(items) {
  for (const o of items) {
    // done_manual 为 NULL 表示「用户没手动勾过」；一旦 v1 有值（含 false）就必须原样保留，
    // 否则 §8.2 的三条规则会被改写，用户手动标过的状态可能被自动派生覆盖。
    const dm = pick(o, "doneManual", "done_manual");
    sql.push(
      insert("tasks", {
        id: S(o, "id"),
        title: S(o, "title"),
        due: S(o, "due"),
        time: S(o, "time"),
        type: S(o, "type") || "task",
        place: S(o, "place"),
        note: S(o, "note"),
        subject_id: subjectId(o),
        done: pick(o, "done") ? 1 : 0,
        done_manual: dm === undefined || dm === null ? null : dm ? 1 : 0,
        src: S(o, "src") || "manual",
        src_key: srcKey(o),
        ...common(o),
      }),
    );
  }
  counts.tasks = items.length;
}

function mapGrades(items) {
  for (const o of items) {
    sql.push(
      insert("grades", {
        id: S(o, "id"),
        name: S(o, "name"),
        subject_id: subjectId(o),
        score: nullableNum(o, "score"),
        full: NUM(o, 100, "full"),
        weight: nullableNum(o, "weight"),
        type: S(o, "type") || "other",
        date: S(o, "date"),
        note: S(o, "note"),
        src: S(o, "src") || "manual",
        src_key: srcKey(o),
        ...common(o),
      }),
    );
  }
  counts.grades = items.length;
}

function mapNotes(items) {
  for (const o of items) {
    sql.push(
      insert("notes", {
        id: S(o, "id"),
        title: S(o, "title") || "无标题",
        content: S(o, "content"),
        subject_id: subjectId(o),
        ...common(o),
      }),
    );
  }
  counts.notes = items.length;
}

function mapKnowledge(items) {
  for (const o of items) {
    // v1 的正文叫 note，v2 叫 content；log 是数组，必须序列化成 TEXT。
    sql.push(
      insert("knowledge", {
        id: S(o, "id"),
        title: S(o, "title"),
        content: S(o, "content", "note"),
        subject_id: subjectId(o),
        stage: NUM(o, 0, "stage"),
        next_review: S(o, "nextReview", "next_review"),
        mastered: pick(o, "mastered") ? 1 : 0,
        log: jsonText(o, ["log"], "[]"),
        ...common(o),
      }),
    );
  }
  counts.knowledge = items.length;
}

function mapLinks(items) {
  for (const o of items) {
    sql.push(
      insert("links", {
        id: S(o, "id"),
        name: S(o, "name"),
        url: S(o, "url"),
        icon: nullable(S(o, "icon")),
        sort: NUM(o, 0, "order", "sort"),
        ...common(o),
      }),
    );
  }
  counts.links = items.length;
}

// ---------------------------------------------------------------- 课表

function mapTimetable() {
  const raw = loadJson("timetable.json") || {};
  const slots = Array.isArray(raw.slots) ? raw.slots : [];
  let valid = 0;
  for (const s of slots) {
    const day = NUM(s, 0, "day");
    const block = NUM(s, 0, "block", "period");
    // (day, block) 是主键；越界的格子丢弃，避免整份导入破坏约束。
    if (day < 1 || day > 7 || block < 1 || block > 6) continue;
    sql.push(
      insert("timetable_slots", {
        day,
        block,
        name: S(s, "name"),
        room: S(s, "room"),
        teacher: S(s, "teacher"),
        weeks: S(s, "weeks"),
        subject_id: subjectId(s),
        rev: NUM(s, 1, "rev"),
        updated_at: ts(s, "updatedAt", "updated_at"),
      }),
    );
    valid += 1;
  }
  const meta = raw.meta || {};
  // 0001_init.sql 已经预置 id=1 的空行，用 REPLACE 覆盖而不是 INSERT 撞主键。
  sql.push(
    "INSERT OR REPLACE INTO timetable_meta (id, semester, student, start_date) " +
      `VALUES (1, ${q(S(meta, "semester"))}, ${q(S(meta, "student"))}, ${q(S(meta, "startDate", "start_date"))});`,
  );
  counts.timetable_slots = valid;
  counts.timetable_meta = 1;
}

// ---------------------------------------------------------------- 文件与 R2

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function mapFiles(items) {
  const r2 = [];
  const seenSha = new Set();
  let localOnly = 0;
  let dedupSkipped = 0;
  let missingUpload = 0;
  let index = 0;

  for (const o of items) {
    index += 1;
    const id = S(o, "id");
    const isLink = o.link === true || o.link === 1 || o.link === "true";
    const size = NUM(o, 0, "size");
    const mime = S(o, "type", "mime") || "application/octet-stream";
    let local_only = 0;
    let sha256;
    let r2_key = "";

    if (isLink) {
      // v1 的 link 型指向本机磁盘：v2 标记 local_only，永不上传，手机端点不开。
      // sha256 列 NOT NULL 且有唯一索引，用 local:<id> 占位保证不冲突、不参与内容去重。
      local_only = 1;
      sha256 = "local:" + (id || "row" + index);
    } else {
      const stored = S(o, "stored");
      const abs = join(DATA, "files", stored);
      if (stored && existsSync(abs)) {
        const sha = sha256File(abs);
        r2_key = "blob/" + sha.slice(0, 2) + "/" + sha;
        sha256 = sha;
        // 内容寻址：同一 sha 只留一行、只上传一次对象（v2 files_sha 唯一索引）。
        if (seenSha.has(sha)) {
          dedupSkipped += 1;
          continue;
        }
        seenSha.add(sha);
        r2.push({ fileId: id, name: S(o, "name"), sha256: sha, r2Key: r2_key, localPath: abs, mime, size });
      } else {
        // 上传型但原文件不在（用户可能换过机）：保留行，标记仅电脑可用，不伪造对象地址。
        local_only = 1;
        sha256 = "local:" + (id || "row" + index);
        missingUpload += 1;
      }
    }

    sql.push(
      insert("files", {
        id,
        name: S(o, "name"),
        r2_key,
        size,
        mime,
        sha256,
        subject_id: subjectId(o),
        category: S(o, "category") || "material",
        pinned: pick(o, "pinned") ? 1 : 0,
        tags: jsonText(o, ["tags"], "[]"),
        note: S(o, "note"),
        local_only,
        rev: NUM(o, 1, "rev"),
        created_at: ts(o, "createdAt", "created_at"),
        updated_at: ts(o, "updatedAt", "updated_at") || ts(o, "createdAt", "created_at"),
        deleted_at: null,
      }),
    );
    if (local_only) localOnly += 1;
  }

  counts.files = items.length - dedupSkipped;
  counts.files_local_only = localOnly;
  counts.files_to_r2 = r2.length;
  counts.files_dedup_skipped = dedupSkipped;
  counts.files_missing_upload = missingUpload;
  return r2;
}

// ---------------------------------------------------------------- 主流程

// 显式跳过，绝不迁移（交接书 §10.3）：这三份留在本机，新站重新设密码、重新填账号。
// 即使目录里存在也一律不读：bb.json（学校账号口令）、auth.json（密码哈希与长期凭据）、
// sync-state.json（同步状态，sync_runs 从空开始）。
const SKIPPED = ["bb.json", "auth.json", "sync-state.json"];

mapSubjects(itemsOf("subjects.json"));
mapTasks(itemsOf("schedules.json"));
mapGrades(itemsOf("grades.json"));
mapNotes(itemsOf("notes.json"));
mapKnowledge(itemsOf("knowledge.json"));
mapLinks(itemsOf("links.json"));
mapTimetable();
const r2 = mapFiles(itemsOf("files.json"));

const header = [
  "-- 由 scripts/migrate-v1.mjs 生成的一次性 v1 导入 SQL。",
  "-- 本文件含真实数据，位于已被 gitignore 的 data/ 目录，切勿提交、切勿外传。",
  "-- 用法：先按 0001_init.sql 建好空库；生产环境先删除 0002_example_seed.sql",
  "--       （或删掉 demo_ 前缀的行），再用 wrangler d1 execute 指向本文件执行。",
  "-- auth / settings / sync_runs 故意不导入：首次访问重设密码，采集运行状态从空开始。",
  "-- id 全部沿用 v1，前端书签 / 铃铛水位 / 外链都引用它。",
  "",
].join("\n");

writeFileSync(join(OUT_DIR, "v1-import.sql"), header + sql.join("\n") + "\n", "utf8");

const manifest = {
  note: "逐条用 wrangler r2 object put <bucket>/<r2Key> --file=<localPath> --remote 上传；key 已按 blob/<sha前2位>/<sha> 内容寻址。",
  hint: "本清单含真实本机路径，位于已被 gitignore 的目录，切勿提交；上传完即可删除。",
  items: r2,
};
writeFileSync(join(OUT_DIR, "files-to-r2.json"), JSON.stringify(manifest, null, 2), "utf8");

// ---------------------------------------------------------------- 逐集合条数（§10.2 第 4 步校验用）
// 只打印条数，绝不打印任何姓名 / 课程名 / 成绩 / 路径。
console.log("v1 导出完成。逐集合条数：");
console.log("  subjects          : " + counts.subjects);
console.log("  timetable_slots   : " + counts.timetable_slots);
console.log("  timetable_meta    : " + counts.timetable_meta);
console.log("  tasks (schedules) : " + counts.tasks);
console.log("  grades            : " + counts.grades);
console.log("  notes             : " + counts.notes);
console.log("  knowledge         : " + counts.knowledge);
console.log("  links             : " + counts.links);
console.log("  files (写入行)    : " + counts.files);
console.log("    local_only      : " + counts.files_local_only);
console.log("    待上传对象      : " + counts.files_to_r2);
console.log("    内容重复合并    : " + counts.files_dedup_skipped);
console.log("    上传型原文件缺失: " + counts.files_missing_upload);
console.log("  显式跳过（不迁移）: " + SKIPPED.join(", "));
console.log("生成文件：v1-import.sql（" + sql.length + " 条语句）、files-to-r2.json（" + r2.length + " 个对象）");
// 只打印固定字符串，绝不回显 --data / --out 的真实本机路径。
console.log("输出目录：" + (arg("out") ? "（由 --out 指定）" : "data/migrations-output（已被 gitignore）"));
