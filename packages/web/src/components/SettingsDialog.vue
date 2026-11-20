<template>
  <el-dialog v-model="visible" title="设置" width="600" :close-on-click-modal="false">
    <el-tabs v-model="ui.settingsTab">
      <!-- 个人信息：写进课表元信息，首页问候与周次用它 -->
      <el-tab-pane label="个人信息" name="profile">
        <p class="ss-hint">用于首页的称呼、学期与开学日期。</p>
        <el-form label-width="82px" @submit.prevent>
          <el-form-item label="称呼">
            <el-input v-model="profile.student" placeholder="显示在首页欢迎语里" maxlength="20" />
          </el-form-item>
          <el-form-item label="学期">
            <el-input v-model="profile.semester" placeholder="例如：2026 秋季" maxlength="30" />
          </el-form-item>
          <el-form-item label="开学日期">
            <el-date-picker
              v-model="profile.startDate"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
        <div class="sd-actions">
          <el-button type="primary" :loading="savingProfile" @click="saveProfile">保存</el-button>
          <el-button @click="logout">退出登录</el-button>
        </div>
      </el-tab-pane>

      <!-- 外观 -->
      <el-tab-pane label="外观" name="appearance">
        <p class="ss-hint">主题会写进本地偏好，首帧即生效，不会闪一下。</p>
        <div class="theme-pick">
          <button
            v-for="m in THEME_MODES"
            :key="m"
            class="theme-opt"
            :class="{ on: mode === m }"
            @click="setTheme(m)"
          >
            {{ THEME_LABEL[m] }}
          </button>
        </div>
      </el-tab-pane>

      <!-- 改密码 -->
      <el-tab-pane label="改密码" name="password">
        <p class="ss-hint">新密码至少 6 位。修改后当前会话可能失效，需要重新登录。</p>
        <el-form label-width="92px" @submit.prevent>
          <el-form-item label="当前密码">
            <el-input v-model="pwd.oldPassword" type="password" show-password autocomplete="current-password" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="pwd.newPassword" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="pwd.confirm" type="password" show-password autocomplete="new-password" @keyup.enter="changePassword" />
          </el-form-item>
        </el-form>
        <div class="sd-actions">
          <el-button type="primary" :loading="savingPwd" @click="changePassword">修改密码</el-button>
        </div>
      </el-tab-pane>

      <!-- 数据概览 -->
      <el-tab-pane label="数据概览" name="data">
        <div class="sd-actions sd-first">
          <el-button :loading="loadingOverview" @click="loadOverview">
            <AppIcon name="refresh" :size="14" /> 刷新
          </el-button>
        </div>
        <div v-if="stats" class="stat-grid">
          <div class="stat-cell">
            <span class="stat-k">资料文件</span>
            <span class="stat-v">{{ stats.count }} 个</span>
          </div>
          <div class="stat-cell">
            <span class="stat-k">占用空间</span>
            <span class="stat-v">{{ fmtSize(stats.totalSize) }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-k">仅电脑可用</span>
            <span class="stat-v">{{ stats.localOnly }} 个</span>
          </div>
        </div>
        <p v-else class="ss-hint">{{ loadingOverview ? "正在读取统计…" : "统计信息暂时不可用" }}</p>
        <!-- BB 抓取状态：最近抓取时间 + 手动抓取请求。云端网页无法直接启动本机采集器，
             所以按钮只登记请求，由本机 npm run collect 消费并回写 sync_runs。 -->
        <div class="sync-box">
          <div class="sync-head">
            <span class="sync-title">BB 抓取状态</span>
            <el-button size="small" :loading="requesting" @click="requestSync">手动抓取</el-button>
          </div>

          <div v-if="!syncInfo" class="sync-empty">
            {{ loadingOverview ? "正在读取状态…" : "点「刷新」读取最近抓取状态" }}
          </div>
          <template v-else>
            <div class="sync-line">
              <span class="sync-k">最近抓取</span>
              <span class="sync-v">
                <template v-if="syncInfo.lastRunAt">
                  {{ formatInTZ(syncInfo.lastRunAt) }}（北京时间）· {{ agoInTZ(syncInfo.lastRunAt) }}
                </template>
                <span v-else class="sync-bad">还没有任何抓取记录</span>
              </span>
            </div>
            <div class="sync-line">
              <span class="sync-k">运行状态</span>
              <span class="sync-v">
                <span v-if="!syncInfo.items.length" class="sync-bad">未生效</span>
                <span v-else-if="lastRun?.ok" class="sync-ok">成功</span>
                <span v-else class="sync-bad">上次失败</span>
                <span v-if="lastRun" class="sync-sub">
                  {{ sourceLabel(lastRun.source) }}：新增 {{ lastRun.created }} · 更新 {{ lastRun.updated }} · 跳过 {{ lastRun.skipped }}
                </span>
                <span v-if="lastRun && !lastRun.ok && lastRun.error" class="sync-sub sync-bad">{{ lastRun.error }}</span>
              </span>
            </div>
            <div v-if="syncInfo.pendingAt" class="sync-pending">
              已登记手动抓取（{{ formatInTZ(syncInfo.pendingAt) }}），本机采集器跑完会自动清除这条标记。
            </div>
            <p class="sync-tip">
              网页在云端，不能直接启动你电脑上的采集器。点「手动抓取」只是登记一次请求；
              请在本机运行 <code>npm run collect</code>，抓取结果会自动写回这里。
            </p>
            <p v-if="!syncInfo.items.length" class="sync-hint">
              BB 抓取没生效时，依次检查本机 .env 的 BB_* 与 COLLECTOR_TOKEN、以及 Windows 计划任务是否在运行。
            </p>
            <div v-if="syncInfo.items.length > 1" class="sync-history">
              <div v-for="r in syncInfo.items.slice(0, 5)" :key="r.id" class="hist-row">
                <span :class="r.ok ? 'sync-ok' : 'sync-bad'">{{ r.ok ? "成功" : "失败" }}</span>
                <span>{{ formatInTZ(r.ranAt) }}</span>
                <span>{{ sourceLabel(r.source) }}</span>
                <span>+{{ r.created }} / ~{{ r.updated }}</span>
              </div>
            </div>
          </template>
        </div>
      </el-tab-pane>

      <!-- 学科管理：编辑信息整合在这里，每行小三角展开收起 -->
      <el-tab-pane label="学科管理" name="subjects">
        <p class="ss-hint">
          名称、颜色改后自动保存；上下按钮调整顶栏顺序。点每行右侧小三角展开，可编辑课程信息、
          BB 课程链接与教师官网。删除学科不会删除已挂的资料文件。
        </p>
        <div class="manage-head">
          <el-button type="primary" size="small" @click="addSubject">新建学科</el-button>
        </div>
        <div v-if="!data.subjects.length" class="ss-empty">还没有学科</div>
        <div v-for="(s, i) in data.subjects" :key="s.id" class="manage-item">
          <div class="manage-row">
            <div class="ord-btns">
              <button :disabled="i === 0" title="上移" @click="move(i, -1)">
                <AppIcon name="chevronUp" :size="11" />
              </button>
              <button :disabled="i === data.subjects.length - 1" title="下移" @click="move(i, 1)">
                <AppIcon name="chevronDown" :size="11" />
              </button>
            </div>
            <span class="ss-dot" :style="{ background: s.color }" />
            <el-input v-model="s.name" @change="saveSubjectField(s, { name: s.name })" />
            <el-color-picker v-model="s.color" size="small" @change="(v: string | null) => saveSubjectColor(s, v)" />
            <el-button text type="danger" size="small" @click="removeSubject(s)">删除</el-button>
            <button
              class="fold-btn"
              :class="{ open: expanded[s.id] }"
              :title="expanded[s.id] ? '收起编辑信息' : '展开编辑信息'"
              @click="toggleExpand(s.id)"
            >
              <AppIcon :name="expanded[s.id] ? 'chevronDown' : 'chevronRight'" :size="12" />
            </button>
          </div>
          <div v-if="expanded[s.id]" class="manage-detail">
            <el-form label-width="88px" @submit.prevent>
              <el-form-item label="备注">
                <el-input v-model="draft(s).note" type="textarea" :rows="2" maxlength="1000" />
              </el-form-item>
              <el-form-item label="课程全称">
                <el-input v-model="draft(s).fullName" maxlength="120" />
              </el-form-item>
              <el-form-item label="教师">
                <el-input v-model="draft(s).teacher" maxlength="60" />
              </el-form-item>
              <el-form-item label="教室">
                <el-input v-model="draft(s).room" maxlength="60" />
              </el-form-item>
              <el-form-item label="周次">
                <el-input v-model="draft(s).weeks" maxlength="60" />
              </el-form-item>
              <el-form-item label="课程代码">
                <el-input v-model="draft(s).classCode" maxlength="60" />
              </el-form-item>
              <el-form-item label="BB 课程链接">
                <el-input
                  v-model="draft(s).homepage"
                  maxlength="300"
                  placeholder="https://... 填一次后其它学科按课程 ID 自动跳转"
                />
              </el-form-item>
              <el-form-item label="教师官网">
                <el-input v-model="draft(s).facultyUrl" maxlength="300" placeholder="点头像会打开这个链接" />
              </el-form-item>
              <el-form-item label="教师头像">
                <el-input v-model="draft(s).facultyAvatar" maxlength="300" placeholder="图片地址，可留空" />
              </el-form-item>
            </el-form>
            <div class="detail-actions">
              <el-button type="primary" size="small" :loading="savingId === s.id" @click="saveSubjectDetail(s)">
                保存
              </el-button>
              <span class="detail-hint">名称与颜色在上方改后即自动保存</span>
            </div>
          </div>
        </div>
        <el-dialog v-model="newOpen" title="新建学科" width="440" append-to-body>
          <el-form label-width="64px" @submit.prevent>
            <el-form-item label="名称">
              <el-input v-model="newSubject.name" maxlength="20" @keyup.enter="submitNew" />
            </el-form-item>
            <el-form-item label="颜色">
              <el-color-picker v-model="newSubject.color" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="newSubject.note" type="textarea" :rows="2" />
            </el-form-item>
          </el-form>
          <!-- 课表里已出现、但标签栏还没建的学科：勾了就批量新建，省得一个个手打 -->
          <div class="quick-create">
            <div class="qc-head">课表里出现、但标签栏还没有的学科</div>
            <div v-if="missingSubjects.length" class="qc-list">
              <label v-for="nm in missingSubjects" :key="nm" class="qc-item">
                <input v-model="quickPicked" type="checkbox" :value="nm" /> {{ nm }}
              </label>
            </div>
            <p v-else class="qc-empty">课表里的课程都已经有对应学科了</p>
            <el-button
              v-if="missingSubjects.length"
              size="small"
              :disabled="!quickPicked.length"
              :loading="quickBusy"
              @click="submitQuick"
            >
              一键新建勾选的学科
            </el-button>
          </div>
          <template #footer>
            <el-button @click="newOpen = false">取消</el-button>
            <el-button type="primary" @click="submitNew">确定</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- 导入 -->
      <el-tab-pane label="导入" name="import">
        <p class="ss-hint">
          选择一份 JSON：支持 subjects / tasks / grades / notes / knowledge / links 数组，
          以及 timetable.slots（或顶层 slots）课表格。逐条写入，不整份覆盖集合。
        </p>
        <el-radio-group v-model="importMode" size="small">
          <el-radio-button value="merge">课表合并</el-radio-button>
          <el-radio-button value="replace">课表覆盖</el-radio-button>
        </el-radio-group>
        <div class="imp-box">
          <input type="file" accept=".json,application/json" :disabled="importBusy" @change="onImportFile" />
        </div>
        <p v-if="importBusy" class="ss-hint">正在导入…</p>
        <p v-if="importResult" class="imp-result">{{ importResult }}</p>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { agoInTZ, formatInTZ } from "@starry/shared";
import type { FileStats, Subject, SyncRun, SyncStatus, TimetableSlot } from "@starry/shared";
import { api, msgOf } from "@/api";
import type { CollectionName } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useDataStore } from "@/stores/data";
import { THEME_LABEL, THEME_MODES, useTheme } from "@/composables/useTheme";
import AppIcon from "@/components/AppIcon.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

const ui = useUiStore();
const auth = useAuthStore();
const data = useDataStore();
const { mode, setTheme } = useTheme();

/* ---------------- 个人信息 ---------------- */
const profile = reactive({ student: "", semester: "", startDate: "" });
const savingProfile = ref(false);

function syncProfile(): void {
  const m = data.timetable.meta;
  profile.student = m.student ?? "";
  profile.semester = m.semester ?? "";
  profile.startDate = m.startDate ?? "";
}

async function saveProfile(): Promise<void> {
  savingProfile.value = true;
  try {
    const ok = await data.saveMeta({
      student: profile.student.trim(),
      semester: profile.semester.trim(),
      startDate: profile.startDate || "",
    });
    if (ok) ElMessage.success("已保存");
  } finally {
    savingProfile.value = false;
  }
}

async function logout(): Promise<void> {
  try {
    await api.auth.logout();
  } catch {
    // 本地切到登录门控即可，接口失败也要能退出
  }
  auth.block("login");
  visible.value = false;
}

/* ---------------- 改密码 ---------------- */
const pwd = reactive({ oldPassword: "", newPassword: "", confirm: "" });
const savingPwd = ref(false);

async function changePassword(): Promise<void> {
  if (!pwd.oldPassword) {
    ElMessage.warning("请输入当前密码");
    return;
  }
  if (pwd.newPassword.length < 6) {
    ElMessage.warning("新密码至少 6 位");
    return;
  }
  if (pwd.newPassword !== pwd.confirm) {
    ElMessage.warning("两次输入不一致");
    return;
  }
  savingPwd.value = true;
  try {
    await api.auth.password(pwd.oldPassword, pwd.newPassword);
    pwd.oldPassword = "";
    pwd.newPassword = "";
    pwd.confirm = "";
    ElMessage.success("密码已修改");
  } catch (e) {
    ElMessage.error(msgOf(e));
  } finally {
    savingPwd.value = false;
  }
}

/* ---------------- 数据概览 ---------------- */
const stats = ref<FileStats | null>(null);
const syncInfo = ref<SyncStatus | null>(null);
const loadingOverview = ref(false);
const requesting = ref(false);

function fmtSize(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

const lastRun = computed<SyncRun | null>(() => syncInfo.value?.items[0] ?? null);

function sourceLabel(source: SyncRun["source"]): string {
  return source === "grades" ? "成绩" : "日程";
}

async function loadOverview(): Promise<void> {
  loadingOverview.value = true;
  try {
    const [s, y] = await Promise.allSettled([data.stats(), data.syncStatus()]);
    if (s.status === "fulfilled") stats.value = s.value;
    if (y.status === "fulfilled") syncInfo.value = y.value;
  } finally {
    loadingOverview.value = false;
  }
}

/** 登记一次抓取请求；真正的抓取只能由本机采集器发起，结果写进 sync_runs。 */
async function requestSync(): Promise<void> {
  requesting.value = true;
  try {
    await api.sync.request();
    ElMessage.success("已登记抓取请求，请在本机运行 npm run collect");
    await loadOverview();
  } catch (e) {
    ElMessage.error(msgOf(e));
  } finally {
    requesting.value = false;
  }
}

/* ---------------- 学科管理 ----------------
 * 学科页的「编辑信息」已整合到这里：每行小三角展开一份草稿，
 * 保存时一次性提交 course / faculty（写请求仍由 store 带 rev）。 */
interface SubjectDraft {
  note: string;
  fullName: string;
  teacher: string;
  room: string;
  weeks: string;
  classCode: string;
  homepage: string;
  facultyUrl: string;
  facultyAvatar: string;
}

const expanded = reactive<Record<string, boolean>>({});
const drafts = reactive<Record<string, SubjectDraft>>({});
const savingId = ref("");

function makeDraft(s: Subject): SubjectDraft {
  return {
    note: s.note ?? "",
    fullName: s.course?.fullName ?? "",
    teacher: s.course?.teacher ?? "",
    room: s.course?.room ?? "",
    weeks: s.course?.weeks ?? "",
    classCode: s.course?.classCode ?? "",
    homepage: s.course?.homepage ?? "",
    facultyUrl: s.faculty?.url ?? "",
    facultyAvatar: s.faculty?.avatar ?? "",
  };
}

/** 模板里 draft(s) 每次渲染都会被调用，必须返回同一个响应式对象，不能现造 */
function draft(s: Subject): SubjectDraft {
  if (!drafts[s.id]) drafts[s.id] = makeDraft(s);
  return drafts[s.id];
}

function toggleExpand(id: string): void {
  expanded[id] = !expanded[id];
  if (expanded[id]) {
    const s = data.subjects.find((x) => x.id === id);
    if (s) drafts[id] = makeDraft(s);
  }
}

/** 从学科页「设置 BB 链接」跳过来时，自动展开对应学科，省得用户自己找 */
function focusSubject(id: string | null): void {
  if (!id) return;
  expanded[id] = true;
  const s = data.subjects.find((x) => x.id === id);
  if (s) drafts[id] = makeDraft(s);
}

async function saveSubjectDetail(s: Subject): Promise<void> {
  const d = draft(s);
  savingId.value = s.id;
  try {
    const out = await data.update("subjects", s.id, {
      note: d.note,
      course: {
        fullName: d.fullName.trim(),
        teacher: d.teacher.trim(),
        room: d.room.trim(),
        weeks: d.weeks.trim(),
        classCode: d.classCode.trim(),
        homepage: d.homepage.trim(),
      },
      // 只改官网 / 头像，其余教师字段沿用旧值，避免展开面板没列的字段被清空
      faculty: {
        name: s.faculty?.name ?? s.course?.teacher ?? "",
        title: s.faculty?.title ?? "",
        dept: s.faculty?.dept ?? "",
        avatar: d.facultyAvatar.trim(),
        url: d.facultyUrl.trim(),
        phone: s.faculty?.phone ?? "",
        email: s.faculty?.email ?? "",
      },
    });
    if (out.ok) ElMessage.success("已保存");
  } finally {
    savingId.value = "";
  }
}

/* ---------------- 新建学科 ---------------- */
const QUICK_COLORS = ["#4f9cf9", "#e8913a", "#5bb98c", "#c76bd8", "#e06b6b", "#3fa9b8"];
const newOpen = ref(false);
const newSubject = reactive({ name: "", color: "#4f9cf9", note: "" });
const quickPicked = ref<string[]>([]);
const quickBusy = ref(false);

/** 课表格里出现、但标签栏还没建的学科名。能按 subjectId 精确匹配时也算已存在。 */
const missingSubjects = computed<string[]>(() => {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const slot of data.timetable.slots) {
    const nm = (slot.name || "").trim();
    if (!nm || seen.has(nm)) continue;
    const hitById = !!slot.subjectId && data.subjects.some((s) => s.id === slot.subjectId);
    // 课表格里的名字常带班级后缀，学科名是它的前缀就认为已经建过
    const hitByName = data.subjects.some((s) => {
      const n = (s.name || "").trim();
      return !!n && (nm === n || nm.startsWith(n));
    });
    if (hitById || hitByName) continue;
    seen.add(nm);
    names.push(nm);
  }
  return names;
});

function addSubject(): void {
  newSubject.name = "";
  newSubject.color = "#4f9cf9";
  newSubject.note = "";
  quickPicked.value = [];
  newOpen.value = true;
}

async function submitNew(): Promise<void> {
  if (!newSubject.name.trim()) {
    ElMessage.warning("请填名称");
    return;
  }
  const out = await data.create("subjects", {
    name: newSubject.name.trim(),
    color: newSubject.color,
    note: newSubject.note.trim(),
  });
  if (out.ok) {
    newOpen.value = false;
    ElMessage.success("已新建");
  }
}

/** 批量新建课表里已出现、标签栏却还没有的学科 */
async function submitQuick(): Promise<void> {
  const picked = quickPicked.value.filter((n) => missingSubjects.value.includes(n));
  if (!picked.length) return;
  quickBusy.value = true;
  let n = 0;
  try {
    for (let i = 0; i < picked.length; i++) {
      const out = await data.create("subjects", {
        name: picked[i].slice(0, 80),
        color: QUICK_COLORS[i % QUICK_COLORS.length],
        note: "",
      });
      if (out.ok) n += 1;
    }
    quickPicked.value = [];
    if (n) {
      newOpen.value = false;
      ElMessage.success(`已新建 ${n} 门学科`);
    }
  } finally {
    quickBusy.value = false;
  }
}

async function saveSubjectField(s: Subject, patch: Record<string, unknown>): Promise<void> {
  await data.update("subjects", s.id, patch);
}

function saveSubjectColor(s: Subject, v: string | null): void {
  void saveSubjectField(s, { color: v || "#4f9cf9" });
}

async function move(i: number, dir: number): Promise<void> {
  const ids = data.subjects.map((s) => s.id);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await data.reorderSubjects(ids);
}

async function removeSubject(s: Subject): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除学科「${s.name}」？`, "删除", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  const out = await data.remove("subjects", s.id);
  if (out.ok) ElMessage.success("已删除");
}

/* ---------------- 导入 ---------------- */
const importMode = ref<"merge" | "replace">("merge");
const importResult = ref("");
const importBusy = ref(false);

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importBusy.value = true;
  importResult.value = "";
  try {
    const payload = JSON.parse(await file.text()) as Record<string, unknown>;
    await doImport(payload);
  } catch (err) {
    ElMessage.error(`导入失败：${msgOf(err)}`);
  } finally {
    importBusy.value = false;
    input.value = "";
  }
}

async function doImport(payload: Record<string, unknown>): Promise<void> {
  const counts: string[] = [];
  const keys: CollectionName[] = ["subjects", "tasks", "grades", "notes", "knowledge", "links"];
  for (const key of keys) {
    const arr = payload[key];
    if (!Array.isArray(arr)) continue;
    let n = 0;
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const out = await data.create(key, raw as Record<string, unknown>);
      if (out.ok) n += 1;
    }
    if (n) counts.push(`${key} ${n} 条`);
  }
  const tt = payload.timetable as { slots?: unknown } | undefined;
  const rawSlots = tt?.slots ?? payload.slots;
  if (Array.isArray(rawSlots) && rawSlots.length) {
    const ok = await data.importTimetable(rawSlots as TimetableSlot[], importMode.value);
    if (ok) counts.push(`课表 ${rawSlots.length} 格`);
  }
  importResult.value = counts.length ? `已导入：${counts.join("、")}` : "文件里没有可导入的内容";
  if (counts.length) ElMessage.success("导入完成");
}

/* ---------------- 打开时同步 ----------------
 * watch 放在所有依赖声明之后，避免 immediate 引用尚未声明的变量（FE-01） */
watch(
  () => props.modelValue,
  (v) => {
    if (!v) return;
    syncProfile();
    if (ui.settingsTab === "data") void loadOverview();
    if (ui.settingsTab === "subjects") focusSubject(ui.settingsFocusSubject);
  },
);

watch(
  () => ui.settingsTab,
  (t) => {
    if (!props.modelValue) return;
    if (t === "data") void loadOverview();
    if (t === "subjects") focusSubject(ui.settingsFocusSubject);
  },
);

watch(
  () => ui.settingsFocusSubject,
  (id) => {
    if (props.modelValue && ui.settingsTab === "subjects") focusSubject(id);
  },
);
</script>

<style scoped>
.sd-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  align-items: center;
}

.sd-first {
  margin-top: 0;
  margin-bottom: 12px;
}

.theme-pick {
  display: flex;
  gap: 8px;
}

.theme-opt {
  flex: 1;
  padding: 10px 0;
  border-radius: 9px;
  border: 1px solid var(--ss-border);
  background: var(--ss-surface-2);
  color: var(--ss-text-2);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.theme-opt:hover {
  border-color: var(--ss-border-strong);
  color: var(--ss-text);
}

.theme-opt.on {
  border-color: var(--ss-accent);
  background: var(--ss-accent-soft);
  color: var(--ss-accent);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--ss-border);
  border-radius: 10px;
  background: var(--ss-surface-2);
}

.stat-k {
  font-size: 11.5px;
  color: var(--ss-muted);
}

.stat-v {
  font-size: 17px;
  font-weight: 650;
  color: var(--ss-text);
}

.sync-box {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--ss-border);
  border-radius: 10px;
  background: var(--ss-surface-2);
}

.sync-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sync-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ss-text-2);
}

.sync-head .el-button {
  margin-left: auto;
}

.sync-empty {
  font-size: 12px;
  color: var(--ss-muted);
  padding: 6px 0;
}

.sync-line {
  display: flex;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--ss-border);
  font-size: 12.5px;
}

.sync-k {
  flex: none;
  width: 64px;
  color: var(--ss-muted);
}

.sync-v {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 8px;
  min-width: 0;
}

.sync-sub {
  font-size: 11.5px;
  color: var(--ss-dim);
}

.sync-ok {
  color: var(--ss-ok);
}

.sync-bad {
  color: var(--ss-danger);
}

.sync-pending {
  margin-top: 9px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--ss-accent-soft);
  color: var(--ss-accent);
  font-size: 11.5px;
}

.sync-tip,
.sync-hint {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--ss-muted);
}

.sync-tip code {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--ss-border);
  background: var(--ss-bg);
  font-family: ui-monospace, Consolas, monospace;
}

.sync-history {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--ss-border);
}

.hist-row {
  display: flex;
  gap: 12px;
  padding: 3px 0;
  font-size: 11.5px;
  color: var(--ss-dim);
}

.manage-head {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.manage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--ss-border);
}

.ord-btns {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: none;
}

.ord-btns button {
  width: 22px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--ss-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ss-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.ord-btns button:disabled {
  opacity: 0.3;
  cursor: default;
}

.imp-box {
  margin-top: 14px;
  padding: 14px;
  border: 1px dashed var(--ss-border-strong);
  border-radius: 10px;
}

.imp-box input {
  width: 100%;
  font-size: 12.5px;
  color: var(--ss-text-2);
  font-family: inherit;
}

.imp-result {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--ss-ok);
}

/* ---------- 学科管理：小三角展开编辑信息 ---------- */
.manage-item {
  padding: 2px 0;
}

.fold-btn {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--ss-border);
  border-radius: 7px;
  background: transparent;
  color: var(--ss-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.15s;
}

.fold-btn:hover,
.fold-btn.open {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
  background: var(--ss-accent-soft);
}

.manage-detail {
  margin: 4px 0 10px 30px;
  padding: 12px 14px 4px;
  border: 1px solid var(--ss-border);
  border-radius: 10px;
  background: var(--ss-surface-2);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 0 8px;
}

.detail-hint {
  font-size: 11.5px;
  color: var(--ss-dim);
}

/* ---------- 新建学科：课表里未建学科的快捷勾选 ---------- */
.quick-create {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px dashed var(--ss-border-strong);
  border-radius: 10px;
}

.qc-head {
  font-size: 12px;
  font-weight: 600;
  color: var(--ss-text-2);
  margin-bottom: 8px;
}

.qc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
  margin-bottom: 10px;
}

.qc-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--ss-text-2);
  cursor: pointer;
}

.qc-empty {
  margin: 0;
  font-size: 12px;
  color: var(--ss-dim);
}
</style>
