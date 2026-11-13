<template>
  <div v-if="!subject" class="missing">
    <p>没有找到这个学科</p>
    <router-link class="ss-btn primary" to="/">回到主页</router-link>
  </div>

  <div v-else class="subject-page">
    <!-- 顶部：学科信息与备注 -->
    <header class="s-top">
      <div class="s-title-row">
        <span class="s-dot" :style="{ background: subject.color }" />
        <h1 class="s-name">{{ subject.name }}</h1>
        <button class="ss-btn" @click="openSubjectEdit">
          <AppIcon name="edit" :size="13" /> 编辑信息
        </button>
      </div>

      <div class="s-meta">
        <div class="s-when">{{ whenText || "课表里还没有这门课的时间" }}</div>
        <div class="s-tags">
          <span v-if="subject.course?.room" class="ss-tag">{{ subject.course.room }}</span>
          <span v-if="subject.course?.weeks" class="ss-tag">{{ subject.course.weeks }}</span>
          <span v-if="subject.course?.classCode" class="ss-tag">{{ subject.course.classCode }}</span>
          <span v-if="subject.course?.fullName" class="ss-tag">{{ subject.course.fullName }}</span>
          <a
            v-if="subject.course?.homepage"
            class="ss-tag accent"
            :href="subject.course.homepage"
            target="_blank"
            rel="noopener"
          >
            <AppIcon name="external" :size="12" /> 课程主页
          </a>
        </div>
        <p v-if="subject.note" class="s-note">{{ subject.note }}</p>
        <div v-if="subject.faculty" class="s-faculty">
          <span>{{ subject.faculty.name }}</span>
          <span v-if="subject.faculty.title">{{ subject.faculty.title }}</span>
          <span v-if="subject.faculty.dept">{{ subject.faculty.dept }}</span>
        </div>
      </div>
    </header>

    <!-- 三列：成绩 | 知识点+笔记 | 任务+资料 -->
    <div class="grid3">
      <!-- 左：成绩 -->
      <div class="col">
        <section class="panel">
          <header class="panel-head">
            <span class="ss-panel-title">成绩</span>
            <span class="ss-panel-sub">共 {{ sortedGrades.length }} 条 · {{ avgText }}</span>
            <button class="ss-add" title="添加成绩" @click="openGrade()">
              <AppIcon name="plus" :size="14" />
            </button>
          </header>
          <div class="panel-body">
            <div v-if="!sortedGrades.length" class="ss-empty">还没有成绩记录</div>
            <template v-else>
              <div class="grade-total">
                <div class="gt-main">
                  <span class="gt-label">总分</span>
                  <span class="gt-value">{{ totalScore }}<em>/{{ totalFull }}</em></span>
                </div>
                <span class="gt-rate" :class="rateClass">{{ rateText }}</span>
                <span class="gt-count">{{ scoredCount }} 项已评分</span>
              </div>
              <div class="grade-list">
                <div
                  v-for="g in sortedGrades"
                  :key="g.id"
                  class="grade-row"
                  @click="openGrade(g)"
                  @contextmenu.prevent="onGradeMenu($event, g)"
                >
                  <span class="g-name">{{ g.name }}</span>
                  <span v-if="g.note" class="g-extra">{{ g.note }}</span>
                  <span class="g-score" :class="scoreClass(g)">
                    {{ g.score ?? "-" }}<em>/{{ g.full }}</em>
                  </span>
                  <span class="g-weight">{{ g.weight ? `${g.weight}%` : "" }}</span>
                </div>
              </div>
            </template>
          </div>
        </section>
      </div>

      <!-- 中：知识点 + 笔记 -->
      <div class="col">
        <section class="panel">
          <header class="panel-head">
            <span class="ss-panel-title">待解决知识点</span>
            <span v-if="dueCount" class="ss-tag warn">{{ dueCount }} 个待复习</span>
            <button class="ss-add" title="添加知识点" @click="kwRef?.openCreate()">
              <AppIcon name="plus" :size="14" />
            </button>
          </header>
          <div class="panel-body">
            <KnowledgePanel ref="kwRef" :subject-id="id" @changed="onKwChanged" />
          </div>
        </section>

        <section class="panel">
          <header class="panel-head">
            <span class="ss-panel-title">笔记</span>
            <span class="ss-panel-sub">共 {{ notes.length }} 条</span>
            <button class="ss-add" title="新建笔记" @click="openNote()">
              <AppIcon name="plus" :size="14" />
            </button>
          </header>
          <div class="panel-body notes-body">
            <NotesCarousel
              :notes="notes"
              @open="openNote"
              @create="openNote()"
              @review="noteToReview"
              @menu="onNoteMenu"
            />
          </div>
        </section>
      </div>

      <!-- 右：任务 + 资料 -->
      <div class="col">
        <section class="panel">
          <header class="panel-head">
            <span class="ss-panel-title">任务</span>
            <span class="ss-panel-sub">共 {{ tasks.length }} 项</span>
            <button class="ss-add" title="添加任务" @click="openTask()">
              <AppIcon name="plus" :size="14" />
            </button>
          </header>
          <div class="panel-body">
            <div class="ss-tabs task-tabs">
              <button :class="{ on: taskTab === 'open' }" @click="taskTab = 'open'">
                未完成 <b v-if="openTasks.length">{{ openTasks.length }}</b>
              </button>
              <button :class="{ on: taskTab === 'done' }" @click="taskTab = 'done'">
                已完成 {{ doneTasks.length }}
              </button>
            </div>
            <div v-if="!shownTasks.length" class="ss-empty">
              {{ taskTab === "done" ? "还没有已完成的任务" : "没有未完成的任务" }}
            </div>
            <div v-else class="task-list">
              <div
                v-for="w in shownTasks"
                :key="w.id"
                class="task-row"
                :class="{ done: w.done }"
                @contextmenu.prevent="onTaskMenu($event, w)"
              >
                <div class="t-main" @click="openTask(w)">
                  <div class="t-title">{{ w.title }}</div>
                  <div v-if="w.note" class="t-note">{{ w.note }}</div>
                </div>
                <span class="t-due">{{ shortDate(w.due) }}</span>
                <button class="t-check" :title="w.done ? '标记未完成' : '标记完成'" @click="toggleTask(w)">
                  <AppIcon name="check" :size="12" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel-head">
            <span class="ss-panel-title">资料</span>
            <span class="ss-panel-sub">共 {{ files.length }} 个</span>
            <div class="panel-actions">
              <button class="ss-btn" :disabled="uploading" @click="onUploadClick">
                <AppIcon name="upload" :size="13" /> {{ uploading ? "上传中…" : "上传" }}
              </button>
            </div>
          </header>
          <div class="panel-body">
            <div class="ss-tabs file-tabs">
              <button :class="{ on: fileTab === 'all' }" @click="fileTab = 'all'">全部 {{ files.length }}</button>
              <button :class="{ on: fileTab === 'material' }" @click="fileTab = 'material'">资料</button>
              <button :class="{ on: fileTab === 'knowledge' }" @click="fileTab = 'knowledge'">知识点</button>
            </div>
            <input ref="fileInput" type="file" multiple hidden @change="onFilesPicked" />
            <div v-if="!shownFiles.length" class="ss-empty">点右上角「上传」添加资料</div>
            <div v-else class="file-grid">
              <div
                v-for="f in shownFiles"
                :key="f.id"
                class="file-card"
                :class="{ pinned: f.pinned, local: f.localOnly }"
                @click="openFile(f)"
                @contextmenu.prevent="onFileMenu($event, f)"
              >
                <button
                  class="pin-btn"
                  :class="{ on: f.pinned }"
                  :title="f.pinned ? '取消置顶' : '置顶'"
                  @click.stop="togglePin(f)"
                >
                  <AppIcon name="pin" :size="12" />
                </button>
                <div class="fc-icon" :style="{ background: iconColor(f) }">{{ extOf(f) }}</div>
                <div class="fc-name" :title="f.name">{{ f.name }}</div>
                <div class="fc-meta">{{ fmtSize(f.size) }}</div>
                <div v-if="tagsOf(f).length" class="fc-tags">
                  <span v-for="t in tagsOf(f)" :key="t" class="ss-tag">{{ t }}</span>
                </div>
                <div v-if="f.localOnly" class="fc-local">仅电脑可用</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 学科信息编辑 -->
    <el-dialog v-model="subjectOpen" title="编辑学科信息" width="520">
      <el-form label-width="82px" @submit.prevent>
        <el-form-item label="名称">
          <el-input v-model="subjectForm.name" maxlength="20" />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="subjectForm.color" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="subjectForm.note" type="textarea" :rows="2" maxlength="1000" />
        </el-form-item>
        <el-form-item label="课程全称">
          <el-input v-model="subjectForm.fullName" maxlength="120" />
        </el-form-item>
        <el-form-item label="教师">
          <el-input v-model="subjectForm.teacher" maxlength="60" />
        </el-form-item>
        <el-form-item label="教室">
          <el-input v-model="subjectForm.room" maxlength="60" />
        </el-form-item>
        <el-form-item label="周次">
          <el-input v-model="subjectForm.weeks" maxlength="60" />
        </el-form-item>
        <el-form-item label="课程代码">
          <el-input v-model="subjectForm.classCode" maxlength="60" />
        </el-form-item>
        <el-form-item label="课程主页">
          <el-input v-model="subjectForm.homepage" maxlength="300" placeholder="https://..." />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="subjectOpen = false">取消</el-button>
        <el-button type="primary" @click="saveSubject">保存</el-button>
      </template>
    </el-dialog>

    <!-- 成绩编辑 -->
    <el-dialog v-model="gradeOpen" :title="gradeForm.id ? '编辑成绩' : '添加成绩'" width="460">
      <el-form label-width="72px" @submit.prevent>
        <el-form-item label="名称">
          <el-input v-model="gradeForm.name" maxlength="80" @keyup.enter="submitGrade" />
        </el-form-item>
        <el-form-item label="分数">
          <el-input v-model="gradeForm.score" placeholder="留空表示未出分" />
        </el-form-item>
        <el-form-item label="满分">
          <el-input v-model="gradeForm.full" />
        </el-form-item>
        <el-form-item label="权重">
          <el-input v-model="gradeForm.weight" placeholder="选填" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="gradeForm.type" style="width: 100%">
            <el-option v-for="t in GRADE_TYPES" :key="t" :label="GRADE_LABEL[t]" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="gradeForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="gradeForm.note" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="gradeOpen = false">取消</el-button>
        <el-button type="primary" @click="submitGrade">保存</el-button>
      </template>
    </el-dialog>

    <!-- 任务编辑（学科页固定挂在本学科下） -->
    <el-dialog v-model="taskOpen" :title="taskForm.id ? '编辑任务' : '添加任务'" width="460">
      <el-form label-width="72px" @submit.prevent>
        <el-form-item label="标题">
          <el-input v-model="taskForm.title" maxlength="120" @keyup.enter="submitTask" />
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
        <el-form-item label="地点">
          <el-input v-model="taskForm.place" maxlength="80" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="taskForm.note" type="textarea" :rows="2" maxlength="1000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="taskOpen = false">取消</el-button>
        <el-button type="primary" @click="submitTask">保存</el-button>
      </template>
    </el-dialog>

    <!-- 资料编辑 -->
    <el-dialog v-model="fileEditOpen" title="编辑资料" width="480">
      <el-form label-width="72px" @submit.prevent>
        <el-form-item label="名称">
          <el-input v-model="fileForm.name" maxlength="120" />
        </el-form-item>
        <el-form-item label="学科">
          <el-select v-model="fileForm.subjectId" clearable placeholder="不关联" style="width: 100%">
            <el-option v-for="s in data.subjects" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="fileForm.category" style="width: 100%">
            <el-option v-for="c in FILE_CATEGORIES" :key="c" :label="CATEGORY_LABEL[c]" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="fileForm.tags" placeholder="用逗号分隔" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="fileForm.note" type="textarea" :rows="2" maxlength="1000" />
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="fileForm.pinned" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fileEditOpen = false">取消</el-button>
        <el-button type="primary" @click="submitFileEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 页面内预览：PDF 用 iframe 渲染，不是下载 -->
    <el-dialog v-model="previewOpen" :title="previewFile?.name || '预览'" width="82%" top="4vh">
      <div class="preview-body">
        <iframe v-if="previewFile && isPdf(previewFile)" :src="pdfUrl(previewFile)" class="pdf-frame" />
        <img v-else-if="previewFile && isImage(previewFile)" :src="fileRawUrl(previewFile)" class="img-preview" />
        <div v-else class="ss-empty">
          此类型无法在页面内预览，
          <a v-if="previewFile" :href="fileRawUrl(previewFile)" target="_blank" rel="noopener">在新标签打开</a>
        </div>
      </div>
    </el-dialog>

    <!-- 笔记编辑器：正文 800ms 防抖自动保存 -->
    <NoteEditorDialog v-model="noteEditorOpen" :note="editingNote" :subject-id="id" />

    <ContextMenu ref="ctx" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  BLOCKS,
  DAYS,
  FILE_CATEGORIES,
  GRADE_TYPES,
  TASK_TYPES,
  todayInTZ,
} from "@starry/shared";
import type {
  FileCategory,
  Grade,
  GradeType,
  Note,
  StudyFile,
  Task,
  TaskType,
} from "@starry/shared";
import { api, msgOf } from "@/api";
import { useDataStore } from "@/stores/data";
import KnowledgePanel from "@/components/KnowledgePanel.vue";
import NotesCarousel from "@/components/NotesCarousel.vue";
import NoteEditorDialog from "@/components/NoteEditorDialog.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps<{ id: string }>();
const data = useDataStore();

const GRADE_LABEL: Record<GradeType, string> = {
  homework: "作业",
  quiz: "测验",
  exam: "考试",
  project: "项目",
  other: "其他",
};
const TYPE_LABEL: Record<TaskType, string> = {
  assignment: "作业",
  exam: "考试",
  project: "项目",
  activity: "活动",
  task: "待办",
};
const CATEGORY_LABEL: Record<FileCategory, string> = {
  material: "资料",
  knowledge: "知识点",
};

const subject = computed(() => data.subjects.find((s) => s.id === props.id));
const today = computed(() => todayInTZ());

const sortedGrades = computed(() =>
  data.grades
    .filter((g) => g.subjectId === props.id)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))),
);
const graded = computed(() => sortedGrades.value.filter((g) => g.score !== null));
const totalScore = computed(() => Math.round(graded.value.reduce((s, g) => s + (g.score ?? 0), 0) * 100) / 100);
const totalFull = computed(() => Math.round(graded.value.reduce((s, g) => s + g.full, 0) * 100) / 100);
const scoredCount = computed(() => graded.value.length);
const rateText = computed(() => (totalFull.value ? `${((totalScore.value / totalFull.value) * 100).toFixed(1)}%` : "—"));
const avgText = computed(() => `得分率 ${rateText.value}`);
const rateClass = computed(() => {
  const r = totalFull.value ? totalScore.value / totalFull.value : 0;
  return r >= 0.85 ? "ok" : r >= 0.6 ? "warn" : "bad";
});

const tasks = computed(() => data.tasks.filter((t) => t.subjectId === props.id));
const openTasks = computed(() => tasks.value.filter((t) => !t.done));
const doneTasks = computed(() => tasks.value.filter((t) => t.done));
const taskTab = ref<"open" | "done">("open");
const shownTasks = computed(() => (taskTab.value === "open" ? openTasks.value : doneTasks.value));

const notes = computed(() => data.notes.filter((n) => n.subjectId === props.id));
const files = computed(() =>
  data.files
    .filter((f) => f.subjectId === props.id)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)),
);
const fileTab = ref<"all" | "material" | "knowledge">("all");
const shownFiles = computed(() =>
  fileTab.value === "all" ? files.value : files.value.filter((f) => f.category === fileTab.value),
);
const dueCount = computed(
  () =>
    data.knowledge.filter(
      (k) => k.subjectId === props.id && !k.mastered && k.nextReview && k.nextReview <= today.value,
    ).length,
);

/* ---------------- 顶部时间文案 ---------------- */
function blockLabel(idx: number): string {
  return data.timetable.blocks.find((b) => b.index === idx)?.label ?? (BLOCKS[idx - 1]?.label ?? `第 ${idx} 节`);
}

const whenText = computed(() => {
  const list = data.timetable.slots.filter((s) => s.subjectId === props.id);
  return [...new Set(list.map((s) => `${DAYS[s.day - 1]} ${blockLabel(s.block)}`))].join("、");
});

/* ---------------- 学科信息 ---------------- */
const subjectOpen = ref(false);
const subjectForm = reactive({
  name: "",
  color: "#4f9cf9",
  note: "",
  fullName: "",
  teacher: "",
  room: "",
  weeks: "",
  classCode: "",
  homepage: "",
});

function openSubjectEdit(): void {
  const s = subject.value;
  if (!s) return;
  subjectForm.name = s.name;
  subjectForm.color = s.color;
  subjectForm.note = s.note ?? "";
  const c = s.course;
  subjectForm.fullName = c?.fullName ?? "";
  subjectForm.teacher = c?.teacher ?? "";
  subjectForm.room = c?.room ?? "";
  subjectForm.weeks = c?.weeks ?? "";
  subjectForm.classCode = c?.classCode ?? "";
  subjectForm.homepage = c?.homepage ?? "";
  subjectOpen.value = true;
}

async function saveSubject(): Promise<void> {
  if (!subjectForm.name.trim()) {
    ElMessage.warning("请填名称");
    return;
  }
  const out = await data.update("subjects", props.id, {
    name: subjectForm.name.trim(),
    color: subjectForm.color,
    note: subjectForm.note,
    course: {
      fullName: subjectForm.fullName.trim(),
      teacher: subjectForm.teacher.trim(),
      room: subjectForm.room.trim(),
      weeks: subjectForm.weeks.trim(),
      classCode: subjectForm.classCode.trim(),
      homepage: subjectForm.homepage.trim(),
    },
  });
  if (out.ok) {
    subjectOpen.value = false;
    ElMessage.success("已保存");
  }
}

/* ---------------- 成绩 ---------------- */
const gradeOpen = ref(false);
const gradeForm = reactive({
  id: "",
  name: "",
  score: "",
  full: "100",
  weight: "",
  type: "other" as GradeType,
  date: "",
  note: "",
});

function openGrade(g?: Grade): void {
  gradeForm.id = g?.id ?? "";
  gradeForm.name = g?.name ?? "";
  gradeForm.score = g?.score === null || g?.score === undefined ? "" : String(g.score);
  gradeForm.full = String(g?.full ?? 100);
  gradeForm.weight = g?.weight === null || g?.weight === undefined ? "" : String(g.weight);
  gradeForm.type = g?.type ?? "other";
  gradeForm.date = g?.date ?? "";
  gradeForm.note = g?.note ?? "";
  gradeOpen.value = true;
}

async function submitGrade(): Promise<void> {
  if (!gradeForm.name.trim()) {
    ElMessage.warning("请填名称");
    return;
  }
  const payload = {
    name: gradeForm.name.trim(),
    subjectId: props.id,
    score: gradeForm.score.trim() === "" ? null : Number(gradeForm.score),
    full: Number(gradeForm.full) || 100,
    weight: gradeForm.weight.trim() === "" ? null : Number(gradeForm.weight),
    type: gradeForm.type,
    date: gradeForm.date || "",
    note: gradeForm.note.trim(),
  };
  const out = gradeForm.id
    ? await data.update("grades", gradeForm.id, payload)
    : await data.create("grades", payload);
  if (out.ok) {
    gradeOpen.value = false;
    ElMessage.success("已保存");
  }
}

function scoreClass(g: Grade): string {
  if (g.score === null || !g.full) return "";
  const r = g.score / g.full;
  return r >= 0.85 ? "ok" : r >= 0.6 ? "warn" : "bad";
}

async function removeGrade(g: Grade): Promise<void> {
  await data.remove("grades", g.id);
}

/* ---------------- 笔记 ---------------- */
const noteEditorOpen = ref(false);
const editingNote = ref<Note | null>(null);

function openNote(n?: Note): void {
  editingNote.value = n ?? null;
  noteEditorOpen.value = true;
}

/** 把笔记加入艾宾浩斯复习队列：知识点内容上限 3000 字 */
async function noteToReview(n: Note): Promise<void> {
  const out = await data.create("knowledge", {
    title: n.title || "无标题",
    content: (n.content || "").slice(0, 3000),
    subjectId: props.id,
  });
  if (out.ok) ElMessage.success("已加入复习队列");
}

async function removeNote(n: Note): Promise<void> {
  await data.remove("notes", n.id);
}

/* ---------------- 任务 ---------------- */
const taskOpen = ref(false);
const taskForm = reactive({
  id: "",
  title: "",
  due: "",
  time: "",
  type: "task" as TaskType,
  place: "",
  note: "",
});

function openTask(t?: Task): void {
  taskForm.id = t?.id ?? "";
  taskForm.title = t?.title ?? "";
  taskForm.due = t?.due ?? today.value;
  taskForm.time = t?.time ?? "";
  taskForm.type = t?.type ?? "task";
  taskForm.place = t?.place ?? "";
  taskForm.note = t?.note ?? "";
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
  const payload = {
    title: taskForm.title.trim(),
    due: taskForm.due,
    time: taskForm.time || "",
    type: taskForm.type,
    place: taskForm.place.trim(),
    note: taskForm.note.trim(),
    subjectId: props.id,
    done: false,
    doneManual: null,
  };
  const out = taskForm.id
    ? await data.update("tasks", taskForm.id, payload)
    : await data.create("tasks", payload);
  if (out.ok) {
    taskOpen.value = false;
    ElMessage.success("已保存");
  }
}

/** 手动勾选写 doneManual：一旦有值，服务端自动派生永远不许覆盖（§8.2） */
async function toggleTask(t: Task): Promise<void> {
  const v = !t.done;
  await data.update("tasks", t.id, { done: v, doneManual: v });
}

async function removeTask(t: Task): Promise<void> {
  await data.remove("tasks", t.id);
}

/* ---------------- 资料 ---------------- */
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const fileEditOpen = ref(false);
const fileForm = reactive({
  id: "",
  name: "",
  subjectId: "" as string,
  category: "material" as FileCategory,
  tags: "",
  note: "",
  pinned: false,
});
const previewOpen = ref(false);
const previewFile = ref<StudyFile | null>(null);

// FE-02：模板里不直接引用 api 的方法，统一包一层组件内方法
function fileRawUrl(f: StudyFile): string {
  return api.files.rawUrl(f.id);
}
function pdfUrl(f: StudyFile): string {
  return `${fileRawUrl(f)}#view=FitH`;
}
function isPdf(f: StudyFile): boolean {
  return /pdf/i.test(f.mime) || /\.pdf$/i.test(f.name);
}
function isImage(f: StudyFile): boolean {
  return /^image\//i.test(f.mime);
}

function fmtSize(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function extOf(f: StudyFile): string {
  const ext = f.name.includes(".") ? f.name.split(".").pop() ?? "" : "";
  return (ext || "文件").slice(0, 4).toUpperCase();
}

/** D1 里 tags 存的是 JSON 文本，服务端解析失败时兜成空数组，别让模板炸掉 */
function tagsOf(f: StudyFile): string[] {
  return Array.isArray(f.tags) ? f.tags : [];
}

/** 扩展名色块：无 emoji，用名称派生一个稳定色相 */
function iconColor(f: StudyFile): string {
  let h = 0;
  for (const ch of extOf(f)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 38% 40%)`;
}

function shortDate(s: string): string {
  return s ? s.slice(5).replace("-", "/") : "";
}

function onUploadClick(): void {
  fileInput.value?.click();
}

async function onFilesPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const picked = input.files;
  if (!picked?.length) return;
  uploading.value = true;
  try {
    const items = await data.uploadFiles(Array.from(picked), props.id);
    ElMessage.success(`已上传 ${items.length} 个文件`);
  } catch (err) {
    ElMessage.error(msgOf(err));
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

function openFile(f: StudyFile): void {
  // localOnly 指向本机磁盘，永远不上传，手机端不可点开（§5.2）
  if (f.localOnly) {
    ElMessage.info("此文件仅电脑可用，无法在这里打开");
    return;
  }
  previewFile.value = f;
  previewOpen.value = true;
}

function openFileEdit(f: StudyFile): void {
  fileForm.id = f.id;
  fileForm.name = f.name;
  fileForm.subjectId = f.subjectId ?? "";
  fileForm.category = f.category;
  fileForm.tags = tagsOf(f).join(", ");
  fileForm.note = f.note ?? "";
  fileForm.pinned = f.pinned;
  fileEditOpen.value = true;
}

async function submitFileEdit(): Promise<void> {
  const tags = fileForm.tags
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 30);
  const out = await data.update("files", fileForm.id, {
    name: fileForm.name.trim(),
    subjectId: fileForm.subjectId || null,
    category: fileForm.category,
    tags,
    note: fileForm.note,
    pinned: fileForm.pinned,
  });
  if (out.ok) {
    fileEditOpen.value = false;
    ElMessage.success("已保存");
  }
}

async function togglePin(f: StudyFile): Promise<void> {
  await data.update("files", f.id, { pinned: !f.pinned });
}

async function removeFile(f: StudyFile): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除资料「${f.name}」？`, "删除", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await data.remove("files", f.id);
}

/* ---------------- 右键菜单 ---------------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = ref<any>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kwRef = ref<any>(null);

function onGradeMenu(e: MouseEvent, g: Grade): void {
  ctx.value?.open(
    e,
    [
      { key: "edit", label: "编辑" },
      { key: "del", label: "删除", danger: true },
    ],
    (k: string) => (k === "edit" ? openGrade(g) : void removeGrade(g)),
  );
}

function onNoteMenu(e: MouseEvent, n: Note): void {
  ctx.value?.open(
    e,
    [
      { key: "edit", label: "编辑" },
      { key: "del", label: "删除", danger: true },
    ],
    (k: string) => (k === "edit" ? openNote(n) : void removeNote(n)),
  );
}

function onTaskMenu(e: MouseEvent, t: Task): void {
  ctx.value?.open(
    e,
    [
      { key: "edit", label: "编辑" },
      { key: "del", label: "删除", danger: true },
    ],
    (k: string) => (k === "edit" ? openTask(t) : void removeTask(t)),
  );
}

function onFileMenu(e: MouseEvent, f: StudyFile): void {
  ctx.value?.open(
    e,
    [
      { key: "edit", label: "编辑" },
      { key: "pin", label: f.pinned ? "取消置顶" : "置顶" },
      { key: "del", label: "删除", danger: true },
    ],
    (k: string) => {
      if (k === "edit") openFileEdit(f);
      else if (k === "pin") void togglePin(f);
      else void removeFile(f);
    },
  );
}

function onKwChanged(): void {
  // 复习动作会改 next_review，强制拉一次让待复习计数与服务端一致
  void data.load("knowledge", true);
}

/* ---------------- 生命周期 ----------------
 * watch 放在所有依赖声明之后，避免 immediate 引用尚未声明的变量（FE-01） */
onMounted(() => {
  void data.loadAll(false);
});

watch(
  () => props.id,
  () => {
    subjectOpen.value = false;
    gradeOpen.value = false;
    taskOpen.value = false;
    fileEditOpen.value = false;
    noteEditorOpen.value = false;
    previewOpen.value = false;
  },
);
</script>

<style scoped>
.missing {
  min-height: 50dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--ss-muted);
}

.subject-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.s-top {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.s-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.s-dot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  flex: none;
}

.s-name {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}

.s-title-row .ss-btn {
  margin-left: auto;
}

.s-meta {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.s-when {
  font-size: 12.5px;
  color: var(--ss-muted);
}

.s-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.s-note {
  margin: 0;
  font-size: 13px;
  color: var(--ss-text-2);
  white-space: pre-wrap;
}

.s-faculty {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--ss-dim);
}

/* ---------- 三列（产品核心） ---------- */
.grid3 {
  display: grid;
  grid-template-columns: 2fr 3fr 3fr;
  /* 三列等高：短列拉伸到与最高列齐平，底部不会参差不齐 */
  align-items: stretch;
  gap: 16px;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

/* 列内各 panel 按内容比例填满列高，绝不写死 max-height（FE-03） */
.col > .panel {
  flex: 1 1 auto;
}

.panel {
  display: flex;
  flex-direction: column;
  background: var(--ss-surface);
  border: 1px solid var(--ss-border);
  border-radius: var(--ss-radius);
  overflow: hidden;
  min-height: 260px;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--ss-border);
  flex: none;
}

.panel-head > .ss-add {
  margin-left: auto;
}

.panel-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex: none;
}

.panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 14px;
}

.notes-body {
  display: flex;
  align-items: stretch;
}

.notes-body > * {
  flex: 1;
  min-width: 0;
}

@media (max-width: 1400px) {
  .grid3 {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

@media (max-width: 1080px) {
  .grid3 {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ---------- 成绩 ---------- */
.grade-total {
  position: sticky;
  top: -10px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -10px -14px 10px;
  padding: 12px 14px;
  background: var(--ss-surface);
  border-bottom: 1px solid var(--ss-border);
}

.gt-main {
  display: flex;
  flex-direction: column;
}

.gt-label {
  font-size: 11px;
  color: var(--ss-muted);
}

.gt-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.gt-value em {
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  color: var(--ss-muted);
}

.gt-rate {
  font-size: 13px;
  font-weight: 650;
  padding: 2px 8px;
  border-radius: 7px;
}

.gt-rate.ok {
  color: var(--ss-ok);
  background: color-mix(in srgb, var(--ss-ok) 14%, transparent);
}

.gt-rate.warn {
  color: var(--ss-warn);
  background: color-mix(in srgb, var(--ss-warn) 14%, transparent);
}

.gt-rate.bad {
  color: var(--ss-danger);
  background: color-mix(in srgb, var(--ss-danger) 14%, transparent);
}

.gt-count {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ss-dim);
}

.grade-list {
  display: flex;
  flex-direction: column;
}

.grade-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 62px 34px;
  align-items: center;
  gap: 8px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--ss-border);
  cursor: pointer;
  font-size: 12.5px;
}

.grade-row:hover {
  background: var(--ss-surface-2);
}

.g-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.g-extra {
  font-size: 11px;
  color: var(--ss-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.g-score {
  text-align: right;
  font-weight: 650;
}

.g-score em {
  font-style: normal;
  font-weight: 400;
  font-size: 11px;
  color: var(--ss-muted);
}

.g-score.ok {
  color: var(--ss-ok);
}
.g-score.warn {
  color: var(--ss-warn);
}
.g-score.bad {
  color: var(--ss-danger);
}

.g-weight {
  text-align: right;
  font-size: 11px;
  color: var(--ss-dim);
}

/* ---------- 任务 ---------- */
.task-tabs,
.file-tabs {
  margin-bottom: 10px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--ss-border);
  border-radius: 9px;
  background: var(--ss-surface-2);
}

.task-row.done .t-title {
  text-decoration: line-through;
  opacity: 0.65;
}

.t-main {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.t-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.t-note {
  font-size: 11px;
  color: var(--ss-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.t-due {
  flex: none;
  font-size: 11px;
  color: var(--ss-muted);
}

.t-check {
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

.t-check:hover {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
}

/* ---------- 资料 ---------- */
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 10px;
}

.file-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 12px 8px 9px;
  border: 1px solid var(--ss-border);
  border-radius: 11px;
  background: var(--ss-surface-2);
  cursor: pointer;
  text-align: center;
  transition: all 0.15s;
  min-width: 0;
}

.file-card:hover {
  border-color: var(--ss-accent);
}

.file-card.pinned {
  border-color: color-mix(in srgb, var(--ss-warn) 45%, transparent);
}

.file-card.local {
  opacity: 0.72;
  cursor: default;
}

.pin-btn {
  position: absolute;
  top: 5px;
  right: 5px;
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

.pin-btn.on {
  color: var(--ss-warn);
  border-color: color-mix(in srgb, var(--ss-warn) 45%, transparent);
}

.fc-icon {
  width: 42px;
  height: 46px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.3px;
}

.fc-name {
  width: 100%;
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fc-meta {
  font-size: 10.5px;
  color: var(--ss-dim);
}

.fc-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 3px;
}

.fc-tags .ss-tag {
  font-size: 9.5px;
  padding: 0 5px;
}

.fc-local {
  font-size: 10px;
  color: var(--ss-warn);
  border-top: 1px dashed var(--ss-border);
  padding-top: 4px;
  width: 100%;
}

/* ---------- 预览 ---------- */
.preview-body {
  min-height: 60dvh;
}

.pdf-frame {
  width: 100%;
  height: 72dvh;
  border: 1px solid var(--ss-border);
  border-radius: 8px;
  background: #fff;
}

.img-preview {
  max-width: 100%;
  max-height: 72dvh;
  display: block;
  margin: 0 auto;
}

.preview-body a {
  color: var(--ss-accent);
}
</style>
