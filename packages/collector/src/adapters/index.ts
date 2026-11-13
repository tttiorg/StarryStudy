// 适配器注册表。
//
// 偏差说明（相对交接书 §4.3）：交接书列过一个「学校专属 adapter 源文件」
// 作为可选项。但 §4.5 的提交自检会命中学校域名关键字，且「代码里不出现任何
// 学校专有信息」是硬规则，新增这类源文件必然踩线。因此不创建任何学校
// 专属 adapter：校方的差异只是 URL 与路径模板，全部由 .env 的 BB_*_PATH
// 配置覆盖，通用流程一份代码就够，不需要按学校派生代码分支。
import type { BbConfig } from "@starry/shared";
import {
  BlackboardGenericAdapter,
  type CollectorAdapter,
  type BbCourseGrades,
} from "./blackboard-generic";
import type { BbCourse, BbGradeRow, BbCalendarEvent } from "../parse";

export type AdapterFactory = (cfg: BbConfig) => CollectorAdapter;

const REGISTRY: Record<string, AdapterFactory> = {
  "blackboard-generic": (cfg) => new BlackboardGenericAdapter(cfg),
};

export const DEFAULT_ADAPTER = "blackboard-generic";

export function createAdapter(cfg: BbConfig, id: string = DEFAULT_ADAPTER): CollectorAdapter {
  const factory = REGISTRY[id];
  if (!factory) {
    throw new Error(`未注册的适配器 ${id}；可用：${Object.keys(REGISTRY).join(", ")}`);
  }
  return factory(cfg);
}

export function listAdapters(): string[] {
  return Object.keys(REGISTRY);
}

export type { CollectorAdapter, BbCourseGrades, BbCourse, BbGradeRow, BbCalendarEvent };
