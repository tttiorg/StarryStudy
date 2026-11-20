<template>
  <div class="home">
    <!-- 问候 -->
    <header class="hi">
      <h1 class="hi-title">
        {{ greeting }}<template v-if="meta.student">，{{ meta.student }}</template>
      </h1>
      <p class="hi-sub">
        <span v-if="meta.semester">{{ meta.semester }}</span>
        <span v-if="weekNo"> · 第 {{ weekNo }} 周</span>
        <span> · {{ today }} {{ DAYS[weekday - 1] }}</span>
      </p>
    </header>

    <!-- 名言壁纸 + 天数大卡：还原 v1 的 row-top -->
    <div class="row-top">
      <div class="quote-card" :style="bgStyle">
        <div class="q-inner">
          <div class="q-text">{{ quote.text }}</div>
          <div class="q-from">— {{ quote.from }}</div>
        </div>
        <span v-if="wallpaperCredit" class="q-credit" :title="wallpaperCredit">{{ wallpaperCredit }}</span>
        <button class="q-refresh" title="换一条" @click="refreshQuote">换一换</button>
      </div>

      <div class="day-card">
        <div class="dc-label">开学已</div>
        <div class="dc-num">{{ daysSinceStart }}<span class="dc-unit">天</span></div>
        <div class="dc-divider" />
        <div class="dc-stats">
          <span>今天 <b>{{ todayClasses }}</b> 节课</span>
          <span>待办 <b>{{ todoCount }}</b></span>
          <span :class="{ warn: overdueCount > 0 }">逾期 <b>{{ overdueCount }}</b></span>
        </div>
      </div>
    </div>

    <div class="home-grid">
      <!-- 本周课表 -->
      <section class="ss-card tt-card">
        <div class="card-head">
          <span class="ss-panel-title">本周课表</span>
          <button class="ss-btn" @click="goTimetable">完整课表</button>
        </div>
        <TimetableGrid
          :slots="data.timetable.slots"
          :blocks="data.timetable.blocks"
          :subjects="data.subjects"
          :days="5"
          compact
          @cell-click="onCellClick"
        />
      </section>

      <!-- 近期日程：新建按钮收在卡片头部，不再挂在页面标题行（v1 位置） -->
      <section class="ss-card sched-card">
        <div class="card-head">
          <span class="ss-panel-title">近期日程</span>
          <div class="head-right">
            <span class="ss-panel-sub">{{ openCount }} 项未完成</span>
            <button class="mini-add" @click="openCreate">新建日程</button>
          </div>
        </div>
        <div class="ss-tabs head-tabs">
          <button :class="{ on: timelineTab === 'open' }" @click="timelineTab = 'open'">
            待完成 <b v-if="openCount">{{ openCount }}</b>
          </button>
          <button :class="{ on: timelineTab === 'done' }" @click="timelineTab = 'done'">
            已完成 {{ doneCount }}
          </button>
        </div>
        <button v-if="overdueOnly" class="ss-btn show-all" @click="overdueOnly = false">显示全部</button>
        <ScheduleTimeline
          :groups="groups"
          :overdue="overdueList"
          :subjects="data.subjects"
          empty-text="还没有日程，点上方「新建日程」添加"
          @toggle="toggleTask"
          @edit="openEdit"
          @menu="onTaskMenu"
          @show-overdue="showOverdue"
        />
      </section>
    </div>

    <!-- 学科卡片：桌面固定 3 列，还原 v1 的彩色竖条与教师 / 教室 / 周次信息 -->
    <section class="subjects-section">
      <div class="card-head">
        <span class="ss-panel-title">学科</span>
        <span class="ss-panel-sub">共 {{ data.subjects.length }} 门</span>
      </div>
      <div v-if="!data.subjects.length" class="ss-empty">还没有学科，可在「设置 → 学科管理」里新建</div>
      <div v-else class="subject-grid">
        <button
          v-for="s in data.subjects"
          :key="s.id"
          class="subject-card"
          :style="{ '--sc': s.color }"
          @click="goSubject(s.id)"
        >
          <div class="sc-top">
            <span class="sc-name">{{ s.name }}</span>
            <span class="sc-dot" />
          </div>
          <div class="sc-meta">
            <span v-if="teacherOf(s)">{{ teacherOf(s) }}</span>
            <span v-if="s.course?.room" class="sc-room">{{ s.course.room }}</span>
          </div>
          <div class="sc-foot">
            <template v-if="s.course?.weeks">{{ s.course.weeks }}</template>
            <template v-else>
              成绩 {{ countOf("grades", s.id) }} · 任务 {{ countOf("tasks", s.id) }} · 笔记 {{ countOf("notes", s.id) }}
            </template>
          </div>
        </button>
      </div>
    </section>

    <!-- 新建 / 编辑日程 -->
    <el-dialog v-model="taskOpen" :title="taskForm.id ? '编辑日程' : '新建日程'" width="480">
      <el-form label-width="76px" @submit.prevent>
        <el-form-item label="标题">
          <el-input v-model="taskForm.title" maxlength="120" placeholder="要做什么" @keyup.enter="submitTask" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="taskForm.due" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="时刻">
          <el-time-picker v-model="taskForm.time" value-format="HH:mm" placeholder="留空表示没有具体时刻" style="width: 100%" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="taskForm.type" style="width: 100%">
            <el-option v-for="t in TASK_TYPES" :key="t" :label="TYPE_LABEL[t]" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="学科">
          <el-select v-model="taskForm.subjectId" clearable placeholder="不选则显示为主页日程" style="width: 100%">
            <el-option v-for="s in data.subjects" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="地点">
          <el-input v-model="taskForm.place" maxlength="80" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="taskForm.note" type="textarea" :rows="2" maxlength="1000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="taskOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitTask">保存</el-button>
      </template>
    </el-dialog>

    <ContextMenu ref="ctx" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  DAYS,
  diffDays,
  hhmmInTZ,
  TASK_TYPES,
  todayInTZ,
  weekdayInTZ,
} from "@starry/shared";
import type { Subject, Task, TaskType, TimetableSlot, Wallpaper } from "@starry/shared";
import { api } from "@/api";
import { useDataStore } from "@/stores/data";
import TimetableGrid from "@/components/TimetableGrid.vue";
import ScheduleTimeline from "@/components/ScheduleTimeline.vue";
import ContextMenu from "@/components/ContextMenu.vue";

const router = useRouter();
const data = useDataStore();

const today = computed(() => todayInTZ());
const weekday = weekdayInTZ();
const meta = computed(() => data.timetable.meta);

const TYPE_LABEL: Record<TaskType, string> = {
  assignment: "作业",
  exam: "考试",
  project: "项目",
  activity: "活动",
  task: "待办",
};

/* ---------------- 名言 + 壁纸 ----------------
 * 壁纸优先用必应每日图（Worker 同源代理 + 边缘缓存），拿不到就退回仓库自带的
 * campus.jpg。图源失败不能让首页空白，所以加载失败一律当作「用本地图」。 */
const QUOTES: { text: string; from: string }[] = [
  { text: "真正的勤勉，从来不是长时间的无脑劳作，而是持续高质量地解决真问题。", from: "学习笔记" },
  { text: "你现在做的一页笔记，可能是考试前一小时救你的那一页。", from: "过来人" },
  { text: "所有的一鸣惊人，其实都是厚积薄发。", from: "《人民日报》" },
  { text: "不要因为走得慢就停下，怕的是你连方向都没有。", from: "随手记" },
  { text: "把不会的题抄下来，比刷十道会做的题更有价值。", from: "错题本法" },
  { text: "大学的自由，是把时间花在真正想学会的东西上。", from: "自勉" },
  { text: "复习不是重新学一遍，是把记忆的绳子再系紧一次。", from: "艾宾浩斯" },
  { text: "今天多熬的半小时，明天会以另一种方式还给你。", from: "匿名" },
  { text: "你不需要很厉害才能开始，但你需要开始才会很厉害。", from: "网络" },
  { text: "知识的复利，靠的是持续不断的小额投入。", from: "自学手册" },
  { text: "慢一点没关系，方向对了就行。", from: "写给自己" },
  { text: "把大目标切成今天能做完的那一小块。", from: "执行法则" },
  { text: "没有白走的路，每一步都算数。", from: "李宗盛" },
  { text: "读书的意义，是让你有底气做选择，而不是被选择。", from: "自勉" },
  { text: "所有自律的本质，都是对未来自己的善意。", from: "随笔" },
];

const quoteIdx = ref(Math.floor(Math.random() * QUOTES.length));
const quote = computed(() => QUOTES[quoteIdx.value]);

/* 壁纸从 /api/wallpaper/list 拿最近 8 天，随机挑一张；「换一换」同时换名言和壁纸。
   wpIdx = -1 表示没有可用壁纸，bgStyle 里就只留渐变 + 本地 campus.jpg。 */
const wallpapers = ref<Wallpaper[]>([]);
const wpIdx = ref(-1);
const wallpaper = computed(() => (wpIdx.value >= 0 ? wallpapers.value[wpIdx.value] : null));
const wallpaperCredit = computed(() => wallpaper.value?.credit || "");
const LOCAL_WALLPAPER = 'url("/campus.jpg")';

/* 壁纸与深色渐变是 .quote-card 同一元素的两层 background-image，逐层单独指定
   size / position：渐变层 100% 100% 铺满，图片层 cover 且下对齐（宽屏下能看见
   底部）。两层共用同一个 border-box 坐标系，不可能出现缝；不用 ::before，因为
   它的 inset:0 只覆盖 padding box，会在 1px 边框内侧露一圈没加渐变的图片。
   这里只覆盖图片那一层的 url（--wallpaper-url），渐变层的尺寸与位置仍在 CSS。 */
const bgStyle = computed(() => ({
  "--wallpaper-url": wallpaper.value?.src
    ? `url("${wallpaper.value.src}")`
    : LOCAL_WALLPAPER,
}));

async function loadWallpaper(): Promise<void> {
  try {
    const data = await api.wallpaper.list();
    const items = data.items || [];
    wallpapers.value = items;
    wpIdx.value = items.length ? Math.floor(Math.random() * items.length) : -1;
  } catch {
    wallpapers.value = [];
    wpIdx.value = -1;
  }
}

function refreshQuote(): void {
  let next = quoteIdx.value;
  while (next === quoteIdx.value) next = Math.floor(Math.random() * QUOTES.length);
  quoteIdx.value = next;

  // 有多张壁纸时连带换一张；只有一张或没拿到时保持不动
  if (wallpapers.value.length > 1) {
    let i = wpIdx.value;
    while (i === wpIdx.value) i = Math.floor(Math.random() * wallpapers.value.length);
    wpIdx.value = i;
  }
}

const greeting = computed(() => {
  const h = Number(hhmmInTZ().slice(0, 2));
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
});

const weekNo = computed(() => {
  if (!meta.value.startDate) return 0;
  return Math.floor(diffDays(meta.value.startDate, today.value) / 7) + 1;
});

const daysSinceStart = computed(() =>
  meta.value.startDate ? Math.max(0, diffDays(meta.value.startDate, today.value)) : 0,
);

const todayClasses = computed(
  () => data.timetable.slots.filter((s) => s.day === weekday && !!s.name).length,
);
const todoCount = computed(() => data.tasks.filter((t) => !t.done).length);
const overdueCount = computed(
  () => data.tasks.filter((t) => !t.done && t.due && t.due < today.value).length,
);

/* ---------------- 日程时间线 ----------------
 * 近期日程展示全部任务：既包括不带学科的主页日程，也包括带 subjectId 的课程任务
 * （BB 采集的作业/考试、学科页手建的待办）。课程任务照旧留在各自学科页，
 * 这里只是把它们一并汇总到时间线；ScheduleTimeline 会显示学科名标签，点开仍能编辑。
 * 顶部「待办 / 逾期」统计本就按全部任务算，改这里正好让列表与计数一致。 */
const schedules = computed(() => data.tasks);
const openList = computed(() => schedules.value.filter((t) => !t.done));
const doneList = computed(() => schedules.value.filter((t) => t.done));
const openCount = computed(() => openList.value.length);
const doneCount = computed(() => doneList.value.length);
const overdueList = computed(() =>
  openList.value.filter((t) => t.due && t.due < today.value),
);

const timelineTab = ref<"open" | "done">("open");
const overdueOnly = ref(false);

const shown = computed(() => {
  const base = timelineTab.value === "open" ? openList.value : doneList.value;
  return overdueOnly.value && timelineTab.value === "open" ? overdueList.value : base;
});

const groups = computed(() => {
  const m = new Map<string, Task[]>();
  for (const t of shown.value) {
    const key = t.due || "无日期";
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(t);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, list }));
});

function showOverdue(): void {
  timelineTab.value = "open";
  overdueOnly.value = true;
}

function countOf(kind: "grades" | "tasks" | "notes", id: string): number {
  if (kind === "grades") return data.grades.filter((g) => g.subjectId === id).length;
  if (kind === "tasks") return data.tasks.filter((t) => t.subjectId === id).length;
  return data.notes.filter((n) => n.subjectId === id).length;
}

/** 学科卡上的教师名：优先用教师卡里的姓名，其次用课程信息里的教师 */
function teacherOf(s: Subject): string {
  return s.faculty?.name || s.course?.teacher || "";
}

function goTimetable(): void {
  void router.push("/timetable");
}

function goSubject(id: string): void {
  void router.push(`/subjects/${id}`);
}

/** 主页课表格：点了有课且已关联学科的格子，直接跳对应学科标签页；
 *  空格子、或课程还没建对应学科时，才回退到完整课表（保持原来的行为）。 */
function onCellClick(p: { day: number; block: number; slot: TimetableSlot | null }): void {
  const sid = p.slot?.subjectId;
  if (sid && data.subjects.some((s) => s.id === sid)) {
    goSubject(sid);
  } else {
    goTimetable();
  }
}

/* ---------------- 任务写操作 ---------------- */
const taskOpen = ref(false);
const saving = ref(false);
const taskForm = reactive({
  id: "",
  title: "",
  due: "",
  time: "",
  type: "task" as TaskType,
  place: "",
  note: "",
  subjectId: "" as string,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = ref<any>(null);

function openCreate(): void {
  taskForm.id = "";
  taskForm.title = "";
  taskForm.due = today.value;
  taskForm.time = "";
  taskForm.type = "task";
  taskForm.place = "";
  taskForm.note = "";
  taskForm.subjectId = "";
  taskOpen.value = true;
}

function openEdit(t: Task): void {
  taskForm.id = t.id;
  taskForm.title = t.title;
  taskForm.due = t.due;
  taskForm.time = t.time;
  taskForm.type = t.type;
  taskForm.place = t.place;
  taskForm.note = t.note;
  taskForm.subjectId = t.subjectId ?? "";
  taskOpen.value = true;
}

async function submitTask(): Promise<void> {
  if (!taskForm.title.trim()) {
    ElMessage.warning("请填标题");
    return;
  }
  if (!taskForm.due) {
    ElMessage.warning("请选择日期");
    return;
  }
  saving.value = true;
  try {
    const payload = {
      title: taskForm.title.trim(),
      due: taskForm.due,
      time: taskForm.time || "",
      type: taskForm.type,
      place: taskForm.place.trim(),
      note: taskForm.note.trim(),
      subjectId: taskForm.subjectId || null,
      done: false,
      doneManual: null,
    };
    const out = taskForm.id
      ? await data.update("tasks", taskForm.id, payload)
      : await data.create("tasks", payload);
    if (out.ok) {
      taskOpen.value = false;
      ElMessage.success(taskForm.id ? "已保存" : "已添加");
    }
  } finally {
    saving.value = false;
  }
}

/** 手动勾选要写 doneManual：一旦有值，服务端自动派生永远不许覆盖（§8.2） */
async function toggleTask(t: Task): Promise<void> {
  const v = !t.done;
  await data.update("tasks", t.id, { done: v, doneManual: v });
}

function onTaskMenu(e: MouseEvent, t: Task): void {
  ctx.value?.open(
    e,
    [
      { key: "edit", label: "编辑" },
      { key: "del", label: "删除", danger: true },
    ],
    (key: string) => (key === "edit" ? openEdit(t) : void removeTask(t)),
  );
}

async function removeTask(t: Task): Promise<void> {
  await data.remove("tasks", t.id);
}

onMounted(() => {
  void data.loadAll(false);
  void loadWallpaper();
});
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hi {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hi-title {
  margin: 0;
  font-size: 24px;
  font-weight: 680;
  letter-spacing: 0.3px;
}

.hi-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ss-muted);
}

/* 名言 + 天数：桌面左右两栏，窄屏上下堆叠。
   minmax(0,1fr) 不能写成 1fr，否则内容会把整列顶宽、页面出现横向滚动条。 */
.row-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 210px;
  gap: 14px;
}

.quote-card {
  position: relative;
  min-height: 168px;
  border-radius: var(--ss-radius);
  border: 1px solid var(--ss-border);
  padding: 26px 30px;
  display: flex;
  align-items: center;
  overflow: hidden;
  /* 渐变与图片是同一元素的两层 background，共用同一个 border-box 坐标系，
     逐层单独指定 size / position，层与层之间不可能错位，也就不会有缝。
     渐变层 100% 100% 铺满且不定位；图片层 cover + 下对齐，宽屏下仍能看到
     底部的校名石。不再用 ::before：它的 inset:0 只覆盖 padding box，
     比 border-box 小一圈（正好是 1px 边框），四周都会露出没加渐变的图片。 */
  background-image:
    linear-gradient(105deg, rgba(9, 14, 17, 0.92) 0%, rgba(9, 14, 17, 0.62) 45%, rgba(9, 14, 17, 0.18) 100%),
    var(--wallpaper-url, url("/campus.jpg"));
  background-size: 100% 100%, cover;
  background-position: 0 0, center bottom;
  background-origin: border-box, border-box;
  background-clip: border-box, border-box;
  background-repeat: no-repeat;
}

.q-inner {
  position: relative;
  z-index: 1;
  max-width: 640px;
}

.q-text {
  font-size: 19.5px;
  line-height: 1.75;
  font-weight: 500;
  color: #f2f6fb;
  letter-spacing: 0.4px;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.55);
}

.q-from {
  margin-top: 12px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.62);
}

.q-refresh {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 1;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 11.5px;
  padding: 4px 11px;
  border-radius: 7px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  font-family: inherit;
  transition: background 0.15s;
}

.q-refresh:hover {
  background: rgba(255, 255, 255, 0.22);
}

/* 壁纸版权说明：必应要求保留，右下角贴边、不挡名言，窄屏可折行 */
.q-credit {
  position: absolute;
  right: 14px;
  top: 12px;
  z-index: 1;
  max-width: 46%;
  font-size: 10.5px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.72);
  text-align: right;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.day-card {
  background: var(--ss-surface);
  border: 1px solid var(--ss-border);
  border-radius: var(--ss-radius);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.dc-label {
  font-size: 12px;
  color: var(--ss-muted);
}

.dc-num {
  font-size: 48px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ss-accent);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.dc-unit {
  font-size: 15px;
  margin-left: 5px;
  color: var(--ss-muted);
  font-weight: 500;
}

.dc-divider {
  height: 1px;
  background: var(--ss-border);
  margin: 12px 0 10px;
}

.dc-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12.5px;
  color: var(--ss-muted);
}

.dc-stats b {
  color: var(--ss-text);
  font-variant-numeric: tabular-nums;
}

.dc-stats .warn b {
  color: var(--ss-danger);
}

/* 课表宽、日程窄：还原 v1 的 1.45fr / 1fr。两张卡等高，
   日程卡不贡献行高，超出的日程在卡内滚动，不会把左列课表顶出大片留白。 */
.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 1fr);
  gap: 14px;
  align-items: stretch;
}

.sched-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.sched-card :deep(.timeline) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.card-head > .ss-btn {
  margin-left: auto;
}

/* 近期日程：新建按钮回到卡片头部（v1 位置），不再挂在页面标题行 */
.head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.mini-add {
  background: transparent;
  border: 1px solid var(--ss-border);
  color: var(--ss-text-2);
  font-size: 12px;
  padding: 3px 11px;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: all 0.15s;
}

.mini-add:hover {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
  background: var(--ss-accent-soft);
}

.head-tabs {
  margin: 0 0 10px;
  flex: none;
}

.show-all {
  margin: 0 0 10px;
  flex: none;
}

.tt-card :deep(.tt) {
  min-width: 0;
}

.subjects-section {
  margin-top: 2px;
}

/* 桌面固定 3 列：auto-fill 会在大屏摊成 5~6 列，卡片太窄、底部学科栏看着错位 */
.subject-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.subject-card {
  position: relative;
  display: block;
  padding: 12px 14px 12px 16px;
  border: 1px solid var(--ss-border);
  border-radius: 12px;
  background: var(--ss-surface);
  color: var(--ss-text);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  overflow: hidden;
  transition: all 0.15s;
}

.subject-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--sc, var(--ss-accent));
}

.subject-card:hover {
  border-color: color-mix(in srgb, var(--sc, var(--ss-accent)) 55%, var(--ss-border));
  transform: translateY(-1px);
}

.sc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.sc-name {
  font-size: 15.5px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sc, var(--ss-accent));
  flex: none;
}

.sc-meta {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--ss-muted);
  overflow: hidden;
}

.sc-room {
  opacity: 0.75;
}

.sc-foot {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--ss-dim);
}

/* 窄到 1100px 时两列并排会把课表挤变形，改成上下堆叠，
   日程卡恢复普通流并用 max-height 限高（和 v1 同一断点）。 */
@media (max-width: 1100px) {
  .home-grid {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }
  .sched-card :deep(.timeline) {
    max-height: 380px;
  }
}

@media (max-width: 900px) {
  .row-top {
    grid-template-columns: minmax(0, 1fr);
  }
  .subject-grid {
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  }
}

@media (max-width: 520px) {
  .subject-grid {
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 8px;
  }
}
</style>
