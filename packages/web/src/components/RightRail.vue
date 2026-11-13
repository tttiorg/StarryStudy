<template>
  <aside class="rail">
    <div class="rail-list">
      <a
        v-for="(l, i) in data.links"
        :key="l.id"
        :href="l.url"
        target="_blank"
        rel="noopener"
        class="rail-item"
        :class="{ dragging: dragIdx === i, 'drop-on': overIdx === i && dragIdx !== i }"
        :title="`${l.name}\n${l.url}\n（拖动可排序，右键可编辑）`"
        draggable="true"
        @dragstart="onDragStart(i, $event)"
        @dragover.prevent="onDragOver(i)"
        @dragleave="onDragLeave(i)"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
        @click="onClick"
        @contextmenu.prevent="onMenu($event, l)"
      >
        <span class="rail-icon">
          <img
            v-if="iconUrl(l) && !broken[l.id]"
            :src="iconUrl(l)"
            alt=""
            referrerpolicy="no-referrer"
            @error="broken[l.id] = true"
          />
          <span v-else class="rail-fallback" :style="{ background: fallbackColor(l) }">
            {{ l.name.slice(0, 1) }}
          </span>
        </span>
        <span class="rail-name">{{ l.name }}</span>
      </a>
    </div>

    <button class="rail-add" title="添加外链" @click="openAdd">
      <AppIcon name="plus" :size="16" />
    </button>

    <el-dialog v-model="dialogOpen" :title="form.id ? '编辑外链' : '添加外链'" width="420">
      <el-form label-width="56px" @submit.prevent>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="例如：资料站" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="网址">
          <el-input v-model="form.url" placeholder="https://..." @keyup.enter="submit" />
        </el-form-item>
      </el-form>
      <p class="rail-tip">图标优先取站点根目录，抓不到时显示名称首字色块。</p>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">
          {{ form.id ? "保存" : "添加" }}
        </el-button>
      </template>
    </el-dialog>

    <ContextMenu ref="ctx" />
  </aside>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { Link } from "@starry/shared";
import { useDataStore } from "@/stores/data";
import AppIcon from "@/components/AppIcon.vue";
import ContextMenu from "@/components/ContextMenu.vue";

const data = useDataStore();

const broken = reactive<Record<string, boolean>>({});
const dialogOpen = ref(false);
const saving = ref(false);
const form = reactive({ id: "", name: "", url: "" });
// 模板 ref 用 any 兜住 defineExpose 的实例类型，避免各编译器版本差异
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = ref<any>(null);

/** 没有自定义图标时试站点根目录的 favicon；失败由 @error 回落到首字色块 */
function iconUrl(l: Link): string {
  if (l.icon) return l.icon;
  try {
    return new URL(l.url).origin + "/favicon.ico";
  } catch {
    return "";
  }
}

/** 用名称生成一个稳定的色相，避免所有首字块都是一个颜色 */
function fallbackColor(l: Link): string {
  let h = 0;
  for (const ch of l.name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 42% 42%)`;
}

function openAdd(): void {
  form.id = "";
  form.name = "";
  form.url = "";
  dialogOpen.value = true;
}

function openEdit(l: Link): void {
  form.id = l.id;
  form.name = l.name;
  form.url = l.url;
  dialogOpen.value = true;
}

function onMenu(e: MouseEvent, l: Link): void {
  ctx.value?.open(
    e,
    [
      { key: "edit", label: "编辑" },
      { key: "del", label: "删除", danger: true },
    ],
    (k: string) => (k === "edit" ? openEdit(l) : void askRemove(l)),
  );
}

/* ---------- 拖动排序 ---------- */
const dragIdx = ref(-1);
const overIdx = ref(-1);
let justDragged = false;

function onDragStart(i: number, e: DragEvent): void {
  dragIdx.value = i;
  justDragged = false;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onDragOver(i: number): void {
  overIdx.value = i;
}

function onDragLeave(i: number): void {
  if (overIdx.value === i) overIdx.value = -1;
}

async function onDrop(i: number): Promise<void> {
  const from = dragIdx.value;
  dragIdx.value = -1;
  overIdx.value = -1;
  if (from < 0 || from === i) return;

  justDragged = true;
  const list = [...data.links];
  const [moved] = list.splice(from, 1);
  list.splice(i, 0, moved);
  data.links = list;
  const ok = await data.reorderLinks(list.map((l) => l.id));
  if (!ok) await data.load("links", true);
  window.setTimeout(() => {
    justDragged = false;
  }, 50);
}

function onDragEnd(): void {
  dragIdx.value = -1;
  overIdx.value = -1;
}

/** 拖完手一松会紧接触发 click，挡掉避免误开网页 */
function onClick(e: MouseEvent): void {
  if (justDragged) e.preventDefault();
}

async function submit(): Promise<void> {
  const name = form.name.trim();
  const url = form.url.trim();
  if (!name || !url) {
    ElMessage.warning("名称和网址都要填");
    return;
  }
  saving.value = true;
  try {
    const out = form.id
      ? await data.update("links", form.id, { name, url })
      : await data.create("links", { name, url });
    if (out.ok) {
      dialogOpen.value = false;
      ElMessage.success(form.id ? "已保存" : "已添加");
    }
  } finally {
    saving.value = false;
  }
}

async function askRemove(l: Link): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除外链「${l.name}」？`, "删除", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  const out = await data.remove("links", l.id);
  if (out.ok) ElMessage.success("已删除");
}

onMounted(() => {
  void data.load("links");
});
</script>

<style scoped>
.rail {
  width: 74px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0 12px;
  gap: 6px;
  background: var(--ss-surface);
  border-left: 1px solid var(--ss-border);
  overflow: hidden;
}

.rail-list {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  overflow-y: auto;
  scrollbar-width: none;
}

.rail-list::-webkit-scrollbar {
  display: none;
}

.rail-item {
  width: 60px;
  padding: 8px 2px 7px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  color: var(--ss-muted);
  transition: all 0.15s;
  border: 1px solid transparent;
  flex: none;
}

.rail-item:hover {
  background: var(--ss-surface-2);
  color: var(--ss-text);
  border-color: var(--ss-border);
}

.rail-item.dragging {
  opacity: 0.35;
}

.rail-item.drop-on {
  border-color: var(--ss-accent);
  background: var(--ss-accent-soft);
  box-shadow: 0 -2px 0 var(--ss-accent);
}

.rail-icon {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  overflow: hidden;
}

.rail-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.rail-fallback {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: #fff;
  font-size: 11px;
  display: grid;
  place-items: center;
}

.rail-name {
  font-size: 11px;
  line-height: 1.2;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-add {
  width: 46px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  border: 1px dashed var(--ss-border-strong);
  background: transparent;
  color: var(--ss-muted);
  cursor: pointer;
  transition: all 0.15s;
  display: grid;
  place-items: center;
}

.rail-add:hover {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
  background: var(--ss-accent-soft);
}

.rail-tip {
  margin: 0;
  font-size: 12px;
  color: var(--ss-muted);
}

@media (max-width: 900px) {
  .rail {
    display: none;
  }
}
</style>
