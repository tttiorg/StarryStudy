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
        <div v-if="syncInfo" class="sync-box">
          <div class="sync-title">最近采集状态</div>
          <pre class="sync-json">{{ prettySync }}</pre>
        </div>
      </el-tab-pane>

      <!-- 学科管理 -->
      <el-tab-pane label="学科管理" name="subjects">
        <p class="ss-hint">改名称或颜色后自动保存；上下按钮调整顶栏顺序。删除学科不会删除已挂的资料文件。</p>
        <div class="manage-head">
          <el-button type="primary" size="small" @click="addSubject">新建学科</el-button>
        </div>
        <div v-if="!data.subjects.length" class="ss-empty">还没有学科</div>
        <div v-for="(s, i) in data.subjects" :key="s.id" class="manage-row">
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
        </div>
        <el-dialog v-model="newOpen" title="新建学科" width="400" append-to-body>
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
import type { FileStats, Subject, TimetableSlot } from "@starry/shared";
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
const syncInfo = ref<Record<string, unknown> | null>(null);
const loadingOverview = ref(false);

function fmtSize(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

const prettySync = computed(() => JSON.stringify(syncInfo.value ?? {}, null, 2));

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

/* ---------------- 学科管理 ---------------- */
const newOpen = ref(false);
const newSubject = reactive({ name: "", color: "#4f9cf9", note: "" });

function addSubject(): void {
  newSubject.name = "";
  newSubject.color = "#4f9cf9";
  newSubject.note = "";
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
  },
);

watch(
  () => ui.settingsTab,
  (t) => {
    if (t === "data" && props.modelValue) void loadOverview();
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
  margin-top: 14px;
}

.sync-title {
  font-size: 12.5px;
  color: var(--ss-muted);
  margin-bottom: 6px;
}

.sync-json {
  margin: 0;
  padding: 10px;
  max-height: 180px;
  overflow: auto;
  border-radius: 9px;
  border: 1px solid var(--ss-border);
  background: var(--ss-bg);
  color: var(--ss-text-2);
  font-size: 11.5px;
  line-height: 1.5;
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
</style>
