# 自托管部署

这份文档给「想部署自己一份」的人。全程用自己的域名、自己的 Cloudflare 账号、自己的 D1
与 R2，凭据只放本地 / Worker Secret，不进仓库。`*.workers.dev` 子域在中国大陆被 DNS 污染，
**必须绑定自定义域名**，下面所有步骤都以此为前提。

> 文中所有地址都是虚构示例：`study.example.com`（应用）、`example.com`（主域）。换成你
> 自己买的域名即可，不要把真实域名、IP、桶名、`database_id` 写进任何会被提交的文件。

## 0. 前置

- Node 20+（CI 用 22）、npm。
- 一个自购域名。
- 一个 Cloudflare 账号。

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
- 在终端配置 `CLOUDFLARE_API_TOKEN` 环境变量（ scopes 至少含 D1 / R2 / Workers 编辑与
  `Account:Read`）。这个令牌以及后面要用到的**真实** `database_id`、桶名、`account_id` 都
  属于私有部署参数，绝不写进公开的 `wrangler.toml`（那里只有一个占位值）或提交给 CI
  （CF-11）。

## 3. 创建 D1 数据库与 R2 桶

```bash
npx wrangler d1 create starry-study        # 记下输出里的 database_id
npx wrangler r2 bucket create <你的桶名>   # 记下桶名
```

> 若要启用 >50MB 文件的 R2 预签名直链，还要在 Cloudflare 创建一个 R2 API Token，记下
> `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`。不用大
> 文件直链的话这一组可以全部留空。

## 4. 生成 `wrangler.local.toml`

公开的 `wrangler.toml` 里 `[[d1_databases]]` 带了一个**全零占位 UUID**
（`00000000-0000-0000-0000-000000000000`），`[[r2_buckets]]` 用了本地模拟桶名
`starry-study-local`。它不含任何真实基础设施信息（CF-11），存在的原因是被 Wrangler 逼出来
的：连 `--local` 都强制要求 `database_id` 字段存在，完全缺省时
`wrangler d1 migrations apply --local` 会直接报「bindings must have a database_id field」，
新人 clone 下来连迁移都跑不了。占位值让 `npm run dev` / `npm run db:migrate` 把本地 D1 落到
`.wrangler/state`，开箱即用。

**但线上部署绝不能用这个占位值。** 部署用的配置是 `wrangler.local.toml`（已被 `.gitignore`
排除）：把 `wrangler.toml` 的内容完整复制成 `wrangler.local.toml`（仓库里也有
`wrangler.local.toml.example` 作格式参照），再**覆盖**下面三项为第 3 步创建出来的真实值。
不覆盖的话，`npm run deploy` 与 `npm run db:migrate:remote` 会带着占位值连到错误的库 / 桶
（或加载失败），数据写不到你自己的 D1 / R2：

```toml
[[d1_databases]]
binding = "DB"
database_name = "starry-study"
database_id = "<第 3 步得到的 database_id>"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "<第 3 步的桶名>"

routes = [
  { pattern = "study.example.com/*", zone_name = "example.com" }
]
```

- `pattern` 是「主机名 + `/*`」，`zone_name` 是主域名（不含子域、不含 `/*`）。写错会 404
  且无提示（CF-10），且该 zone 必须已 Active。
- 这里的 `database_id` / `bucket_name` **必须**覆盖掉 `wrangler.toml` 里的占位值；真实
  `account_id` / `database_id` / 桶名绝不写进公开的 `wrangler.toml`（CF-11）。
  `npm run deploy` 与 `npm run db:migrate:remote` 都带 `--config wrangler.local.toml`，
  会自动读这份本地配置。

## 5. 设置 Worker Secret

```bash
npx wrangler secret put AUTH_SECRET              # 会话签名密钥，粘贴一段随机长字符串
npx wrangler secret put AUTH_COLLECTOR_TOKEN     # 采集器令牌，与本机 .env 的 COLLECTOR_TOKEN 一致

# 可选：通知与 R2 预签名直链，不用的话可以不设
npx wrangler secret put NOTICE_WEBHOOK_URL       # 企业微信群机器人 webhook，不做邮件
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET_NAME
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

## 8. 本机配采集器

采集器只跑在你的电脑上，不进云端、不进仓库：

```bash
cp .env.example .env          # Windows 用 copy
# 按注释填：学校 CAS / Blackboard 地址、账号、API_BASE_URL=https://study.example.com、
# COLLECTOR_TOKEN（与第 5 步 AUTH_COLLECTOR_TOKEN 一致）；学校地址用 cas.example.com /
# bb.example.com 这类占位，默认值全空，没配齐采集器不启动。
npm run collect:dry           # 先空跑，只看要写什么
npm run collect               # 正式采集，POST /api/ingest/*
```

可选 `npm run desktop -- --url https://study.example.com` 用系统浏览器开一个全屏独立窗口
（独立 `--user-data-dir`，见 `packages/desktop`）。

## 9. CF-01 ~ CF-11 坑与对应处理

| # | 坑 | 处理 |
|---|---|---|
| CF-01 | 免费版每次调用 CPU 上限 10ms（wall time 不限，等 I/O 不算） | 密码哈希是最重的计算，PBKDF2 十万次迭代约几十毫秒会直接 1102。本项目默认 1 万次（`PBKDF2_ITERATIONS` 可调），先用 `wrangler tail` 量，超了再降或改用 Cloudflare Access |
| CF-02 | D1 没有长事务，跨语句不保证原子 | 一次请求内的多条写用 `db.batch([...])`，它在一个事务里执行 |
| CF-03 | 免费版每天 10 万次请求、D1 10 万行写 | 笔记自动保存必须防抖 800ms，且只写变化的那一条；不要让前端定时全量 PUT |
| CF-04 | 请求体上限（免费 100MB） | >50MB 走 R2 预签名直传（`POST /api/files/:id/presign`），不要经过 Worker |
| CF-05 | 静态资源与 API 同域时，SPA fallback 会吃掉 `/api/*` | Worker 里**先**处理 `/api/*`，最后才回退 `index.html`；`not_found_handling = "single-page-application"` 只在静态资源绑定上生效，别指望它兜 API |
| CF-06 | 时区。`new Date()` 在 Worker 里是 UTC，D1 的 `datetime('now')` 也是 UTC | 所有「今天 / 本周 / 逾期」判断显式转 Asia/Shanghai，统一走 `shared/time.ts` 的 `todayInTZ()`，业务代码禁止直接 `new Date()` |
| CF-07 | R2 的 Range 要自己实现 | `env.BUCKET.get(key, { range })` 后手动返回 `206` + `Content-Range` + `Accept-Ranges: bytes`；不做的话安卓 Edge 的 PDF 阅读器翻不了页 |
| CF-08 | ETag | 用 `object.httpEtag`（带引号，直接用）与 `If-None-Match` 比对，命中返回 `304` 且无 body |
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
| R2 | 10GB 存储、出站流量不计费 |

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
