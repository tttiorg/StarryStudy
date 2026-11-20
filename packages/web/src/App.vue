<template>
  <LoginGate v-if="gateVisible" :need-setup="auth.state === 'setup'" @done="boot" />

  <div v-else-if="auth.state === 'error'" class="boot-msg">
    <p>{{ auth.errorMessage || "加载失败" }}</p>
    <button class="ss-btn primary" @click="boot">重试</button>
  </div>

  <div
    v-else-if="auth.state === 'ready'"
    class="app-shell"
    :class="{ 'is-booted': booted, 'is-entering': entering }"
  >
    <div class="main-col">
      <header class="topbar">
        <div class="tb-left">
          <span class="brand-dot" />
          <span class="brand-name">StarryStudy</span>
        </div>

        <div class="tb-center">
          <nav class="tabs">
            <router-link to="/" class="tab" :class="{ active: route.name === 'home' }">主页</router-link>
            <router-link to="/timetable" class="tab" :class="{ active: route.name === 'timetable' }">
              课表
            </router-link>
            <router-link
              v-for="s in data.subjects"
              :key="s.id"
              :to="`/subjects/${s.id}`"
              class="tab"
              :class="{ active: route.params.id === s.id }"
              @contextmenu.prevent="ui.openSettings('subjects')"
            >
              <span class="dot" :style="{ background: s.color }" />{{ s.name }}
            </router-link>
          </nav>
        </div>

        <div class="tb-right">
          <NoticeBell :subjects="data.subjects" />
          <button
            class="icon-btn rail-toggle"
            :title="ui.railOpen ? '收起外链' : '展开外链'"
            @click="ui.railOpen = !ui.railOpen"
          >
            <AppIcon name="list" :size="14" />
            <span>外链</span>
          </button>
          <button class="icon-btn" :title="fsActive ? '退出全屏' : '全屏'" @click="toggleFullscreen">
            <AppIcon :name="fsActive ? 'exitFullscreen' : 'fullscreen'" :size="14" />
            <span>{{ fsActive ? "退出" : "全屏" }}</span>
          </button>
          <button class="icon-btn" title="设置" @click="ui.openSettings('profile')">
            <AppIcon name="settings" :size="14" />
            <span>设置</span>
          </button>
        </div>
      </header>

      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <RightRail />
    <SettingsDialog v-model="ui.settingsOpen" />
    <ConflictDialog />
  </div>

  <div v-else class="boot-msg">正在加载…</div>

  <!-- 启动转场挂在外壳层而不是某个页面里：每次页面加载播一次，切路由不重播 -->
  <BootSplash v-if="bootActive" :view="bootView" @finish="skipBoot" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, isUnauthorized, msgOf, onNeedSetup, onUnauthorized } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useDataStore } from "@/stores/data";
import { useTheme } from "@/composables/useTheme";
import { useBoot } from "@/composables/useBoot";
import LoginGate from "@/components/LoginGate.vue";
import NoticeBell from "@/components/NoticeBell.vue";
import RightRail from "@/components/RightRail.vue";
import SettingsDialog from "@/components/SettingsDialog.vue";
import ConflictDialog from "@/components/ConflictDialog.vue";
import AppIcon from "@/components/AppIcon.vue";
import BootSplash from "@/components/BootSplash.vue";

const route = useRoute();
const auth = useAuthStore();
const ui = useUiStore();
const data = useDataStore();
const { apply, watchSystem } = useTheme();
const {
  active: bootActive,
  booted,
  entering,
  view: bootView,
  markReady,
  finish: skipBoot,
} = useBoot();

const gateVisible = computed(() => auth.state === "login" || auth.state === "setup");

/**
 * 启动流程：bootstrap 一次拿全 auth + 学科 + 课表 + 外链 + 未读计数。
 * 401 时再查 auth/status 决定是「首次设密码」还是「登录」，不靠猜测（§7）。
 */
async function boot(): Promise<void> {
  auth.state = "loading";
  try {
    const payload = await api.bootstrap();
    if (payload.auth?.needSetup) {
      auth.block("setup");
      return;
    }
    data.hydrate(payload);
    auth.ready();
    await data.loadAll(false);
  } catch (e) {
    if (isUnauthorized(e)) {
      try {
        const st = await api.auth.status();
        auth.block(st.needSetup ? "setup" : "login");
      } catch {
        auth.block("login");
      }
    } else {
      auth.fail(msgOf(e));
    }
  } finally {
    // 不管成功、失败还是要先设密码，界面状态到这里已经确定，告诉开场转场
    // 可以揭幕；否则登录门控会一直被盖在转场下面（转场最多仍会等 8s 兜底）。
    markReady();
  }
}

/* ---------------- 全屏 ---------------- */
const fsActive = ref(false);

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen?.();
  }
}

function onFsChange(): void {
  fsActive.value = !!document.fullscreenElement;
}

// 401 任意时刻都回登录门控；只在已经进入应用后才切，避免打断 boot 自己的判断
onUnauthorized(() => {
  if (auth.state === "ready") auth.block("login");
});
onNeedSetup(() => auth.block("setup"));

onMounted(() => {
  apply();
  watchSystem();
  document.addEventListener("fullscreenchange", onFsChange);
  void boot();
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFsChange);
});
</script>

<style scoped>
.boot-msg {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--ss-muted);
  font-size: 13.5px;
}

.topbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--ss-border);
  background: var(--ss-surface);
  flex: none;
}

.tb-left {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: var(--ss-accent);
  flex: none;
}

.brand-name {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ss-text);
  white-space: nowrap;
}

.tb-center {
  min-width: 0;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.tb-center::-webkit-scrollbar {
  display: none;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  width: max-content;
  margin: 0 auto;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 15px;
  border-radius: 9px;
  font-size: 14px;
  color: var(--ss-muted);
  text-decoration: none;
  white-space: nowrap;
  /* 标签不允许被压扁：窄屏靠容器横向滚动，而不是把激活标签挤成半个字（FE-05） */
  flex: none;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.tab:hover {
  background: var(--ss-surface-2);
  color: var(--ss-text);
}

.tab.active {
  background: var(--ss-accent-soft);
  color: var(--ss-accent);
  border-color: color-mix(in srgb, var(--ss-accent) 35%, transparent);
  font-weight: 600;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.tb-right {
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--ss-border);
  background: transparent;
  color: var(--ss-text);
  font-size: 12.5px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s;
  flex: none;
}

.icon-btn:hover {
  border-color: var(--ss-accent);
  color: var(--ss-accent);
}

/* 桌面右栏常驻，不需要这个开关；只有窄屏才出现 */
.rail-toggle {
  display: none;
}

@media (max-width: 900px) {
  .rail-toggle {
    display: inline-flex;
  }
}

@media (max-width: 700px) {
  .topbar {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      "left right"
      "center center";
    row-gap: 7px;
    padding: 8px 10px;
  }
  .tb-left {
    grid-area: left;
  }
  .tb-right {
    grid-area: right;
    justify-content: flex-end;
    gap: 6px;
  }
  .tb-center {
    grid-area: center;
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 16px), transparent 100%);
  }
  .tb-right .icon-btn span {
    display: none;
  }
  .tb-right .icon-btn {
    padding: 5px 9px;
  }
}
</style>
