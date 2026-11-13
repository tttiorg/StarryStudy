// 采集器与 Worker 的接口边界：形状要吃下 Worker 实际返回的两种响应，
// 且每个请求都带令牌、网络错误不能静默吞掉。用 mock fetch 覆盖整条链路。
import test from "node:test";
import assert from "node:assert/strict";
import type { CollectorConfig } from "@starry/shared";
import { IngestClient, fetchCloudContext } from "../src/ingest";

// 令牌取短值：仓库隐私自检会把「关键字 = 6 字符以上字面量」当疑似凭据，
// 测试里这个值只用于断言 header 传递，不需要真实长度。
const CLOUD: CollectorConfig = { apiBaseUrl: "https://api.example.com", token: "t" };

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(handler: (url: string) => unknown) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = handler(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function headersOf(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

test("GET /api/subjects 支持 {items:[...]}，且带 X-Collector-Token", async () => {
  const m = mockFetch(() => ({ items: [{ id: "s_1", bbCourseId: "_100_1", name: "课程甲" }] }));
  try {
    const subs = await new IngestClient(CLOUD).fetchSubjects();
    assert.equal(subs.length, 1);
    assert.equal(subs[0].id, "s_1");
    assert.equal(subs[0].bbCourseId, "_100_1");
    assert.equal(m.calls.length, 1);
    assert.match(m.calls[0].url, /\/api\/subjects$/);
    assert.equal(headersOf(m.calls[0])["X-Collector-Token"], "t");
  } finally {
    m.restore();
  }
});

test("GET /api/subjects 也兼容裸数组与 {subjects:[...]}", async () => {
  const item = { id: "s_1", bbCourseId: "_100_1" };
  for (const shape of [[item], { subjects: [item] }, { items: [item] }]) {
    const m = mockFetch(() => shape);
    try {
      const subs = await new IngestClient(CLOUD).fetchSubjects();
      assert.equal(subs[0].id, "s_1");
    } finally {
      m.restore();
    }
  }
});

test("GET /api/bootstrap 支持顶层 bbMap，且带 X-Collector-Token", async () => {
  const m = mockFetch(() => ({ bbMap: { _100_1: "s_1", _200_1: "s_2" } }));
  try {
    const map = await new IngestClient(CLOUD).fetchBootstrapMap();
    assert.deepEqual(map, { _100_1: "s_1", _200_1: "s_2" });
    assert.match(m.calls[0].url, /\/api\/bootstrap$/);
    assert.equal(headersOf(m.calls[0])["X-Collector-Token"], "t");
  } finally {
    m.restore();
  }
});

test("bootstrap 同时带空 settings 与 bbMap 时不丢映射", async () => {
  const m = mockFetch(() => ({ settings: {}, bbMap: { _100_1: "s_1" } }));
  try {
    const map = await new IngestClient(CLOUD).fetchBootstrapMap();
    assert.deepEqual(map, { _100_1: "s_1" });
  } finally {
    m.restore();
  }
});

test("bootstrap 兼容 settings['bb.map'] 对象与 JSON 字符串两种形状", async () => {
  const objectShape = { settings: { "bb.map": { _100_1: "s_1" } } };
  const stringShape = { settings: { "bb.map": JSON.stringify({ _100_1: "s_1" }) } };
  for (const shape of [objectShape, stringShape]) {
    const m = mockFetch(() => shape);
    try {
      const map = await new IngestClient(CLOUD).fetchBootstrapMap();
      assert.deepEqual(map, { _100_1: "s_1" });
    } finally {
      m.restore();
    }
  }
});

test("fetchCloudContext 合并云端 bbMap 与本地映射，本地优先", async () => {
  const m = mockFetch((url) =>
    url.includes("/api/subjects")
      ? { items: [{ id: "s_1", bbCourseId: "_100_1" }] }
      : { bbMap: { _100_1: "s_cloud", _200_1: "s_2" } }
  );
  try {
    const ctx = await fetchCloudContext(CLOUD, { _100_1: "s_local" });
    assert.equal(ctx.subjects.length, 1);
    assert.equal(ctx.manualMap._100_1, "s_local", "本地明确配置优先");
    assert.equal(ctx.manualMap._200_1, "s_2", "云端映射仍要保留");
  } finally {
    m.restore();
  }
});

test("学科为空时直接抛错，不静默降级成一批无归属条目", async () => {
  const m = mockFetch(() => ({ items: [] }));
  try {
    await assert.rejects(() => fetchCloudContext(CLOUD, {}), /没返回学科/);
  } finally {
    m.restore();
  }
});

test("POST /api/ingest/* 只提交 {items}，响应解析成 IngestSummary", async () => {
  const m = mockFetch(() => ({ created: 1, updated: 2, skipped: 3 }));
  try {
    const client = new IngestClient(CLOUD);
    const r = await client.postGrades([
      { srcKey: "bb:_100_1:1", name: "x", subjectId: null, score: 1, full: 1,
        type: "other", date: "" },
    ]);
    assert.deepEqual(r, { created: 1, updated: 2, skipped: 3 });
    assert.match(m.calls[0].url, /\/api\/ingest\/grades$/);
    const body = JSON.parse(String(m.calls[0].init.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["items"]);
    assert.equal(headersOf(m.calls[0])["X-Collector-Token"], "t");
  } finally {
    m.restore();
  }
});

test("网络错误不静默吞掉，给出可诊断信息与 W-01 的 curl 提示", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () => new IngestClient(CLOUD).fetchSubjects(),
      /curl --noproxy/
    );
  } finally {
    globalThis.fetch = original;
  }
});
