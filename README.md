# StarryStudy

一个**单用户、多端**的学习工作台。数据只放在 Cloudflare 边缘（Workers + D1 + R2），
通过自购域名访问；电脑关机时手机、平板照样能读写。本机只保留一个采集器和一个可选的
桌面启动器，不存任何业务数据副本。

> 这套东西替代的是「教务系统 + Blackboard + 一堆表格便签 + 网盘」：Blackboard 上的作业与
> 成绩自动进来，主页告诉你今天要交什么，学科页汇总一门课的成绩、资料、笔记，资料里的
> PDF 在手机上也点得开。

## 定位与边界

- **单用户**。永远只有一个账号，没有注册、没有权限体系，也没有为「以后支持多人」预留的设计。
- **多端同一份数据**。电脑（Windows，主力）、手机（安卓 Edge）、平板走同一个网址、同一套
  API；云端是唯一数据源（single source of truth），本地不再存业务数据。
- **Cloudflare 边缘 + 自有域名**。D1 存结构化数据，R2 存文件对象，Worker 同时托管静态资源
  与 REST API。
- **不做的事**：移动端原生 App（用浏览器 PWA）、实时协同推送、离线优先、邮件通知。刷新或
  手动重新拉取即可拿到最新数据。

`*.workers.dev` 子域在中国大陆被 DNS 污染，**必须绑定自定义域名**才能稳定访问，项目里的
默认配置、文档、示例一律不假设它可用。

## 功能清单

| 模块 | 内容 |
|---|---|
| 主页总览 | 今日日程、临期任务、最近成绩、学科卡片 |
| 课表 | 周视图；按「天 + 节」单格编辑，不会整份覆盖别的设备刚改的格子 |
| 学科页 | 三列：成绩、资料、笔记；课程信息与师资为结构化字段 |
| 资料库 | 上传、按学科分类、标签、置顶、PDF 预览；内容寻址去重 |
| 日程 / 任务 | 带学科的在学科页当「任务」，不带的在主页当「日程」 |
| 成绩 | 分数 / 满分 / 权重 / 类型 / 日期，按学科汇总求和 |
| 笔记 | 标题 + 正文（最长 200KB），自动保存带 800ms 防抖 |
| 知识点 | 艾宾浩斯复习排期，间隔 1/2/4/7/15/30/60 天 |
| 外链竖栏 | 可拖拽排序，抓 favicon |
| 通知铃铛 | 新任务 / 新成绩 / 临近截止三组，带「水位」判定 |
| Blackboard 采集 | 本机脚本登录后抓成绩、抓日历，写入云端 |
| 设置 | 改密码、数据概览 |

`link` 型（指向本机磁盘）的资料在 v2 标记为 `local_only`：只在电脑端显示为「仅电脑可用」，
永远不上传，手机端点不开。这是明确的语义，不是待办。

## 快速开始

前置：Node 20+（CI 用 22）、一个能用的 npm。

```bash
git clone <你的仓库地址> starry-study
cd starry-study
npm i
cp .env.example .env          # Windows 用 copy；按注释填本机采集器需要的值
npm run db:migrate            # 在本地 D1 建表（0001_init.sql + 0002_example_seed.sql）
npm run build                 # 构建前端到 packages/web/dist
npm run dev                   # 构建 + wrangler dev，本地起在 http://localhost:8787
```

`npm run dev` 用的是本地模拟的 D1 与 R2，不连线上库。浏览器打开
`http://localhost:8787` 即可看到界面（首次会要求设置密码）。

`wrangler.toml` 里的 `database_id` 是全零占位 UUID、`bucket_name` 是本地模拟桶名：Wrangler
连 `--local` 都强制要求 `database_id` 存在，缺了会拒绝加载配置，占位值只为让本地迁移 / 开发
开箱即用，**不是任何真实基础设施信息**。线上部署必须在 `wrangler.local.toml`（已 gitignore）
里覆盖成真实 ID 与桶名，详见 `docs/ARCHITECTURE.md` §3.1 与 `docs/SELF-HOSTING.md` §4。

注意两份本机配置各管各的：`.env` 给采集器读（本机 Node 进程），`.dev.vars` 给本地
`wrangler dev` 的 Worker 读（复制 `.dev.vars.example` 填写，键名与线上 Secret 一致）；
两者都不进仓库。完整部署侧流程见 `docs/SELF-HOSTING.md`。

**本地起浏览器独立全屏窗口**（可选）：`npm run desktop -- --url https://study.example.com`。
它会用系统浏览器以独立配置目录拉起一个 `--app` 全屏窗口，详见 `packages/desktop`。

### 关于示例数据

`migrations/0002_example_seed.sql` 是**完全虚构的演示数据**（示例学科、示例成绩、示例日程、
示例外链），目的是让别人 clone 下来就能看到界面，里面没有任何真实课程、成绩、姓名或
学校链接。**生产部署前请删掉这个文件再执行迁移**；若已经执行过，按 `demo_` 前缀的 id
删除即可，不会碰到真实数据。

截图一律用这套示例种子生成，不得使用真实课表、真实成绩或真实姓名。仓库里 `shots/` 与
`data/` 都已被 `.gitignore` 排除。

## 目录结构

```
starry-study/
├─ packages/
│  ├─ web/          Vue 3 前端（唯一的 UI，构建产物到 dist/）
│  ├─ worker/       Cloudflare Worker：静态资源 + REST API
│  ├─ collector/    本机采集器（Node，跑在用户电脑上）
│  ├─ shared/       类型 / zod schema / 常量 / 时区与配置（前后端共用）
│  └─ desktop/      桌面启动器（Node，只负责用浏览器开一个全屏窗口）
├─ migrations/      D1 SQL 迁移（0001_init.sql、0002_example_seed.sql）
├─ scripts/         隐私自检、v1 数据迁移等一次性脚本
├─ docs/
│  ├─ ARCHITECTURE.md     架构与请求生命周期
│  ├─ DATA-MODEL.md       逐表字段与不能丢的业务语义
│  └─ SELF-HOSTING.md     别人怎么部署自己的一份
├─ .github/workflows/ci.yml
├─ .githooks/pre-commit
├─ .env.example            只有键名和注释，不含任何值
├─ .dev.vars.example       本地 wrangler dev 用的 secret 占位
├─ wrangler.toml           仅本地全零占位 ID，真实 ID 走 wrangler.local.toml
├─ wrangler.local.toml.example
└─ tsconfig.json
```

## 常用命令

全部定义在根 `package.json`，在仓库根目录运行。

| 命令 | 作用 |
|---|---|
| `npm i` / `npm ci` | 安装（含 workspaces）；CI 用 `npm ci` |
| `npm run dev` | `npm run build` + `wrangler dev`（本地） |
| `npm run build` | 构建前端 `-w @starry/web` |
| `npm run deploy` | 构建 + `wrangler deploy --config wrangler.local.toml` |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` |
| `npm run check:privacy` | 隐私自检（真实地址 / 疑似硬编码凭据两条规则） |
| `npm run check` | `typecheck` + `check:privacy` |
| `npm test` | 单测（当前聚合 `packages/collector` 的 node:test 用例），CI 在 typecheck 后跑 |
| `npm run smoke` | 接口冒烟 `scripts/smoke-test.mjs`；需先 `npm run db:migrate`，并在另一个终端 `npm run dev` 起本地服务 |
| `npm run db:migrate` | `wrangler d1 migrations apply starry-study --local`，作用于本地 D1（占位 ID 够用，不连线上） |
| `npm run db:migrate:remote` | `wrangler d1 migrations apply ... --remote --config wrangler.local.toml`，作用于真实 D1 |
| `npm run collect` | 跑本机采集器 |
| `npm run collect:dry` | 采集器 `--dry-run`，只看要写什么、不落库 |
| `npm run desktop` | 起浏览器全屏窗口（需传 `--url`） |

部署侧还有 `wrangler secret put <NAME>`、`wrangler r2 object put` 等 Wrangler 原生命令，
完整流程见 `docs/SELF-HOSTING.md`。

## 隐私边界

这个仓库从第一个提交起就是公私分离的：**仓库里不能出现任何真实姓名、学号、成绩、
课程名 / 课程代码、教师信息、学校域名、服务器 IP、SSH / 隧道地址、真实本机路径**。
按泄露后果排序，以下几类绝对不进仓库：

| 类别 | 内容 |
|---|---|
| 凭据 | 学校账号口令、采集器令牌、Cloudflare API Token、真实 D1 `database_id`、R2 桶名、`AUTH_SECRET`（`wrangler.toml` 里的全零占位 ID 不属此类） |
| 身份 | 真实姓名、学号、班级 |
| 学业 | 真实成绩、真实课程名与代码、作业标题、教师姓名 / 邮箱 / 电话 |
| 基础设施 | 服务器 IP、密钥路径、隧道域名、自定义域名本身 |
| 本机路径 | 数据目录、用户目录等绝对地址 |
| 运行时数据 | `db/*.json`、上传文件、备份、日志、截图、构建产物 |

设计上靠三条硬规则保证「不会再犯」：

1. **代码里不出现学校专有信息**。采集器用通用 Blackboard 适配器 + 可选学校专属适配器
   （默认不加载），地址从配置读；`.env.example` / `.dev.vars.example` 只有键名，默认值全空，
   没配置时采集器直接不启动而不是拿一个真实地址去崩掉。
2. **默认数据是假的**（见上「示例数据」），代码里也不含真数据。
3. **所有可变的环境相关值只有一个出口**：`packages/shared/src/config.ts` 是唯一读取环境的
   地方，业务代码里出现 `process.env` 视为 bug；桌面启动器是独立进程，只在自己的
   `packages/desktop/src/env.ts` 里读 `APP_URL`。

`.gitignore` 已排除 `node_modules/ dist/ .wrangler/ .dev.vars .env .env.* wrangler.local.toml
data/ *.sqlite backups/ shots/ *.log .workbuddy/` 等。提交前跑 `npm run check:privacy`；
启用钩子：`git config core.hooksPath .githooks`，之后每次 commit 会自动执行它，CI 也会再
跑一遍。

## 验收清单对应说明

`docs/SELF-HOSTING.md` 末尾列出完整 12 条验收项。这里说明它们各自验证什么、依赖什么环境：

| # | 验证点 | 对应实现 / 命令 | 是否要真机 |
|---|---|---|---|
| 1 | 关机后手机 4G 能登录、看课表、写笔记 | Worker + D1 同源 API、`/api/bootstrap` | 手机 + 4G |
| 2 | 手机上传图、电脑改名互见 | R2 `blob/<sha前2位>/<sha>` + 文件元数据软更新 | 手机 + 电脑 |
| 3 | 手机 Edge 内嵌渲染 PDF、能翻页 | `GET /api/files/:id/raw` 的 Range / 206 / ETag | 手机 |
| 4 | 课表改一格只提交一格 | `PUT /api/timetable/slot`，DevTools 看只有一个 PUT | 电脑 |
| 5 | 采集器跑一次，今日作业出现且 done 与 BB 一致 | `npm run collect`、`/api/ingest/*` | 电脑 + 学校账号 |
| 6 | 手动勾完成后采集不被覆盖 | `done` 三条规则、`done_manual` | 电脑 + 学校账号 |
| 7 | 手动删除的 BB 作业不被复活 | ingest 命中 `deleted_at` 时跳过 | 电脑 + 学校账号 |
| 8 | 两标签页先后保存同一笔记得到 409 | `rev` + `UPDATE ... WHERE rev = ?` | 电脑 |
| 9 | 铃铛首次全算新、点开灭红点、再看仍有列表 | 水位判定 + 「最近一份清单」 | 浏览器 |
| 10 | 仓库自检两条规则全绿 | `npm run check:privacy` / pre-commit / CI | 不需要 |
| 11 | 新机器 clone → 填 `.env` → `npm i` → 迁移 → 跑起来（假数据） | 本文档「快速开始」 | 干净机器 |
| 12 | 断电式测试：电脑休眠 10 分钟后手机写入正常 | 云端唯一数据源 | 手机 + 电脑 |

前 6 条是核心，任何一条不过都不算完成。第 10 条由 CI 与 pre-commit 保证，不需要真机；
第 1、2、3、5、6、7、12 条必须在真实设备 / 真实账号上验证。

## 部署与迁移

- 别人部署自己一份：见 `docs/SELF-HOSTING.md`（买域名、建 D1/R2、填
  `wrangler.local.toml`、设 secret、迁移、部署、本机配采集器）。
- 从 v1 搬数据：用 `node scripts/migrate-v1.mjs --data <v1 数据目录>` 生成一次性 SQL 与
  待上传文件清单，脚本只读 v1、不连线上库、不打印任何真实姓名 / 课程名（只打印条数），
  产物落在被 gitignore 的 `data/` 下。详见脚本头部注释与 `docs/DATA-MODEL.md`。
- 回滚：迁移期间旧站全程可用，切换后旧站与旧数据保留一周，域名切回去即可恢复。

## v1 旧仓库的关系

v1 是本机 Express + JSON 文件 + 可选云同步的形态，是**本地回滚线**：保留、不修改、不删除。
但它的 git 历史里曾有脚本写死过真实服务器地址，所以**不要给 v1 仓库配置 remote 后 push**，
也不要把它整个历史并进 v2。v2 必须是**全新仓库、全新历史、第一个提交就干净**。
v1 的解析逻辑（尤其是 Blackboard 采集）只作为只读参考，不要复制文件、读逻辑即可。

## 开源许可

建议采用 **MIT** 许可。仓库当前**尚未包含 `LICENSE` 文件**，采用时请自行添加许可证全文，
不要假设它已经存在。

## 风格约定

- 全项目不用 emoji，图标一律 CSS 色块或内联 SVG。
- 中文注释写「为什么」不写「做了什么」，事故复盘类注释要保留。
- id 前缀沿用 v1：`s_` 学科 / `d_` 日程 / `g_` 成绩 / `n_` 笔记 / `f_` 文件 / `l_` 外链 /
  `k_` 知识点，保持短 id，不用 UUID。
- 前端 API 调用统一从 `api/index.ts` 出，组件里不出现 `fetch`；类型放 `packages/shared`，
  入参用 zod 校验。
