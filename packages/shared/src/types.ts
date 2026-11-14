// 前后端共用的唯一一份类型定义。数据库是 snake_case，API 一律 camelCase，
// 转换只在 Worker 的 db.ts 里做一次。

export interface BaseRecord {
  id: string;
  rev: number;
  createdAt: string;   // ISO 8601 UTC
  updatedAt: string;   // ISO 8601 UTC
  deletedAt: string | null;
}

export interface Course {
  fullName: string;
  teacher: string;
  room: string;
  weeks: string;
  classCode: string;
  homepage: string;
}

export interface Faculty {
  name: string;
  title: string;
  dept: string;
  avatar: string;
  url: string;
  phone: string;
  email: string;
}

export interface Subject extends BaseRecord {
  name: string;
  color: string;
  sort: number;
  note: string;
  course: Course | null;
  faculty: Faculty | null;
  bbCourseId: string | null;   // 形如 _8497_1，采集器按它精确匹配，绝不按名字模糊匹配
}

export interface TimetableSlot {
  day: number;    // 1-7
  block: number;  // 1-6
  name: string;
  room: string;
  teacher: string;
  weeks: string;
  subjectId: string | null;
  rev: number;
  updatedAt: string;
}

export interface TimetableMeta {
  semester: string;
  student: string;
  startDate: string;  // YYYY-MM-DD
}

export interface TimetableBlock {
  index: number;
  label: string;
  time: string;
}

export interface TimetablePayload {
  meta: TimetableMeta;
  blocks: TimetableBlock[];
  slots: TimetableSlot[];
}

export type TaskType = "task" | "assignment" | "exam" | "project" | "activity";
export type GradeType = "homework" | "quiz" | "exam" | "project" | "other";
export type FileCategory = "material" | "knowledge";
export type Src = "manual" | "bb";

export interface Task extends BaseRecord {
  title: string;
  due: string;              // YYYY-MM-DD，日期型不存时区
  time: string;             // HH:MM，空字符串 = 没有具体时刻
  type: TaskType;
  place: string;
  note: string;
  subjectId: string | null;
  done: boolean;
  doneManual: boolean | null; // NULL = 用户没手动勾过；一旦有值，自动派生永远不许覆盖
  src: Src;
  srcKey: string | null;
}

export interface Grade extends BaseRecord {
  name: string;
  subjectId: string | null;
  score: number | null;
  full: number;
  weight: number | null;
  type: GradeType;
  date: string;             // YYYY-MM-DD
  note: string;
  src: Src;
  srcKey: string | null;
}

export interface Note extends BaseRecord {
  title: string;
  content: string;
  subjectId: string | null;
}

export interface ReviewLogEntry {
  at: string;
  action: string;
  stage: number;
}

export interface Knowledge extends BaseRecord {
  title: string;
  content: string;
  subjectId: string | null;
  stage: number;            // 已完成轮次
  nextReview: string;       // YYYY-MM-DD
  mastered: boolean;
  log: ReviewLogEntry[];
}

export interface Link extends BaseRecord {
  name: string;
  url: string;
  icon: string;
  sort: number;
}

export interface StudyFile extends BaseRecord {
  name: string;             // 显示名，改动不影响 B2 对象
  objectKey: string;        // blob/<sha256前2位>/<sha256>
  size: number;
  mime: string;
  sha256: string;
  subjectId: string | null;
  category: FileCategory;
  pinned: boolean;
  tags: string[];
  note: string;
  localOnly: boolean;       // v1 的 link 型：只在电脑上能打开，永远不上传
}

export interface SyncRun {
  id: string;
  source: "grades" | "tasks";
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  error: string;
  ranAt: string;
}

export interface FileStats {
  count: number;
  totalSize: number;
  localOnly: number;
}

export interface NoticeCounts {
  urgent: number;
  newTasks: number;
  newGrades: number;
}

export interface BootstrapPayload {
  auth: { registered: boolean; needSetup: boolean };
  subjects: Subject[];
  timetable: TimetablePayload;
  links: Link[];
  notice: NoticeCounts;
  // §8.7 手工学科映射（settings['bb.map']）。采集器靠它把 BB 课程对上学科，
  // 没有这个字段时只能退回本机配置，属于功能缺失。
  bbMap: Record<string, string>;
}

export interface WriteResult<T> {
  item: T;
  rev: number;
}

// 409 时把服务端当前完整记录交给前端，让用户自己选保留哪份；绝不静默合并
export interface ConflictResult<T = unknown> {
  error: "conflict";
  server: T;
}

export interface ApiError {
  error: string;
  message?: string;
}

// 采集器提交给 /api/ingest/* 的形状。bbDone 只是「BB 认为完成了吗」，
// 最终 done 由服务端按 §8.2 三条规则算，采集器不许自己决定。
export interface IngestTask {
  srcKey: string;
  title: string;
  due: string;
  time: string;
  type: TaskType;
  place: string;
  note: string;
  subjectId: string | null;
  bbDone: boolean;
}

export interface IngestGrade {
  srcKey: string;
  name: string;
  subjectId: string | null;
  score: number;
  full: number;
  type: GradeType;
  date: string;
}

export interface IngestSummary {
  created: number;
  updated: number;
  skipped: number;
}
