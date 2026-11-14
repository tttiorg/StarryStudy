# 参与贡献

StarryStudy 是单用户自托管的学习工作台。欢迎修 bug、补文档、改进采集器适配；
但请先读完这一页，尤其是「隐私红线」——它是这个仓库的硬要求，不是建议。

## 本地跑通

前置：Node 20+（CI 用 22）、npm。

```bash
npm ci
cp .dev.vars.example .dev.vars      # Windows 用 copy；按注释填 5 个 B2_* 与会话密钥
npm run db:migrate                  # 本地 D1 建表 + 虚构示例数据
npm run dev                         # 构建前端并起 wrangler dev，默认 http://localhost:8787
```

另一个终端跑接口冒烟：

```bash
npm run smoke -- --collector-token <与 .dev.vars 中 AUTH_COLLECTOR_TOKEN 一致的值>
```

`.dev.vars` 里的 `B2_*` 指向你自己的 B2 桶；没有桶也可以只跑不碰文件的接口，
但文件上传 / 下载与冒烟里的 Range 断言会失败。完整部署侧流程见
`docs/SELF-HOSTING.md`。

## 提交前检查清单

按顺序跑完再提 PR，任何一条不过都不要提交：

| 命令 | 检查什么 |
|---|---|
| `npm run typecheck` | 全项目 TypeScript 类型 |
| `npm test` | 采集器单元测试 |
| `npm run check:privacy` | 私有信息 / 疑似硬编码凭据 |
| `npm run build` | 前端能构建 |
| `npm run smoke` | 本地起服务后的接口冒烟（见上） |

启用本地钩子，让检查在每次 commit 前自动跑一遍：

```bash
git config core.hooksPath .githooks
```

CI 会再跑同一套检查（`.github/workflows/ci.yml`）。

## 代码约定

- 全项目不用 emoji；图标用 CSS 色块或内联 SVG。
- 中文注释写「为什么」，事故复盘类注释要保留，不复述代码。
- 类型放 `packages/shared`，写请求入参一律用 zod schema 校验；前端 API 只从
  `packages/web/src/api/index.ts` 出，组件里不出现裸 `fetch`。
- 写请求带 `rev`，服务端 `UPDATE ... WHERE rev = ?` 不匹配就返回 409，绝不静默重试或合并。
- 所有查询带 `deleted_at IS NULL`；软删行不复活；课表按「格」写，不整份替换。
- `done` 的三条规则（手动优先 / 历史只升不降 / 今天及以后以 BB 为准）只在服务端派生。
- 时间统一走 `packages/shared/src/time.ts`，按 `Asia/Shanghai` 显式处理；任何自动派生字段
  都要有配置缺失时的回退路径。
- 配置只在 `packages/shared/src/config.ts` 读，业务代码里出现 `process.env` 视为 bug。
- 对象存储的 key 是内容寻址的 `blob/<sha256前2位>/<sha256>`，改名 / 换学科不改对象。

## 隐私红线

仓库从第一个提交起就是公私分离的。**以下内容绝不进仓库**：

- `.env`、`.dev.vars`、`wrangler.local.toml`、`data/`、`shots/`、备份包、日志、`*.sqlite`；
  它们都已在 `.gitignore` 里，别用 `git add -f` 绕过去。
- 学校账号口令、采集器令牌、Cloudflare API Token、真实 D1 `database_id`、
  B2 桶名与 App Key、`AUTH_SECRET`、webhook 地址、自定义域名、服务器 IP。
- 真实姓名、学号、成绩、课程名与代码、教师信息、学校域名、真实本机绝对路径。
- 任何真实课表 / 成绩截图；演示一律用 `migrations/0002_example_seed.sql` 的虚构数据。

示例文件（`.env.example`、`.dev.vars.example`、`wrangler.local.toml.example`、
`0002_example_seed.sql`）只放键名和虚构值。默认值一律留空：没配置时不启动，
而不是拿一个真实地址去崩掉。

如果你不小心提交了凭据，**不要只删文件了事**：先轮换该凭据，再联系维护者处理历史，
因为 git 历史里的东西不会因为一次删除而消失。

## PR 说明里请写清

1. 改了什么、为什么改（尤其是动了业务语义时）。
2. 本地跑了哪些检查，结果如何。
3. 是否动过 `done` 派生、`rev` 冲突、软删、课表按格写这几处；动过就要说明兼容性。

## 关于 v1 旧仓库

v1 是本机回滚线，保留、不修改、不删除。它的 git 历史里曾写死过真实服务器地址，
**不要给它配置 remote 后 push，也不要把它的历史并进本仓库**。需要参考 Blackboard
采集逻辑时只读代码，不复制文件。
