<template>
  <div class="timetable-view">
    <div class="head">
      <div>
        <h2 class="title">课程表</h2>
        <p class="sub">
          <span v-if="data.timetable.meta.semester">{{ data.timetable.meta.semester }}</span>
          <span v-if="data.timetable.meta.student"> · {{ data.timetable.meta.student }}</span>
          <span> · 点格子编辑，留空即为空闲</span>
        </p>
      </div>
      <div class="head-actions">
        <button class="ss-btn" @click="openMeta">编辑信息</button>
      </div>
    </div>

    <div class="ss-card tt-card">
      <TimetableGrid
        :slots="data.timetable.slots"
        :blocks="data.timetable.blocks"
        :subjects="data.subjects"
        :days="7"
        editable
        @cell-click="openCell"
        @cell-menu="onCellMenu"
      />
    </div>

    <!-- 单格编辑 -->
    <el-dialog v-model="cellOpen" :title="cellTitle" width="460">
      <el-form label-width="62px" @submit.prevent>
        <el-form-item label="课程">
          <el-input v-model="editing.name" placeholder="课程名称" maxlength="60" />
        </el-form-item>
        <el-form-item label="学科">
          <el-select v-model="editing.subjectId" clearable placeholder="关联学科" style="width: 100%">
            <el-option v-for="s in data.subjects" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="地点">
          <el-input v-model="editing.room" placeholder="教学楼 / 教室" maxlength="40" />
        </el-form-item>
        <el-form-item label="教师">
          <el-input v-model="editing.teacher" placeholder="选填" maxlength="40" />
        </el-form-item>
        <el-form-item label="周次">
          <el-input v-model="editing.weeks" placeholder="如 1-16周" maxlength="30" />
        </el-form-item>
      </el-form>
      <p class="cell-hint">保存只提交这一格，不会覆盖别的设备上新增的课（§8.1）。</p>
      <template #footer>
        <el-button v-if="editing.rev" text type="danger" @click="clearCell">清空此格</el-button>
        <el-button @click="cellOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCell">保存</el-button>
      </template>
    </el-dialog>

    <!-- 课表元信息：节次设置与清空课表都收进这里，避免在外面误触 -->
    <el-dialog v-model="metaOpen" title="课表信息" width="560" @closed="clearConfirm = false">
      <el-form label-width="82px" @submit.prevent>
        <el-form-item label="学期">
          <el-input v-model="metaForm.semester" maxlength="60" />
        </el-form-item>
        <el-form-item label="称呼">
          <el-input v-model="metaForm.student" maxlength="60" />
        </el-form-item>
        <el-form-item label="开学日期">
          <el-date-picker v-model="metaForm.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>

      <div class="tt-blocks-zone">
        <div class="bz-head">
          <span class="dz-title">每天节次</span>
          <span class="bz-count">共 {{ blockDraft.length }} 节 · 最多 {{ MAX_BLOCKS }} 节</span>
        </div>
        <p class="dz-hint">
          可增删节次、改名称与时间。减少节数不会删除已排的课程，重新加回节数后会再次显示。
        </p>
        <div v-for="(b, i) in blockDraft" :key="i" class="bz-row">
          <span class="bz-no">{{ i + 1 }}</span>
          <el-input v-model="b.label" class="bz-label" placeholder="节次名称" maxlength="24" />
          <el-input v-model="b.time" class="bz-time" placeholder="时间，如 08:00-09:50" maxlength="40" />
          <button
            class="bz-del"
            type="button"
            title="删除这一节"
            :disabled="blockDraft.length <= 1"
            @click="removeBlock(i)"
          >
            删除
          </button>
        </div>
        <button class="bz-add" type="button" :disabled="blockDraft.length >= MAX_BLOCKS" @click="addBlock">
          增加一节
        </button>
      </div>

      <div class="tt-danger-zone">
        <div class="dz-title">清空整张课表</div>
        <p class="dz-hint">会删掉全部格子且无法撤销。请先勾选下方确认框。</p>
        <el-checkbox v-model="clearConfirm">
          我已确认要清空全部 {{ data.timetable.slots.length }} 节课
        </el-checkbox>
        <el-button
          class="dz-btn"
          type="danger"
          plain
          :disabled="!clearConfirm || !data.timetable.slots.length"
          @click="clearAll"
        >
          清空课表
        </el-button>
      </div>

      <template #footer>
        <el-button @click="metaOpen = false">取消</el-button>
        <el-button type="primary" @click="saveMeta">保存</el-button>
      </template>
    </el-dialog>

    <ContextMenu ref="ctx" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { BLOCKS, DAYS, MAX_BLOCKS } from "@starry/shared";
import type { TimetableBlock, TimetableSlot } from "@starry/shared";
import { useDataStore } from "@/stores/data";
import TimetableGrid from "@/components/TimetableGrid.vue";
import ContextMenu from "@/components/ContextMenu.vue";

interface CellPayload {
  day: number;
  block: number;
  slot: TimetableSlot | null;
}

const data = useDataStore();
// 节次以服务端下发的动态配置为准；没配置时回退默认表，MAX_BLOCKS 只兜住坏数据。
const blockList = computed<TimetableBlock[]>(() =>
  (data.timetable.blocks.length ? data.timetable.blocks : (BLOCKS as TimetableBlock[]))
    .filter((b) => b.index >= 1 && b.index <= MAX_BLOCKS),
);

function blockLabel(idx: number): string {
  return blockList.value.find((b) => b.index === idx)?.label ?? `第 ${idx} 节`;
}

const cellTitle = computed(() => `${DAYS[editing.day - 1]} · ${blockLabel(editing.block)}`);

const cellOpen = ref(false);
const saving = ref(false);
const editing = reactive({
  day: 1,
  block: 1,
  name: "",
  room: "",
  teacher: "",
  weeks: "",
  subjectId: "" as string,
  rev: 0,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = ref<any>(null);

function openCell({ day, block, slot }: CellPayload): void {
  editing.day = day;
  editing.block = block;
  editing.name = slot?.name ?? "";
  editing.room = slot?.room ?? "";
  editing.teacher = slot?.teacher ?? "";
  editing.weeks = slot?.weeks ?? "";
  editing.subjectId = slot?.subjectId ?? "";
  editing.rev = slot?.rev ?? 0;
  cellOpen.value = true;
}

/**
 * 只提交被改的这一格：body 里是单个 slot 对象，不是整张表。
 * 页面里的 slots 是打开时读到的快照，整份提交会把别的设备新增的格子冲掉（§8.1，验收 #4）。
 */
async function saveCell(): Promise<void> {
  const slot: Record<string, unknown> = {
    day: editing.day,
    block: editing.block,
    name: editing.name.trim(),
    room: editing.room.trim(),
    teacher: editing.teacher.trim(),
    weeks: editing.weeks.trim(),
    subjectId: editing.subjectId || null,
  };
  if (editing.rev) slot.rev = editing.rev;
  saving.value = true;
  try {
    const out = await data.saveSlot(slot, { ...editing });
    if (out.ok) cellOpen.value = false;
  } finally {
    saving.value = false;
  }
}

/** 全空字段 = 清空这一格；仍然只发一个 slot */
async function clearCell(): Promise<void> {
  const slot: Record<string, unknown> = {
    day: editing.day,
    block: editing.block,
    name: "",
    room: "",
    teacher: "",
    weeks: "",
    subjectId: null,
  };
  if (editing.rev) slot.rev = editing.rev;
  saving.value = true;
  try {
    const out = await data.saveSlot(slot, { day: editing.day, block: editing.block });
    if (out.ok) cellOpen.value = false;
  } finally {
    saving.value = false;
  }
}

function onCellMenu(e: MouseEvent, payload: CellPayload): void {
  const items: { key: string; label: string; danger?: boolean }[] = [
    { key: "edit", label: payload.slot ? "编辑此节" : "添加课程" },
  ];
  if (payload.slot) items.push({ key: "clear", label: "清空此格", danger: true });
  ctx.value?.open(e, items, (key: string) => {
    if (key === "edit") openCell(payload);
    else {
      editing.day = payload.day;
      editing.block = payload.block;
      editing.rev = payload.slot?.rev ?? 0;
      void clearCell();
    }
  });
}

async function clearAll(): Promise<void> {
  // 复选是硬门槛，再叠一次确认框：清空整张课表不可撤销，宁可多点一下。
  if (!clearConfirm.value) return;
  try {
    await ElMessageBox.confirm(
      `确定清空全部 ${data.timetable.slots.length} 节课？此操作无法撤销。`,
      "清空课表",
      { type: "warning", confirmButtonText: "清空", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  const ok = await data.clearTimetable();
  if (ok) {
    clearConfirm.value = false;
    metaOpen.value = false;
  }
}

/* ---------------- 课表元信息 ---------------- */
const metaOpen = ref(false);
const clearConfirm = ref(false);
const metaForm = reactive({ semester: "", student: "", startDate: "" });
// 节次只在弹窗里编辑草稿，点「保存」才整体提交；取消/关闭不会动服务端数据。
const blockDraft = reactive<TimetableBlock[]>([]);
let blockSnapshot = "";

function syncMeta(): void {
  const m = data.timetable.meta;
  metaForm.semester = m.semester ?? "";
  metaForm.student = m.student ?? "";
  metaForm.startDate = m.startDate ?? "";
}

/** 草稿统一成「序号连续 + 去掉首尾空格」的形状，提交与比对都用同一份。 */
function normalizeBlocks(): TimetableBlock[] {
  return blockDraft.map((b, i) => ({
    index: i + 1,
    label: b.label.trim(),
    time: b.time.trim(),
  }));
}

function syncBlocks(): void {
  const src = data.timetable.blocks.length ? data.timetable.blocks : (BLOCKS as TimetableBlock[]);
  blockDraft.splice(
    0,
    blockDraft.length,
    ...src.map((b) => ({ index: b.index, label: b.label, time: b.time })),
  );
  blockSnapshot = JSON.stringify(normalizeBlocks());
}

function addBlock(): void {
  if (blockDraft.length >= MAX_BLOCKS) return;
  const i = blockDraft.length + 1;
  blockDraft.push({ index: i, label: `第${i}节`, time: "" });
}

function removeBlock(i: number): void {
  if (blockDraft.length <= 1) return;
  blockDraft.splice(i, 1);
  blockDraft.forEach((b, idx) => {
    b.index = idx + 1;
  });
}

function openMeta(): void {
  clearConfirm.value = false;
  syncMeta();
  syncBlocks();
  metaOpen.value = true;
}

async function saveMeta(): Promise<void> {
  const metaOk = await data.saveMeta({
    semester: metaForm.semester.trim(),
    student: metaForm.student.trim(),
    startDate: metaForm.startDate || "",
  });
  // 节次没改就不发请求，避免每次保存元信息都无谓地覆盖一次单点配置。
  let blocksOk = true;
  const normalized = normalizeBlocks();
  if (JSON.stringify(normalized) !== blockSnapshot) {
    blocksOk = await data.saveBlocks(normalized);
  }
  if (metaOk && blocksOk) metaOpen.value = false;
}

onMounted(() => {
  syncMeta();
  void data.load("subjects");
  void data.refreshTimetable().catch(() => {});
});
</script>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.title {
  margin: 0 0 3px;
  font-size: 18px;
  font-weight: 650;
}

.sub {
  margin: 0;
  color: var(--ss-muted);
  font-size: 12.5px;
}

.tt-card {
  padding: 0;
  overflow: hidden;
}

.cell-hint {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--ss-dim);
}

.tt-blocks-zone {
  margin-top: 4px;
  padding: 12px 14px;
  border: 1px solid var(--ss-border);
  border-radius: 10px;
  background: var(--ss-surface-2);
}

.bz-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.bz-count {
  font-size: 11.5px;
  color: var(--ss-dim);
  white-space: nowrap;
}

.bz-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.bz-no {
  width: 20px;
  flex: none;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--ss-muted);
}

.bz-label {
  flex: 1 1 40%;
  min-width: 0;
}

.bz-time {
  flex: 1 1 46%;
  min-width: 0;
}

.bz-del,
.bz-add {
  flex: none;
  padding: 5px 10px;
  border: 1px solid var(--ss-border);
  border-radius: 8px;
  background: transparent;
  color: var(--ss-text);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.bz-del:hover:not(:disabled) {
  border-color: var(--ss-danger);
  color: var(--ss-danger);
}

.bz-add {
  margin-top: 10px;
}

.bz-add:hover:not(:disabled) {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
}

.bz-del:disabled,
.bz-add:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 520px) {
  .bz-row {
    flex-wrap: wrap;
  }
  .bz-label,
  .bz-time {
    flex: 1 1 100%;
  }
  .bz-del {
    margin-left: auto;
  }
}

.tt-danger-zone {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--ss-border);
  border-radius: 10px;
  background: var(--ss-surface-2);
}

.dz-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--ss-text);
}

.dz-hint {
  margin: 4px 0 10px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ss-muted);
}

.dz-btn {
  margin-top: 10px;
}
</style>
