<template>
  <teleport to="body">
    <div v-if="visible" class="ctx-layer" @click="close" @contextmenu.prevent="close">
      <div class="ctx-menu" :style="pos">
        <button
          v-for="it in items"
          :key="it.key"
          class="ctx-item"
          :class="{ danger: it.danger }"
          @click.stop="pick(it)"
        >
          {{ it.label }}
        </button>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

interface CtxItem {
  key: string;
  label: string;
  danger?: boolean;
}

const visible = ref(false);
const items = ref<CtxItem[]>([]);
const x = ref(0);
const y = ref(0);
let onPick: ((key: string) => void) | null = null;

const pos = computed(() => {
  const w = 150;
  const h = items.value.length * 34 + 10;
  const px = Math.max(8, Math.min(x.value, window.innerWidth - w - 8));
  const py = Math.max(8, Math.min(y.value, window.innerHeight - h - 8));
  return { left: `${px}px`, top: `${py}px` };
});

function open(e: MouseEvent, list: CtxItem[], cb: (key: string) => void): void {
  e.preventDefault();
  e.stopPropagation();
  items.value = list;
  x.value = e.clientX;
  y.value = e.clientY;
  onPick = cb;
  visible.value = true;
  window.addEventListener("keydown", onKey);
}

function close(): void {
  visible.value = false;
  onPick = null;
  window.removeEventListener("keydown", onKey);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

function pick(it: CtxItem): void {
  const cb = onPick;
  close();
  cb?.(it.key);
}

onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

defineExpose({ open, close });
</script>

<style>
.ctx-layer {
  position: fixed;
  inset: 0;
  z-index: 3000;
}

.ctx-menu {
  position: fixed;
  min-width: 136px;
  padding: 5px;
  border-radius: 10px;
  background: var(--el-bg-color-overlay, #202a2f);
  border: 1px solid var(--ss-border-strong);
  box-shadow: var(--ss-shadow);
}

.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ss-text);
  font-size: 13.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s;
}

.ctx-item:hover {
  background: var(--ss-surface-3);
  color: var(--ss-accent);
}

.ctx-item.danger {
  color: var(--ss-danger);
}

.ctx-item.danger:hover {
  background: color-mix(in srgb, var(--ss-danger) 14%, transparent);
  color: var(--ss-danger);
}
</style>
