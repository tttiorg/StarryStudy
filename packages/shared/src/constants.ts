import type { TimetableBlock } from "./types";

// 艾宾浩斯间隔（天）。stage 是已完成轮次，nextReview = today + INTERVALS[stage]
export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30, 60] as const;

export const TASK_TYPES = ["task", "assignment", "exam", "project", "activity"] as const;
export const GRADE_TYPES = ["homework", "quiz", "exam", "project", "other"] as const;
export const FILE_CATEGORIES = ["material", "knowledge"] as const;

export const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
export const MIN_DAY = 1;
export const MAX_DAY = 7;
export const MIN_BLOCK = 1;
// 默认一天排 5 个课表块（第1-2节到第9-10节），不设第11-12节。
// BLOCKS 是「没有自定义配置时」的回退值，不是硬上限：用户可在课表信息里
// 把节数改成 1..MAX_BLOCKS 节，并逐节改名称与时间。
// v1 里注释写 1-6、默认块只有 5 个、导入却允许 1-8，三处口径不一致；
// v2 统一到「默认常量 + 可持久化配置」两层。
export const DEFAULT_BLOCK_COUNT = 5;
/** 自定义节次允许的最大节数；D1 的 CHECK 与写请求校验都以此为准。 */
export const MAX_BLOCKS = 12;
/** 默认节次表。settings['timetable.blocks'] 缺失或非法时回退到它（任何自动派生字段必须有回退路径）。 */
export const BLOCKS: TimetableBlock[] = [
  { index: 1, label: "第1-2节", time: "08:00-09:50" },
  { index: 2, label: "第3-4节", time: "10:20-12:10" },
  { index: 3, label: "第5-6节", time: "14:00-15:50" },
  { index: 4, label: "第7-8节", time: "16:20-18:10" },
  { index: 5, label: "第9-10节", time: "19:00-20:50" },
];

// BB 日历返回这三种「假时间」，全部按没有具体时刻处理，time 写空字符串。
// 实测 12 条事件里 9 条是占位；照抄会把日程写成半夜 23:59 交作业。
export const PLACEHOLDER_TIMES = ["23:59", "00:00"] as const;

// Blackboard 成绩明细里的合计行，不是成绩条目，必须过滤。
export const TOTAL_ROW_RE = /^(总计|加权总计|total|weighted total|term total|course total)$/i;

// id 前缀沿用 v1：前端书签、铃铛水位、外链都引用 id，换 id 会断。
export const ID_PREFIX = {
  subject: "s_",
  task: "d_",
  grade: "g_",
  note: "n_",
  file: "f_",
  link: "l_",
  knowledge: "k_",
} as const;

export const NOTE_CONTENT_MAX = 200_000;
export const PRESIGN_THRESHOLD_BYTES = 50 * 1024 * 1024;
export const SESSION_COOKIE = "sid";
export const SESSION_TTL_DAYS = 30;
export const NOTE_AUTOSAVE_DEBOUNCE_MS = 800;
export const NOTICE_STORAGE_KEY = "starry.notice.v1";
export const THEME_STORAGE_KEY = "starry.theme";

// 面板里「最近 N 条」是展示截断，必须同时显示总数，否则用户会误判成数据丢了。
export const NOTICE_RECENT_TASKS = 5;
export const NOTICE_RECENT_GRADES = 6;
