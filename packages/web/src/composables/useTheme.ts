import { ref } from "vue";
import { THEME_STORAGE_KEY } from "@starry/shared";

export type ThemeMode = "dark" | "light" | "auto";

export const THEME_MODES: ThemeMode[] = ["dark", "light", "auto"];
export const THEME_LABEL: Record<ThemeMode, string> = {
  dark: "深色",
  light: "浅色",
  auto: "跟随系统",
};

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "auto") return v;
  } catch {
    // localStorage 被禁用时退回深色，不影响渲染
  }
  return "dark";
}

// 主题是全局单例：首帧内联脚本已经按 localStorage 切过一次，这里保持一致
const mode = ref<ThemeMode>(read());

function isLight(m: ThemeMode): boolean {
  return (
    m === "light" ||
    (m === "auto" && window.matchMedia("(prefers-color-scheme: light)").matches)
  );
}

function apply(): void {
  const light = isLight(mode.value);
  const el = document.documentElement;
  el.classList.toggle("light", light);
  el.classList.toggle("dark", !light);
  el.style.colorScheme = light ? "light" : "dark";
}

function setTheme(m: ThemeMode): void {
  mode.value = m;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, m);
  } catch {
    // 存不了就算了，本次会话内仍然生效
  }
  apply();
}

let media: MediaQueryList | null = null;
function watchSystem(): void {
  if (media) return;
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener?.("change", () => {
    if (mode.value === "auto") apply();
  });
}

export function useTheme() {
  return { mode, setTheme, apply, watchSystem };
}
