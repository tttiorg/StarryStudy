import { defineStore } from "pinia";
import { ref } from "vue";

export type ConflictChoice = "mine" | "server" | "cancel";

export interface ConflictState {
  local: Record<string, unknown>;
  server: Record<string, unknown>;
  resolve: (choice: ConflictChoice) => void;
}

export const useUiStore = defineStore("ui", () => {
  const settingsOpen = ref(false);
  const settingsTab = ref("profile");
  // 从学科页「设置 BB 链接」跳过来时，自动在学科管理里展开这一门。
  const settingsFocusSubject = ref<string | null>(null);
  const conflict = ref<ConflictState | null>(null);
  // 窄屏外链栏默认收起；桌面常驻，这个开关只在窄屏生效。
  const railOpen = ref(false);

  function openSettings(tab = "profile", focusSubjectId: string | null = null): void {
    settingsTab.value = tab;
    settingsFocusSubject.value = focusSubjectId;
    settingsOpen.value = true;
  }

  /** 挂起一个 Promise，等对话框里用户选完再继续写流程 */
  function openConflict(
    local: Record<string, unknown>,
    server: Record<string, unknown>,
  ): Promise<ConflictChoice> {
    return new Promise((resolve) => {
      conflict.value = { local, server, resolve };
    });
  }

  function settleConflict(choice: ConflictChoice): void {
    const pending = conflict.value;
    conflict.value = null;
    pending?.resolve(choice);
  }

  return {
    settingsOpen,
    settingsTab,
    settingsFocusSubject,
    conflict,
    railOpen,
    openSettings,
    openConflict,
    settleConflict,
  };
});
