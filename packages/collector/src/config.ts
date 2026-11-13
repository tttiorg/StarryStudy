// 采集器所有「可变环境值」的唯一入口：只调 shared 的 readNodeConfig()。
// 本包不定义任何默认值、不硬编码任何站点地址——§4.3 规则一/三要求地址与
// 路径模板只能从配置来；配不齐时直接不启动，而不是拿一个空地址去崩掉。
import {
  readNodeConfig,
  collectorConfigured,
  collectorMissing,
  type AppConfig,
  type BbConfig,
  type CollectorConfig,
} from "@starry/shared";

export interface CollectorSettings {
  bb: BbConfig;
  cloud: CollectorConfig;
  configured: boolean;
  missing: string[];
}

export function readCollectorSettings(): CollectorSettings {
  const app: AppConfig = readNodeConfig();
  return {
    bb: app.bb,
    cloud: app.collector,
    configured: collectorConfigured(app),
    missing: collectorMissing(app),
  };
}

// 用 globalThis 取进程句柄，避免本包直接引用 Node 全局对象，
// 也绝不在业务代码里读环境变量（唯一读环境的出口是 readNodeConfig）。
interface ProcLike {
  argv?: string[];
  exitCode?: number;
}

export function processHandle(): ProcLike {
  return (globalThis as { process?: ProcLike }).process ?? {};
}

export function setExitCode(code: number): void {
  // 让 Node 自然退出，不强制 process.exit，免得 stdout 被截断
  processHandle().exitCode = code;
}

export interface CliArgs {
  dryRun: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    help: args.includes("--help") || args.includes("-h"),
  };
}
