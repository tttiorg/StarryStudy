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
        <button class="ss-btn" @click="metaOpen = true">编辑信息</button>
        <button v-if="data.timetable.slots.length" class="ss-btn danger" @click="clearAll">清空课表</button>
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

    <!-- 课表元信息 -->
    <el-dialog v-model="metaOpen" title="课表信息" width="440">
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
import { BLOCKS, DAYS } from "@starry/shared";
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
const blockList = computed<TimetableBlock[]>(() =>
  data.timetable.blocks.length ? data.timetable.blocks : (BLOCKS as TimetableBlock[]),
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
  try {
    await ElMessageBox.confirm("确定清空整张课表？", "清空课表", { type: "warning" });
  } catch {
    return;
  }
  await data.clearTimetable();
}

/* ---------------- 课表元信息 ---------------- */
const metaOpen = ref(false);
const metaForm = reactive({ semester: "", student: "", startDate: "" });

function syncMeta(): void {
  const m = data.timetable.meta;
  metaForm.semester = m.semester ?? "";
  metaForm.student = m.student ?? "";
  metaForm.startDate = m.startDate ?? "";
}

async function saveMeta(): Promise<void> {
  const ok = await data.saveMeta({
    semester: metaForm.semester.trim(),
    student: metaForm.student.trim(),
    startDate: metaForm.startDate || "",
  });
  if (ok) metaOpen.value = false;
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
</style>
