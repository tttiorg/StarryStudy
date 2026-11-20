// 采集器入口：登录一次、拉一次课程表，再按注册表顺序跑各数据源。
// 借鉴 v1 tasks.js 的 SOURCES + runAll 结构，但云端写入走 /api/ingest/*。
import type { IngestSummary } from "@starry/shared";
import {
  readCollectorSettings,
  parseArgs,
  processHandle,
  setExitCode,
} from "./config";
import { createAdapter, DEFAULT_ADAPTER } from "./adapters";
import type { CollectorAdapter, BbCourse } from "./adapters";
import { fetchCloudContext, IngestClient } from "./ingest";
import { buildGradePlan, buildTaskPlan } from "./plan";
import type { CloudContext, GradePlan } from "./plan";
import { RunState } from "./state";
import { acquireLock } from "./lock";
import type { CliArgs } from "./config";

interface RunCtx {
  adapter: CollectorAdapter;
  ingest: IngestClient;
  cloud: CloudContext;
  courses: BbCourse[];
  dryRun: boolean;
  gradePlan: GradePlan | null; // 成绩先跑完填好，任务靠它判完成
  /** 两个源各自解析出的条目数，供入口做「空结果不等于成功」的健全性检查。 */
  planned: { grades: number; tasks: number };
}

interface SourceDef {
  id: "grades" | "tasks";
  label: string;
  order: number;
  run(ctx: RunCtx): Promise<IngestSummary | undefined>;
}

// 顺序是语义不是排版：任务要靠「有没有成绩」判断完成状态，成绩必须先跑。
const SOURCES: SourceDef[] = [
  {
    id: "grades",
    label: "成绩",
    order: 10,
    async run(ctx) {
      const raw = await ctx.adapter.fetchGrades(ctx.courses);
      const plan = buildGradePlan(raw, ctx.cloud);
      ctx.gradePlan = plan;
      ctx.planned.grades = plan.items.length;
      printGradePlan(plan);
      if (ctx.dryRun) return undefined;
      return ctx.ingest.postGrades(plan.items);
    },
  },
  {
    id: "tasks",
    label: "任务",
    order: 20,
    async run(ctx) {
      const events = await ctx.adapter.fetchCalendar(ctx.courses);
      if (!ctx.gradePlan) throw new Error("任务依赖成绩先跑（靠有没有成绩判完成）");
      const plan = buildTaskPlan(events, ctx.gradePlan, ctx.cloud);
      ctx.planned.tasks = plan.items.length;
      printTaskPlan(plan);
      if (ctx.dryRun) return undefined;
      return ctx.ingest.postTasks(plan.items);
    },
  },
];

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function printGradePlan(plan: GradePlan): void {
  const errors = plan.courses.filter((c) => c.error);
  console.log(`[计划] 成绩：${plan.courses.length} 门课，${plan.items.length} 条已评分记录`);
  for (const c of plan.courses) {
    const sid = c.subjectId ?? "未匹配学科";
    const bad = c.error ? `（明细抓取异常：${c.error}）` : "";
    console.log(
      `  - ${c.courseId} ${c.courseName} -> ${sid}，${c.graded} 条，总分 ${c.total.score}/${c.total.full}${bad}`
    );
  }
  if (errors.length) {
    console.warn(`[警告] ${errors.length} 门课明细抓取异常，其成绩未纳入计划`);
  }
}

function printTaskPlan(plan: ReturnType<typeof buildTaskPlan>): void {
  console.log(
    `[计划] 任务：${plan.items.length} 条事件，${plan.withoutTime} 条无具体时刻，${plan.unmatched} 条未匹配学科`
  );
}

function printSummary(state: RunState): void {
  if (state.dryRun) {
    console.log("[完成] --dry-run：只打印计划，未写入云端。");
    return;
  }
  for (const [id, s] of Object.entries(state.sources)) {
    if (s.ok && s.summary) {
      const r = s.summary;
      console.log(`[完成] ${id}：新增 ${r.created}，更新 ${r.updated}，跳过 ${r.skipped}`);
    } else if (!s.ok) {
      console.log(`[完成] ${id}：失败 - ${s.error}`);
    }
  }
}

function printUsage(): void {
  console.log(
    "用法：npm run collect -- [--dry-run] [--help]\n" +
      "  --dry-run   只抓数据、打印写入计划，不写云端\n" +
      "  --help      显示本说明\n\n" +
      "运行前：复制 .env.example 为 .env，填好 BB_* / API_BASE_URL / COLLECTOR_TOKEN。\n" +
      "配置不齐时采集器会打印缺失项并直接退出，不会启动。"
  );
}

/** 把一轮失败登记到云端 sync_runs，让「数据概览」如实显示，而不是永远只有 ok=1。 */
async function reportFailure(ingest: IngestClient, source: "grades" | "tasks", error: string): Promise<void> {
  try {
    await ingest.reportFailure(source, error);
  } catch {
    // 上报失败不能盖住原始故障，日志里已有原始错误
  }
}

async function runOnce(args: CliArgs, cfg: ReturnType<typeof readCollectorSettings>): Promise<void> {
  let cloud: CloudContext;
  try {
    cloud = await fetchCloudContext(cfg.cloud, cfg.bb.subjectMap);
  } catch (e) {
    const m = `读取云端学科/映射失败：${msg(e)}`;
    console.error(`[collector] ${m}`);
    if (!args.dryRun) await reportFailure(new IngestClient(cfg.cloud), "grades", m);
    setExitCode(1);
    return;
  }

  const adapter = createAdapter(cfg.bb, DEFAULT_ADAPTER);
  const ingest = new IngestClient(cfg.cloud);
  try {
    await adapter.login();
  } catch (e) {
    const m = `CAS 登录失败：${msg(e)}`;
    console.error(`[collector] ${m}`);
    if (!args.dryRun) await reportFailure(ingest, "grades", m);
    setExitCode(1);
    return;
  }

  let courses: BbCourse[];
  try {
    courses = await adapter.listCourses();
  } catch (e) {
    const m = `课程列表拉取失败：${msg(e)}`;
    console.error(`[collector] ${m}`);
    if (!args.dryRun) await reportFailure(ingest, "grades", m);
    setExitCode(1);
    return;
  }

  // 空结果当成功是无人值守最隐蔽的故障：BB 改版/会话失效时页面结构变了，
  // 各 parser 会静默返回 []，两个 POST 都是空数组、sync_runs 两条 ok=1，
  // 表现成「每小时都成功但成绩再也不更新」，可能持续数周无人察觉。
  if (!courses.length) {
    const m = "课程列表为空：Blackboard 未返回任何课程，可能是会话失效或页面改版，本轮判定失败";
    console.error(`[collector] ${m}`);
    if (!args.dryRun) await reportFailure(ingest, "grades", m);
    setExitCode(1);
    return;
  }

  const state = new RunState(args.dryRun);
  const ctx: RunCtx = {
    adapter, ingest, cloud, courses, dryRun: args.dryRun, gradePlan: null,
    planned: { grades: 0, tasks: 0 },
  };
  for (const src of [...SOURCES].sort((a, b) => a.order - b.order)) {
    try {
      const summary = await src.run(ctx);
      state.record(src.id, true, summary ? { summary } : {});
    } catch (e) {
      // 一个源失败不影响另一个，但错误必须可见、不能静默吞掉
      const m = msg(e);
      console.error(`[collector] ${src.label}失败：${m}`);
      state.record(src.id, false, { error: m });
      if (!args.dryRun) await reportFailure(ingest, src.id, `${src.label}失败：${m}`);
      setExitCode(1);
    }
  }
  printSummary(state);

  // 两个源都解析出 0 条时，有课却什么都没有，几乎只可能是页面结构变了、
  // 各 parser 静默返回 []（BB 改版 / 返回登录页）。必须按失败上报，不能静默成功。
  // 只空一个源是正常情况（例如某学期没有已评分成绩），不误判。
  const planEmpty = ctx.planned.grades === 0 && ctx.planned.tasks === 0;
  if (planEmpty && !args.dryRun) {
    const m = "成绩与任务计划均为空：解析可能未识别页面结构，本轮不确认成功";
    console.warn(`[collector] ${m}`);
    await reportFailure(ingest, "grades", m);
    setExitCode(1);
  }

  // 只有两个源全部成功才清「手动抓取」标记。以前无条件 ack，
  // 部分失败也会把 pending 抹掉，网页看起来像抓成功了。
  const allOk = [...SOURCES].every((s) => state.sources[s.id]?.ok === true) && !planEmpty;
  if (!args.dryRun && allOk) await ingest.ackSync();
  else if (!args.dryRun) {
    console.warn("[collector] 本轮存在失败，保留「手动抓取」标记，等待下次重试");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(processHandle().argv ?? []);
  if (args.help) {
    printUsage();
    return;
  }

  const cfg = readCollectorSettings();
  if (!cfg.configured) {
    // 没配齐就明确不启动，而不是拿一个空地址去崩掉（§4.3 规则一）
    console.error(`[collector] 缺少必要配置，采集器不启动。缺失项：${cfg.missing.join(", ")}`);
    console.error("[collector] 请复制 .env.example 为 .env 后填写；凭据只留本机，绝不进仓库。");
    setExitCode(1);
    return;
  }

  // 每小时定时任务可能撞上还没跑完的上一轮（网络慢 / 用户手动又跑一次）。
  // 拿不到锁就安静跳过：这是调度上的正常情况，不是错误，也不该上报失败。
  const lock = await acquireLock();
  if (!lock) {
    console.log("[collector] 已有采集器在运行，本轮跳过，避免并发写入云端");
    return;
  }
  try {
    await runOnce(args, cfg);
  } finally {
    await lock.release();
  }
}

main().catch((e) => {
  console.error(`[collector] 未捕获错误：${msg(e)}`);
  setExitCode(1);
});
