<template>
  <div ref="root" class="nb">
    <button
      ref="btn"
      class="nb-btn"
      :class="{ 'has-dot': dot }"
      :title="dot ? '有新的提醒' : '通知'"
      :aria-label="dotLabel"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="dialog"
      @click="onBtn"
    >
      <AppIcon name="bell" :size="15" />
      <i v-if="dot" class="nb-dot" />
    </button>

    <transition name="nb-pop">
      <div
        v-if="open"
        class="nb-panel"
        role="dialog"
        aria-label="通知"
        :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px', maxHeight: pos.maxH + 'px' }"
        @click.stop
      >
        <div class="nb-head">
          <span class="nb-title">通知</span>
          <span class="nb-count">
            <template v-if="snapTotal">共 {{ snapTotal }} 项<template v-if="snapNew"> · {{ snapNew }} 条新</template></template>
            <template v-else>暂无提醒</template>
          </span>
        </div>

        <div class="nb-body">
          <div v-if="!snapTotal" class="nb-empty">暂时没有日程和成绩</div>

          <section v-if="snap.urgent.length" class="nb-sec">
            <div class="nb-sec-h">
              <i class="nb-sec-dot is-urgent" />日程临期<b>{{ snap.urgent.length }}</b>
            </div>
            <button v-for="it in snap.urgent" :key="'u' + it.id" class="nb-item" @click="goSchedule">
              <span class="nb-item-t"><i v-if="it._isNew" class="nb-new" />{{ it.title }}</span>
              <span class="nb-item-m" :class="{ late: it._d < 0 }">{{ it._when }}</span>
            </button>
          </section>

          <section v-if="snap.tasks.length" class="nb-sec">
            <div class="nb-sec-h">
              <i class="nb-sec-dot is-new" />最近任务<b>{{ snap.tasks.length }}</b>
            </div>
            <button v-for="it in snap.tasks" :key="'t' + it.id" class="nb-item" @click="goSchedule">
              <span class="nb-item-t"><i v-if="it._isNew" class="nb-new" />{{ it.title }}</span>
              <span class="nb-item-m">{{ it._when }}</span>
            </button>
          </section>

          <section v-if="snap.grades.length" class="nb-sec">
            <div class="nb-sec-h">
              <i class="nb-sec-dot is-new" />最近成绩<b>{{ snap.grades.length }}</b>
            </div>
            <button v-for="g in snap.grades" :key="'g' + g.id" class="nb-item" @click="goGrade(g)">
              <span class="nb-item-t"><i v-if="g._isNew" class="nb-new" />{{ gradeTitle(g) }}</span>
              <span class="nb-item-m">{{ scoreText(g) }}</span>
            </button>
          </section>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  addDays,
  diffDays,
  NOTICE_RECENT_GRADES,
  NOTICE_RECENT_TASKS,
  NOTICE_STORAGE_KEY,
  nowIso,
  todayInTZ,
} from "@starry/shared";
import type { Grade, Subject, Task } from "@starry/shared";
import { useDataStore } from "@/stores/data";
import AppIcon from "@/components/AppIcon.vue";

const props = withDefaults(defineProps<{ subjects?: Subject[] }>(), { subjects: () => [] });

const route = useRoute();
const router = useRouter();
const data = useDataStore();

/* ---------------- 水位 ----------------
 * 结构 { taskIds, gradeIds, seenAt }。没有水位时全部算「新」：
 * 不能把启动时刻当水位，否则历史成绩永远不算新，用户会觉得铃铛坏了（§8.9）。 */
interface Water {
  taskIds: string[];
  gradeIds: string[];
  seenAt: string;
}

function readWater(): Water | null {
  try {
    const raw = localStorage.getItem(NOTICE_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Water>;
    if (!o || !Array.isArray(o.taskIds) || !Array.isArray(o.gradeIds)) return null;
    return {
      taskIds: o.taskIds.map(String),
      gradeIds: o.gradeIds.map(String),
      seenAt: String(o.seenAt ?? ""),
    };
  } catch {
    return null;
  }
}

const water = ref<Water | null>(readWater());
const seenTaskIds = computed(() => new Set(water.value?.taskIds ?? []));
const seenGradeIds = computed(() => new Set(water.value?.gradeIds ?? []));
const isNewTask = (id: string): boolean => !seenTaskIds.value.has(id);
const isNewGrade = (id: string): boolean => !seenGradeIds.value.has(id);

/* ---------------- 日期文案 ---------------- */
function whenText(it: Task, d: number): string {
  if (d < 0) return `逾期 ${-d} 天`;
  if (d === 0) return it.time ? `今天 ${it.time}` : "今天";
  if (d === 1) return it.time ? `明天 ${it.time}` : "明天";
  return `${d} 天后`;
}

/* ---------------- 三组数据 ---------------- */
type UrgentItem = Task & { _d: number; _when: string; _isNew: boolean };
type RecentTask = Task & { _d: number; _when: string; _isNew: boolean };
type RecentGrade = Grade & { _isNew: boolean };

const today = computed(() => todayInTZ());

/** 临期：未完成且 due <= 今天+1（含已逾期） */
const urgent = computed<UrgentItem[]>(() => {
  const limit = addDays(today.value, 1);
  return data.tasks
    .filter((t) => !t.done && t.due && t.due <= limit)
    .map((t) => {
      const d = diffDays(today.value, t.due);
      return { ...t, _d: d, _when: whenText(t, d), _isNew: isNewTask(t.id) };
    })
    .sort(
      (a, b) =>
        a._d - b._d || String(a.time ?? "").localeCompare(String(b.time ?? "")),
    );
});

const recentTasks = computed<RecentTask[]>(() => {
  const urgentSet = new Set(urgent.value.map((t) => t.id));
  return [...data.tasks]
    .filter((t) => !urgentSet.has(t.id))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, NOTICE_RECENT_TASKS)
    .map((t) => {
      const d = diffDays(today.value, t.due);
      return { ...t, _d: d, _when: whenText(t, d), _isNew: isNewTask(t.id) };
    });
});

const recentGrades = computed<RecentGrade[]>(() =>
  [...data.grades]
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, NOTICE_RECENT_GRADES)
    .map((g) => ({ ...g, _isNew: isNewGrade(g.id) })),
);

/* ---------------- 红点 ----------------
 * 只判「有没有新增的 id」，不比对集合指纹。
 * v1 用 ids.join(",") 做指纹：把一条临期任务标记完成后集合变短，指纹也变，
 * 明明没有新东西红点却又亮起来。改成「是否出现没见过的 id」后不会误亮。 */
const dot = computed(
  () =>
    data.tasks.some((t) => isNewTask(t.id)) || data.grades.some((g) => isNewGrade(g.id)),
);

const dotLabel = computed(() =>
  dot.value ? `通知：${urgent.value.length + recentTasks.value.length + recentGrades.value.length} 条提醒` : "通知",
);

/* ---------------- 面板 ---------------- */
const root = ref<HTMLElement | null>(null);
const btn = ref<HTMLElement | null>(null);
const open = ref(false);
const GAP = 6;
const pos = ref({ top: 0, left: 0, width: 318, maxH: 400 });

function placePanel(): void {
  const b = btn.value?.getBoundingClientRect();
  if (!b) return;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const width = Math.min(318, vw - GAP * 2);
  let left = b.right - width;
  if (left < GAP) left = vw - GAP - width;
  left = Math.max(GAP, left);
  const top = Math.round(b.bottom + 8);
  pos.value = {
    top,
    left: Math.round(left),
    width: Math.round(width),
    maxH: Math.max(180, vh - top - GAP),
  };
}

interface Snapshot {
  urgent: UrgentItem[];
  tasks: RecentTask[];
  grades: RecentGrade[];
}
/** 打开瞬间先拍快照：标记已读后红点会灭，但刚才那批内容要留着给人看 */
const snap = ref<Snapshot>({ urgent: [], tasks: [], grades: [] });
const snapTotal = computed(
  () => snap.value.urgent.length + snap.value.tasks.length + snap.value.grades.length,
);
const snapNew = computed(
  () =>
    snap.value.urgent.filter((x) => x._isNew).length +
    snap.value.tasks.filter((x) => x._isNew).length +
    snap.value.grades.filter((x) => x._isNew).length,
);

function markSeen(): void {
  const next: Water = {
    taskIds: data.tasks.map((t) => t.id),
    gradeIds: data.grades.map((g) => g.id),
    seenAt: nowIso(),
  };
  water.value = next;
  try {
    localStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存不下本次会话内仍然算已读
  }
  // 组件内包一层，模板里不直接引用 api（FE-02）
  void data.noticeSeen();
}

function openPanel(): void {
  snap.value = {
    urgent: urgent.value.map((x) => ({ ...x })),
    tasks: recentTasks.value.map((x) => ({ ...x })),
    grades: recentGrades.value.map((x) => ({ ...x })),
  };
  placePanel();
  open.value = true;
  markSeen();
}

function closePanel(): void {
  open.value = false;
}

function onBtn(): void {
  if (open.value) closePanel();
  else openPanel();
}

function onDocDown(e: MouseEvent): void {
  if (!open.value) return;
  if (root.value && root.value.contains(e.target as Node)) return;
  closePanel();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") closePanel();
}

function onWinChange(): void {
  if (open.value) placePanel();
}

function goSchedule(): void {
  closePanel();
  void router.push("/");
}

function goGrade(g: RecentGrade): void {
  closePanel();
  const sid = g.subjectId;
  const exists = sid && props.subjects.some((s) => s.id === sid);
  void router.push(exists ? `/subjects/${sid}` : "/");
}

function gradeTitle(g: Grade): string {
  const s = props.subjects.find((x) => x.id === g.subjectId);
  return s ? `${s.name} · ${g.name || "成绩"}` : g.name || "成绩";
}

function scoreText(g: Grade): string {
  if (g.score === null || g.score === undefined) return "未出分";
  return `${g.score}/${g.full || 100}`;
}

/* ---------------- 加载 ---------------- */
let timer: number | undefined;

async function refresh(force = false): Promise<void> {
  await Promise.allSettled([data.load("tasks", force), data.load("grades", force)]);
}

onMounted(() => {
  document.addEventListener("mousedown", onDocDown);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onWinChange);
  void refresh(true);
  timer = window.setInterval(() => void refresh(true), 60000);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocDown);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", onWinChange);
  if (timer) window.clearInterval(timer);
});

// 切页面顺手拉一次：学科页改完成绩，回到首页铃铛能立刻看到
watch(
  () => route.fullPath,
  () => void refresh(true),
);
</script>

<style scoped>
.nb {
  position: relative;
  display: flex;
}

.nb-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 9px;
  border-radius: 8px;
  border: 1px solid var(--ss-border);
  background: transparent;
  color: var(--ss-text);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  flex: none;
}

.nb-btn:hover {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
}

.nb-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ss-danger);
  box-shadow: 0 0 0 2px var(--ss-surface);
}

.nb-panel {
  position: fixed;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: var(--ss-surface);
  border: 1px solid var(--ss-border-strong);
  border-radius: 12px;
  box-shadow: var(--ss-shadow);
  overflow: hidden;
}

.nb-head {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 13px 9px;
  border-bottom: 1px solid var(--ss-border);
}

.nb-title {
  font-size: 13.5px;
  font-weight: 650;
}

.nb-count {
  font-size: 11.5px;
  color: var(--ss-dim);
}

.nb-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 5px 6px 8px;
}

.nb-empty {
  padding: 26px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--ss-dim);
}

.nb-sec + .nb-sec {
  margin-top: 3px;
}

.nb-sec-h {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 7px 5px;
  font-size: 11.5px;
  color: var(--ss-muted);
}

.nb-sec-h b {
  margin-left: -2px;
  font-weight: 600;
  color: var(--ss-text-2);
}

.nb-sec-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.nb-sec-dot.is-urgent {
  background: var(--ss-warn);
}

.nb-sec-dot.is-new {
  background: var(--ss-accent);
}

.nb-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ss-text-2);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.13s, color 0.13s;
}

.nb-item:hover {
  background: var(--ss-surface-2);
  color: var(--ss-text);
}

.nb-item-t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nb-new {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--ss-accent);
  vertical-align: middle;
}

.nb-item-m {
  flex: none;
  font-size: 11.5px;
  color: var(--ss-dim);
}

.nb-item-m.late {
  color: var(--ss-danger);
}

.nb-pop-enter-active,
.nb-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.nb-pop-enter-from,
.nb-pop-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}
</style>
