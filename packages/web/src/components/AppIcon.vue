<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";

// 全项目不用 emoji：图标一律内联 SVG（§12）
const ICONS: Record<string, string[]> = {
  bell: [
    "M12 3.2a5.6 5.6 0 00-5.6 5.6v3.1l-1.5 3.6h14.2l-1.5-3.6V8.8A5.6 5.6 0 0012 3.2z",
    "M9.6 18.1a2.5 2.5 0 004.8 0",
  ],
  fullscreen: ["M4 9V4h5M20 9V4h-5M20 15v5h-5M4 15v5h5"],
  exitFullscreen: ["M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"],
  settings: [
    "M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z",
    "M19.4 13.5a7.7 7.7 0 000-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2.6-1.5L14 2h-4l-.4 2.9A7.6 7.6 0 007 6.4l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 000 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002.6 1.5L12 22h4l.4-2.9a7.6 7.6 0 002.6-1.5l2.4 1 2-3.4z",
  ],
  plus: ["M12 5v14M5 12h14"],
  chevronLeft: ["M15 5l-7 7 7 7"],
  chevronRight: ["M9 5l7 7-7 7"],
  chevronUp: ["M5 15l7-7 7 7"],
  chevronDown: ["M5 9l7 7 7-7"],
  check: ["M4 12l5 5L20 6"],
  close: ["M5 5l14 14M19 5L5 19"],
  pin: ["M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6z", "M12 14v7"],
  upload: ["M12 16V4M7 9l5-5 5 5", "M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"],
  edit: ["M4 20h4l10-10-4-4L4 16v4z", "M13.5 6.5l4 4"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  search: ["M11 19a8 8 0 100-16 8 8 0 000 16z", "M21 21l-4.3-4.3"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"],
  calendar: ["M4 6h16v14H4z", "M8 3v4M16 3v4M4 10h16"],
  book: ["M4 5h7a3 3 0 013 3v12a3 3 0 00-3-3H4z", "M20 5h-3a3 3 0 00-3 3v12a3 3 0 013-3h3z"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v5h4"],
  clock: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M12 7v5l3 2"],
  refresh: ["M20 11a8 8 0 10-2 6", "M20 5v6h-6"],
  sun: [
    "M12 17a5 5 0 100-10 5 5 0 000 10z",
    "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  ],
  moon: ["M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"],
  logout: ["M10 4H5a1 1 0 00-1 1v14a1 1 0 001 1h5", "M15 8l4 4-4 4M19 12H9"],
  more: ["M5 12h2M11 12h2M17 12h2"],
  star: ["M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.9z"],
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  list: ["M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"],
  alert: ["M12 3L2 21h20L12 3z", "M12 9v5M12 17h.01"],
  eye: ["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z", "M12 15a3 3 0 100-6 3 3 0 000 6z"],
  note: ["M5 4h14v12l-4 4H5z", "M15 20v-4h4M8 8h8M8 12h6"],
};

const props = withDefaults(
  defineProps<{ name: string; size?: number | string; strokeWidth?: number | string }>(),
  { size: 16, strokeWidth: 1.8 },
);

const paths = computed(() => ICONS[props.name] ?? []);
</script>
