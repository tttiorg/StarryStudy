<template>
  <div class="carousel">
    <button class="nav" :disabled="atStart" title="上一页" @click="scroll(-1)">
      <AppIcon name="chevronLeft" :size="16" />
    </button>

    <div ref="track" class="track" @scroll="onScroll">
      <div
        v-for="n in notes"
        :key="n.id"
        class="note-card"
        @click="$emit('open', n)"
        @contextmenu.prevent="$emit('menu', $event, n)"
      >
        <div class="nc-head">
          <span class="nc-title" :title="n.title">{{ n.title || "无标题" }}</span>
          <button class="nc-add" title="加入复习队列" @click.stop="$emit('review', n)">
            <AppIcon name="plus" :size="12" />
          </button>
        </div>
        <div class="nc-body">{{ preview(n.content) }}</div>
        <div class="nc-foot">{{ formatStamp(n.updatedAt) }}</div>
      </div>

      <div class="note-card new-card" @click="$emit('create')">
        <AppIcon name="plus" :size="22" />
        <span class="nc-tip">新建笔记</span>
      </div>
    </div>

    <button class="nav" :disabled="atEnd" title="下一页" @click="scroll(1)">
      <AppIcon name="chevronRight" :size="16" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Note } from "@starry/shared";
import AppIcon from "@/components/AppIcon.vue";

const props = withDefaults(defineProps<{ notes?: Note[] }>(), { notes: () => [] });
defineEmits(["open", "create", "review", "menu"]);

const track = ref<HTMLElement | null>(null);
const atStart = ref(true);
const atEnd = ref(false);

function updateState(): void {
  const el = track.value;
  if (!el) return;
  atStart.value = el.scrollLeft <= 2;
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
}

function scroll(dir: number): void {
  const el = track.value;
  if (!el) return;
  el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  window.setTimeout(updateState, 320);
}

function onScroll(): void {
  updateState();
}

function preview(t: string): string {
  return (t || "").replace(/\s+/g, " ").slice(0, 80) || "（空）";
}

/** 只做字符串切片，不引入本地时区偏移 */
function formatStamp(iso: string): string {
  if (!iso || iso.length < 16) return "";
  return `${iso.slice(5, 7)}-${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

let ro: ResizeObserver | null = null;

onMounted(async () => {
  await nextTick();
  updateState();
  if (window.ResizeObserver && track.value) {
    ro = new ResizeObserver(updateState);
    ro.observe(track.value);
  }
});

/**
 * notes 是异步拉回来的：数据到位后容器宽度没变，ResizeObserver 不会触发，
 * 翻页按钮会永远停在 disabled（FE-04）。所以列表长度变化后必须重算一次。
 */
watch(
  () => props.notes.length,
  async () => {
    await nextTick();
    updateState();
  },
);

onBeforeUnmount(() => ro?.disconnect());
</script>

<style scoped>
.carousel {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav {
  flex: none;
  width: 26px;
  height: 62px;
  border-radius: 9px;
  border: 1px solid var(--ss-border);
  background: var(--ss-surface-2);
  color: var(--ss-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.15s;
}

.nav:hover:not(:disabled) {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
}

.nav:disabled {
  opacity: 0.28;
  cursor: default;
}

.track {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-behavior: smooth;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.track::-webkit-scrollbar {
  display: none;
}

.note-card {
  flex: none;
  width: 238px;
  height: 148px;
  padding: 13px 15px;
  border-radius: 12px;
  background: var(--ss-surface-2);
  border: 1px solid var(--ss-border);
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: all 0.16s;
  overflow: hidden;
}

.note-card:hover {
  border-color: var(--ss-accent);
  background: var(--ss-surface-3);
  transform: translateY(-1px);
}

.nc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}

.nc-title {
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.nc-add {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1px solid var(--ss-border);
  background: transparent;
  color: var(--ss-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.nc-add:hover {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
  background: var(--ss-accent-soft);
}

.nc-body {
  flex: 1;
  margin-top: 7px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ss-muted);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.nc-foot {
  font-size: 11px;
  color: var(--ss-dim);
}

.new-card {
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  border-color: var(--ss-border-strong);
  background: transparent;
  color: var(--ss-muted);
}

.new-card:hover {
  color: var(--ss-accent);
  border-color: var(--ss-accent);
}

.nc-tip {
  font-size: 12.5px;
}
</style>
