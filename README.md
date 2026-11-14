# StarryStudy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20%2B-339933.svg)](https://nodejs.org/)
[![CI](https://github.com/tttiorg/StarryStudy/actions/workflows/ci.yml/badge.svg)](https://github.com/tttiorg/StarryStudy/actions/workflows/ci.yml)

一个**单用户、多端同步**的学习工作台：课表、作业、成绩、资料、笔记和知识点复习集中在
一个网页里。电脑关机之后，手机和平板照样能打开读写。

云端是唯一数据源——结构化数据放在 Cloudflare D1，文件放在 Backblaze B2，Worker 同时托管
网页和 REST API。本机只跑一个 Blackboard 采集器，不保存任何业务数据副本。

## 它能做什么

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

## 工作方式

- **单用户**：一个账号，没有注册、没有权限体系。
- **多端同一份数据**：电脑、手机、平板走同一个网址、同一套 API；刷新或重新拉取即可拿到最新数据。
- **桌面启动器**：可选的独立全屏窗口（`--app` 模式），不监听端口、不驻留后台。
- **Blackboard 采集**：本机脚本抓成绩与日历写入云端；手动勾选完成、手动删除的条目不会被采集覆盖。
- **不做的事**：移动端原生 App（用浏览器 PWA）、实时协同、离线优先、邮件通知。

`*.workers.dev` 子域在中国大陆被 DNS 污染，**请绑定自定义域名**访问。

## 快速开始（本地预览）

前置：Node 20+（CI 用 22）、npm。

```bash
git clone https://github.com/tttiorg/StarryStudy.git starry-study
cd starry-study
npm i
cp .dev.vars.example .dev.vars     # Windows 用 copy；按注释填 5 个 B2_* 与会话密钥
npm run db:migrate                  # 本地 D1 建表 + 虚构示例数据
npm run build
npm run dev                         # 本地起在 http://localhost:8787
```

浏览器打开 `http://localhost:8787`，首次会要求设置密码。

`npm run dev` 用的是本地模拟的 D1，不连线上库；对象存储走 B2 的 S3 兼容 API，本地也要在
`.dev.vars` 里配齐 5 个 `B2_*`。`wrangler.toml` 里的 `database_id` 是**全零占位值**，只为让
本地迁移 / 开发开箱即用，不是任何真实基础设施信息。

`migrations/0002_example_seed.sql` 是**完全虚构的演示数据**，让你 clone 下来就能看到界面；
**部署正式环境前请删掉这个文件再执行迁移**（若已执行过，按 `demo_` 前缀删除即可）。

## 部署自己的一份

1. 准备 Cloudflare 账号、一个自有域名、一个 Backblaze B2 桶（S3 兼容 API）。
2. 复制 `wrangler.local.toml.example` 为 `wrangler.local.toml`，填真实 D1 `database_id` 与域名路由。
3. 用 `wrangler secret put` 注入 `AUTH_SECRET`、`AUTH_COLLECTOR_TOKEN`、`NOTICE_WEBHOOK_URL`
   以及 5 个 `B2_*` 凭据；这些值不写进仓库。
4. `npm run db:migrate:remote` → `npm run deploy`，然后在 Cloudflare 绑定自定义域名。
5. 本机填好 `.env` 跑 `npm run collect`，让 Blackboard 数据进来。

完整步骤与验收清单见 [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md)；
架构与数据模型见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)、
[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + Vue Router + Pinia + Element Plus + TypeScript，PWA |
| 服务端 | Cloudflare Workers（静态资源 + REST API） |
| 数据 | Cloudflare D1（SQLite）+ Backblaze B2（S3 兼容对象存储） |
| 共用 | `packages/shared`：类型、zod schema、时区、配置读取 |
| 本机 | 采集器（Node）、可选桌面启动器（Node） |

写请求带 `rev` 乐观锁，冲突返回 409；课表按「格」提交；删除是软删，不会被采集器复活；
时间统一按 `Asia/Shanghai` 显式处理。

## 目录结构

```
starry-study/
├─ packages/
│  ├─ web/          Vue 3 前端
│  ├─ worker/       Worker：静态资源 + REST API
│  ├─ collector/    本机采集器
│  ├─ shared/       类型 / schema / 时区 / 配置
│  └─ desktop/      桌面启动器（独立全屏窗口）
├─ migrations/      D1 SQL 迁移
├─ scripts/         隐私自检、数据迁移等一次性脚本
├─ installer/       Windows 桌面启动器安装包源码
├─ docs/            架构、数据模型、自托管指南
├─ .github/workflows/ci.yml
├─ .env.example / .dev.vars.example / wrangler.local.toml.example
└─ wrangler.toml
```

## 常用命令

全部定义在根 `package.json`，在仓库根目录运行。

| 命令 | 作用 |
|---|---|
| `npm i` / `npm ci` | 安装（含 workspaces）；CI 用 `npm ci` |
| `npm run dev` | `npm run build` + `wrangler dev`（本地） |
| `npm run build` | 构建前端 |
| `npm run deploy` | 构建 + `wrangler deploy --config wrangler.local.toml` |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` |
| `npm test` | 单元测试 |
| `npm run check:privacy` | 检查仓库里是否混入真实地址或硬编码凭据 |
| `npm run smoke` | 接口冒烟；需先 `npm run db:migrate`，并在另一个终端 `npm run dev` |
| `npm run db:migrate` | 本地 D1 迁移（占位 ID 够用，不连线上） |
| `npm run db:migrate:remote` | 线上 D1 迁移 |
| `npm run collect` | 跑本机采集器 |
| `npm run collect:dry` | 采集器 `--dry-run`，只看要写什么、不落库 |
| `npm run desktop` | 起浏览器全屏窗口（需传 `--url`） |

## 桌面启动器

```bash
npm run desktop -- --url https://你的域名
```

它会用系统 Edge / Chrome 以独立配置目录拉起一个 `--app` 全屏窗口：不占用你正在用的浏览器
会话，登录状态会一直记住。不想装 Node 的话，也可以从
[Releases](https://github.com/tttiorg/StarryStudy/releases) 下载 Windows 安装包：双击安装、
填入你自己的访问网址即可，目标机器不需要 Node。

## 常见问题

- **配置文件会进仓库吗？** 不会。`.env`、`.dev.vars`、`wrangler.local.toml` 都被 `.gitignore`
  排除，示例文件只有空键名；`npm run check:privacy` 和 CI 会再扫一遍。
- **能多人共用吗？** 不能，这是单用户自托管应用。
- **换设备要重装吗？** 不用，浏览器打开同一个网址即可。

## 开源许可

[MIT](LICENSE)。参与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)；
安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 issue。
