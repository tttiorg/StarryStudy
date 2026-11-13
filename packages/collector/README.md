# @starry/collector

本机采集器（Node 脚本）。它只做一件事：登录 Blackboard / CAS，抓成绩与日历，
把结果整理成 `IngestGrade` / `IngestTask`，通过 `POST /api/ingest/*` 写进云端。

**采集器绝不直连 D1，也绝不覆盖用户手填字段**：提交体里只有 `IngestGrade` /
`IngestTask` 的字段，不含 `done` / `doneManual` / `weight` / `rev` 等由用户或
服务端维护的字段（字段白名单最终由服务端执行）。

## 前置

- Node >= 20（用到 `AbortSignal.timeout`、`Headers.getSetCookie`）。
- 在仓库根执行一次 `npm install`，npm workspaces 会把 `@starry/shared` 链好。
- 复制仓库根的 `.env.example` 为 `.env` 并填写。所有环境值唯一的读取出口是
  `packages/shared/src/config.ts` 的 `readNodeConfig()`，业务代码不碰环境。

## 配置项（都写在 .env，只留本机）

| 键 | 说明 | 必填 |
|---|---|---|
| `BB_CAS_URL` | CAS 站点根地址 | 是 |
| `BB_BASE_URL` | Blackboard 站点根地址 | 是 |
| `BB_SERVICE_PATH` | CAS 回跳的 service 路径模板 | 否（用通用默认值） |
| `BB_STREAM_PATH` | 课程列表 / 成绩流接口路径 | 否（用通用默认值） |
| `BB_MYGRADES_PATH` | 成绩明细页路径 | 否（用通用默认值） |
| `BB_CALENDAR_PATH` | 日历事件接口路径 | 否（用通用默认值） |
| `BB_USER` | 学校账号 | 是 |
| `BB_PASSWORD` | 学校密码 | 是 |
| `BB_SUBJECT_MAP` | 课程 id 到学科 id 的手工映射（JSON 字符串） | 否 |
| `API_BASE_URL` | 云端 API 根地址 | 是 |
| `COLLECTOR_TOKEN` | 采集器令牌，须与 Worker 侧一致 | 是 |

地址类配置的默认值一律为空：配不齐时 `collectorConfigured()` 为 `false`，
采集器会打印缺失项并**直接退出，不会启动、不会崩**。

凭据（`BB_USER` / `BB_PASSWORD` / `COLLECTOR_TOKEN`）只在进程内存与本机环境里，
不写进仓库、不打印到日志；会话 cookie 也只在内存里，不落盘（v1 的
`bb.json` 按迁移约定不迁移）。

## 运行

在仓库根执行：

```bash
npm run collect          # 抓一次并写入云端
npm run collect:dry      # 等价于 --dry-run
```

或在本包目录：

```bash
npx tsx src/index.ts --dry-run
npx tsx src/index.ts --help
```

`--dry-run` 仍然会登录、抓取、算计划并打印，只是**不写云端**，适合先核对
学科匹配和条数。

## 校方差异怎么适配（偏差说明）

交接书 §4.3 曾把「学校专属 adapter 源文件」列为可选项。但 §4.5 的提交自检会
命中学校域名关键字，且「代码里不出现任何学校专有信息」是硬规则，新增这类
源文件必然踩线。**因此本包只有一个通用适配器 + 一个注册表**：
`adapters/blackboard-generic.ts` 走完整流程，`adapters/index.ts` 目前只注册它。
校方之间的差异只是 CAS 地址、站点地址与各接口路径模板，全部由 `.env` 的
`BB_*` 覆盖，不需要新增代码；将来若某校流程真的不同，也应加通用分支，
而不是把学校名或域名写进代码。

## 写入语义速记

- **成绩两步取数**：先 POST 课程流接口拿课程 id 与课程名，再逐门课 GET 服务端
  渲染的明细页。**不用**流接口里的总分（满分恒为 0）。只用有分数的行，
  过滤合计行；`duedate` 为 0 回退 `lastactivity`；`srcKey = bb:<courseId>:<rowId>`；
  课程总分 = 已评分行分数求和 / 满分求和。中文标题会解码 HTML 实体。
- **日历**：取往前 120 天、往后 180 天。`start` 是不带时区的本地时间字符串，
  只切字符串、绝不当成 UTC 解析；`allDay` 或占位时刻写成 `time=""`，但 `due`
  日期保留。`srcKey = bbcal:<eventId>`。
- **学科匹配优先级**：`subject.bbCourseId` → `settings['bb.map']`（含
  `BB_SUBJECT_MAP`）→ 日历 `calendarName` 精确对上课程名得到 course_id →
  再走前两条；都对不上就是 `null`，**绝不按课程名模糊匹配**。
- **bbDone 只是布尔上报**：日历事件的 `itemSourceId` 对应成绩行 rowId，能在本次
  成绩里查到就算完成。采集器不决定最终 `done`——服务端按三条规则算
  （人手动勾过永远听人的；今天之前只升不降；今天及以后完全以 BB 为准）。
  v1 曾把 `done` 写成单向锁，误标一条当天作业后它永久消失，这个坑不能复发。
- **顺序**：成绩先跑、任务后跑，因为任务靠「有没有成绩」判完成。

## 验证云端连通性（W-01）

本机有全局代理，裸 `curl` 会走代理返回 502。验证时务必绕过代理：

```bash
curl --noproxy '*' -X POST https://study.example.com/api/ingest/grades \
  -H 'X-Collector-Token: <令牌>' -H 'Content-Type: application/json' \
  -d '{"items":[]}'
```

把示例域名换成自己的站点地址。网络错误会带出 URL、HTTP 状态与响应片段，
不会静默吞掉。

## 调试证据（BB-07）

登录失败或抓数异常时，响应 HTML 会落到仓库根 `.workbuddy/bb-debug/` 下，
文件名形如 `<标签>-<时间戳>.html`。该目录已被根 `.gitignore` 排除，不会进
仓库；日志只给文件路径，不把 HTML 内容打满屏。
