# 下载者操作手册（Windows 安装包）

面向**从 GitHub Releases 下载 `StarryStudy-Setup-<版本>.exe` 的人**。按这份文档从头做完，
你才能在自己的网址上看到内容。想直接看部署命令请跳到 [完整部署指南](../docs/SELF-HOSTING.md)。

> **先说清楚这个 exe 是什么**
> 它是「桌面启动器」，**不是服务端、不带数据库、不含任何学习数据**。
> 双击安装只是让 Edge / Chrome 用一个独立窗口打开**你自己的访问网址**。
> 网址背后那套服务必须先部署好，否则窗口打开就是空白或报错。
>
> 目标机器**不需要安装 Node**（启动器是 Node SEA 单文件）。

---

## 第 0 步：判断你要做哪一类事

| 你的情况 | 要做什么 |
|---|---|
| 别人已经部署好，只给了你一个网址 | 直接跳到 [第 3 步：安装](#第-3-步安装启动器)，填那个网址即可 |
| 自己从零搭一套 | 从第 1 步顺序做完，约需准备一个域名和两个免费账号 |
| 只想先看看界面 | 用本地预览：见仓库 README「快速开始（本地预览）」，不需要买任何东西 |

## 第 1 步：要买 / 准备什么（一次性，多数有免费额度）

| 东西 | 用来做什么 | 大概花费 |
|---|---|---|
| 一个自有域名 | 绑定 Worker 作为日常入口；`*.workers.dev` 在中国大陆被 DNS 污染，不能当入口 | 一年几十到一百多元 |
| Cloudflare 账号 | Workers 跑网页和 API、D1 存课表 / 成绩 / 日程、自定义域名接入 | 个人用量免费额度够 |
| Backblaze B2 账号 + 一个**私有**桶 | 存上传的 PDF / 图片等资料，走 S3 兼容 API | 10 GB 内通常免费 |
| 一对 B2 Application Key（`keyID` + `applicationKey`） | 让 Worker 能读写那个桶 | 免费，建桶时生成 |

不需要买服务器、不需要备案、不需要单独的数据库主机。

## 第 2 步：装什么、部署什么、配置什么

### 装什么

| 位置 | 装什么 | 说明 |
|---|---|---|
| 云端 | 什么都不用装 | `wrangler deploy` 把 Worker、D1 建表和网页一起推上去 |
| 部署用的电脑 | Node 20+（建议 22）、npm、git | 只在首次部署、构建安装包、跑采集器时需要 |
| 日常使用的电脑 | 本安装包（可选） | 也可以直接用浏览器打开网址，不装任何东西 |
| 手机 / 平板 | 什么都不用装 | 浏览器打开同一个网址即可 |

> 采集器脚本本身兼容 Node 18 / 20 / 22（用 `--import` 预加载 `.env`，不依赖高版本才有的
> `--env-file` 选项）。部署用的 `wrangler` 仍建议 Node 20+。

### 部署命令（在仓库根目录执行）

```bash
npm ci
cp wrangler.local.toml.example wrangler.local.toml   # Windows 用 copy；填真实 D1 ID 与域名
npm run db:migrate:remote                            # 线上 D1 建表
npm run deploy                                       # 构建 + 部署 Worker，绑定自定义域名
```

> 仓库里的 `migrations/0002_example_seed.sql` 是虚构演示数据，**不要在生产执行**。
> 执行远程迁移前把它临时移出 `migrations/`，跑完再移回（详见部署指南第 6 步）。

### 配置什么

| 位置 | 配置项 | 从哪来 |
|---|---|---|
| 云端 Worker | 8 个 secret：`AUTH_SECRET`、`AUTH_COLLECTOR_TOKEN`、`NOTICE_WEBHOOK_URL` + 5 个 `B2_*` | `wrangler secret put`；逐项说明见 [部署指南第 5 步](../docs/SELF-HOSTING.md) |
| 云端路由 | `wrangler.local.toml` 里真实 D1 `database_id` 与自定义域名 `routes` | 从示例复制后填，**该文件被 gitignore，不进仓库** |
| 首次访问 | 登录密码 | 浏览器第一次打开网址时自己设置，助手/别人都不代设 |
| 安装这个 exe 时 | 访问网址 | 上面都做完、域名能打开之后的那个 `https://` 地址 |

以上凭据只留在本机，绝不写进仓库或任何公开页面。仓库自带的 `npm run check:privacy`
和 CI 会再扫一遍，防止真实域名 / 令牌混入。

## 第 3 步：安装启动器

双击 exe，在弹出的输入框里填入**已经部署好的** StarryStudy 网址，完成后从桌面快捷方式打开。
首次需要登录一次，之后浏览器会记住会话。

静默安装：

```text
StarryStudy-Setup.exe --url https://你的域名
```

其它参数：

| 参数 | 作用 |
|---|---|
| `--launch` | 打开已安装的窗口（快捷方式用） |
| `--uninstall` | 卸载（移除快捷方式与卸载项） |
| `--version` / `--help` | 版本与帮助 |
| `--install-dir <目录>` / `--config-dir <目录>` | 自定义安装与配置位置 |
| `--no-shortcut` | 不创建快捷方式与卸载项 |

安装器会做这些事，仅此而已：

- 把启动器复制到 `%LOCALAPPDATA%\Programs\StarryStudy\`
- 在 `%APPDATA%\StarryStudy\config.json` 写入访问网址
- 创建桌面与开始菜单快捷方式，写入「添加或删除程序」的卸载项
- 用 Edge / Chrome 以独立配置目录打开 `--app` 全屏窗口；不驻留后台、不监听端口、不联网

## 第 4 步：日常使用

一个网址、一个账号，电脑 / 手机 / 平板打开同一个地址就是同一份数据。页面里可以：

- **主页**：今日课表、近期日程（含课程任务）、待办与逾期统计、学科卡片、必应每日壁纸
- **课表**：周视图，按「天 + 节」单格编辑；「编辑信息」里可自定义每天节数与时间、可清空课表（需勾选确认）
- **学科页**：成绩、资料、笔记、教师卡；只保留一个 Blackboard 外链按钮
- **资料**：左键在新窗口用浏览器自带 PDF 阅读器打开，右键下载；其它不能预览的文件会自动转为下载
- **设置 → 学科管理**：小三角展开编辑信息、改 BB 链接、快捷新建课表里出现但还没建的学科
- **设置 → 数据概览**：BB 抓取状态（最近时间 / 成功或失败 / 条数）与「手动抓取」按钮

> 网页跑在云端，**不能直接启动你电脑上的采集器**。「手动抓取」按钮只是登记一次请求，
> 等你在本机跑 `npm run collect`，采集器消费请求、写入结果后再清掉标记。这是架构限制，不是 bug。

## 第 5 步（可选）：让 Blackboard 数据自动进来

采集器只跑在你自己电脑上，读本机 `.env`。配置教学见
[部署指南第 8 节](../docs/SELF-HOSTING.md)，要点：

1. 复制 `.env.example` 为 `.env`，填 6 项必填。三个地址**只填「协议 + 域名」站点根**
   （别把浏览器地址栏里带 `?service=...` 的完整 URL 整条粘进来）。
   `COLLECTOR_TOKEN` 必须与云端 `AUTH_COLLECTOR_TOKEN` 完全一致。
2. 先 `npm run collect:dry` 看计划，再 `npm run collect` 正式写入。
   **运行前先 `cd` 到项目根目录**（有 `package.json` 那一层），否则会报 `ENOENT package.json`。
3. Windows 开机自动 + 每 N 小时自动抓取（无需管理员）：

```powershell
cd D:\StarryStudy
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1                   # 默认每 1 小时
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1 -IntervalHours 2  # 改成每 2 小时
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1 -Status           # 查状态
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-collector.ps1 -Uninstall        # 取消
```

自动抓取自带单实例锁（上一次没跑完则下一轮跳过）、日志轮转（`data\collector.log`，
超过 512KB 只留后半段）、失败上报（「数据概览」能看到 `ok=0` 及错误）、错过补跑与
30 分钟超时保护。macOS / Linux 用 cron 等价配置。

## 常见问题与排障

| 现象 | 原因 / 处理 |
|---|---|
| 安装后窗口空白或打不开 | 网址对应的服务端还没部署好；先按第 2 步部署，再用浏览器直接访问该网址确认 |
| 提示 `node: bad option: --env-file-if-exists` | 系统 Node 版本过旧且脚本是旧版；更新代码后 `collect` 已改用 `--import ./scripts/load-env.mjs`，Node 18/20/22 都能跑 |
| `npm run collect` 报 `ENOENT ... package.json` | 没在项目根目录执行；先 `cd D:\StarryStudy` |
| 数据概览一直显示「未生效」 | `.env` 没填齐、`COLLECTOR_TOKEN` 与云端不一致，或计划任务没在跑；看 `data\collector.log` |
| 采集日志中文乱码 | 用 `Get-Content data\collector.log -Encoding UTF8 -Tail 30` 读，别用默认代码页 |
| PDF 打开成一个「套娃」窗口并显示 404 | 旧版行为，现已修复：左键用 fetch + Blob 在新窗口打开，右键下载，不产生 `/api/...` 页面导航 |
| 部署后页面看起来没变 | 三端强刷一次（Ctrl+F5）拿最新 Service Worker / HTML；边缘缓存有几秒传播延迟 |
| 壁纸偶尔变回校园图 | 必应每日图拿不到时的正常回退，不影响其它功能 |
| 编辑任务时提示 409 冲突 | 该记录在别处改过，页面会带上服务端当前版本让你自己决定保留哪份 |

## 从源码构建这个安装包

前置：Windows + Node 22（与 CI 一致）。

```bash
npm ci
node installer/build.mjs
```

产物在 `dist-installer/StarryStudy-Setup-<版本>.exe`。构建会把
`installer/src/main.cjs` 注入当前 Node 的 `node.exe`，因此生成的 exe 与构建机 Node
版本一致；blob 等中间文件构建完自动清理。该目录被 `.gitignore` 排除，不进仓库。

---

完整部署步骤、自检项与采集器配置见 [`docs/SELF-HOSTING.md`](../docs/SELF-HOSTING.md)；
架构与数据模型见 `docs/ARCHITECTURE.md`、`docs/DATA-MODEL.md`。
