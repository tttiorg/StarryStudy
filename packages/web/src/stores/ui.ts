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
  const conflict = ref<ConflictState | null>(null);

  function openSettings(tab = "profile"): void {
    settingsTab.value = tab;
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
    conflict,
    openSettings,
    openConflict,
    settleConflict,
  };
});
