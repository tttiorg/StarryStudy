<template>
  <el-dialog
    :model-value="visible"
    title="这条已在别处修改"
    width="660"
    :close-on-click-modal="false"
    @close="onClose"
  >
    <p class="cd-hint">
      同一条记录在另一台设备上被改过。下面是两份内容，请选择保留哪一份；不会自动合并，也不会静默覆盖。
    </p>

    <div class="cd-grid">
      <div class="cd-side">
        <div class="cd-side-h mine">我的修改</div>
        <div class="cd-rows">
          <div v-for="r in rows" :key="r.key" class="cd-row" :class="{ diff: r.diff }">
            <span class="cd-k">{{ r.label }}</span>
            <span class="cd-v">{{ r.mine }}</span>
          </div>
        </div>
      </div>
      <div class="cd-side">
        <div class="cd-side-h server">服务器上的版本</div>
        <div class="cd-rows">
          <div v-for="r in rows" :key="r.key" class="cd-row" :class="{ diff: r.diff }">
            <span class="cd-k">{{ r.label }}</span>
            <span class="cd-v">{{ r.server }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="choose('cancel')">取消</el-button>
      <el-button @click="choose('server')">使用服务器版本</el-button>
      <el-button type="primary" @click="choose('mine')">保留我的并覆盖</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useUiStore } from "@/stores/ui";
import type { ConflictChoice } from "@/stores/ui";

const ui = useUiStore();
const visible = computed(() => ui.conflict !== null);

const LABELS: Record<string, string> = {
  name: "名称",
  title: "标题",
  content: "正文",
  note: "备注",
  due: "截止日期",
  time: "时刻",
  type: "类型",
  place: "地点",
  done: "已完成",
  doneManual: "手动标记",
  score: "分数",
  full: "满分",
  weight: "权重",
  date: "日期",
  color: "颜色",
  sort: "顺序",
  subjectId: "学科",
  stage: "复习轮次",
  nextReview: "下次复习",
  mastered: "已掌握",
  url: "网址",
  icon: "图标",
  pinned: "置顶",
  tags: "标签",
  category: "分类",
  localOnly: "仅电脑可用",
  day: "星期",
  block: "节次",
  room: "教室",
  teacher: "教师",
  weeks: "周次",
  action: "本次操作",
  semester: "学期",
  student: "称呼",
  startDate: "开学日期",
};

const SKIP = new Set([
  "id",
  "rev",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "srcKey",
  "objectKey",
  "sha256",
  "size",
  "mime",
  "src",
  "log",
]);

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "（空）";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (Array.isArray(v)) return v.length ? v.join("、") : "（空）";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface DiffRow {
  key: string;
  label: string;
  mine: string;
  server: string;
  diff: boolean;
}

const rows = computed<DiffRow[]>(() => {
  const c = ui.conflict;
  if (!c) return [];
  const keys = new Set([...Object.keys(c.local), ...Object.keys(c.server)]);
  const out: DiffRow[] = [];
  for (const key of keys) {
    if (SKIP.has(key)) continue;
    const a = fmt(c.local[key]);
    const b = fmt(c.server[key]);
    out.push({ key, label: LABELS[key] ?? key, mine: a, server: b, diff: a !== b });
  }
  return out.sort((x, y) => Number(y.diff) - Number(x.diff));
});

function choose(choice: ConflictChoice): void {
  ui.settleConflict(choice);
}

function onClose(): void {
  // 点右上角关闭等同于「取消」；settleConflict 内部会处理已为空的情况
  if (ui.conflict) ui.settleConflict("cancel");
}
</script>

<style scoped>
.cd-hint {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ss-muted);
  line-height: 1.7;
}

.cd-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.cd-side {
  border: 1px solid var(--ss-border);
  border-radius: 10px;
  overflow: hidden;
  min-width: 0;
}

.cd-side-h {
  padding: 7px 11px;
  font-size: 12.5px;
  font-weight: 650;
  border-bottom: 1px solid var(--ss-border);
  background: var(--ss-surface-2);
}

.cd-side-h.mine {
  color: var(--ss-accent);
}

.cd-side-h.server {
  color: var(--ss-warn);
}

.cd-rows {
  max-height: 320px;
  overflow-y: auto;
}

.cd-row {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ss-border);
  font-size: 12px;
}

.cd-row.diff {
  background: color-mix(in srgb, var(--ss-warn) 10%, transparent);
}

.cd-k {
  flex: none;
  width: 76px;
  color: var(--ss-muted);
}

.cd-v {
  min-width: 0;
  word-break: break-all;
  color: var(--ss-text-2);
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .cd-grid {
    grid-template-columns: 1fr;
  }
}
</style>
