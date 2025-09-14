// packages/rum-core/src/plugins/perf.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

/**
 * 性能采集：
 * - Navigation: TTFB、FP/FCP
 * - LongTask: >50ms
 * - Web Vitals: LCP/CLS/INP（优先 web-vitals；否则回退到 LCP/CLS/FID）
 * - 白屏粗探
 * - NetworkInfo 一次性采集
 * - teardown: 断开观察器与事件
 */

const LONG_TASK_MS = 50;
const WHITE_MS = 3000;

type AnyFn = (...a: any[]) => void;

let offVis: AnyFn | undefined;
let offHide: AnyFn | undefined;
let loadHandler: AnyFn | undefined;
let whiteTimer: number | undefined;

let longObs: PerformanceObserver | undefined;
let lcpObs: PerformanceObserver | undefined;
let clsObs: PerformanceObserver | undefined;
let fidObs: PerformanceObserver | undefined;

export const perfPlugin: RumPlugin = {
  name: 'perf',

  setup(ctx: RumContext, t: RumTransport) {
    t.track({ type: '__plugin_loaded', plugin: 'perf' });

    /* -------------------- Navigation + Paint -------------------- */
    const onLoad = () => {
      try {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        if (nav) {
          t.track({ type: 'ttfb', value: nav.responseStart - nav.requestStart, pageId: ctx.pageId });
          t.track({
            type: 'nav',
            pageId: ctx.pageId,
            domInteractive: nav.domInteractive,
            dcl: nav.domContentLoadedEventEnd - nav.startTime,
            load: nav.loadEventEnd - nav.startTime
          });
        }
        performance.getEntriesByType('paint').forEach((p: any) => {
          if (p?.name === 'first-paint' || p?.name === 'first-contentful-paint') {
            t.track({ type: p.name, value: p.startTime, pageId: ctx.pageId });
          }
        });
      } catch {}
    };
    if (document.readyState === 'complete') onLoad();
    addEventListener('load', onLoad);
    loadHandler = () => removeEventListener('load', onLoad);

    /* --------------------------- LongTask --------------------------- */
    try {
      longObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any) {
          if (e.duration >= LONG_TASK_MS) {
            t.track({ type: 'longtask', value: e.duration, pageId: ctx.pageId });
          }
        }
      });
      // 兼容新旧 observe 签名（type/buffered 或 entryTypes）
      safeObserve(longObs, 'longtask', true);
    } catch {}

    /* ------------------------- Web Vitals ------------------------- */
    let vitalsInstalled = false;
    try {
      // 可选依赖：没装就走回退
      // @ts-ignore - 运行时动态导入，类型不强求
      import('web-vitals/attribution').then(({ onLCP, onCLS, onINP }) => {
        vitalsInstalled = true;
        onLCP((m: any) => t.track({ type: 'lcp', value: m.value, pageId: ctx.pageId }));
        onCLS((m: any) => t.track({ type: 'cls', value: m.value, pageId: ctx.pageId }));
        onINP((m: any) => t.track({ type: 'inp', value: m.value, pageId: ctx.pageId }));
      }).catch(() => setupFallbackVitals(ctx, t));
    } catch {
      setupFallbackVitals(ctx, t);
    }
    // 兜底：1s 内还没装上就回退一次，避免卡住
    setTimeout(() => { if (!vitalsInstalled) setupFallbackVitals(ctx, t); }, 1000);

    /* --------------------------- 白屏粗探 --------------------------- */
    whiteTimer = window.setTimeout(() => {
      try {
        const count = document.body ? document.body.querySelectorAll('*').length : 0;
        if (count < 50) t.track({ type: 'whitescreen', nodes: count, pageId: ctx.pageId });
      } catch {}
    }, WHITE_MS);

    /* ------------------------ Network Information ----------------------- */
    try {
      const con = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (con) {
        t.track({
          type: 'netinfo',
          effectiveType: String(con.effectiveType || ''),
          rtt: Number(con.rtt || 0),
          downlink: Number(con.downlink || 0),
          saveData: Boolean(con.saveData || false),
          pageId: ctx.pageId
        });
      }
    } catch {}

    /* ------------------------- 可见性收尾 ------------------------- */
    const onHidden = onceOnHidden(() => {
      tryFinalizeFallbackVitals(t, ctx);
    });
    offVis = () => document.removeEventListener('visibilitychange', onHidden, true);
    offHide = () => removeEventListener('pagehide', onHidden, true);
  },

  teardown() {
    try { longObs?.disconnect(); } catch {}
    try { lcpObs?.disconnect(); } catch {}
    try { clsObs?.disconnect(); } catch {}
    try { fidObs?.disconnect(); } catch {}
    longObs = lcpObs = clsObs = fidObs = undefined;

    offVis?.(); offHide?.(); offVis = offHide = undefined;
    loadHandler?.(); loadHandler = undefined;
    if (whiteTimer) { clearTimeout(whiteTimer); whiteTimer = undefined; }
  }
};

/* ============================== 回退实现 ============================== */

let fallbackInstalled = false;
let lcpValue = 0;
let clsValue = 0;
let fidValue = 0;
let finalized = false;

function setupFallbackVitals(ctx: RumContext, t: RumTransport) {
  if (fallbackInstalled) return;
  fallbackInstalled = true;

  // LCP
  try {
    lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as any;
      if (last) lcpValue = last.startTime;
    });
    safeObserve(lcpObs, 'largest-contentful-paint', true);
  } catch {}

  // CLS
  try {
    clsValue = 0;
    clsObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any) {
        if (!e.hadRecentInput) clsValue += e.value;
      }
    });
    safeObserve(clsObs, 'layout-shift', true);
  } catch {}

  // INP 回退：FID
  try {
    fidObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        const delay = Math.max(0, (e as any).processingStart - e.startTime);
        if (delay) fidValue = delay;
      }
    });
    safeObserve(fidObs, 'first-input', true);
  } catch {}

  const finalize = () => {
    if (finalized) return;
    finalized = true;
    try { lcpObs?.disconnect(); } catch {}
    try { clsObs?.disconnect(); } catch {}
    try { fidObs?.disconnect(); } catch {}

    if (lcpValue) t.track({ type: 'lcp', value: lcpValue, pageId: ctx.pageId });
    if (clsValue) t.track({ type: 'cls', value: Number(clsValue.toFixed(4)), pageId: ctx.pageId });
    if (fidValue) t.track({ type: 'fid', value: fidValue, pageId: ctx.pageId });
  };

  (tryFinalizeFallbackVitals as any)._ = finalize;
}

function tryFinalizeFallbackVitals(t: RumTransport, ctx: RumContext) {
  const fn: AnyFn | undefined = (tryFinalizeFallbackVitals as any)._;
  if (fn) fn();
}

/* ============================== 小工具区 ============================== */

// 兼容新版 {type, buffered} 与旧版 {entryTypes:['x']}，并移除 @ts-expect-error
function safeObserve(po: PerformanceObserver | undefined, type: string, buffered = false) {
  if (!po) return;
  try {
    (po as any).observe({ type, buffered });
  } catch {
    try {
      po.observe({ entryTypes: [type] as any });
    } catch { /* ignore */ }
  }
}

function onceOnHidden(cb: AnyFn) {
  let done = false;
  const wrap = () => {
    if (done) return;
    if (document.visibilityState === 'hidden') { done = true; cb(); }
  };
  document.addEventListener('visibilitychange', wrap, true);
  addEventListener('pagehide', wrap, { capture: true, once: true } as any);
  return wrap;
}
