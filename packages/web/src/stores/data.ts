import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import { BLOCKS } from "@starry/shared";
import type {
  BootstrapPayload,
  Grade,
  Knowledge,
  Link,
  Note,
  NoticeCounts,
  StudyFile,
  Subject,
  Task,
  TimetableBlock,
  TimetableMeta,
  TimetablePayload,
  TimetableSlot,
  WriteResult,
} from "@starry/shared";
import {
  api,
  collections,
  isConflictError,
  msgOf,
  normalizeWrite,
} from "@/api";
import type { CollectionName, TimetableWriteResult } from "@/api";
import { useUiStore } from "@/stores/ui";
import { guardedWrite } from "@/composables/useConflict";
import type { WriteOutcome } from "@/composables/useConflict";

type Row = { id: string; rev: number; [key: string]: unknown };

const emptyMeta = (): TimetableMeta => ({ semester: "", student: "", startDate: "" });

/** 写响应统一成列表记录；rev 以服务端返回为准 */
function norm(r: unknown): Row {
  return normalizeWrite(r as WriteResult<Row>) as Row;
}

export const useDataStore = defineStore("data", () => {
  const subjects = ref<Subject[]>([]);
  const tasks = ref<Task[]>([]);
  const grades = ref<Grade[]>([]);
  const notes = ref<Note[]>([]);
  const knowledge = ref<Knowledge[]>([]);
  const links = ref<Link[]>([]);
  const files = ref<StudyFile[]>([]);
  const timetable = ref<TimetablePayload>({
    meta: emptyMeta(),
    blocks: BLOCKS as TimetableBlock[],
    slots: [],
  });
  const notice = ref<NoticeCounts>({ urgent: 0, newTasks: 0, newGrades: 0 });
  const knowledgeDue = ref(0);
  const knowledgeTotal = ref(0);

  // 各集合始终保存全量，按 subjectId 过滤交给视图的 computed 做。
  // 这样不会出现「同一集合按不同查询参数各缓存一份、互相覆盖」的不一致。
  const buckets = {
    subjects,
    tasks,
    grades,
    notes,
    knowledge,
    links,
    files,
  } as unknown as Record<CollectionName, Ref<Row[]>>;

  const loaded = reactive<Record<string, boolean>>({});
  const inflight: Record<string, Promise<void> | undefined> = {};

  /**
   * load(force) 的 force 必须真的绕过缓存：v1 在这里短路错了，
   * 导致「刷新」按钮点了也拿不到新数据（§11 与 Pinia 需求）。
   */
  async function load(name: CollectionName, force = false): Promise<void> {
    if (!force && loaded[name]) return;
    if (!force && inflight[name]) return inflight[name];

    const p = (async () => {
      const data = await collections[name].list();
      buckets[name].value = (data.items ?? []) as Row[];
      if (name === "knowledge") {
        knowledgeDue.value = data.dueCount ?? 0;
        knowledgeTotal.value = data.total ?? buckets.knowledge.value.length;
      }
      loaded[name] = true;
    })();
    inflight[name] = p;
    p.finally(() => {
      if (inflight[name] === p) inflight[name] = undefined;
    }).catch(() => {});
    return p;
  }

  async function refreshTimetable(): Promise<void> {
    const data = await api.timetable.get();
    timetable.value = {
      meta: data.meta ?? emptyMeta(),
      blocks: data.blocks?.length ? data.blocks : (BLOCKS as TimetableBlock[]),
      slots: data.slots ?? [],
    };
  }

  function hydrate(b: BootstrapPayload): void {
    subjects.value = b.subjects ?? [];
    links.value = b.links ?? [];
    notice.value = b.notice ?? { urgent: 0, newTasks: 0, newGrades: 0 };
    timetable.value = {
      meta: b.timetable?.meta ?? emptyMeta(),
      blocks: b.timetable?.blocks?.length ? b.timetable.blocks : (BLOCKS as TimetableBlock[]),
      slots: b.timetable?.slots ?? [],
    };
    loaded.subjects = true;
    loaded.links = true;
    loaded.timetable = true;
  }

  /** 登录后预热各集合；单项失败不能拖垮整个应用 */
  async function loadAll(force = false): Promise<void> {
    const names: CollectionName[] = [
      "tasks",
      "grades",
      "notes",
      "knowledge",
      "files",
      ...(force ? (["subjects", "links"] as CollectionName[]) : []),
    ];
    await Promise.allSettled(names.map((n) => load(n, force)));
    if (force) {
      await refreshTimetable().catch(() => {});
    }
  }

  function apply(name: CollectionName, item: Row): void {
    const arr = buckets[name].value;
    const i = arr.findIndex((x) => x.id === item.id);
    if (i >= 0) {
      const next = [...arr];
      next[i] = item;
      buckets[name].value = next;
    } else {
      buckets[name].value = [item, ...arr];
    }
  }

  async function create(
    name: CollectionName,
    payload: Record<string, unknown>,
  ): Promise<WriteOutcome<Row>> {
    try {
      const r = await collections[name].create(payload);
      const item = norm(r);
      apply(name, item);
      return { ok: true, item };
    } catch (e) {
      ElMessage.error(msgOf(e));
      return { ok: false, choice: "error", error: e };
    }
  }

  async function update(
    name: CollectionName,
    id: string,
    patch: Record<string, unknown>,
    draft?: Record<string, unknown>,
  ): Promise<WriteOutcome<Row>> {
    const local = buckets[name].value.find((x) => x.id === id);
    if (!local) return { ok: false, choice: "error" };
    const mine = { ...local, ...patch, ...(draft ?? {}) } as Record<string, unknown>;
    return guardedWrite<Row>(
      mine,
      async (rev) => norm(await collections[name].update(id, { ...patch, rev })),
      (item) => apply(name, item),
      local.rev,
    );
  }

  async function remove(name: CollectionName, id: string): Promise<WriteOutcome<Row>> {
    const ui = useUiStore();
    const local = buckets[name].value.find((x) => x.id === id);
    try {
      const r = await collections[name].remove(id);
      buckets[name].value = buckets[name].value.filter((x) => x.id !== id);
      return { ok: true, item: norm(r) };
    } catch (e) {
      if (!isConflictError(e)) {
        ElMessage.error(msgOf(e));
        return { ok: false, choice: "error", error: e };
      }
      const server = e.server as unknown as Row;
      const choice = await ui.openConflict(
        local ? ({ ...local } as Record<string, unknown>) : { id },
        server as unknown as Record<string, unknown>,
      );
      if (choice === "mine") {
        try {
          const r2 = await collections[name].remove(id);
          buckets[name].value = buckets[name].value.filter((x) => x.id !== id);
          return { ok: true, item: norm(r2), choice: "mine" };
        } catch (e2) {
          ElMessage.error(msgOf(e2));
          return { ok: false, choice: "error", error: e2 };
        }
      }
      if (choice === "server") {
        apply(name, server);
        return { ok: true, item: server, choice: "server", server };
      }
      return { ok: false, choice: "cancel", server };
    }
  }

  async function reorderSubjects(ids: string[]): Promise<boolean> {
    try {
      await api.subjects.reorder(ids);
      const map = new Map(subjects.value.map((s) => [s.id, s]));
      subjects.value = ids
        .map((id) => map.get(id))
        .filter((s): s is Subject => !!s)
        .map((s, i) => ({ ...s, sort: i }));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e));
      return false;
    }
  }

  async function reorderLinks(ids: string[]): Promise<boolean> {
    try {
      await api.links.reorder(ids);
      const map = new Map(links.value.map((l) => [l.id, l]));
      links.value = ids
        .map((id) => map.get(id))
        .filter((l): l is Link => !!l)
        .map((l, i) => ({ ...l, sort: i }));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e));
      return false;
    }
  }

  /** 单格写入后的本地同步：兼容 {item,rev} / {item:null} 清空 / {slots} / 需要回读 */
  async function applySlotResult(
    res: TimetableWriteResult,
    coord?: { day: number; block: number },
  ): Promise<void> {
    if (Array.isArray(res.slots)) {
      timetable.value = { ...timetable.value, slots: res.slots };
      return;
    }
    if (res.item) {
      const s = res.item as TimetableSlot;
      const rest = timetable.value.slots.filter((x) => !(x.day === s.day && x.block === s.block));
      const empty = !s.name && !s.room && !s.teacher && !s.weeks && !s.subjectId;
      timetable.value = { ...timetable.value, slots: empty ? rest : [...rest, s] };
      return;
    }
    if ("item" in res && res.item === null && coord) {
      // 服务端明确回 item=null 表示这一格已清空，直接本地移除，不必再 GET 一次
      timetable.value = {
        ...timetable.value,
        slots: timetable.value.slots.filter(
          (x) => !(x.day === coord.day && x.block === coord.block),
        ),
      };
      return;
    }
    await refreshTimetable();
  }

  /** 保存只提交这一格（验收 #4：DevTools 里只有一个 PUT、body 只有一个 slot） */
  async function saveSlot(
    slot: Record<string, unknown>,
    draft?: Record<string, unknown>,
  ): Promise<WriteOutcome<TimetableSlot>> {
    const ui = useUiStore();
    const mine = { ...slot, ...(draft ?? {}) } as Record<string, unknown>;
    const coord = { day: Number(slot.day), block: Number(slot.block) };
    try {
      const res = await api.timetable.slot(slot);
      await applySlotResult(res, coord);
      return { ok: true, item: (res.item ?? slot) as TimetableSlot };
    } catch (e) {
      if (!isConflictError(e)) {
        ElMessage.error(msgOf(e));
        return { ok: false, choice: "error", error: e };
      }
      const server = e.server as unknown as TimetableSlot;
      const choice = await ui.openConflict(mine, server as unknown as Record<string, unknown>);
      if (choice === "mine") {
        try {
          const res = await api.timetable.slot({ ...slot, rev: server.rev });
          await applySlotResult(res, coord);
          return { ok: true, choice: "mine" };
        } catch (e2) {
          ElMessage.error(msgOf(e2));
          return { ok: false, choice: "error", error: e2 };
        }
      }
      if (choice === "server") {
        await applySlotResult({ item: server }, coord);
        return { ok: true, item: server, choice: "server", server };
      }
      return { ok: false, choice: "cancel", server };
    }
  }

  async function saveMeta(meta: Partial<TimetableMeta>): Promise<boolean> {
    try {
      const res = await api.timetable.meta(meta);
      timetable.value = { ...timetable.value, meta: res.meta ?? { ...timetable.value.meta, ...meta } };
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e));
      return false;
    }
  }

  /** 清空走 bulk+replace（仅导入用的整份替换接口），不是日常编辑路径 */
  async function clearTimetable(): Promise<boolean> {
    try {
      await api.timetable.bulk([], "replace");
      timetable.value = { ...timetable.value, slots: [] };
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e));
      return false;
    }
  }

  async function importTimetable(
    slots: TimetableSlot[],
    mode: "merge" | "replace" = "merge",
  ): Promise<boolean> {
    try {
      await api.timetable.bulk(slots, mode);
      await refreshTimetable();
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e));
      return false;
    }
  }

  async function reviewKnowledge(
    id: string,
    action: "review" | "master" | "reset" | "forgot",
  ): Promise<boolean> {
    const local = knowledge.value.find((k) => k.id === id);
    if (!local) return false;
    const out = await guardedWrite<Row>(
      { ...local, action } as Record<string, unknown>,
      async (rev) => norm(await api.knowledge.review(id, action, rev)),
      (item) => apply("knowledge", item),
      local.rev,
    );
    return out.ok;
  }

  /**
   * 一次 POST 全部文件：契约是 FormData 字段名 `files`、可多文件、响应 {items:[...]}。
   * 不再把同一文件同时挂到 file/files 两个名字下 —— multipart 会把二进制写两遍，
   * 大文件上传时请求体直接翻倍。响应仍兼容单文件写形状 {item,rev}。
   */
  async function uploadFiles(picked: File[], subjectId: string | null): Promise<StudyFile[]> {
    if (!picked.length) return [];
    const form = new FormData();
    for (const file of picked) form.append("files", file);
    if (subjectId) form.append("subjectId", subjectId);
    const res = await api.files.upload(form);
    const items: StudyFile[] = Array.isArray(res.items)
      ? res.items
      : res.item
        ? [res.item]
        : [];
    for (const it of items) {
      apply("files", it as unknown as Row);
    }
    // 服务端若不读取 FormData 里的 subjectId，补一次 PUT 保证按学科分类
    if (subjectId) {
      for (const it of items) {
        if (it.subjectId !== subjectId) {
          await update("files", it.id, { subjectId });
        }
      }
    }
    return items;
  }

  async function noticeSeen(): Promise<void> {
    try {
      await api.settings.noticeSeen();
    } catch {
      // 水位以本地为准，接口失败不影响铃铛本次「已读」的表现
    }
  }

  function subjectById(id: string | null): Subject | undefined {
    return id ? subjects.value.find((s) => s.id === id) : undefined;
  }

  return {
    subjects,
    tasks,
    grades,
    notes,
    knowledge,
    links,
    files,
    timetable,
    notice,
    knowledgeDue,
    knowledgeTotal,
    load,
    loadAll,
    refreshTimetable,
    hydrate,
    apply,
    create,
    update,
    remove,
    reorderSubjects,
    reorderLinks,
    saveSlot,
    saveMeta,
    clearTimetable,
    importTimetable,
    reviewKnowledge,
    uploadFiles,
    noticeSeen,
    subjectById,
    stats: api.files.stats,
    syncStatus: api.sync.status,
  };
});
