// 入口的第一道门：配置不齐就明确不启动，绝不能拿空地址去崩、更不能联网。
// 这里把全局 fetch 换成会抛错的哨兵，直接断言「零次调用」，比只看输出更硬。
import test from "node:test";
import assert from "node:assert/strict";

interface ProcLike {
  env: Record<string, string | undefined>;
  exitCode?: number;
}

const KEYS = [
  "BB_CAS_URL", "BB_BASE_URL", "BB_SERVICE_PATH", "BB_STREAM_PATH",
  "BB_MYGRADES_PATH", "BB_CALENDAR_PATH", "BB_USER", "BB_PASSWORD",
  "BB_SUBJECT_MAP", "API_BASE_URL", "COLLECTOR_TOKEN",
];

const REQUIRED = [
  "BB_CAS_URL", "BB_BASE_URL", "BB_USER", "BB_PASSWORD",
  "API_BASE_URL", "COLLECTOR_TOKEN",
];

test("缺配置时打印全部缺失项、非零退出，且不发起任何网络请求", async () => {
  // 测试代码显式操作环境变量来模拟「未配置」；业务代码仍禁止读环境。
  const proc = (globalThis as { process?: ProcLike }).process;
  assert.ok(proc, "需要 Node 进程句柄");
  const p = proc as ProcLike;

  const savedFetch = globalThis.fetch;
  const savedError = console.error;
  const savedWarn = console.warn;
  const savedLog = console.log;
  const savedExitCode = p.exitCode;
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of KEYS) {
    savedEnv[k] = p.env[k];
    delete p.env[k];
  }

  let fetchCalls = 0;
  const logs: string[] = [];
  const collect = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("缺配置时不应联网");
  }) as unknown as typeof fetch;
  console.error = collect;
  console.warn = collect;
  console.log = collect;

  try {
    // index.ts 顶层执行 main()；缺配置分支在所有 fetch 之前同步 return
    await import("../src/index.ts");
    await new Promise((r) => setImmediate(r));

    assert.equal(fetchCalls, 0, "缺配置分支必须零网络请求");
    assert.equal(p.exitCode, 1, "应设置非零退出码而不是崩溃");
    const text = logs.join("\n");
    assert.match(text, /采集器不启动/);
    for (const k of REQUIRED) {
      assert.ok(text.includes(k), `应打印缺失项 ${k}`);
    }
  } finally {
    globalThis.fetch = savedFetch;
    console.error = savedError;
    console.warn = savedWarn;
    console.log = savedLog;
    p.exitCode = savedExitCode;
    for (const k of KEYS) {
      if (savedEnv[k] === undefined) delete p.env[k];
      else p.env[k] = savedEnv[k];
    }
  }
});
