// 入参校验统一用 zod，业务代码不手写 if 判断（§12）。
// 写请求一律带 rev；服务端 UPDATE ... WHERE rev = ? 不匹配就 409。
import { z } from "zod";
import {
  FILE_CATEGORIES, GRADE_TYPES, MAX_BLOCKS, MAX_DAY, MIN_BLOCK, MIN_DAY,
  NOTE_CONTENT_MAX, TASK_TYPES,
} from "./constants";

const rev = z.number().int().positive();
const id = z.string().min(1).max(64);
const nullableId = id.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");
const time = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal("")]);
const txt = (max: number) => z.string().trim().max(max);

const course = z.object({
  fullName: txt(120), teacher: txt(60), room: txt(60), weeks: txt(60),
  classCode: txt(60), homepage: txt(300),
}).partial();

const faculty = z.object({
  name: txt(60), title: txt(60), dept: txt(80), avatar: txt(300),
  url: txt(300), phone: txt(40), email: txt(80),
}).partial();

export const subjectCreate = z.object({
  name: txt(80).min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#4f9cf9"),
  note: txt(1000).default(""),
  sort: z.number().int().default(0),
  course: course.nullable().default(null),
  faculty: faculty.nullable().default(null),
  bbCourseId: z.string().max(64).nullable().default(null),
});
export const subjectUpdate = subjectCreate.partial().extend({ rev });

export const taskCreate = z.object({
  title: txt(120).min(1),
  due: date,
  time: time.default(""),
  type: z.enum(TASK_TYPES).default("task"),
  place: txt(80).default(""),
  note: txt(1000).default(""),
  subjectId: nullableId.default(null),
  done: z.boolean().default(false),
  doneManual: z.boolean().nullable().default(null),
});
export const taskUpdate = taskCreate.partial().extend({ rev });

export const gradeCreate = z.object({
  name: txt(80).min(1),
  subjectId: nullableId.default(null),
  score: z.number().finite().nullable().default(null),
  full: z.number().positive().default(100),
  weight: z.number().min(0).nullable().default(null),
  type: z.enum(GRADE_TYPES).default("other"),
  date: date.or(z.literal("")).default(""),
  note: txt(500).default(""),
});
export const gradeUpdate = gradeCreate.partial().extend({ rev });

export const noteCreate = z.object({
  title: txt(120).default("无标题"),
  content: z.string().max(NOTE_CONTENT_MAX).default(""),
  subjectId: nullableId.default(null),
});
export const noteUpdate = noteCreate.partial().extend({ rev });

export const knowledgeCreate = z.object({
  title: txt(150).min(1),
  content: txt(3000).default(""),
  subjectId: nullableId.default(null),
});
export const knowledgeUpdate = knowledgeCreate.partial().extend({ rev });
export const knowledgeReview = z.object({
  action: z.enum(["review", "master", "reset", "forgot"]),
  rev,
});

export const linkCreate = z.object({
  name: txt(20).min(1),
  url: z.string().trim().url().max(500),
  icon: z.string().max(300).default(""),
  sort: z.number().int().default(0),
});
export const linkUpdate = linkCreate.partial().extend({ rev });

export const fileUpdate = z.object({
  name: txt(120).optional(),
  subjectId: nullableId.optional(),
  category: z.enum(FILE_CATEGORIES).optional(),
  pinned: z.boolean().optional(),
  tags: z.array(txt(40)).max(30).optional(),
  note: txt(1000).optional(),
  localOnly: z.boolean().optional(),
  rev,
});

export const timetableSlot = z.object({
  day: z.number().int().min(MIN_DAY).max(MAX_DAY),
  // 上限跟着可自定义的节数走，不再把默认 5 块写死成硬上限
  block: z.number().int().min(MIN_BLOCK).max(MAX_BLOCKS),
  name: txt(60).default(""),
  room: txt(40).default(""),
  teacher: txt(40).default(""),
  weeks: txt(30).default(""),
  subjectId: nullableId.default(null),
  rev: z.number().int().positive().optional(),
});
export const timetableBulk = z.object({
  // 7 天 × 最多 12 节 = 84 格；按可配置上限留余量，不用默认块数推算
  slots: z.array(timetableSlot).max(MAX_DAY * MAX_BLOCKS),
  mode: z.enum(["merge", "replace"]).default("merge"),
});
export const timetableMeta = z.object({
  semester: txt(60).optional(),
  student: txt(60).optional(),
  startDate: date.or(z.literal("")).optional(),
});

/** 自定义每天节次：序号必须从 1 开始连续递增，服务端按顺序重排后落库。 */
export const timetableBlocks = z.object({
  blocks: z
    .array(
      z.object({
        index: z.number().int().min(MIN_BLOCK).max(MAX_BLOCKS),
        label: txt(24),
        time: txt(40),
      }),
    )
    .min(1)
    .max(MAX_BLOCKS)
    .refine((list) => list.every((b, i) => b.index === i + 1), {
      message: "节次序号必须从 1 开始连续递增",
    }),
});

export const reorder = z.object({ ids: z.array(id).max(200) });

export const authSetup = z.object({ password: z.string().min(6).max(200) });
export const authLogin = z.object({ password: z.string().min(1).max(200) });
export const authPassword = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6).max(200),
});

export const ingestTask = z.object({
  srcKey: z.string().regex(/^bbcal:/).max(120),
  title: txt(120).min(1),
  due: date,
  time: time,
  type: z.enum(TASK_TYPES),
  place: txt(80),
  note: txt(200),
  subjectId: nullableId,
  bbDone: z.boolean(),
});
export const ingestGrade = z.object({
  srcKey: z.string().regex(/^bb:[^:]+:\d+$/).max(120),
  name: txt(80).min(1),
  subjectId: nullableId,
  score: z.number().finite(),
  full: z.number().positive(),
  type: z.enum(GRADE_TYPES),
  date: date.or(z.literal("")),
});
export const ingestTasks = z.object({ items: z.array(ingestTask).max(500) });
export const ingestGrades = z.object({ items: z.array(ingestGrade).max(500) });

export const presign = z.object({
  ttl: z.number().int().min(60).max(3600).default(600),
});

export type SubjectCreate = z.infer<typeof subjectCreate>;
export type TaskCreate = z.infer<typeof taskCreate>;
export type GradeCreate = z.infer<typeof gradeCreate>;
export type NoteCreate = z.infer<typeof noteCreate>;
export type KnowledgeCreate = z.infer<typeof knowledgeCreate>;
export type LinkCreate = z.infer<typeof linkCreate>;
export type TimetableSlotInput = z.infer<typeof timetableSlot>;
