// 本地集成冒烟测试。覆盖 §11 验收清单里不需要真机/外网的部分：
// #4 课表单格、#6 done 不被采集覆盖、#7 软删不复活、#8 409、Range/ETag/304。
// 用法：先 npm run db:migrate && npm run dev，再
//   node scripts/smoke-test.mjs --base http://127.0.0.1:8787 --collector-token <与 .dev.vars 一致的值>
// 本机裸 curl 会走全局代理 502（W-01），所以这里用 Node 的 fetch，不走代理。
import assert from "node:assert/strict";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:8787").replace(/\/$/, "");
const collectorToken = arg("collector-token", "");
const demoPassword = arg("password", "demo-only-password");

let cookie = "";
let passed = 0;

async function call(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const pair = c.split(";")[0];
    if (pair.startsWith("sid=")) cookie = pair;
  }
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

function ok(label, condition, detail = "") {
  assert.ok(condition, `${label}${detail ? ` :: ${detail}` : ""}`);
  passed += 1;
  console.log(`  PASS  ${label}`);
}

async function main() {
  const health = await call("/api/health");
  ok("health 不泄露环境信息", health.status === 200 && Object.keys(health.data).length === 1);

  const status = await call("/api/auth/status", { method: "POST", body: {} });
  ok("auth/status 可用", status.status === 200);

  if (status.data?.needSetup) {
    const setup = await call("/api/auth/setup", { method: "POST", body: { password: demoPassword } });
    ok("首次设置密码", setup.status === 200, JSON.stringify(setup.data));
  }
  const login = await call("/api/auth/login", { method: "POST", body: { password: demoPassword } });
  ok("登录拿到 HttpOnly Cookie", login.status === 200 && cookie.startsWith("sid="));

  const boot = await call("/api/bootstrap");
  ok("bootstrap 一次拿全", boot.status === 200 && Array.isArray(boot.data.subjects) && Array.isArray(boot.data.timetable.slots));
  const before = boot.data.timetable.slots.length;

  // 验收 #4：只提交一格，其他格子不受影响
  const slot = { day: 2, block: 3, name: "冒烟测试", room: "X-1", teacher: "", weeks: "", subjectId: null };
  const putSlot = await call("/api/timetable/slot", { method: "PUT", body: slot });
  ok("课表单格写入", putSlot.status === 200, JSON.stringify(putSlot.data));
  const after = await call("/api/timetable");
  ok("只新增/改动这一格", after.data.slots.length === before + 1 &&
    after.data.slots.some((s) => s.day === 2 && s.block === 3 && s.name === "冒烟测试"));

  // 验收 #8：陈旧 rev 必须 409，且返回服务端当前完整记录
  const notes = await call("/api/notes");
  const note = notes.data.items[0];
  if (note) {
    const first = await call(`/api/notes/${note.id}`, { method: "PUT", body: { rev: note.rev, content: "第一次" } });
    ok("笔记按 rev 写入", first.status === 200 && first.data.rev === note.rev + 1);
    const stale = await call(`/api/notes/${note.id}`, { method: "PUT", body: { rev: note.rev, content: "第二次" } });
    ok("陈旧 rev 返回 409 + 服务端记录", stale.status === 409 &&
      stale.data?.error === "conflict" && stale.data?.server?.content === "第一次");
  }

  if (collectorToken) {
    const h = { "X-Collector-Token": collectorToken };
    const srcKey = `bbcal:smoke-${Date.now()}`;
    const tasks = await call("/api/tasks");
    const today = tasks.data.items.find((t) => t.due)?.due ?? "2026-11-12";
    const item = {
      srcKey, title: "冒烟作业", due: today, time: "", type: "assignment",
      place: "", note: "", subjectId: null, bbDone: false,
    };
    const ingest1 = await call("/api/ingest/tasks", { method: "POST", body: { items: [item] }, headers: h });
    ok("采集器写入 BB 任务", ingest1.status === 200 && ingest1.data.created === 1, JSON.stringify(ingest1.data));

    const created = (await call("/api/tasks")).data.items.find((t) => t.srcKey === srcKey);
    ok("采集记录带 src=bb", created?.src === "bb");

    // 验收 #6：用户手动勾完成后，采集器再跑也不许改回去
    const manual = await call(`/api/tasks/${created.id}`, {
      method: "PUT", body: { rev: created.rev, done: true, doneManual: true },
    });
    ok("手动标记完成", manual.status === 200);
    await call("/api/ingest/tasks", { method: "POST", body: { items: [{ ...item, bbDone: false }] }, headers: h });
    const kept = (await call("/api/tasks")).data.items.find((t) => t.srcKey === srcKey);
    ok("done 不被采集器覆盖", kept?.done === true);

    // 验收 #7：软删后采集器不许复活
    await call(`/api/tasks/${created.id}`, { method: "DELETE" });
    const again = await call("/api/ingest/tasks", { method: "POST", body: { items: [item] }, headers: h });
    const revived = (await call("/api/tasks")).data.items.find((t) => t.srcKey === srcKey);
    ok("软删条目不被复活", !revived && again.data.created === 0, JSON.stringify(again.data));
  } else {
    console.log("  SKIP  采集器相关断言（未提供 --collector-token）");
  }

  // CF-07 / CF-08：Range / ETag / 304
  const form = new FormData();
  form.append("files", new Blob(["starry-study smoke test content"], { type: "text/plain" }), "smoke.txt");
  const up = await call("/api/files/upload", { method: "POST", body: form });
  const file = up.data?.items?.[0] ?? up.data?.item;
  if (up.status === 200 && file) {
    const raw = await call(`/api/files/${file.id}/raw`, { raw: true });
    const etag = raw.headers.get("etag");
    ok("raw 返回 ETag 与 Accept-Ranges", raw.status === 200 && !!etag && raw.headers.get("accept-ranges") === "bytes");
    const cached = await call(`/api/files/${file.id}/raw`, { raw: true, headers: { "If-None-Match": etag } });
    ok("If-None-Match 命中 304 无 body", cached.status === 304);
    const partial = await call(`/api/files/${file.id}/raw`, { raw: true, headers: { Range: "bytes=0-4" } });
    ok("Range 返回 206 + Content-Range", partial.status === 206 && !!partial.headers.get("content-range"));
  } else {
    ok("文件上传可用", false, JSON.stringify(up.data));
  }

  console.log(`\n冒烟测试通过 ${passed} 项。`);
}

main().catch((err) => {
  console.error("冒烟测试失败：", err.message);
  process.exit(1);
});
