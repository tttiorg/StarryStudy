<template>
  <div class="home">
    <!-- 问候 + 学期信息 -->
    <header class="hi">
      <div>
        <h1 class="hi-title">
          {{ greeting }}<template v-if="meta.student">，{{ meta.student }}</template>
        </h1>
        <p class="hi-sub">
          <span v-if="meta.semester">{{ meta.semester }}</span>
          <span v-if="weekNo"> · 第 {{ weekNo }} 周</span>
          <span> · {{ today }} {{ DAYS[weekday - 1] }}</span>
        </p>
      </div>
      <button class="ss-btn primary" @click="openCreate">
        <AppIcon name="plus" :size="14" /> 新建日程
      </button>
    </header>

    <!-- 天数卡 -->
    <div class="day-cards">
      <div class="day-card">
        <span class="dc-k">今天课程</span>
        <span class="dc-v">{{ todayClasses }}<em>节</em></span>
      </div>
      <div class="day-card">
        <span class="dc-k">待办</span>
        <span class="dc-v">{{ todoCount }}<em>项</em></span>
      </div>
      <div class="day-card" :class="{ warn: overdueCount > 0 }">
        <span class="dc-k">逾期</span>
        <span class="dc-v">{{ overdueCount }}<em>项</em></span>
      </div>
      <div class="day-card">
        <span class="dc-k">开学</span>
        <span class="dc-v">{{ daysSinceStart }}<em>天</em></span>
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
          @cell-click="goTimetable"
        />
      </section>

      <!-- 近期日程 -->
      <section class="ss-card">
        <div class="card-head">
          <span class="ss-panel-title">近期日程</span>
          <span class="ss-panel-sub">共 {{ shown.length }} 条</span>
          <div class="ss-tabs head-tabs">
            <button :class="{ on: timelineTab === 'open' }" @click="timelineTab = 'open'">
              待完成 <b v-if="openCount">{{ openCount }}</b>
            </button>
            <button :class="{ on: timelineTab === 'done' }" @click="timelineTab = 'done'">
              已完成 {{ doneCount }}
            </button>
          </div>
          <button v-if="overdueOnly" class="ss-btn" @click="overdueOnly = false">显示全部</button>
        </div>
        <ScheduleTimeline
          :groups="groups"
          :overdue="overdueList"
          :subjects="data.subjects"
          empty-text="还没有日程，点右上角「新建日程」添加"
          @toggle="toggleTask"
          @edit="openEdit"
          @menu="onTaskMenu"
          @show-overdue="showOverdue"
        />
      </section>
    </div>

    <!-- 学科卡片 -->
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
          @click="goSubject(s.id)"
        >
          <span class="sc-dot" :style="{ background: s.color }" />
          <span class="sc-name">{{ s.name }}</span>
          <span class="sc-meta">
            成绩 {{ countOf("grades", s.id) }} · 任务 {{ countOf("tasks", s.id) }} · 笔记 {{ countOf("notes", s.id) }}
          </span>
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
import type { Task, TaskType } from "@starry/shared";
import { useDataStore } from "@/stores/data";
import TimetableGrid from "@/components/TimetableGrid.vue";
import ScheduleTimeline from "@/components/ScheduleTimeline.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import AppIcon from "@/components/AppIcon.vue";

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
 * 不带 subjectId 的任务是「主页日程」，带学科的在学科页当任务。 */
const schedules = computed(() => data.tasks.filter((t) => !t.subjectId));
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

function goTimetable(): void {
  void router.push("/timetable");
}

function goSubject(id: string): void {
  void router.push(`/subjects/${id}`);
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.hi-title {
  margin: 0 0 3px;
  font-size: 21px;
  font-weight: 650;
}

.hi-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ss-muted);
}

.day-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.day-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 16px;
  border: 1px solid var(--ss-border);
  border-radius: 12px;
  background: var(--ss-surface);
}

.day-card.warn .dc-v {
  color: var(--ss-danger);
}

.dc-k {
  font-size: 11.5px;
  color: var(--ss-muted);
}

.dc-v {
  font-size: 24px;
  font-weight: 650;
  color: var(--ss-text);
  line-height: 1.2;
}

.dc-v em {
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  color: var(--ss-muted);
  margin-left: 3px;
}

.home-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
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

.head-tabs {
  margin-left: auto;
}

.tt-card :deep(.tt) {
  min-width: 0;
}

.subjects-section {
  margin-top: 2px;
}

.subject-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.subject-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px;
  border: 1px solid var(--ss-border);
  border-radius: 12px;
  background: var(--ss-surface);
  color: var(--ss-text);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.subject-card:hover {
  border-color: var(--ss-accent);
  transform: translateY(-1px);
}

.sc-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

.sc-name {
  font-size: 14px;
  font-weight: 650;
}

.sc-meta {
  font-size: 11px;
  color: var(--ss-muted);
}

@media (max-width: 900px) {
  .home-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .day-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
