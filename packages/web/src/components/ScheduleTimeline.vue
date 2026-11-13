<template>
  <div class="timeline">
    <div v-if="!groups.length" class="ss-empty">{{ emptyText }}</div>

    <div v-for="g in groups" :key="g.date" class="tl-group">
      <div class="tl-date">
        <span class="tl-dot" :class="{ today: g.date === todayStr }" />
        <span class="tl-label">{{ dateLabel(g.date) }}</span>
        <span class="tl-count">{{ g.list.length }}</span>
      </div>
      <div class="tl-items">
        <div
          v-for="it in g.list"
          :key="it.id"
          class="tl-item"
          :class="[it.type, { done: it.done, late: !it.done && isLate(it) }]"
          @click="$emit('edit', it)"
          @contextmenu.prevent="$emit('menu', $event, it)"
        >
          <div class="ti-main">
            <div class="ti-title">
              <span class="ti-tag">{{ typeLabel(it.type) }}</span>
              {{ it.title }}
            </div>
            <div class="ti-meta">
              <span v-if="it.time" class="ti-time">{{ it.time }}</span>
              <span class="ti-left" :class="{ 'is-urgent': isUrgent(it) }">{{ remainText(it) }}</span>
              <span v-if="it.subjectId" class="ti-subject">{{ subjectName(it.subjectId) }}</span>
            </div>
          </div>
          <button
            class="ti-check"
            :class="{ on: it.done }"
            :title="it.done ? '标记未完成' : '标记完成'"
            @click.stop="$emit('toggle', it)"
          >
            <AppIcon name="check" :size="13" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="overdue.length" class="tl-overdue">
      <span>已逾期 {{ overdue.length }} 项</span>
      <button class="link-btn" @click="$emit('show-overdue')">去看</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { diffDays, todayInTZ } from "@starry/shared";
import type { Subject, Task, TaskType } from "@starry/shared";
import AppIcon from "@/components/AppIcon.vue";

interface Group {
  date: string;
  list: Task[];
}

const props = withDefaults(
  defineProps<{
    groups?: Group[];
    overdue?: Task[];
    subjects?: Subject[];
    emptyText?: string;
  }>(),
  {
    groups: () => [],
    overdue: () => [],
    subjects: () => [],
    emptyText: "还没有日程",
  },
);

defineEmits(["toggle", "edit", "menu", "show-overdue"]);

const todayStr = computed(() => todayInTZ());

const TYPE_LABEL: Record<TaskType, string> = {
  assignment: "作业",
  exam: "考试",
  project: "项目",
  activity: "活动",
  task: "待办",
};

function typeLabel(t: TaskType): string {
  return TYPE_LABEL[t] ?? "待办";
}

function dayOf(dateStr: string): number {
  return diffDays(todayStr.value, dateStr);
}

function dateLabel(dateStr: string): string {
  const d = dayOf(dateStr);
  if (d === 0) return "今天";
  if (d === 1) return "明天";
  if (d === 2) return "后天";
  if (d === -1) return "昨天";
  return `${dateStr.slice(5, 7)}月${dateStr.slice(8, 10)}日`;
}

function remainText(it: Task): string {
  const d = dayOf(it.due);
  if (it.done) return "已完成";
  if (d < 0) return `逾期 ${-d} 天`;
  if (d === 0) return "今天截止";
  if (d === 1) return "还剩 1 天";
  return `还剩 ${d} 天`;
}

function isLate(it: Task): boolean {
  return dayOf(it.due) < 0;
}

function isUrgent(it: Task): boolean {
  return !it.done && dayOf(it.due) <= 1;
}

function subjectName(id: string): string {
  return props.subjects.find((s) => s.id === id)?.name ?? "";
}
</script>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tl-group {
  position: relative;
  padding-left: 16px;
}

.tl-group::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 12px;
  bottom: 0;
  width: 1px;
  background: var(--ss-border);
}

.tl-date {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
  font-size: 12.5px;
  color: var(--ss-muted);
}

.tl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ss-surface-3);
  flex: none;
}

.tl-dot.today {
  background: var(--ss-accent);
}

.tl-label {
  font-weight: 600;
  color: var(--ss-text-2);
}

.tl-count {
  font-size: 11px;
  color: var(--ss-dim);
}

.tl-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tl-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid var(--ss-border);
  background: var(--ss-surface-2);
  cursor: pointer;
  transition: all 0.15s;
}

.tl-item:hover {
  border-color: var(--ss-accent);
}

.tl-item.late {
  border-color: color-mix(in srgb, var(--ss-danger) 35%, transparent);
}

.tl-item.done {
  opacity: 0.62;
}

.tl-item.done .ti-title {
  text-decoration: line-through;
}

.ti-main {
  flex: 1;
  min-width: 0;
}

.ti-title {
  font-size: 13.5px;
  color: var(--ss-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ti-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 10.5px;
  color: var(--ss-accent);
  background: var(--ss-accent-soft);
  vertical-align: 1px;
}

.ti-meta {
  display: flex;
  gap: 10px;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ss-dim);
}

.ti-left.is-urgent {
  color: var(--ss-warn);
}

.ti-check {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--ss-border);
  background: transparent;
  color: var(--ss-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.ti-check:hover {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
}

.ti-check.on {
  color: var(--ss-ok);
  border-color: color-mix(in srgb, var(--ss-ok) 45%, transparent);
}

.tl-overdue {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 11px;
  border-radius: 9px;
  font-size: 12px;
  color: var(--ss-danger);
  background: color-mix(in srgb, var(--ss-danger) 10%, transparent);
}

.link-btn {
  border: none;
  background: transparent;
  color: var(--ss-accent);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
</style>
