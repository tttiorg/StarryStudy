# 数据模型

DDL 的唯一来源是 `migrations/0001_init.sql`。本文逐表说明字段、约定，以及**不能丢的业务
语义**（每条都对应一次真实事故，删掉会原样复发）。字段命名：数据库用 `snake_case`，
API 用 `camelCase`，转换只在 Worker 的 `db.ts` 里做一次（`packages/shared/src/utils.ts`
的 `camelize` / `parseJson`）。

## 1. 通用约定

- `id TEXT PRIMARY KEY`：业务 id，沿用 v1 的短 id 前缀（见 §3）。**不要用 UUID**：现有 id
  够短，且前端书签、铃铛水位、外链都引用它，换 id 会断链。
- `rev INTEGER NOT NULL DEFAULT 1`：乐观锁。每次写入 +1，写入语句必须带 `AND rev = ?`，
  `changes() === 0` 返回 409（见 §4.6）。
- **软删除**：`deleted_at` 非空即视为删除。所有查询默认带 `WHERE deleted_at IS NULL`，
  所有 `COUNT` / 求和也都要带，漏一处统计就多算（D-05）。
- **时间戳**：`created_at` / `updated_at` / `deleted_at` 存 ISO 8601 UTC 字符串
  （`...Z`）；`sync_runs.ran_at` 同理。
- **日期型字段**：`due` / `date` / `next_review` 只存 `YYYY-MM-DD` 本地日期，**不存时区**。
  「今天 / 逾期 / 本周 / 待复习」判断一律用 `todayInTZ()`（Asia/Shanghai），详见
  `docs/ARCHITECTURE.md` §5。
- **结构化子对象**：`course` / `faculty` / `tags` / `log` 用 `TEXT` 存 JSON 字符串，不为它们
  建表；读出来用 `parseJson` 还原，坏数据回退默认值而不是让整个请求 500。
- **布尔**：D1 没有 bool，用 `INTEGER 0/1`；`bool()` 兼容 `1 / true / "1"`。
- 例外：`timetable_slots` 没有 `id` / 软删 / `created_at`（一格一行，清空即删行）；
  `timetable_meta`、`auth` 是单行表；`settings` 是 KV；`sync_runs` 无 `rev` / 软删。

## 2. 逐表字段（对照 `0001_init.sql`）

### subjects 学科

| 字段 | 类型 / 默认 | 说明 |
|---|---|---|
| `id` | TEXT PK | `s_` 前缀 |
| `name` | TEXT NOT NULL | 显示名 |
| `color` | TEXT DEFAULT `#4f9cf9` | CSS 色块，图标不用 emoji |
| `sort` | INTEGER DEFAULT 0 | 拖拽排序；索引 `subjects_sort`（仅未删行） |
| `note` | TEXT DEFAULT '' | 备注 |
| `course` | TEXT NULL | JSON：`{fullName, teacher, room, weeks, classCode, homepage}` |
| `faculty` | TEXT NULL | JSON：`{name, title, dept, avatar, url, phone, email}` |
| `bb_course_id` | TEXT NULL | 形如 `_8497_1`，采集器按它精确匹配学科，绝不按名字模糊匹配 |
| `rev` / `created_at` / `updated_at` / `deleted_at` | 通用 | 见 §1 |

`course` / `faculty` 含教师等他人信息，属于隐私边界，示例数据里一律留空。

### timetable_slots 课表单格

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `day` | INTEGER 1–7 | 周一~周日 |
| `block` | INTEGER 1–6 | 第 1-2 / 3-4 / 5-6 / 7-8 / 9-10 / 11-12 节 |
| `name` / `room` / `teacher` / `weeks` | TEXT DEFAULT '' | 单格内容 |
| `subject_id` | TEXT NULL | 关联学科 |
| `rev` | INTEGER DEFAULT 1 | 单格也要乐观锁 |
| `updated_at` | TEXT NOT NULL | 时间戳 |

**主键就是 `(day, block)`**，一格一行，天然不会整份覆盖（§4.1）。全字段为空表示清空这一格
（删行），这是它不需要软删的原因。

### timetable_meta 课表元信息（单行）

`id INTEGER PRIMARY KEY CHECK (id = 1)`、`semester`、`student`、`start_date`（`YYYY-MM-DD`）。
`0001_init.sql` 用 `INSERT OR IGNORE` 预置一行空值。`student` 属于身份信息，迁移时保留但
绝不打印、绝不进仓库。

### tasks 日程 / 任务

| 字段 | 类型 / 默认 | 说明 |
|---|---|---|
| `id` | TEXT PK | `d_` 前缀 |
| `title` | TEXT NOT NULL | |
| `due` | TEXT NOT NULL | `YYYY-MM-DD`，日期型不存时区 |
| `time` | TEXT DEFAULT '' | `HH:MM`，空字符串 = 没有具体时刻（见 §4.4） |
| `type` | TEXT DEFAULT `task` | `task / assignment / exam / project / activity` |
| `place` / `note` | TEXT DEFAULT '' | |
| `subject_id` | TEXT NULL | 带学科 → 学科页当「任务」，不带 → 主页当「日程」 |
| `done` | INTEGER DEFAULT 0 | 派生结果，按 §4.2 三条规则算 |
| `done_manual` | INTEGER NULL | `NULL` = 用户没手动勾过；`0/1` = 用户明确指定，自动派生永不许覆盖 |
| `src` | TEXT DEFAULT `manual` | `manual / bb` |
| `src_key` | TEXT NULL | `bbcal:<eventId>`；唯一索引 `tasks_src_key`（仅非空行） |
| `rev` / `created_at` / `updated_at` / `deleted_at` | 通用 | 索引 `tasks_due`（仅未删行） |

### grades 成绩

| 字段 | 类型 / 默认 | 说明 |
|---|---|---|
| `id` | TEXT PK | `g_` 前缀 |
| `name` | TEXT NOT NULL | |
| `subject_id` | TEXT NULL | |
| `score` | REAL NULL | `NULL` = 未评分行（不进库，见 §4.5） |
| `full` | REAL DEFAULT 100 | 满分 |
| `weight` | REAL NULL | 权重，采集器白名单不许覆盖 |
| `type` | TEXT DEFAULT `other` | `homework / quiz / exam / project / other` |
| `date` | TEXT DEFAULT '' | `YYYY-MM-DD` |
| `note` | TEXT DEFAULT '' | |
| `src` / `src_key` | 默认 `manual` / NULL | `src_key = bb:<courseId>:<rowId>`；唯一索引 `grades_src_key` |
| `rev` / `created_at` / `updated_at` / `deleted_at` | 通用 | 索引 `grades_subject`（`subject_id, date DESC`） |

### notes 笔记

`id`（`n_`）、`title`（默认 `无标题`）、`content`（默认 ''，最长 200KB）、`subject_id`、
`rev` / `created_at` / `updated_at` / `deleted_at`。索引 `notes_subject`（仅未删行）。
自动保存带 800ms 防抖、只写变化的那一条（CF-03）。

### knowledge 知识点（艾宾浩斯）

| 字段 | 类型 / 默认 | 说明 |
|---|---|---|
| `id` | TEXT PK | `k_` 前缀 |
| `title` | TEXT NOT NULL | |
| `content` | TEXT DEFAULT '' | |
| `subject_id` | TEXT NULL | |
| `stage` | INTEGER DEFAULT 0 | 已完成的复习轮次 |
| `next_review` | TEXT DEFAULT '' | `YYYY-MM-DD`，`<= today` 即「今天要复习」 |
| `mastered` | INTEGER DEFAULT 0 | 掌握后不再出现在待复习列表 |
| `log` | TEXT DEFAULT `'[]'` | JSON 数组 `[{at, stage}]`，迁移时序列化成 TEXT |
| `rev` / `created_at` / `updated_at` / `deleted_at` | 通用 | 索引 `knowledge_review`（仅未删行） |

### links 外链

`id`（`l_`）、`name`、`url`、`icon`、`sort`（默认 0）、`rev` / `created_at` / `updated_at` /
`deleted_at`。可拖拽排序，抓 favicon。示例种子只保留 2 个通用示例链接（`example.com` /
`example.org`），其余让用户自己加。

### files 文件（对象在 R2）

| 字段 | 类型 / 默认 | 说明 |
|---|---|---|
| `id` | TEXT PK | `f_` 前缀 |
| `name` | TEXT NOT NULL | 显示名，改名不影响 R2 对象 |
| `r2_key` | TEXT NOT NULL | `blob/<sha256前2位>/<sha256>` |
| `size` / `mime` / `sha256` | | 内容寻址元信息 |
| `subject_id` | TEXT NULL | |
| `category` | TEXT DEFAULT `material` | `material / knowledge` |
| `pinned` | INTEGER DEFAULT 0 | |
| `tags` | TEXT DEFAULT `'[]'` | JSON 数组 |
| `note` | TEXT DEFAULT '' | |
| `local_only` | INTEGER DEFAULT 0 | v1 的 `link` 型：只在电脑能打开，永远不上传 |
| `rev` / `created_at` / `updated_at` / `deleted_at` | 通用 | 唯一索引 `files_sha(sha256)`；索引 `files_subject`（仅未删行） |

### settings 杂项设置（KV）

`key TEXT PRIMARY KEY`、`value TEXT NOT NULL`。`0001_init.sql` 预置 `bb.map = '{}'`
（手动的 BB course_id → 学科 id 映射）与 `lastSyncAt = ''`。UI 偏好、铃铛水位等也放这里
或浏览器本地存储。

### sync_runs 采集器运行状态

`id`（`r_` 前缀）、`source`（`grades / tasks`）、`ok`、`created` / `updated` / `skipped`
（计数）、`error`、`ran_at`。**不迁移** v1 的 `sync-state.json`，从空开始。

### auth 认证（单行）

`id INTEGER PK CHECK (id = 1)`、`hash`（PBKDF2 密码哈希）、`session_id`。`0001_init.sql`
预置空行，首次访问据此触发设置密码。**没有 `users` 表，永远只有一个用户。**

## 3. id 前缀表

| 前缀 | 集合 | 前缀 | 集合 |
|---|---|---|---|
| `s_` | subjects 学科 | `d_` | tasks 日程 / 任务 |
| `g_` | grades 成绩 | `n_` | notes 笔记 |
| `f_` | files 文件 | `l_` | links 外链 |
| `k_` | knowledge 知识点 | `r_` | sync_runs 采集运行 |

前缀常量在 `packages/shared/src/constants.ts` 的 `ID_PREFIX`，生成在 `ids.ts` 的 `newId()`。
v1 课表用过 `t_`，但 v2 的 `timetable_slots` 主键是 `(day, block)`、不带 id，故不再使用。

## 4. R2 key 布局与去重 / 软删

```
blob/<sha256[0:2]>/<sha256>
```

- **内容寻址**：两级前缀避免单目录对象过多；相同内容天然指向同一对象，去重靠
  `files_sha` 唯一索引。
- **key 里不放文件名、不放学科**：改名、换学科都不该动对象，`name` / `subject_id` 只在
  `files` 行里改。
- **上传流程**：算 sha256 → 对 `blob/<sha前2位>/<sha>` 做 `HEAD` 命中则直接复用该 key →
  否则 `PUT`。`sha256` 列有唯一索引，重复内容不会重复存对象。
- **删除**：只软删 `files` 行（`deleted_at` 置值），R2 对象保留等 GC；免费额度宽，暂时不 GC
  也没关系。绝不做物理移动。
- **local_only**：`local_only=1` 的行不上传、不参与 sha 去重，手机端显示「仅电脑可用」且
  不可点开。迁移脚本对 `link:true` 的 v1 条目直接置 `local_only=1`。

## 5. 不能丢的业务语义（每条注明为什么）

这一节是整份文档最重要的部分。代码可以重写，这些规则不行。

### 5.1 课表按「格」写，不按「份」

一个格子 = `(day, block)`；日常编辑只提交被改的那一格，**整份替换只留给「导入」用**。
**为什么**：v1 曾经整份保存。平板昨天打开、今天才点保存，会把这中间在手机上加的格子
静默冲掉。改成按格后，最坏只覆盖自己改的那一格。

### 5.2 任务的 `done` 有三条规则

```
if (done_manual != NULL)  done = done_manual          // ① 人手动勾过的，永远听人的
else if (due < today)     done = done || bb_done      // ② 今天之前的条目，只升不降
else                      done = bb_done              // ③ 今天及以后，完全以 BB 为准
```

`bb_done` 的判定：这条作业在成绩表里有对应行（`itemSourceId` → `srcKey` 能查到成绩）即
视为已完成。

**为什么**：v1 曾写成单向锁 `done = old.done || it.done`。一次误判把当天到期的作业标成
完成，之后永远回不来，页面上这条作业直接消失，用户以为抓漏了，查了两小时才发现数据一直
在库里。**通用原则：任何自动派生字段都必须有回退路径**，没有回退路径的自动写入迟早会把
一条错误固化。
**规则 ② 为什么**：历史作业如果被翻回未完成，会在页面上冒出一堆无用的「逾期 N 天」，
同样是灾难，历史就让它保持原样。

### 5.3 采集写入的白名单

采集器更新已存在记录时**只改** `title` / `due` / `time` / `type` / `place` / `note` /
`subject_id`（仅当为空时）；不动 `done_manual`、`weight`、手填 `note`、`tags`、
`pinned`、`rev`（由服务端自增）。新建记录时额外写 `src`、`src_key`、`created_at`。
**为什么**：保护用户手填字段不被自动流程冲掉。别用 `INSERT OR REPLACE`，它会把整行冲掉。

### 5.4 时间字段的「占位值」

Blackboard 日历返回三种「假时间」——`allDay === true`、`hhmm === "23:59"`、
`hhmm === "00:00"`——全部按**没有具体时刻**处理，`time` 写空字符串（常量
`PLACEHOLDER_TIMES`）。**为什么**：实测 12 条事件里 9 条是这类占位，照抄会把日程写成
「半夜 23:59 交作业」。但 `due` 日期必须保留：日期错了还能看，时刻错了会误导。
同理 BB 的 `start` 是**不带时区的本地时间字符串**，`startDate` 才是 UTC；取日期要用
`splitLocalDateTime()` 切字符串，不要 `new Date(start)`（会引入 UTC 偏移把 23:59 挪到
第二天）。

### 5.5 成绩的稳定键与求和口径

- 稳定键 `srcKey = bb:<courseId>:<rowId>`，`rowId` 是成绩明细行 `<div id="...">` 里的数字。
- **只用有分数的行**（`score !== null`），未评分的行不进库。
- 课程总分 = 所有已评分行的 `score` 求和，满分 = `full` 求和；这与 BB 显示的「总计」吻合。
- **不要**用成绩流接口返回的 `itemSpecificData.gradeDetails.grade` 当总分：那一项的
  `pointsPossible` 恒为 0，算不出百分比。
- 合计行（`总计` / `Weighted Total` / `Course Total` 等，常量 `TOTAL_ROW_RE`）必须过滤，
  它不是成绩条目。
- 日期优先 `duedate`，为 0 时回退 `lastactivity`。

**为什么**：稳定键保证重复采集是 upsert 而不是重复插入；只用有分数的行 + 求和口径才能
和 BB 显示一致；`gradeDetails` 与合计行会算错或重复计分；不回退 `lastactivity` 会导致
部分课程的成绩列表没有日期、排序乱掉。

### 5.6 并发与陈旧覆盖（409）

每条记录带 `rev`，写请求带 `rev`，服务端 `UPDATE ... WHERE id = ? AND rev = ?`，
`changes() === 0` 返回 409 并把服务端当前完整记录交给前端。前端**不要静默重试**，要提示
「这条已在别处修改」并展示两份差异。采集器读到旧 `rev` 就重读一次再写，最多重试 2 次。
**为什么**：防止两个标签页 / 两台设备互相覆盖且用户毫无察觉。手机和平板不会同时编辑
（已确认），409 极少发生，**不需要** CRDT / 字段级合并。

### 5.7 学科匹配优先级（采集器）

1. 学科里存的 `bb_course_id`（从 `bbUrl` 里正则 `[?&]id=(_\d+_\d+)` 抠出来）；
2. 用户手动映射过的（`settings` 里的 `bb.map`）；
3. 日历事件的 `calendarName` 对上 BB 课程名 → `course_id` → 学科；
4. 都对不上 → `subject_id = NULL`，不猜。

**为什么**：v1 实测 12/12 全部自动对上、0 条未匹配。**不要按课程名做模糊匹配**——
「课程名」与「课程名(上)」这类相似名称会错配到别的学科，宁可留空也不猜。

### 5.8 文件的去重与删除

上传先算 sha256，命中已有 `files.sha256` 直接复用对象；删除软删行 + 对象保留。
**为什么**：内容寻址让相同文件不重复占空间；物理删除 / 移动对象会破坏「改名不动对象」
的约定。`local_only=true` 的文件永远不上传，因为它是本机磁盘路径，云端没有对应字节。

### 5.9 通知铃铛的「水位」

- 「新」的判定靠本地一份 `{ taskIds, gradeIds, seenAt }`（常量 `NOTICE_STORAGE_KEY`）。
- **第一次打开（没有水位）时全部算「新」**，不能把启动时刻当水位，否则历史成绩永远不算
  新，用户会觉得铃铛坏了。
- **红点不能用「集合指纹」判断**：v1 用 `ids.join(",")` 比对，结果把一条临期任务标记完成
  后集合从 3 项变 2 项、指纹变了 → 红点明明没有新东西却又亮起来。正确做法是比对
  「有没有新增的 id」，不是「集合是否相同」。
- 面板内容永远是「最近的一份清单」（临期 + 最近 5 条任务 + 最近 6 条成绩），不是
  「上次之后新增的」；用户点开时即使没有新消息也要能看到东西。

### 5.10 知识点的复习间隔

`[1, 2, 4, 7, 15, 30, 60]` 天（常量 `REVIEW_INTERVALS`）。`stage` 是已完成轮次：

- `review`：`stage + 1`，`next_review = today + INTERVALS[stage+1]`
- `forgot`：`stage = 0`，`next_review = today + 1`
- `master`：`mastered = 1`，不再出现在待复习列表
- `reset`：清空 `stage` 与 `mastered`

`next_review <= today` 即为「今天要复习」。**为什么**：递增间隔是艾宾浩斯遗忘曲线的复习
排期，是本功能的核心价值；`next_review` 是日期型字段，判断必须用 `todayInTZ()` 而不是
系统 UTC 时间，否则「今天」会错一天。

> 迁移相关：v1 的 `db/*.json` 是 `{version, items:[]}`，`timetable.json` 是
> `{version, meta, blocks, slots}`，`knowledge.log` 要序列化成 TEXT，`files.json` 里
> `link:true` 的条目置 `local_only=1` 不上传，**id 全部保留**（前端书签 / 铃铛水位 / 外链都
> 引用它），`bb.json` / `auth.json` / `sync-state.json` 显式跳过不迁移。由
> `scripts/migrate-v1.mjs` 一次性导出，产物落在被 gitignore 的 `data/` 下。
