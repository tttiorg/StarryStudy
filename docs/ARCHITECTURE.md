# 架构

## 1. 形态与数据流

v2 是「Cloudflare 边缘 + D1 + B2（Backblaze B2，S3 兼容 API）+ 自有域名」，本机只负责采集。
**云端是唯一数据源**（single source of truth），本地不再存业务数据副本；电脑关机时手机、
平板照样能读写。

```mermaid
flowchart LR
  subgraph 本机（开机时）
    C[采集器 Node 脚本<br/>登录 CAS / Blackboard<br/>抓成绩、抓日历]
    D[桌面启动器 / 浏览器]
  end
  subgraph 手机 / 平板（随时）
    M[浏览器 PWA]
  end
  subgraph Cloudflare（自有域名 + 边缘）
    W[Worker<br/>静态资源 + REST API]
    D1[(D1：结构化数据)]
  end
  subgraph Backblaze
    B2[(B2：文件对象<br/>S3 兼容 API)]
  end
  C -->|POST /api/ingest/*<br/>带 X-Collector-Token| W
  D -->|同源 HTTPS| W
  M -->|同源 HTTPS| W
  W --> D1
  W -->|S3 兼容 API| B2
```

三个终端：

| 终端 | 场景 | 关键诉求 |
|---|---|---|
| 电脑（Windows） | 主力，每天开着 | 全屏独立窗口、能跑采集器、能打开本机文件 |
| 手机（安卓 Edge） | 路上查、随手记 | 笔记能写、PDF 页内直接看、不下载到本地 |
| 平板 | 看资料、看课表 | 同上，屏幕更大 |

采集器与浏览器**走同一套 API**，区别只是采集器带 `X-Collector-Token`、且只能写 `src=bb`
的条目（见 §6）。电脑关机后，浏览器读写完全不依赖本机，这正是换架构的头等目标。

核心闭环：Blackboard 上的作业与成绩自动进来 → 主页告诉你今天要交什么 → 学科页看到一门
课的所有成绩、资料、笔记 → 资料里的 PDF 在手机上也点得开。

## 2. 为什么选 Cloudflare（备选与否决理由）

按「电脑关机手机也能用」这条硬约束筛掉的方案：

| 备选 | 否决理由 |
|---|---|
| 继续续费现有云 VM | 用户明确要脱离，且订阅到期在即；数据不该再绑在一台 VM 的磁盘上 |
| 家里常开一台机器 + 内网穿透（Tunnel） | 代码几乎不用改，但需要一台 7×24 设备、耗电、断电断网就全挂，直接违反「电脑关机手机也能用」 |
| Supabase 免费版 | 库与存储额度偏小，用户资料会到 1–2GB，直接超 |
| Vercel + 外部数据库 | 静态 + Serverless 可以，但文件存储还要另找，且境内访问不稳 |
| **Cloudflare Workers + D1 + B2** | 免费额度够（D1 5GB / B2 10GB 存储，下载有每日免费额度），Worker 跑在全球边缘，无需运维 |

`*.workers.dev` 子域在中国大陆被 DNS 污染（实测解析到无关地址段、直连超时），
**所有部署必须绑自定义域名**，不要在默认配置或文档里假设它可用。Cloudflare 边缘比原
云主机慢一个量级，但对 1–2MB 的 PDF 与文本同步足够，不值得为这 100ms 去做缓存优化。

## 3. 已定下来的技术选择

| 项 | 决定 | 理由 |
|---|---|---|
| 域名 | 用户自购，NS 托管到 Cloudflare | `workers.dev` 不可用 |
| 登录 | 自建：单账号 + 密码 + 签名 Cookie，不用 Cloudflare Access | Access 不支持 `workers.dev`，且自建能保持「单账号」模型 |
| 文件下载 | 默认 Worker 代理转发；单文件 >50MB 才返回 B2 预签名直链（Worker 用 SigV4 生成） | 代理能逐请求校验权限；大文件才需要绕开 Worker 请求数 |
| 缓存头 | `Cache-Control: private, max-age=0` + `ETag`，命中返回 304 | 既不浪费流量，也不会让手机看到旧版本 |
| 写入冲突 | 每条记录带 `rev`，提交带上，不匹配返回 409 | 见 §5 |
| 通知 | 企业微信群机器人 webhook（**不做邮件**） | 邮件需要第三方 API + 发件人验证；webhook 一个 POST 就够，境内直连 |
| 前端 | Vue 3 + Vite + Vue Router + Pinia + Element Plus | 沿用既有 UI 习惯 |

实现落点：`wrangler.toml` 只绑定 `ASSETS`（静态）与 `DB`（D1），B2 不设 binding，由 Worker
凭 5 个 `B2_*` 环境变量通过 S3 兼容 API 访问；`packages/shared/src/constants.ts` 定义
`PRESIGN_THRESHOLD_BYTES = 50MB`、`SESSION_COOKIE = "sid"`、`SESSION_TTL_DAYS = 30` 等；
`config.ts` 是唯一读取环境的出口。

### 3.1 本地占位 ID 与线上覆盖

`wrangler.toml` 里 `[[d1_databases]]` 的 `database_id` 是一个**全零占位 UUID**
`00000000-0000-0000-0000-000000000000`。这不是任何真实基础设施信息，而是被 Wrangler 逼出来
的：连 `--local` 都强制要求 `database_id` 字段存在，完全缺省时 `wrangler d1 migrations apply
--local` 会直接拒绝加载配置，新人 clone 下来连迁移都跑不了。占位值让本地 D1 落到
`.wrangler/state`，`wrangler dev` / `npm run db:migrate` 开箱即用。B2 没有 binding，桶名与
App Key 不出现在 `wrangler.toml`，只走 Worker secret / `.dev.vars`。

**线上部署必须在 `wrangler.local.toml`（已 gitignore）里把 `database_id` 覆盖成真实值**，
否则 `npm run deploy` / `npm run db:migrate:remote` 会带着占位值连到错误的库（或加载失败），
数据写不到自己的 D1。真实 `database_id`、`account_id` 绝不写进公开的 `wrangler.toml`
（CF-11），只放 `wrangler.local.toml` 或 CI secret；B2 的 5 个凭据用 `wrangler secret put`
设置，同样不进任何文件。两条迁移命令的分工：

| 命令 | 目标 | 读哪份配置 |
|---|---|---|
| `npm run db:migrate` | 本地 D1（`.wrangler/state`，占位 ID 够用，不连线上） | `wrangler.toml` |
| `npm run db:migrate:remote` | 线上真实 D1 | `wrangler.local.toml`（`--remote --config`） |

`wrangler dev` 的本地 D1 与线上行为有差异，每次迁移后至少要跑一次 `--remote` 验证真实 D1
（CF-09）。完整部署流程见 `docs/SELF-HOSTING.md`。

## 4. 请求生命周期与 SPA fallback 边界

Worker 同时托管静态资源与 API，全部同源、全部 `/api` 前缀 JSON，没有 CORS。
`wrangler.toml` 的 `[assets]` 开了 `not_found_handling = "single-page-application"`，但
**这个设置只作用于静态资源绑定，不能指望它兜 API**（CF-05）。入口必须按下面的顺序判定：

```
请求进入
  ├─ 路径以 /api/ 开头 ──► 交给 API 路由（含 /api/health、/api/bootstrap、各 CRUD、/api/ingest/*）
  │                         未匹配的 /api/* 必须返回 JSON 404，绝不能掉到 index.html
  ├─ 命中静态资源（带扩展名且存在）─► 直接返回 ASSETS（带 ETag / Range 处理）
  └─ 其余 GET（无扩展名的前端路由，如 /subjects/s_xxx）─► 回退 index.html
       └─ 带扩展名却找不到 ─► 真 404，不能回退成 HTML，否则脚本会被当页面塞给浏览器
```

关键点：**先处理 `/api/*`，最后才回退**。否则 SPA fallback 会吃掉 API 请求，返回
`200 + index.html`，前端拿到一段 HTML 当成 JSON 解析，表现为莫名其妙的报错。前端是
History 模式，断言 / 调试地址是 `/subjects/<id>` 而不是 `/#/subjects/<id>`。

写请求的统一形状（见 `packages/shared/src/schema.ts`，一律带 `rev`）：

```json
{ "title": "复习", "due": "2026-11-20", "rev": 3 }
```

- `200 { "item": {...}, "rev": 4 }`
- `409 { "error": "conflict", "server": { ...当前完整记录... } }`
- `404 / 400` 照常

## 5. 认证模型、乐观锁、时区

**认证**：单账号模型，没有 `users` 表，`auth` 表只有一行（id=1）存 `hash` 与
`session_id`。密码用 PBKDF2 哈希（免费版 CPU 上限 10ms，迭代默认 1 万次，见 CF-01）。
登录成功后签发 HttpOnly 签名 Cookie `sid`（全站 HTTPS），TTL 30 天；`AUTH_SECRET` 走
`wrangler secret put`，不写进任何文件。令牌 / 采集器口令比较用常量时间实现
（`packages/shared/src/utils.ts` 的 `timingSafeEqual`，自己实现长度检查 + 异或累加）。
首次访问 `hash` 为空 → `needSetup` → 要求设置密码。

**D1 / B2 分工**：D1 存全部结构化数据（学科、课表、任务、成绩、笔记、知识点、外链、
文件元数据、`settings`、`sync_runs`、`auth`）；B2 只存文件对象，key 为内容寻址的
`blob/<sha256前2位>/<sha256>`。结构化子对象（`course` / `faculty` / `tags` / `log`）用
`TEXT` 存 JSON，不为它们建表。

**乐观锁与 409**：每条记录带 `rev`，写入 `UPDATE ... WHERE id = ? AND rev = ?`，
`changes() === 0` 就返回 409，并把服务端当前完整记录交给前端。前端收到 409 **不要静默
重试**，要提示「这条在别处改过」并展示两份差异，让用户自己选保留哪份。手机与平板不会
同时编辑（已确认），所以 409 极少发生，不需要 CRDT / 字段级合并。采集器写入也要遵守：
读到旧 `rev` 就重读一次再写，最多重试 2 次。

**时区**：Workers 与 D1 的 `new Date()` / `datetime('now')` 都是 UTC，直接用会让「今天」
错一天（CF-06）。全项目唯一允许直接碰 `new Date()` / `Intl` 的地方是
`packages/shared/src/time.ts`；业务代码一律调 `todayInTZ()`（Asia/Shanghai）、`nowIso()`、
`addDays()`，不要自己算。时间戳统一存 ISO 8601 UTC 字符串；日期型字段（`due` / `date` /
`next_review`）只存 `YYYY-MM-DD`，不存时区。示例种子里用 `date('now','+8 hours')` 取
Asia/Shanghai 的「今天」，也是这个原因。

## 6. 采集器边界

`/api/ingest/tasks`、`/api/ingest/grades` 是采集器专用入口，约束很死：

- **只带 `X-Collector-Token`**（与 Worker 的 `AUTH_COLLECTOR_TOKEN` 一致），用常量时间比较；
  没有合法令牌一律拒绝。
- **只能写 `src=bb` 的记录**。`packages/shared/src/schema.ts` 里 `ingestTask.srcKey` 必须
  以 `bbcal:` 开头、`ingestGrade.srcKey` 必须匹配 `bb:<courseId>:<rowId>`，从入参形状上
  就杜绝伪装成手动数据。
- **白名单更新**：更新已存在记录时只改 `title` / `due` / `time` / `type` / `place` /
  `note` / `subject_id`（仅当为空时）。绝不覆盖用户手填的 `done_manual`、`weight`、
  `score` 以外的 `note`、`tags`、`pinned`、`rev`。别用 `INSERT OR REPLACE`，它会把整行冲掉。
- **软删不复活**：ingest 匹配到 `deleted_at` 非空的记录时跳过，不要 upsert 回去（D-01）。
- `done` 的最终值由服务端按 §8.2 三条规则算，采集器只提交 `bbDone`（「BB 认为完成了吗」），
  不许自己决定。

采集器代码放在 `packages/collector`，用通用 Blackboard 适配器 + 可选学校专属适配器
（默认不加载）；所有学校地址、账号、云端目标、令牌都从配置读，默认值全空，没配齐就不启动
（`config.ts` 的 `collectorConfigured` / `collectorMissing`）。本机采集器是唯一需要登录
学校系统的进程，凭据留在本机，绝不进仓库。

## 7. 明确删除的 v1 模块

以下模块随 v1 一起废弃，v2 不带过来，也不要「为将来」重新引入：

| 已删除 | 原因 |
|---|---|
| 云同步（`cloud.js`、`cloud-snapshot.js`、`sync.js`、`CloudSyncPanel.vue`、双 token 兼容） | 云端就是数据源，本地壳转发 + 快照兜底彻底不需要 |
| AIHOT 侧栏 + `/__proxy` + `/__px` 页面代理 | 功能已删；代理要剥响应头、改写子资源地址，是最脏的一块 |
| 视频页 / `MediaPane.vue` | 已删 |
| APK / Capacitor 路线 | 已废弃，改用浏览器 PWA |
| `dsh` 集成（反向代理、会话保持、长连接转发） | 已删，别再引入常连接通道 |
| `_legacy/`、`release/`、`dist/` 产物 | 构建产物与归档 |
| `config.json` 里 `cloud.baseUrl` 多地址回退链 | 没有隧道了，不需要 fallback 链 |
| 系统文件 / 文件夹选择对话框 | 只有本地壳需要；要么放 `desktop` 包，要么删 |
| 课表 `PUT /` 整份替换（`mode:"replace"`） | 只保留给「导入」用，日常编辑一律走单格 |

对应地，资料文件从 v1 的「`link` 本机路径 / `upload` 副本」两种，收敛为只有上云一种；
本机 `link` 型标记 `local_only=1`，手机端显示「仅电脑可用」且不可点开。文件夹映射、师资
官网抓取、壁纸等本机 / 学校专属能力，v2 不做或抽成默认关闭的适配器。

> 不能丢的业务语义（课表按格、`done` 三条规则、白名单、时间占位值、成绩稳定键与求和、
> 409 处理、学科匹配优先级、铃铛水位、艾宾浩斯间隔）见 `docs/DATA-MODEL.md`，那里是这套
> 系统真正的价值所在，改之前先读。
