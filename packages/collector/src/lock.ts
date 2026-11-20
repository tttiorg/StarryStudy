// 单实例锁：定时任务每小时触发，网络慢时上一次可能还没结束。两个进程同时
// POST /api/ingest/* 会各自「先 SELECT 再 batch」，撞 UNIQUE 约束导致整批回滚，
// 还会重复登录、重复写 sync_runs、重复 ack。这里用 wx 原子建锁文件，同一时刻
// 只有一个采集器能跑；进程退出（含异常）都删锁，陈旧锁按时间自动失效。
//
// 为什么不用内存互斥体：计划任务与用户手动跑是两个进程，跨进程必须落到文件系统。
import { nowIso } from "@starry/shared";

interface FsLike {
  open(p: string, flags: string): Promise<{ close(): Promise<void> }>;
  writeFile(p: string, data: string, enc: string): Promise<void>;
  readFile(p: string, enc: string): Promise<string>;
  unlink(p: string): Promise<void>;
  mkdir(p: string, opts: { recursive: boolean }): Promise<unknown>;
  stat(p: string): Promise<{ mtimeMs: number }>;
}
interface PathLike {
  dirname(p: string): string;
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
}
interface UrlLike {
  fileURLToPath(u: string): string;
}

/** 时间兜底：连 PID 都读不到时，超过这个毫秒数也允许接管；正常单轮远小于它。 */
const STALE_MS = 30 * 60 * 1000;

interface ProcLike {
  kill?(pid: number, signal?: number | string): boolean;
}

/** Windows / POSIX 都支持 signal 0：只探测进程是否存在，不真的发信号。 */
function pidAlive(pid: number): boolean {
  if (!pid) return false;
  const proc = (globalThis as { process?: ProcLike }).process;
  if (typeof proc?.kill !== "function") return true; // 探测不了就保守当作活着
  try {
    proc.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = 进程不存在；EPERM = 存在但无权，仍算活着
    const code = (e as { code?: string }).code;
    return code === "EPERM";
  }
}

async function modules(): Promise<{ fs: FsLike; path: PathLike; lockPath: string }> {
  const fsMod = "node:fs/promises";
  const pathMod = "node:path";
  const urlMod = "node:url";
  const fs = (await import(fsMod)) as unknown as FsLike;
  const path = (await import(pathMod)) as unknown as PathLike;
  const { fileURLToPath } = (await import(urlMod)) as UrlLike;
  const here = path.dirname(fileURLToPath(import.meta.url)); // src/
  const root = path.resolve(here, "../../..");              // src -> collector -> packages -> 仓库根
  const dir = path.join(root, "data");
  await fs.mkdir(dir, { recursive: true });
  return { fs, path, lockPath: path.join(dir, "collector.lock") };
}

export interface CollectorLock {
  release(): Promise<void>;
}

/**
 * 拿不到锁不抛错、返回 null：定时任务里「已有实例在跑」是正常情况，
 * 直接跳过这一轮即可，不该把日志写成失败。
 */
export async function acquireLock(): Promise<CollectorLock | null> {
  const { fs, lockPath } = await modules();

  // 进程被强杀（任务超时、断电、kill）不会走 finally，锁文件会残留。
  // 优先看锁里记的 PID 是否还活着：死了立即接管，不必等 30 分钟时间兜底，
  // 否则接下来每小时的任务都会被这个孤儿锁白白跳过。
  try {
    const content = await fs.readFile(lockPath, "utf8");
    const pid = Number(content.trim().split(/\s+/)[0]) || 0;
    const st = await fs.stat(lockPath);
    const timedOut = Date.now() - st.mtimeMs > STALE_MS;
    if (!pidAlive(pid) || timedOut) {
      try { await fs.unlink(lockPath); } catch { /* 已被别的进程清掉 */ }
    }
  } catch {
    // 锁不存在（或读失败），按正常流程尝试原子创建
  }

  let handle: { close(): Promise<void> };
  try {
    handle = await fs.open(lockPath, "wx");
  } catch {
    return null;
  }
  // 用 globalThis 结构化取进程句柄，和 config.ts 一致：不依赖 @types/node
  const pid = (globalThis as { process?: { pid?: number } }).process?.pid ?? 0;
  try {
    await fs.writeFile(lockPath, `${pid} ${nowIso()}`, "utf8");
  } catch {
    // 写内容失败不影响排他性，锁文件本身已建立
  }
  await handle.close();

  return {
    async release(): Promise<void> {
      try { await fs.unlink(lockPath); } catch { /* 已清理 */ }
    },
  };
}
