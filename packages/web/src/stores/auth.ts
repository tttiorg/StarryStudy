import { defineStore } from "pinia";
import { ref } from "vue";

export type AuthState = "loading" | "login" | "setup" | "ready" | "error";

export const useAuthStore = defineStore("auth", () => {
  const state = ref<AuthState>("loading");
  const errorMessage = ref("");

  function block(kind: "login" | "setup"): void {
    state.value = kind;
    errorMessage.value = "";
  }

  function ready(): void {
    state.value = "ready";
    errorMessage.value = "";
  }

  function fail(msg: string): void {
    state.value = "error";
    errorMessage.value = msg;
  }

  return { state, errorMessage, block, ready, fail };
});
