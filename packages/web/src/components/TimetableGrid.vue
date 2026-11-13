<template>
  <div class="tt-wrap" :class="{ compact }">
    <table class="tt">
      <thead>
        <tr>
          <th class="corner">{{ compact ? "节次" : "节次 / 时间" }}</th>
          <th v-for="d in dayList" :key="d" :class="{ today: d === todayDay }">
            {{ DAYS[d - 1] }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in blockList" :key="b.index">
          <td class="period">
            <span class="pno">{{ b.label }}</span>
            <span v-if="!compact" class="ptime">{{ b.time }}</span>
          </td>
          <td
            v-for="d in dayList"
            :key="d"
            class="cell"
            :class="{ filled: hasSlot(d, b.index), today: d === todayDay }"
            @click="onCell(d, b.index)"
            @contextmenu.prevent="onCellMenu($event, d, b.index)"
          >
            <template v-if="hasSlot(d, b.index)">
              <div class="c-name">
                <span class="c-dot" :style="{ background: colorOf(slotOf(d, b.index)) }" />
                <span class="c-text">{{ shortName(slotOf(d, b.index)) }}</span>
              </div>
              <div v-if="slotOf(d, b.index).room" class="c-meta">
                {{ slotOf(d, b.index).room }}
              </div>
              <div v-if="compact && slotOf(d, b.index).teacher" class="c-meta">
                {{ slotOf(d, b.index).teacher }}
              </div>
            </template>
            <span v-else class="c-empty">
              <AppIcon v-if="editable" name="plus" :size="12" />
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { BLOCKS, DAYS, weekdayInTZ } from "@starry/shared";
import type { Subject, TimetableBlock, TimetableSlot } from "@starry/shared";
import AppIcon from "@/components/AppIcon.vue";

interface CellPayload {
  day: number;
  block: number;
  slot: TimetableSlot | null;
}

const props = withDefaults(
  defineProps<{
    slots?: TimetableSlot[];
    blocks?: TimetableBlock[];
    subjects?: Subject[];
    days?: number;
    compact?: boolean;
    editable?: boolean;
  }>(),
  {
    slots: () => [],
    blocks: () => BLOCKS as TimetableBlock[],
    subjects: () => [],
    days: 7,
    compact: false,
    editable: false,
  },
);

const emit = defineEmits(["cell-click", "cell-menu"]);

const dayList = computed(() => Array.from({ length: props.days }, (_, i) => i + 1));
const blockList = computed<TimetableBlock[]>(() =>
  props.blocks.length ? props.blocks : (BLOCKS as TimetableBlock[]),
);
// 今天是周几（1-7），由 shared 按 Asia/Shanghai 算，不直接取系统时间（CF-06）
const todayDay = weekdayInTZ();

const map = computed<Record<string, TimetableSlot>>(() => {
  const m: Record<string, TimetableSlot> = {};
  for (const s of props.slots) m[`${s.day}-${s.block}`] = s;
  return m;
});

const EMPTY_SLOT: TimetableSlot = {
  day: 0,
  block: 0,
  name: "",
  room: "",
  teacher: "",
  weeks: "",
  subjectId: null,
  rev: 0,
  updatedAt: "",
};

function hasSlot(day: number, block: number): boolean {
  return !!map.value[`${day}-${block}`];
}

function slotOf(day: number, block: number): TimetableSlot {
  return map.value[`${day}-${block}`] ?? EMPTY_SLOT;
}

function slotAt(day: number, block: number): TimetableSlot | null {
  return map.value[`${day}-${block}`] ?? null;
}

function subjectOf(slot: TimetableSlot): Subject | undefined {
  return props.subjects.find((x) => x.id === slot.subjectId);
}

function colorOf(slot: TimetableSlot): string {
  return subjectOf(slot)?.color ?? "#5a6675";
}

/** 名称优先用关联学科；没关联时去掉班级后缀，卡片里放得下 */
function shortName(slot: TimetableSlot): string {
  return subjectOf(slot)?.name ?? slot.name.split(/[-（(]/)[0] ?? slot.name;
}

function onCell(day: number, block: number): void {
  emit("cell-click", { day, block, slot: slotAt(day, block) } as CellPayload);
}

function onCellMenu(e: MouseEvent, day: number, block: number): void {
  emit("cell-menu", e, { day, block, slot: slotAt(day, block) } as CellPayload);
}
</script>

<style scoped>
.tt-wrap {
  overflow-x: auto;
}

.tt {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  min-width: 680px;
}

.tt th {
  font-size: 13px;
  font-weight: 600;
  color: var(--ss-muted);
  padding: 8px 4px;
  border-bottom: 1px solid var(--ss-border);
  background: var(--ss-surface-2);
}

.tt th.today {
  color: var(--ss-accent);
}

.corner {
  width: 96px;
}

.compact .corner {
  width: 72px;
}

.tt td {
  border-bottom: 1px solid var(--ss-border);
  border-right: 1px solid var(--ss-border);
}

.period {
  text-align: center;
  padding: 5px 3px;
  background: var(--ss-surface-2);
}

.pno {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.ptime {
  display: block;
  font-size: 11px;
  color: var(--ss-muted);
  white-space: nowrap;
}

.cell {
  padding: 5px 6px;
  cursor: pointer;
  vertical-align: top;
  height: 54px;
  transition: background 0.13s;
}

.cell:hover {
  background: var(--ss-surface-2);
}

.cell.filled {
  background: color-mix(in srgb, var(--ss-accent) 5%, transparent);
}

.cell.today {
  background: color-mix(in srgb, var(--ss-accent) 9%, transparent);
}

.c-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 42px;
  color: var(--ss-dim);
}

.cell:hover .c-empty {
  color: var(--ss-accent);
}

.c-name {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 12.8px;
  font-weight: 600;
  line-height: 1.3;
}

.c-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex: none;
  margin-top: 5px;
}

.c-text {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.c-meta {
  font-size: 11px;
  color: var(--ss-muted);
  margin-top: 2px;
  margin-left: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.15px;
}

.compact .tt tbody tr td {
  height: 46px;
}

.compact .c-name {
  font-size: 12.2px;
}

/* 窄屏：5 天紧凑表可以缩到内容区，7 天表给个下限让它在卡片内横向滚动。
   这些规则放在最后，避免被上面的基础字号覆盖。 */
@media (max-width: 700px) {
  .tt {
    min-width: 0;
  }
  .tt-wrap:not(.compact) .tt {
    min-width: 500px;
  }
  .corner {
    width: 46px;
  }
  .compact .corner {
    width: 40px;
  }
  .tt th {
    font-size: 10px;
    padding: 6px 1px;
    letter-spacing: -0.3px;
  }
  .tt td {
    font-size: 10px;
  }
  .period {
    padding: 4px 1px;
  }
  .pno {
    font-size: 10px;
  }
  .ptime {
    font-size: 9.5px;
  }
  .cell {
    padding: 4px 3px;
    height: 50px;
  }
  .c-name {
    font-size: 10.5px;
    gap: 3px;
  }
  .c-dot {
    width: 4px;
    height: 4px;
    margin-top: 4px;
  }
  .c-meta {
    font-size: 9.5px;
    margin-left: 7px;
    letter-spacing: -0.25px;
  }
  .c-empty {
    height: 40px;
  }
  .compact .tt tbody tr td {
    height: 44px;
  }
}

@media (max-width: 400px) {
  .corner {
    width: 38px;
  }
  .compact .corner {
    width: 34px;
  }
  .tt th {
    font-size: 9.5px;
    letter-spacing: -0.4px;
  }
  .c-name,
  .compact .c-name {
    font-size: 10px;
  }
  .c-meta {
    font-size: 9px;
    margin-left: 0;
  }
}
</style>
