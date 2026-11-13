<template>
  <div class="kw">
    <div class="kw-legend">
      <span>艾宾浩斯间隔</span>
      <span class="kw-steps">{{ REVIEW_INTERVALS.join(" / ") }} 天</span>
    </div>

    <div v-if="!items.length" class="ss-empty">还没有知识点</div>

    <div v-else class="kw-list">
      <div
        v-for="k in items"
        :key="k.id"
        class="kw-item"
        :class="{ due: isDue(k), mastered: k.mastered }"
        @contextmenu.prevent="onMenu($event, k)"
      >
        <div class="kw-top">
          <span class="kw-title">{{ k.title }}</span>
          <span class="kw-badge" :class="badgeClass(k)">{{ badgeText(k) }}</span>
        </div>
        <p v-if="k.content" class="kw-content">{{ k.content }}</p>
        <div class="kw-meta">
          <span>第 {{ k.stage }} 轮</span>
          <span v-if="k.nextReview">下次 {{ k.nextReview }}</span>
        </div>
        <div class="kw-actions">
          <button class="ss-btn primary" @click="review(k, 'review')">复习</button>
          <button class="ss-btn" @click="review(k, 'forgot')">忘了</button>
          <button class="ss-btn" @click="review(k, 'master')">掌握</button>
          <button class="ss-btn" @click="review(k, 'reset')">重置</button>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogOpen" :title="form.id ? '编辑知识点' : '新建知识点'" width="460">
      <el-form label-width="64px" @submit.prevent>
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="150" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="4" maxlength="3000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <ContextMenu ref="ctx" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { REVIEW_INTERVALS, todayInTZ } from "@starry/shared";
import type { Knowledge } from "@starry/shared";
import { useDataStore } from "@/stores/data";
import ContextMenu from "@/components/ContextMenu.vue";

const props = defineProps<{ subjectId: string }>();
const emit = defineEmits(["changed"]);
const data = useDataStore();

const items = computed(() =>
  data.knowledge
    .filter((k) => k.subjectId === props.subjectId)
    .sort((a, b) => String(a.nextReview ?? "").localeCompare(String(b.nextReview ?? ""))),
);

const dueCount = computed(() => items.value.filter(isDue).length);
const today = computed(() => todayInTZ());

function isDue(k: Knowledge): boolean {
  return !k.mastered && !!k.nextReview && k.nextReview <= today.value;
}

function badgeText(k: Knowledge): string {
  if (k.mastered) return "已掌握";
  if (!k.nextReview) return "未安排";
  if (k.nextReview <= today.value) return "今天复习";
  return "待复习";
}

function badgeClass(k: Knowledge): string {
  if (k.mastered) return "ok";
  if (isDue(k)) return "due";
  return "";
}

/* ---------- 复习动作 ----------
 * 间隔与 stage 由服务端按 REVIEW_INTERVALS 计算，前端只发 action（§8.10） */
async function review(k: Knowledge, action: "review" | "master" | "reset" | "forgot"): Promise<void> {
  const ok = await data.reviewKnowledge(k.id, action);
  if (ok) emit("changed");
}

/* ---------- 新建 / 编辑 / 删除 ---------- */
const dialogOpen = ref(false);
const saving = ref(false);
const form = reactive({ id: "", title: "", content: "" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = ref<any>(null);

function openCreate(): void {
  form.id = "";
  form.title = "";
  form.content = "";
  dialogOpen.value = true;
}

function openEdit(k: Knowledge): void {
  form.id = k.id;
  form.title = k.title;
  form.content = k.content;
  dialogOpen.value = true;
}

function onMenu(e: MouseEvent, k: Knowledge): void {
  ctx.value?.open(
    e,
    [
      { key: "edit", label: "编辑" },
      { key: "del", label: "删除", danger: true },
    ],
    (key: string) => (key === "edit" ? openEdit(k) : void remove(k)),
  );
}

async function remove(k: Knowledge): Promise<void> {
  const out = await data.remove("knowledge", k.id);
  if (out.ok) emit("changed");
}

async function submit(): Promise<void> {
  if (!form.title.trim()) return;
  saving.value = true;
  try {
    const out = form.id
      ? await data.update("knowledge", form.id, {
          title: form.title.trim(),
          content: form.content,
        })
      : await data.create("knowledge", {
          title: form.title.trim(),
          content: form.content,
          subjectId: props.subjectId,
        });
    if (out.ok) {
      dialogOpen.value = false;
      emit("changed");
    }
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void data.load("knowledge");
});

defineExpose({ openCreate, dueCount });
</script>

<style scoped>
.kw-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 11.5px;
  color: var(--ss-muted);
}

.kw-steps {
  color: var(--ss-accent);
}

.kw-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.kw-item {
  padding: 10px 11px;
  border: 1px solid var(--ss-border);
  border-radius: 10px;
  background: var(--ss-surface-2);
}

.kw-item.due {
  border-color: color-mix(in srgb, var(--ss-warn) 45%, transparent);
}

.kw-item.mastered {
  opacity: 0.7;
}

.kw-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.kw-title {
  font-size: 13.5px;
  font-weight: 650;
  line-height: 1.4;
  word-break: break-word;
}

.kw-badge {
  flex: none;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 6px;
  color: var(--ss-muted);
  background: var(--ss-surface-3);
}

.kw-badge.due {
  color: var(--ss-warn);
  background: color-mix(in srgb, var(--ss-warn) 14%, transparent);
}

.kw-badge.ok {
  color: var(--ss-ok);
  background: color-mix(in srgb, var(--ss-ok) 14%, transparent);
}

.kw-content {
  margin: 6px 0;
  font-size: 12.5px;
  color: var(--ss-text-2);
  white-space: pre-wrap;
  word-break: break-word;
}

.kw-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--ss-dim);
  margin-bottom: 8px;
}

.kw-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.kw-actions .ss-btn {
  height: 24px;
  padding: 0 8px;
  font-size: 11.5px;
}
</style>
