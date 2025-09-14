import type { RumTransport } from '../core/plugin';

const OFFLINE_KEY = '__RUM_OFFLINE_Q__';

export function createTransport(opts: {
  endpoint?: string;
  appId: string;
  release: string;
}): RumTransport {
  const queue: any[] = [];
  let timer: number | null = null;

  // ✅ 订阅总线（给 Demo/DevTools 用）
  const subs: Array<(e: any) => void> = [];
  const emit = (e: any) => { for (const f of subs) { try { f(e); } catch {} } };

  // —— 离线回放 —— //
  try {
    const stash = localStorage.getItem(OFFLINE_KEY);
    if (stash) {
      const old = JSON.parse(stash);
      if (Array.isArray(old)) queue.push(...old);
      localStorage.removeItem(OFFLINE_KEY);
    }
  } catch {}

  function schedule() {
    if (timer) return;
    timer = window.setTimeout(() => flush(), 2000); // 惰性批量
  }

  function track(e: any) {
    // 统一加时间戳；不修改原对象避免副作用
    const evt = { t: Date.now(), ...e };
    queue.push(evt);
    emit(evt); // ✅ 广播给外部订阅者
    if (queue.length >= 20) flush(true);
    else schedule();
  }

  async function shipBatch(batch: any[], urgent = false) {
    const { endpoint, appId, release } = opts;
    if (!endpoint) return true; // 没配置上报地址：视为开发模式，直接丢弃（Demo 仍可见，因为走了 emit）

    const body = JSON.stringify({ appId, release, sentAt: Date.now(), events: batch });

    // 1) sendBeacon（最稳，不阻塞）
    try {
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        if (ok) return true;
      }
    } catch {}

    // 2) fetch keepalive（支持部分浏览器）
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: urgent // 仅在卸载时尽量 keepalive
      });
      if (res.ok) return true;
    } catch {}

    // 3) Image GET（兜底，长度可能受限）
    try {
      const img = new Image();
      img.src = `${endpoint}?d=${encodeURIComponent(body)}`;
      // 粗略认为触发 onload/onerror 即可
      await new Promise<void>(r => {
        const done = () => { img.onload = img.onerror = null; r(); };
        img.onload = done; img.onerror = done;
        // 加个超时兜底
        setTimeout(done, 1200);
      });
      return true;
    } catch {}

    return false;
  }

  async function flush(urgent = false) {
    if (!queue.length) { if (timer) { clearTimeout(timer); timer = null; } return; }
    const batch = queue.splice(0, queue.length);
    if (timer) { clearTimeout(timer); timer = null; }

    const ok = await shipBatch(batch, urgent);
    if (!ok) {
      // 失败落盘，等待下次机会
      try {
        const prev = localStorage.getItem(OFFLINE_KEY);
        const old = prev ? JSON.parse(prev) : [];
        localStorage.setItem(OFFLINE_KEY, JSON.stringify([...(old || []), ...batch].slice(-2000)));
      } catch {}
    }
  }

  return {
    track,
    flush,
    // ✅ 新增：订阅所有事件
    __subscribe(cb: (e: any) => void) {
      subs.push(cb);
      return () => {
        const i = subs.indexOf(cb);
        if (i >= 0) subs.splice(i, 1);
      };
    }
  };
}
