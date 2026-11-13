// 桌面启动器是独立进程，唯一需要的应用地址就是 APP_URL。
// shared/config.ts 里没有这个键（那份配置面向 Worker 与采集器），按 §4.3 规则三业务代码也
// 不碰 process.env：桌面启动器不该依赖采集器的进程环境，更不该把地址塞进 shared 的配置出口。
// 所以这里从「命令行参数」或「.env 文件」读，用 fs 读 .env 而不是读 process.env —— 理由：
// .env 是采集器那份文件，桌面启动器按文件解析即可，彼此隔离，谁都不用往进程环境里塞值。

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 只声明本包用到的 process 成员，故意不含 env：桌面启动器不从进程环境取值。 */
export interface DesktopProcess {
  argv: string[];
  platform: string;
  exit(code?: number): never;
}

/** 与 shared/config.ts 一致，用 globalThis 拿 process，不引 Node 全局类型。 */
export function nodeProcess(): DesktopProcess {
  return (globalThis as unknown as { process: DesktopProcess }).process;
}

function fromArgs(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--url" || a === "-u") return argv[i + 1] ?? null;
    if (a.startsWith("--url=")) return a.slice("--url=".length);
    if (/^https?:\/\//i.test(a)) return a; // 也允许把 URL 直接当位置参数
  }
  return null;
}

function envPathFromArgs(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--env") return argv[i + 1] ?? null;
    if (argv[i].startsWith("--env=")) return argv[i].slice("--env=".length);
  }
  return null;
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const quoted =
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"));
    if (quoted) val = val.slice(1, -1);
    if (key) out[key] = val;
  }
  return out;
}

function validUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 读取 APP_URL，优先级：命令行 --url / 位置参数 > .env 文件里的 APP_URL。
 * 没有默认值：拿不到就明确报错退出，不猜一个地址去打开。
 */
export function readAppUrl(): string {
  const proc = nodeProcess();
  const argv = proc.argv.slice(2);

  // env.ts 位于 packages/desktop/src/，向上三级到仓库根；.env 默认就放那里。
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const envPath = envPathFromArgs(argv) ?? join(root, ".env");

  const url = (fromArgs(argv) ?? parseEnvFile(envPath).APP_URL ?? "").trim();

  if (!validUrl(url)) {
    throw new Error(
      "未找到可用的 APP_URL。\n" +
        "用法：npm run desktop -- --url https://study.example.com\n" +
        "或在仓库根 .env 里写 APP_URL=https://study.example.com\n" +
        "（--env <路径> 可指定别的 .env 文件）",
    );
  }
  return url;
}
