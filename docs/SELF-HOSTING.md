# 自托管部署

这份文档给「想部署自己一份」的人。全程用自己的域名、自己的 Cloudflare 账号、自己的 D1
与 B2 桶，凭据只放本地 / Worker Secret，不进仓库。`*.workers.dev` 子域在中国大陆被 DNS 污染，
**必须绑定自定义域名**，下面所有步骤都以此为前提。

> 文中所有地址都是虚构示例：`study.example.com`（应用）、`example.com`（主域）。换成你
> 自己买的域名即可，不要把真实域名、IP、桶名、`database_id` 写进任何会被提交的文件。

## 0. 前置：要买什么、装什么、配置什么

| | 项目 | 说明 |
|---|---|---|
| 要买 / 注册 | 一个自有域名 | 绑定成应用入口，一年几十到一百多元 |
| | Cloudflare 账号 | Workers、D1、域名接入；个人用量免费额度够 |
| | Backblaze B2 账号 + 私有桶 + 一对 Application Key | 存资料文件；10 GB 内通常免费 |
| 装什么 | 云端：什么都不用装 | `wrangler deploy` 推一次即可 |
| | 本机：Node 20+（CI 用 22）、npm | 只在部署、跑采集器、构建安装包时需要 |
| | 日常设备：浏览器即可 | 可选装 Windows 桌面启动器（见 [`installer/README.md`](../installer/README.md)） |
| 配置什么 | `wrangler.local.toml`：真实 `account_id`、D1 `database_id`、域名 `routes` | 从 `.example` 复制，绝不进仓库 |
| | 8 个 Worker secret：`AUTH_SECRET`、`AUTH_COLLECTOR_TOKEN`、`NOTICE_WEBHOOK_URL`、5 个 `B2_*` | 见第 4、5 节 |
| | 首次访问密码 | 浏览器第一次打开时设置 |
| | 可选：本机 `.env` 的 `BB_*` / `API_BASE_URL` / `COLLECTOR_TOKEN` | 不配不影响网页使用，只是没有自动采集 |
| | 可选：学科页「编辑信息 → 课程主页」填一次 BB 课程页链接 | 「Blackboard」按钮据此按课程 ID 自动跳转；真实域名由使用者填，不进仓库 |

部署完成后，网页「设置 → 数据概览」会显示 **BB 抓取状态**（最近抓取时间、成功 / 失败）与
「手动抓取」按钮。云端网页无法直接启动本机采集器，按钮只登记请求；在本机跑一次
`npm run collect` 即会消费该请求并把结果写回状态页。

## 常用命令速查

全部在仓库根运行，与根 `package.json` 一致。CI 的顺序是 `npm ci` → `npm run typecheck`
→ `npm test` → `npm run check:privacy` → `npm run build`。

| 命令 | 作用 |
|---|---|
| `npm ci` | 按锁文件安装（CI 用，可复现） |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` |
| `npm test` | 单测（当前聚合 `packages/collector` 的 node:test 用例），纯本地、不连线上服务 |
| `npm run check:privacy` | 隐私自检；pre-commit 与 CI 都调它 |
| `npm run check` | `typecheck` + `check:privacy` |
| `npm run build` | 构建前端 |
| `npm run db:migrate` | 本地 D1 建表（读 `wrangler.toml` 占位 ID，不连线上） |
| `npm run db:migrate:remote` | 线上真实 D1 建表（`--remote --config wrangler.local.toml`） |
| `npm run deploy` | 构建 + `wrangler deploy --config wrangler.local.toml` |
| `npm run dev` | 构建 + `wrangler dev`（本地服务） |
| `npm run collect:dry` / `npm run collect` | 本机采集器空跑 / 正式跑 |
| `npm run desktop` | 起浏览器全屏独立窗口 |
| `npm run smoke` | 接口冒烟；需先 `npm run db:migrate`，并在另一个终端 `npm run dev` 起本地服务 |

## 1. 买域名并把 NS 托管到 Cloudflare

1. 在任意注册商买一个域名（示例 `example.com`）。
2. 在 Cloudflare 添加站点，按提示把注册商处的 Nameserver 改成 Cloudflare 给的两个值。
3. 等面板状态变成 **Active** 再继续。后面的 `routes` 依赖这个 zone，未 Active 会 404 且
   没有任何提示（CF-10）。

## 2. 认证 Wrangler（凭据只放本地）

二选一，都只在你的本机终端执行，不进仓库：

- `npx wrangler login`（浏览器授权）；或
- 在终端配置 `CLOUDFLARE_API_TOKEN` 环境变量（ scopes 至少含 D1 / Workers 编辑与
  `Account:Read`）。这个令牌以及后面要用到的**真实** `database_id`、`account_id`，还有 B2 的
  桶名与 App Key，都属于私有部署参数，绝不写进公开的 `wrangler.toml`（那里只有一个占位值）
  或提交给 CI（CF-11）。

## 3. 创建 D1 数据库与 B2 桶

D1 用 Wrangler 建；B2 桶在 Backblaze B2 控制台创建（它不归 Cloudflare 管，没有对应的
wrangler 命令）：

```bash
npx wrangler d1 create starry-study        # 记下输出里的 database_id
```

在 Backblaze B2 控制台创建桶后，记下下面 5 个值，它们是 Worker 访问 B2 的全部凭据（示例
值一律用占位，真实值只放本地 / Worker Secret）：

- `B2_ENDPOINT`：S3 兼容 API 端点
- `B2_REGION`：桶所在区域
- `B2_KEY_ID`：应用密钥的 Key ID
- `B2_APP_KEY`：应用密钥本身
- `B2_BUCKET_NAME`：桶名

> 大文件（>50MB）的预签名直链由 Worker 用 B2 的 SigV4 生成，不再依赖 Cloudflare 侧的对象
> 存储 API Token；这 5 项凭据必须全部配置，没有「可选留空」一说。

## 4. 生成 `wrangler.local.toml`

公开的 `wrangler.toml` 里 `[[d1_databases]]` 带了一个**全零占位 UUID**
（`00000000-0000-0000-0000-000000000000`），仅此一项占位，没有别的对象存储绑定。它不含任何
真实基础设施信息（CF-11），存在的原因是被 Wrangler 逼出来的：连 `--local` 都强制要求
`database_id` 字段存在，完全缺省时 `wrangler d1 migrations apply --local` 会直接报
「bindings must have a database_id field」，新人 clone 下来连迁移都跑不了。占位值让
`npm run dev` / `npm run db:migrate` 把本地 D1 落到 `.wrangler/state`，开箱即用。B2 桶
不设 binding，5 个 `B2_*` 凭据也不写进这份文件，见第 5 步。

**但线上部署绝不能用这个占位值。** 部署用的配置是 `wrangler.local.toml`（已被 `.gitignore`
排除）：把 `wrangler.toml` 的内容完整复制成 `wrangler.local.toml`（仓库里也有
`wrangler.local.toml.example` 作格式参照），把 `database_id` 覆盖成第 3 步得到的真实值，
再补上 `routes`。不覆盖的话，`npm run deploy` 与 `npm run db:migrate:remote` 会带着占位值
连到错误的库（或加载失败），数据写不到你自己的 D1：

```toml
[[d1_databases]]
binding = "DB"
database_name = "starry-study"
database_id = "<第 3 步得到的 database_id>"

routes = [
  { pattern = "study.example.com/*", zone_name = "example.com" }
]
```

- `pattern` 是「主机名 + `/*`」，`zone_name` 是主域名（不含子域、不含 `/*`）。写错会 404
  且无提示（CF-10），且该 zone 必须已 Active。
- 这里的 `database_id` **必须**覆盖掉 `wrangler.toml` 里的占位值；真实 `account_id` /
  `database_id` 绝不写进公开的 `wrangler.toml`（CF-11）。B2 的桶名与 App Key 走第 5 步的
  Worker Secret，同样不进任何文件。`npm run deploy` 与 `npm run db:migrate:remote` 都带
  `--config wrangler.local.toml`，会自动读这份本地配置。

## 5. 设置 Worker Secret

```bash
npx wrangler secret put AUTH_SECRET              # 会话签名密钥，粘贴一段随机长字符串
npx wrangler secret put AUTH_COLLECTOR_TOKEN     # 采集器令牌，与本机 .env 的 COLLECTOR_TOKEN 一致
npx wrangler secret put NOTICE_WEBHOOK_URL       # 可选：企业微信群机器人 webhook，不做邮件

# Worker 通过 S3 兼容 API 访问 B2，以下 5 项必须配置
npx wrangler secret put B2_ENDPOINT
npx wrangler secret put B2_REGION
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APP_KEY
npx wrangler secret put B2_BUCKET_NAME
```

这些值只存在 Cloudflare 的 Secret 里。本地 `wrangler dev` 若要用，复制
`.dev.vars.example` 为 `.dev.vars`（已 gitignore）按注释填，不要提交。线上与本机两边用
同一套键名，方便对账（`packages/shared/src/config.ts` 是唯一读取环境的出口）。

## 6. 建表（至少跑一次 `--remote`）

**生产部署前先删掉 `migrations/0002_example_seed.sql`**：那是完全虚构的演示数据，只为让
clone 下来能看到界面，不该进你的真实库。若已经执行过，按 `demo_` 前缀的 id 删除即可。

```bash
npm ci
npm run build
npm run db:migrate:remote     # wrangler d1 migrations apply ... --remote --config wrangler.local.toml
```

两条迁移命令读的不是同一份配置，别混淆：

- `npm run db:migrate` 走 `wrangler.toml` 的占位 ID，只作用于本地 D1（`.wrangler/state`），
  不连线上；`npm run db:migrate:remote` 才带 `--remote --config wrangler.local.toml`，作用
  于真实 D1。
- `wrangler dev` 的本地 D1 与线上行为有差异，**每次迁移后至少跑一次 `--remote` 验证真实
  D1**（CF-09）。

## 7. 部署

```bash
npm run deploy                # npm run build && wrangler deploy --config wrangler.local.toml
```

部署完成后打开 `https://study.example.com`：因为 `auth` 表的 `hash` 初始为空，首次访问会
进入「设置密码」，设好后即可以单账号登录。

## 8. 本机配采集器（BB 抓取在哪里配）

BB 抓取**不在网页里配置**：网页跑在 Cloudflare 上，碰不到你校园网里的 Blackboard。
真正干活的是本机采集器，它读本机的 `.env`，登录后把结果 POST 到云端 `/api/ingest/*`。
所以一共要配两个地方，缺一个都不会生效。

> **先进入项目目录再跑命令。** `npm run collect:dry` / `npm run collect` 必须在
> `D:\StarryStudy`（有 `package.json` 的那一层）执行。在 `C:\Users\你的用户名` 下直接跑
> 会报 `ENOENT ... Could not read package.json`，这不是配置问题：
> ```powershell
> cd D:\StarryStudy
> npm run collect:dry
> ```
> 脚本会通过 `scripts/load-env.mjs` 自动加载项目根目录的 `.env`，不需要手动设置环境变量。
> 这个预加载只用 Node 自带的 `fs`，**Node 18 / 20 / 22 都支持**（不依赖 `--env-file` 这类
> 高版本才有的选项）；`.env` 不存在时静默跳过，由采集器打印「缺少必要配置」。

| 地方 | 配什么 | 在哪配 |
|---|---|---|
| 云端 Worker | `AUTH_COLLECTOR_TOKEN` | 第 5 步的 `wrangler secret put` |
| 本机采集器 | `.env` 里的 `BB_*` / `COLLECTOR_TOKEN` / `API_BASE_URL` | 本机项目根目录，复制 `.env.example` |

### 8.1 逐项填 `.env`

```bash
cp .env.example .env          # Windows 用 copy .env.example .env
```

按注释填下面几项。示例地址全是占位，换成自己学校的真实地址；**这些值只留在本机**，
`.env` 已被 gitignore，绝不进仓库。**只有前 6 项必填，其余留空即可**（留空走内置通用
Blackboard 默认路径）。

| 键 | 填什么 | 去哪里找 |
|---|---|---|
| `BB_CAS_URL` | 学校统一登录（CAS）**站点根**，如 `https://cas.example.com` | 打开一次学校统一登录页，地址栏里 `https://` 到第一个 `/` 之间那一段。**只取这一段**，后面的 `/cas/login?service=...` 全部删掉 |
| `BB_BASE_URL` | Blackboard **站点根**，如 `https://bb.example.com` | 同上，登录进 Blackboard 后取地址栏的 `https://` + 域名，删掉 `/webapps/portal/...` 等所有路径 |
| `BB_USER` / `BB_PASSWORD` | 学校统一身份认证账号密码 | 就是登录学校 CAS / 信息门户用的那组；.`env` 只在本机，不上传 |
| `COLLECTOR_TOKEN` | **必须和云端 `AUTH_COLLECTOR_TOKEN` 完全一致**，否则写接口返回 401 | 这个值是你自己生成后写进 Worker secret 的，本机从 `.dev.vars` 的 `AUTH_COLLECTOR_TOKEN` 复制过来即可；不用去学校或 Cloudflare 找 |
| `API_BASE_URL` | 自己的 Worker 访问地址，如 `https://study.example.com` | 就是 `wrangler.local.toml` 里 `routes` 绑定的自定义域名，加 `https://`、不带路径 |
| `BB_SERVICE_PATH` | 选填，留空即用通用默认值 | 一般不用填；只有学校 CAS 回跳路径特殊时才改 |
| `BB_STREAM_PATH` / `BB_MYGRADES_PATH` / `BB_CALENDAR_PATH` | 选填，留空即用通用默认值 | 只有 `collect:dry` 报某类数据抓不到时才按学校实际路径微调 |
| `BB_SUBJECT_MAP` | 选填：BB `course_id` → 学科 id 的映射 JSON，见 8.2 | 只有 dry-run 输出里出现「未匹配学科」不为 0 时才需要填 |

> **两个地址千万别整条复制浏览器 URL。** 采集器会把 `BB_CAS_URL` / `BB_BASE_URL`
> 当站点根再拼 `/cas/login`、`/webapps/...`；若填了带 `?service=...` 的完整登录页地址，
> 会拼出 `https://cas.example.com/cas/login?service=.../cas/login` 这样的错地址。
> `BB_CAS_URL`、`BB_BASE_URL`、`API_BASE_URL` 三项都必须是「协议 + 域名」的裸根。

6 项必填里任何一项留空，采集器会**直接不启动**而不是崩掉；缺哪几项会明确打印出来。

### 8.2 学科怎么对上

采集器按学科记录里的 `bbCourseId`（形如 `_8497_1`）**精确匹配**，不按课程名模糊匹配：

- 默认从 BB 页面读 course_id，和库里的 `bbCourseId` 对；
- 对不上时用 `BB_SUBJECT_MAP` 手动指定，例如
  `{"_8497_1":"<学科id>","_8501_1":"<学科id>"}`，学科 id 可从「设置 → 导入」导出的数据里对照；
- 「设置 → 学科管理」展开学科后填的 **BB 课程链接**只用于学科页那个「Blackboard」跳转按钮，
  和采集器抓哪些课是两回事，别混在一起。

### 8.3 跑一次，看结果

```bash
npm run collect:dry           # 先空跑：只打印准备写入什么，不写云端
npm run collect               # 正式采集：POST /api/ingest/* 并写 sync_runs
```

跑完回到网页「设置 → 数据概览 → BB 抓取状态」：

- 「最近抓取」显示北京时间和「x 分钟前」；
- 「运行状态」显示成功 / 失败，以及新增 / 更新 / 跳过条数；失败时错误信息直接列在下面。

网页上的「手动抓取」按钮**不会**真的去抓：它只在云端登记一次请求
（`settings['sync.requestedAt']`），等你在本机跑 `npm run collect`，采集器消费该请求、
写入 `sync_runs` 后再 ack 掉标记。这是架构限制，不是 bug——云端没有你的校园网会话。

### 8.4 开机自动抓取 + 每隔 N 小时自动抓取（Windows）

项目自带两个 PowerShell 脚本，**不需要管理员权限**（触发器是「当前用户登录时」）。
在 PowerShell 里进入项目根目录执行：

```powershell
cd D:\StarryStudy
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1                  # 默认每 1 小时
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1 -IntervalHours 2 # 改成每 2 小时
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1 -Status          # 查看状态/上次结果/下次运行
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1 -Uninstall       # 关闭自动抓取
```

它会注册一个任务 `StarryStudy-BB-Collect`：**登录时立即抓一次**，之后每 N 小时重复
（`-IntervalHours` 可改，范围 1~24）。`-ExecutionPolicy Bypass` 只作用于这一条命令，
不会改系统全局策略。

配套的稳定性设计（无人值守才会用到的保护）：

- **单实例锁**：`data/collector.lock` 用原子创建 + PID 存活检测。上一次没跑完、
  下一次触发时后者安静跳过，不会并发写云端；进程被强杀后孤儿锁会被自动接管。
- **日志轮转**：输出写到 `data\collector.log`，超过 512KB 只保留后半段，
  几年也不会撑满磁盘。用 `Get-Content data\collector.log -Encoding UTF8 -Tail 30` 查看。
- **失败可见**：登录失败、课程列表为空、某数据源失败都会上报到 `sync_runs`（`ok=0`），
  「数据概览」能直接看到错误；只有两个源都成功才清掉「手动抓取」标记。
- **无变化不写**：BB 数据没变时不发 UPDATE、不 bump `rev`，避免每小时把用户手改的
  备注覆盖回去、导致网页编辑撞 409，也省下 D1 写额度（日志里表现为「跳过 N」）。
- **错过补跑 / 30 分钟时限**：关机期间错过的会在下次可用时补跑一次；单次卡死超过
  30 分钟会被终止，不会拖到下一个周期。

macOS / Linux 用 cron 等价配置即可，例如每小时一次：

```cron
0 * * * * cd /path/to/StarryStudy && node --import ./scripts/load-env.mjs --import tsx packages/collector/src/index.ts >> data/collector.log 2>&1
```

> 判断有没有生效：看「数据概览」有没有抓取记录，或 `-Status` 里的「上次结果」是否为 0。
> 一条都没有＝没跑起来，先回 8.1 检查 `.env` 是否填齐、`COLLECTOR_TOKEN` 是否与云端一致，
> 再看 `data\collector.log`。

可选 `npm run desktop -- --url https://study.example.com` 用系统浏览器开一个全屏独立窗口
（独立 `--user-data-dir`，见 `packages/desktop`）。

## 9. CF-01 ~ CF-11 坑与对应处理

| # | 坑 | 处理 |
|---|---|---|
| CF-01 | 免费版每次调用 CPU 上限 10ms（wall time 不限，等 I/O 不算） | 密码哈希是最重的计算，PBKDF2 十万次迭代约几十毫秒会直接 1102。本项目默认 1 万次（`PBKDF2_ITERATIONS` 可调），先用 `wrangler tail` 量，超了再降或改用 Cloudflare Access |
| CF-02 | D1 没有长事务，跨语句不保证原子 | 一次请求内的多条写用 `db.batch([...])`，它在一个事务里执行 |
| CF-03 | 免费版每天 10 万次请求、D1 10 万行写 | 笔记自动保存必须防抖 800ms，且只写变化的那一条；不要让前端定时全量 PUT |
| CF-04 | 请求体上限（免费 100MB） | >50MB 走 B2 预签名直传（`POST /api/files/:id/presign`），由 Worker 用 SigV4 生成直链，不要经过 Worker |
| CF-05 | 静态资源与 API 同域时，SPA fallback 会吃掉 `/api/*` | Worker 里**先**处理 `/api/*`，最后才回退 `index.html`；`not_found_handling = "single-page-application"` 只在静态资源绑定上生效，别指望它兜 API |
| CF-06 | 时区。`new Date()` 在 Worker 里是 UTC，D1 的 `datetime('now')` 也是 UTC | 所有「今天 / 本周 / 逾期」判断显式转 Asia/Shanghai，统一走 `shared/time.ts` 的 `todayInTZ()`，业务代码禁止直接 `new Date()` |
| CF-07 | B2 的 Range 要自己实现 | 通过 B2 的 S3 兼容 API 发起带 Range 的 GET，手动返回 `206` + `Content-Range` + `Accept-Ranges: bytes`；不做的话安卓 Edge 的 PDF 阅读器翻不了页 |
| CF-08 | ETag | 用 B2 返回的 ETag（带引号，直接用）与 `If-None-Match` 比对，命中返回 `304` 且无 body |
| CF-09 | `wrangler dev` 的本地 D1 与线上行为有差异 | 每次迁移后至少跑一次 `--remote`（见第 6 步） |
| CF-10 | 自定义域名的路由写错会 404 且无提示 | `routes = [{ pattern = "study.example.com/*", zone_name = "example.com" }]`，zone 必须已 Active |
| CF-11 | 不要把**真实** `account_id` / `database_id` / 桶名写进公开的 `wrangler.toml` | 公开文件只留全零占位 ID；真实值放 `wrangler.local.toml`（已 gitignore）或 CI Secret，并在部署时覆盖占位值（见第 4 步） |

## 10. 免费额度

| 资源 | 免费额度 |
|---|---|
| Workers 请求 | 每天 10 万次 |
| Workers CPU | 每次调用 10ms（wall time 不限） |
| Workers 请求体 | 100MB（>50MB 文件走预签名直传绕开） |
| D1 | 5GB 存储、每天 10 万行写 |
| B2 | 10GB 存储，下载有每日免费额度、超出按流量计费 |

个人单用户用量远在这些额度内。笔记防抖、按条写、内容寻址去重、304 缓存都是为了别把
请求数浪费在全量提交上。Cloudflare 边缘比原云主机慢一个量级，但对 1–2MB 的 PDF 与文本
同步足够，不值得为这 100ms 做缓存优化。

## 11. 回滚方式

迁移期间旧站全程可用，直到域名切换那一步。切换后**旧站与旧数据保留一周**不要动：域名
解析切回旧站入口即可恢复。数据搬运用 `node scripts/migrate-v1.mjs --data <v1 数据目录>`
生成一次性 SQL 与待上传文件清单（脚本只读 v1、不连线上库、不打印真实姓名 / 课程名，产物
在被 gitignore 的 `data/` 下）；逐集合比对条数、文件比 sha256、随机抽 5 条人工核对后再切换。

## 12. 如何验证（验收清单 12 条）

前 6 条是核心，任何一条不过都不算完成。括号标注是否需要真实设备 / 真实账号。

| # | 验收项 | 是否要真机 |
|---|---|---|
| 1 | 电脑关机状态下，手机 4G 打开 `https://study.example.com` 能登录、看课表、新建笔记 | 真机：手机 + 4G |
| 2 | 手机上传一张 1MB 的图 → 电脑刷新能看到；电脑改文件名 → 手机看到新名字 | 真机：手机 + 电脑 |
| 3 | 手机 Edge 点开 PDF，页内直接渲染（不是下载），能翻页 | 真机：手机 |
| 4 | 课表改一格 → DevTools 里只有一个 PUT、body 只有一个 slot | 真机：电脑（浏览器 DevTools） |
| 5 | 采集器跑一次 → 今日到期作业出现，且 done 状态与 BB 一致 | 真机：电脑 + 学校账号 |
| 6 | 手动把一条今日作业标记完成 → 采集器再跑 → done 仍是我标的（不被覆盖） | 真机：电脑 + 学校账号 |
| 7 | 手动删除一条 BB 作业 → 采集器再跑 → 不会被复活 | 真机：电脑 + 学校账号 |
| 8 | 两个标签页分别打开同一条笔记，先后保存 → 第二次得到 409 提示，不是静默覆盖 | 真机：电脑（两个标签页） |
| 9 | 铃铛：第一次打开全部算新；点开一次后红点灭；再点开仍能看到列表 | 真机：浏览器 |
| 10 | 仓库自检两条规则全绿 | 不需要：`npm run check:privacy` / pre-commit / CI 本机即可 |
| 11 | 新机器 clone → 填 `.env` → `npm i` → `npm run db:migrate` → 能跑起来（假数据） | 不需要真机，但要一台干净环境 / 新目录 |
| 12 | 断电式测试：电脑直接休眠，10 分钟后手机写入，数据正常 | 真机：手机 + 电脑 |

第 10 条由 CI（`npm ci` → `typecheck` → `check:privacy` → `build`）与 pre-commit 保证，
不需要真机；其余涉及多端、浏览器、学校账号的都必须在真实环境里过一遍。
