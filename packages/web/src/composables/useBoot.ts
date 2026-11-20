/**
 * 开场转场控制器（从 v1 的 useBoot.js 移植成 TS）
 * ------------------------------------------------------------
 * 为什么用 JS 管时序、CSS 管每帧：
 *   转场结束后要移除节点，而「移除 -> 重新插入」才能让 CSS animation 从头播
 *   （animation 跑完后再加 class 不会重播）。所以这里用 JS 管时序与收尾。
 *
 * 播放策略：
 *   每次页面加载播一次，切路由不重播（转场层挂在 App.vue 外壳层）。
 *   揭幕时机等数据就绪，否则云同步下动画会跑在数据回来之前。
 *
 * 为什么进度数字要读进度条的真实宽度：
 *   CSS 用分段线性控宽度，JS 若另用固定时长估百分比，两套算法必然漂移；
 *   以条子为唯一真源，偏差只剩取整误差。
 */
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from "vue";

export interface BootView {
  wordReady: boolean;
  opening: boolean;
  done: boolean;
  pct: number;
  status: string;
  statusSwapping: boolean;
}

/** 状态文案，at 是相对转场开始的秒数 */
const STEPS = [
  { at: 0.0, text: "正在唤醒学习空间" },
  { at: 0.85, text: "装载课程与课表" },
  { at: 1.35, text: "同步笔记与知识点" },
  { at: 1.72, text: "准备就绪" },
] as const;

export function useBoot() {
  /** 转场层是否还在 DOM 里 */
  const active = ref(false);
  /** 页面是否已亮起（控制外壳可见） */
  const booted = ref(false);
  /**
   * 入场动画是否在跑。约 1.35s 后摘掉 —— 摘掉后整套 animation 规则消失，
   * 元素回到「没有任何动画」的最终态，之后用户增删数据新元素不会被锁在 opacity:0。
   */
  const entering = ref(false);

  const view = reactive<BootView>({
    wordReady: false,
    opening: false,
    done: false,
    pct: 0,
    status: STEPS[0].text,
    statusSwapping: false,
  });

  let finished = false;
  /** 界面数据是否已就绪；转场会等它，避免「动画播完才蹦出界面」 */
  let dataReady = false;
  let rafId = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** App 拿到数据（或确认拿不到）后调用，转场才允许揭幕 */
  function markReady(): void {
    dataReady = true;
  }

  function clearAll(): void {
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(rafId);
    rafId = 0;
    if (keyHandler) {
      window.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
  }

  function later(fn: () => void, ms: number): void {
    timers.push(setTimeout(fn, ms));
  }

  /** 进度百分比：直接读进度条填充元素的真实像素宽度换算。 */
  function trackPercent(fillEl: HTMLElement, onFull: () => void): void {
    const track = fillEl.parentElement;
    if (!track) return;
    // 轨道宽度是固定值，测一次即可，不必每帧读
    const total = track.getBoundingClientRect().width;
    let full = false;

    const tick = (): void => {
      if (finished) return;
      const w = fillEl.getBoundingClientRect().width;
      const pct = total > 0 ? Math.min(100, Math.round((w / total) * 100)) : 0;
      view.pct = pct;
      if (pct >= 100 && !full) {
        full = true;
        onFull();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  /** 按时间点切换状态文案，切换时做一次淡出淡入 */
  function scheduleStatus(): void {
    for (const step of STEPS) {
      if (step.at === 0) continue;
      later(() => {
        if (finished) return;
        view.statusSwapping = true;
        later(() => {
          view.status = step.text;
          view.statusSwapping = false;
        }, 150);
      }, step.at * 1000);
    }
  }

  /** 收尾：劈开 -> 亮出页面 -> 拆掉转场层 */
  function finish(skipped: boolean): void {
    if (finished) return;
    finished = true;
    clearAll();

    // 跳过时把进度直接补满，避免视觉上突然断掉
    if (skipped) {
      view.pct = 100;
      view.status = STEPS[STEPS.length - 1].text;
    }

    // 进度条走满后停在 100% 等界面数据；等待期间屏幕上是「准备就绪 100%」
    // 的转场，比「挡板推开、下面 opacity:0 空一会儿」自然得多。
    const revealAt = skipped ? 200 : 460;
    const MAX_WAIT = 8000;

    const go = (): void => {
      view.opening = true;
      // 挡板是 0.72s 的位移，页面必须在挡板推开足够多之后才亮
      later(() => {
        booted.value = true;
        entering.value = true;
        later(() => {
          entering.value = false;
        }, 1350);
      }, revealAt);

      // 挡板走完后整层淡出，不留空窗
      const fadeAt = skipped ? 700 : 760;
      later(() => {
        view.done = true;
        later(() => {
          active.value = false;
        }, 460);
      }, fadeAt);
    };

    let waited = 0;
    const waitReady = (): void => {
      if (dataReady || waited >= MAX_WAIT) {
        go();
        return;
      }
      waited += 100;
      later(waitReady, 100);
    };
    waitReady();
  }

  /** 点击 / Esc / 空格 / Enter 跳过 */
  function bindSkip(): void {
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
    keyHandler = (e: KeyboardEvent): void => {
      if (finished) return;
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        finish(true);
      }
    };
    window.addEventListener("keydown", keyHandler);
  }

  /** 真正开跑 */
  async function run(): Promise<void> {
    // 重置所有运行时状态；少任何一个，第二次启动都会失效
    finished = false;
    clearAll();
    view.wordReady = false;
    view.opening = false;
    view.done = false;
    view.pct = 0;
    view.status = STEPS[0].text;
    view.statusSwapping = false;

    view.wordReady = true;
    await nextTick();

    // 兜底：无论 DOM 结构是否对得上，这个定时器都要把页面亮出来。
    // 否则 .app-shell:not(.is-booted) 会把整页永久锁在 opacity:0。
    later(() => finish(false), 2600);

    const fillEl = document.querySelector<HTMLElement>(".boot-bar-fill");
    if (fillEl) {
      scheduleStatus();
      // 标签页在后台时 rAF 会被节流，onFull 可能永远不触发，
      // 所以上面那个 2600ms 定时器先到就先劈（finish 内部有锁）。
      trackPercent(fillEl, () => finish(false));
    } else {
      later(() => finish(false), 900);
    }

    bindSkip();
  }

  onMounted(() => {
    // 每次页面加载播一次；切路由不会重播，因为转场层挂在 App.vue 上。
    // 尊重系统「减少动效」：直接亮出页面，不播也不留黑屏。
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      finished = true;
      booted.value = true;
      entering.value = false;
      active.value = false;
      return;
    }
    active.value = true;
    void run();
  });

  onBeforeUnmount(clearAll);

  return {
    active,
    booted,
    entering,
    view,
    markReady,
    finish: () => finish(true),
  };
}
