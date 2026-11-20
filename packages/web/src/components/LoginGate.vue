<template>
  <div class="gate">
    <div class="gate-card">
      <div class="gate-brand">
        <span class="gate-mark">StarryStudy</span>
        <span class="gate-sub">{{ needSetup ? "首次使用" : "欢迎回来" }}</span>
      </div>

      <p v-if="needSetup" class="gate-hint">
        先设置一个访问密码。设完即锁定，只有你能登录，不提供注册入口。
      </p>
      <p v-else class="gate-hint">请输入访问密码</p>

      <form @submit.prevent="submit">
        <label class="gate-field">
          <span>{{ needSetup ? "新密码" : "密码" }}</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
            autofocus
          />
        </label>
        <label v-if="needSetup" class="gate-field">
          <span>再输一次</span>
          <input v-model="confirm" type="password" autocomplete="new-password" :disabled="busy" />
        </label>
        <p v-if="error" class="gate-err">{{ error }}</p>
        <button class="gate-submit" type="submit" :disabled="busy">
          {{ busy ? "处理中…" : needSetup ? "设置并进入" : "进入" }}
        </button>
      </form>

      <p class="gate-tip">密码通过 HttpOnly Cookie 会话保存，不会写进本地存储。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { api, msgOf } from "@/api";

const props = withDefaults(defineProps<{ needSetup?: boolean }>(), { needSetup: false });
const emit = defineEmits<{ done: [] }>();

const password = ref("");
const confirm = ref("");
const busy = ref(false);
const error = ref("");

async function submit(): Promise<void> {
  error.value = "";
  if (!password.value) {
    error.value = "请输入密码";
    return;
  }
  if (props.needSetup) {
    if (password.value.length < 6) {
      error.value = "密码至少 6 位";
      return;
    }
    if (password.value !== confirm.value) {
      error.value = "两次输入不一致";
      return;
    }
  }
  busy.value = true;
  try {
    // 登录成功后服务端 Set-Cookie，前端不接触任何 token
    if (props.needSetup) await api.auth.setup(password.value);
    else await api.auth.login(password.value);
    password.value = "";
    confirm.value = "";
    emit("done");
  } catch (e) {
    error.value = msgOf(e);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ss-bg);
  padding: 16px;
}

.gate-card {
  width: 340px;
  max-width: 100%;
  padding: 26px 24px 20px;
  border: 1px solid var(--ss-border);
  border-radius: var(--ss-radius);
  background: var(--ss-surface);
  box-shadow: var(--ss-shadow);
}

.gate-brand {
  text-align: center;
  margin-bottom: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gate-mark {
  font-size: 17px;
  font-weight: 650;
  color: var(--ss-text);
  letter-spacing: 0.3px;
}

.gate-sub {
  font-size: 12px;
  color: var(--ss-accent);
}

.gate-hint {
  margin: 10px 0 18px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ss-muted);
  text-align: center;
}

.gate-field {
  display: block;
  margin-bottom: 12px;
}

.gate-field span {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--ss-muted);
}

.gate-field input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  font-size: 13.5px;
  color: var(--ss-text);
  background: var(--ss-bg);
  border: 1px solid var(--ss-border);
  border-radius: 8px;
  outline: none;
  font-family: inherit;
}

.gate-field input:focus {
  border-color: var(--ss-accent);
}

.gate-err {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ss-danger);
}

.gate-submit {
  width: 100%;
  padding: 9px 0;
  font-size: 13.5px;
  color: #08181a;
  background: var(--ss-accent);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
}

.gate-submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.gate-tip {
  margin: 14px 0 0;
  font-size: 11.5px;
  text-align: center;
  color: var(--ss-dim);
}
</style>
