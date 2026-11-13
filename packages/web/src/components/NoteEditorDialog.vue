<template>
  <el-dialog
    v-model="visible"
    :title="note ? '编辑笔记' : '新建笔记'"
    width="720"
    top="6vh"
    :close-on-click-modal="false"
  >
    <el-input v-model="draft.title" class="ne-title" placeholder="标题" maxlength="120" />
    <el-input
      v-model="draft.content"
      class="ne-content"
      type="textarea"
      :rows="14"
      :maxlength="NOTE_CONTENT_MAX"
      placeholder="正文，停止输入后自动保存"
    />
    <div class="ne-foot">
      <span class="ne-status">{{ statusText }}</span>
      <span>{{ draft.content.length }} / {{ NOTE_CONTENT_MAX }}</span>
    </div>
    <template #footer>
      <el-button @click="requestClose">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { NOTE_AUTOSAVE_DEBOUNCE_MS, NOTE_CONTENT_MAX } from "@starry/shared";
import type { Note } from "@starry/shared";
import { useDataStore } from "@/stores/data";

const props = withDefaults(
  defineProps<{ modelValue: boolean; note?: Note | null; subjectId?: string }>(),
  { note: null, subjectId: "" },
);
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  saved: [];
}>();

const data = useDataStore();
const draft = reactive({ id: "", title: "", content: "" });
const saving = ref(false);
const dirty = ref(false);

let timer: number | undefined;
let pending = false;
let ready = false;
let suppress = false;

const statusText = computed(() => {
  if (saving.value) return "正在保存…";
  if (dirty.value) return "有未保存的修改";
  return "已保存";
});

/* ---------------- 打开 / 关闭 ---------------- */
const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => {
    if (v) emit("update:modelValue", true);
    else void close();
  },
});

async function close(): Promise<void> {
  // 关窗前把最后一次防抖内的修改落盘，避免用户点「关闭」丢字
  if (timer) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  await flush();
  ready = false;
  emit("update:modelValue", false);
}

function requestClose(): void {
  void close();
}

/* ---------------- 自动保存 ----------------
 * 防抖 800ms，且只 PUT 当前这一条笔记（CF-03：免费版写请求很贵，
 * 不能定时全量提交）。 */
function scheduleSave(): void {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = undefined;
    void flush();
  }, NOTE_AUTOSAVE_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (!ready || !draft.id) return;
  if (saving.value) {
    pending = true;
    return;
  }
  saving.value = true;
  try {
    const out = await data.update(
      "notes",
      draft.id,
      { title: draft.title, content: draft.content },
      { ...draft },
    );
    if (out.choice === "server" && out.server) {
      // 用户在 409 对话框里选了「使用服务器版本」：把编辑器同步过去，
      // 否则继续编辑旧草稿会再次覆盖（§8.6 不能静默覆盖）
      suppress = true;
      draft.title = String(out.server.title ?? "");
      draft.content = String(out.server.content ?? "");
      await nextTick();
      suppress = false;
    }
    if (out.ok) {
      dirty.value = false;
      emit("saved");
    }
  } finally {
    saving.value = false;
    if (pending) {
      pending = false;
      scheduleSave();
    }
  }
}

/* ---------------- watch 全部放在依赖声明之后（FE-01） ---------------- */
watch(
  [() => draft.title, () => draft.content],
  () => {
    if (!ready || suppress) return;
    dirty.value = true;
    scheduleSave();
  },
);

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return;
    ready = false;
    suppress = true;
    if (props.note) {
      draft.id = props.note.id;
      draft.title = props.note.title ?? "";
      draft.content = props.note.content ?? "";
    } else {
      // 新建时先落一条空笔记，拿到 id 之后自动保存才有目标
      const out = await data.create("notes", {
        title: "无标题",
        content: "",
        subjectId: props.subjectId || null,
      });
      if (!out.ok || !out.item) {
        emit("update:modelValue", false);
        return;
      }
      draft.id = out.item.id;
      draft.title = String(out.item.title ?? "无标题");
      draft.content = String(out.item.content ?? "");
      emit("saved");
    }
    dirty.value = false;
    await nextTick();
    suppress = false;
    ready = true;
  },
);
</script>

<style scoped>
.ne-title {
  margin-bottom: 10px;
  font-size: 15px;
}

.ne-content :deep(.el-textarea__inner) {
  font-family: inherit;
  line-height: 1.7;
}

.ne-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ss-dim);
}

.ne-status {
  color: var(--ss-muted);
}
</style>
