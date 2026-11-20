<template>
  <div v-if="!subject" class="missing">
    <p>没有找到这个学科</p>
    <router-link class="ss-btn primary" to="/">回到主页</router-link>
  </div>

  <div v-else class="subject-page">
    <!-- 顶部：标题在左、教师卡固定在右上角（v1 的 s-top 两列网格）。
         学科编辑信息已整合进「设置 → 学科管理」，这里不再放编辑按钮。 -->
    <header class="s-top">
      <div class="s-title-row">
        <span class="s-dot" :style="{ background: subject.color }" />
        <h1 class="s-name">{{ subject.name }}</h1>
      </div>

      <div class="fac-card s-fac">
        <div class="fac-text">
          <div class="fac-name">
            {{ facultyName }}
            <span v-if="subject.faculty?.title" class="fac-title">{{ subject.faculty.title }}</span>
          </div>
          <div class="fac-dept">{{ subject.faculty?.dept || "课表教师信息" }}</div>
          <div class="fac-contact">
            <span v-if="subject.faculty?.email">{{ subject.faculty.email }}</span>
            <span v-if="subject.faculty?.phone">{{ subject.faculty.phone }}</span>
          </div>
        </div>
        <div
          class="fac-avatar"
          :title="subject.faculty?.url ? '点击打开教师官网主页' : '教师信息在「设置 → 学科管理」里编辑'"
          @click="onFacultyAvatarClick"
        >
          <img
            v-if="facultyAvatar && !avatarBroken"
            :src="facultyAvatar"
            alt=""
            @error="avatarBroken = true"
          />
          <span v-else class="fac-initial">{{ facultyInitial }}</span>
        </div>
      </div>

      <div class="s-meta">
        <div class="s-when">{{ whenText || "课表里还没有这门课的时间" }}</div>
        <div class="s-tags">
          <span v-if="subject.course?.room" class="ss-tag">{{ subject.course.room }}</span>
          <span v-if="subject.course?.weeks" class="ss-tag">{{ subject.course.weeks }}</span>
          <span v-if="subject.course?.classCode" class="ss-tag">{{ subject.course.classCode }}</span>
          <span v-if="subject.course?.fullName" class="ss-tag">{{ subject.course.fullName }}</span>
          <!-- 只保留 BB 外链按钮：站点根来自学科自己填的 BB 课程链接，仓库里不写任何真实域名。
               链接在「设置 → 学科管理」展开对应学科后修改。 -->
          <a
            v-if="bbUrl"
            class="ss-tag bb-link"
            :href="bbUrl"
            target="_blank"
            rel="noopener"
            title="打开 Blackboard 课程页"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path
                d="M4 5.5h6.2a3 3 0 0 1 2.4 4.9A3.2 3.2 0 0 1 10.8 17H4Z M4 10.4h6.6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
              />
              <path
                d="M13.6 8.8h4.2a2.7 2.7 0 0 1 2.2 4.2 2.9 2.9 0 0 1 2 4.6h-8.4Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
              />
            </svg>
            Blackboard
          </a>
          <button
            v-else
            class="ss-tag bb-link bb-setup"
            title="在「设置 → 学科管理」里填一次 BB 课程链接，之后所有学科都能跳转"
            @click="goSubjectSettings"
          >
            <AppIcon name="external" :size="12" /> 设置 BB 链接
          </button>
        </div>
        <p v-if="subject.note" class="s-note">{{ subject.note }}</p>
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
              <!-- 左键：先同步开空窗口，再 fetch 文件内容、用 blob: 地址交给新窗口，
                   Edge 原生 PDF 阅读器直接渲染；右键菜单里有「下载」。
                   href 指向 ?dl=1，浏览器原生「链接另存为」也能用，同时是 JS 失效时
                   的降级（点了就下载，符合「不能阅读就下载」）。绝不导航到 /api/... -->
              <a
                v-for="f in shownFiles"
                :key="f.id"
                class="file-card"
                :class="{ pinned: f.pinned, local: f.localOnly }"
                :href="f.localOnly ? undefined : fileDownloadHref(f)"
                @click.prevent="openFile(f)"
                @contextmenu.prevent="onFileMenu($event, f)"
              >
                <button
                  class="pin-btn"
                  :class="{ on: f.pinned }"
                  :title="f.pinned ? '取消置顶' : '置顶'"
                  @click.stop.prevent="togglePin(f)"
                >
                  <AppIcon name="pin" :size="12" />
                </button>
                <!-- 图片资料显示真实缩略图（v1 的 fthumb），加载失败才回落扩展名色块 -->
                <div v-if="isImageFile(f) && !f.localOnly && !imgBroken[f.id]" class="fc-thumb">
                  <img :src="fileRawUrl(f)" :alt="f.name" loading="lazy" @error="imgBroken[f.id] = true" />
                </div>
                <div v-else class="fc-icon" :style="{ background: iconColor(f) }">{{ extOf(f) }}</div>
                <div class="fc-name" :title="f.name">{{ f.name }}</div>
                <div class="fc-meta">{{ fmtSize(f.size) }}</div>
                <div v-if="tagsOf(f).length" class="fc-tags">
                  <span v-for="t in tagsOf(f)" :key="t" class="ss-tag">{{ t }}</span>
                </div>
                <div v-if="f.localOnly" class="fc-local">仅电脑可用</div>
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>

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
import { useUiStore } from "@/stores/ui";
import KnowledgePanel from "@/components/KnowledgePanel.vue";
import NotesCarousel from "@/components/NotesCarousel.vue";
import NoteEditorDialog from "@/components/NoteEditorDialog.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps<{ id: string }>();
const data = useDataStore();
const ui = useUiStore();

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

/* ---------------- 跳转 BB / 教师卡 ---------------- */
// 仓库里不写任何真实学校域名：BB 站点根从「学科自己填的 Blackboard 课程链接」里取。
// 只要有一门课填了完整的 v1 式 launcher 链接，其余学科就能按 bbCourseId 自动拼出来，
// 不用每门课都填一次，也不把私有域名写进代码。
const bbOrigin = computed(() => {
  for (const s of data.subjects) {
    const hp = s.course?.homepage?.trim();
    if (hp && /blackboard|\/webapps\/|bb\./i.test(hp)) {
      try {
        return new URL(hp).origin;
      } catch {
        // 不是合法 URL 就继续找下一门课
      }
    }
  }
  return "";
});

const bbUrl = computed(() => {
  const s = subject.value;
  // 本学科填了课程主页就直接用，最精确（可能就是 BB 课程页）
  const hp = s?.course?.homepage?.trim() ?? "";
  if (hp) return hp;
  const cid = s?.bbCourseId?.trim();
  const origin = bbOrigin.value;
  return cid && origin
    ? `${origin}/webapps/blackboard/execute/launcher?type=Course&id=${encodeURIComponent(cid)}&url=`
    : "";
});

const facultyName = computed(
  () => subject.value?.faculty?.name || subject.value?.course?.teacher || "未填写教师",
);
const facultyAvatar = computed(() => subject.value?.faculty?.avatar || "");
const facultyInitial = computed(() => facultyName.value.slice(0, 1) || "师");
const avatarBroken = ref(false);

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

/* ---------------- 跳转设置 / 教师卡 ----------------
 * 学科信息编辑已整合进「设置 → 学科管理」，学科页只留查看与外链跳转。
 * 点「设置 BB 链接」时直接打开设置并展开当前学科，用户不用自己找。 */
function goSubjectSettings(): void {
  ui.openSettings("subjects", props.id);
}

const facultyUrl = computed(() => subject.value?.faculty?.url?.trim() ?? "");

function onFacultyAvatarClick(): void {
  if (facultyUrl.value) {
    window.open(facultyUrl.value, "_blank", "noopener");
  } else {
    ElMessage.info("还没填教师官网链接，可在「设置 → 学科管理」里展开本学科填写");
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
// 缩略图加载失败的资料 id：失败一次就回落到扩展名色块，别反复请求
const imgBroken = reactive<Record<string, boolean>>({});
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
// FE-02：模板里不直接引用 api 的方法，统一包一层组件内方法
function fileRawUrl(f: StudyFile): string {
  return api.files.rawUrl(f.id);
}

function fileDownloadHref(f: StudyFile): string {
  return api.files.downloadUrl(f.id);
}

function isImage(f: StudyFile): boolean {
  return /^image\//i.test(f.mime);
}

// 资料卡缩略图：mime 可能为空，再按扩展名兜一次，和 v1 的 kindOf 口径一致
function isImageFile(f: StudyFile): boolean {
  return isImage(f) || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(f.name);
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

/* ---------------- 打开 / 下载文件 ----------------
 * 上一版直接让浏览器导航到 /api/files/:id/raw，结果被旧 SW 的导航兜底或 PWA
 * 独立窗口换成 index.html，Vue Router 再显示 404，就是「套娃窗口」。
 * 现在改成 fetch + blob:，全程不产生 /api/... 的页面导航。 */
const PREVIEW_MIME = /^(application\/pdf|text\/|image\/|audio\/|video\/|application\/json)/i;
const PREVIEW_EXT = /\.(pdf|png|jpe?g|gif|webp|bmp|svg|avif|txt|md|json|log|html?|mp3|wav|m4a|mp4|webm)$/i;

function canPreview(mime: string, name: string): boolean {
  return PREVIEW_MIME.test(mime) || PREVIEW_EXT.test(name);
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 给浏览器取走内容的时间，再释放 blob 地址
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** JS 不可用 / fetch 失败时的降级：直接吃服务端 ?dl=1 的 attachment 响应 */
function fallbackDownload(f: StudyFile): void {
  const a = document.createElement("a");
  a.href = api.files.downloadUrl(f.id);
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 左键与右键「在新窗口打开」：
 * 1) 先同步开空窗口 —— 必须在用户手势内完成，await fetch 之后再 open 会被拦截；
 * 2) fetch 文件内容（不是页面导航，旧 SW 导航兜底 / SPA fallback 都碰不到它）；
 * 3) 浏览器能渲染 → blob: 地址交给新窗口，Edge 原生 PDF 阅读器直接打开；
 *    不能渲染或开窗口失败 → 关掉空窗口走下载（「不能阅读就下载」）。
 */
async function openFile(f: StudyFile): Promise<void> {
  if (f.localOnly) {
    ElMessage.info("此文件仅电脑可用，无法在这里打开");
    return;
  }
  const win = window.open("", "_blank");
  let blobUrl: string | null = null;
  try {
    const { blob, mime, name } = await api.files.readFile(f.id);
    const finalName = name || f.name;
    if (!canPreview(mime, finalName) || !win) {
      win?.close();
      triggerDownload(blob, finalName);
      return;
    }
    blobUrl = URL.createObjectURL(blob);
    win.location.replace(blobUrl);
    // 新窗口加载完才释放；60s 足够，且不影响已经渲染出来的 PDF
    setTimeout(() => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }, 60_000);
  } catch (e) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    win?.close();
    fallbackDownload(f);
    ElMessage.warning(`无法在新窗口预览，已转为下载（${msgOf(e)}）`);
  }
}

/** 右键「下载」：同样用 blob 下载，彻底不产生 /api/... 导航请求 */
async function downloadFile(f: StudyFile): Promise<void> {
  if (f.localOnly) {
    ElMessage.info("此文件仅电脑可用，无法下载");
    return;
  }
  try {
    const { blob, name } = await api.files.readFile(f.id);
    triggerDownload(blob, name || f.name);
  } catch {
    fallbackDownload(f);
  }
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
      { key: "open", label: "在新窗口打开" },
      { key: "download", label: "下载" },
      { key: "edit", label: "编辑" },
      { key: "pin", label: f.pinned ? "取消置顶" : "置顶" },
      { key: "del", label: "删除", danger: true },
    ],
    (k: string) => {
      if (k === "open") void openFile(f);
      else if (k === "download") void downloadFile(f);
      else if (k === "edit") openFileEdit(f);
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
    gradeOpen.value = false;
    taskOpen.value = false;
    fileEditOpen.value = false;
    noteEditorOpen.value = false;
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

/* 标题在左、教师卡固定在右上角，两行共用右侧那一格（v1 的 s-top 网格） */
.s-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "title fac"
    "meta  fac";
  align-items: start;
  gap: 8px 18px;
}

.s-title-row {
  grid-area: title;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
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

.s-meta {
  grid-area: meta;
  min-width: 0;
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

/* ---------- 跳转 BB ---------- */
.bb-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ss-accent);
  border-color: color-mix(in srgb, var(--ss-accent) 40%, transparent);
  background: var(--ss-accent-soft);
  text-decoration: none;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.bb-link:hover {
  border-color: var(--ss-accent);
}

/* 还没填任何 BB 链接时的引导按钮，和真正可跳转的标签区分开 */
.bb-setup {
  border-style: dashed;
  color: var(--ss-muted);
  background: transparent;
}

/* ---------- 教师卡（右上角，文字右对齐、头像在最右） ---------- */
.fac-card {
  grid-area: fac;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  min-width: 260px;
  max-width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ss-border);
  border-radius: var(--ss-radius);
  background: var(--ss-surface);
}

.fac-text {
  flex: 1;
  min-width: 0;
  text-align: right;
}

.fac-name {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
}

.fac-title {
  font-size: 11px;
  font-weight: 400;
  color: var(--ss-muted);
  background: var(--ss-surface-2);
  padding: 1px 6px;
  border-radius: 5px;
}

.fac-dept {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ss-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fac-contact {
  margin-top: 2px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-size: 10.5px;
  color: var(--ss-muted);
  overflow: hidden;
  white-space: nowrap;
}

.fac-avatar {
  width: 58px;
  height: 58px;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 1px solid var(--ss-border);
  background: var(--ss-surface-2);
  color: var(--ss-accent);
  font-size: 20px;
  font-weight: 650;
  cursor: pointer;
  transition: border-color 0.15s;
}

.fac-avatar:hover {
  border-color: var(--ss-accent);
}

.fac-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 窄屏：教师卡占满一整行，文字改回左对齐 */
@media (max-width: 820px) {
  .s-top {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "title"
      "fac"
      "meta";
    gap: 10px;
  }
  .fac-card {
    width: 100%;
    min-width: 0;
  }
  .fac-text {
    text-align: left;
  }
  .fac-name {
    justify-content: flex-start;
  }
  .fac-contact {
    justify-content: flex-start;
  }
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

/* 每行高度 = padding 8+8 + 内容 22 + 底边 1 = 39px。
   容器固定成正好 10 行（390px），第 11 条起在容器内滚动。
   绝不改成「只渲染 10 条」：用户要的是能看到全部，只是把框限高。 */
.grade-list {
  --grade-row-h: 39px;
  display: flex;
  flex-direction: column;
  height: calc(var(--grade-row-h) * 10);
  overflow-y: auto;
  /* 滚动条不挤压内容：留一点右内边距 */
  padding-right: 2px;
}

.grade-row {
  /* 行高必须固定，否则上面那个 10 行的算式对不上 */
  flex: none;
  height: var(--grade-row-h);
  box-sizing: border-box;
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
  /* 卡片是 <a>，别让浏览器把整卡染成链接色或加下划线 */
  color: inherit;
  text-decoration: none;
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

/* 图片资料的真实缩略图；加载失败由 imgBroken 回落到上面的扩展名色块 */
.fc-thumb {
  width: 42px;
  height: 46px;
  flex: none;
  border-radius: 7px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--ss-surface-2);
}

.fc-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

</style>
