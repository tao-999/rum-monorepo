/** ======== 最小 Svelte Store 协议实现（零依赖） ======== */
export type Unsubscribe = () => void;
export type Subscriber<T> = (value: T) => void;
export type Invalidator<T> = (value?: T) => void;

export type Readable<T> = {
  subscribe(run: Subscriber<T>, invalidate?: Invalidator<T>): Unsubscribe;
};

export function readable<T>(
  initial: T,
  start?: (set: (v: T) => void) => void | Unsubscribe
): Readable<T> {
  let value = initial;
  const subs = new Set<Subscriber<T>>();
  let stop: Unsubscribe | void;

  const set = (v: T) => {
    value = v;
    subs.forEach((fn) => {
      try { fn(value); } catch {}
    });
  };

  return {
    subscribe(run: Subscriber<T>): Unsubscribe {
      if (subs.size === 0 && start) stop = start(set);
      try { run(value); } catch {}
      subs.add(run);
      return () => {
        subs.delete(run);
        if (subs.size === 0 && stop) {
          try { stop(); } catch {}
          stop = undefined;
        }
      };
    }
  };
}

/** ======== 公共类型 ======== */
export type TrackFn = (e: any) => void;

export type RumSvelteClient = {
  track: TrackFn;
  onEvent?: (cb: (e: any) => void) => () => void;
};

export type CreateStoreOptions = {
  bufferSize?: number;   // 事件环形缓冲区大小（默认 200）
  attachGlobal?: boolean;// 是否自动挂载 window.onerror / unhandledrejection（默认 true）
};

/** ======== 事件 Store：订阅 client 总线，拿到全部事件 ======== */
export function createRUMEventStore(
  client: RumSvelteClient,
  opts: CreateStoreOptions = {}
): Readable<any[]> {
  const size = Math.max(1, opts.bufferSize ?? 200);
  let buf: any[] = [];

  return readable<any[]>([], (set: (v: any[]) => void) => {
    // 订阅 SDK 总线
    const offBus = client.onEvent?.((e) => {
      buf.unshift(e);
      if (buf.length > size) buf.length = size;
      set(buf.slice());
    });

    // 可选：全局错误兜底（即使没用 errorPlugin 也能看到）
    let off1: Unsubscribe | undefined;
    let off2: Unsubscribe | undefined;
    if (opts.attachGlobal !== false) {
      const onErr = (ev: ErrorEvent) => {
        try {
          client.track({
            type: 'js-error',
            message: String(ev.message || ''),
            filename: String(ev.filename || ''),
            lineno: Number(ev.lineno || 0),
            colno: Number(ev.colno || 0),
            stack: cut(String(ev.error?.stack || ''), 2000)
          });
        } catch {}
      };
      const onRej = (ev: PromiseRejectionEvent) => {
        try {
          const e = normalizeError(ev.reason);
          client.track({
            type: 'promise-reject',
            reason: cut(e.message, 500),
            stack: cut(String(e.stack || ''), 2000)
          });
        } catch {}
      };
      addEventListener('error', onErr, true);
      addEventListener('unhandledrejection', onRej, true);
      off1 = () => removeEventListener('error', onErr, true);
      off2 = () => removeEventListener('unhandledrejection', onRej, true);
    }

    return () => {
      offBus?.();
      off1?.();
      off2?.();
    };
  });
}

/** ======== Hook 风格：手动上报（配合 try/catch） ======== */
export function useRUMReport(track?: TrackFn) {
  let _track = track;
  return (err: unknown) => {
    if (!_track) return;
    const e = normalizeError(err);
    _track({
      type: 'svelte-error',
      message: cut(e.message, 500),
      stack: cut(String(e.stack || ''), 2000),
      componentStack: '' // Svelte 无统一组件栈，这里留空
    });
  };
}

/** ======== Svelte Action：自动跟踪交互（可选） ========
 * 用法（在 Svelte 组件中）：
 *   <button use:rumTrackOn={{ type:'click', name:'btn-1', track: client.track }}>...</button>
 */
export function rumTrackOn(node: HTMLElement, params?: { type?: string; name?: string; track?: TrackFn }) {
  const p = { ...(params || {}) };
  let type = p.type || 'click';

  const handler = () => {
    try {
      p.track?.({
        type: 'behavior',
        action: 'dom-' + type,
        name: p.name || inferName(node),
        x: lastMouse.x,
        y: lastMouse.y
      });
    } catch {}
  };

  node.addEventListener(type, handler, true);
  return {
    update(next?: { type?: string; name?: string; track?: TrackFn }) {
      const nextType = next?.type || 'click';
      if (nextType !== type) {
        node.removeEventListener(type, handler, true);
        node.addEventListener(nextType, handler, true);
        type = nextType;
      }
      if (next?.track) p.track = next.track;
      if (next?.name) p.name = next.name;
    },
    destroy() {
      node.removeEventListener(type, handler, true);
    }
  };
}

/** ======== 小工具们 ======== */
function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  try {
    const anyErr = err as any;
    const msg = anyErr?.message ? String(anyErr.message) : String(err);
    const e = new Error(msg);
    (e as any).stack = anyErr?.stack || e.stack;
    return e;
  } catch {
    return new Error(String(err));
  }
}

function cut(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}

const lastMouse = { x: 0, y: 0 };
addEventListener(
  'mousemove',
  (e) => {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
  },
  { passive: true }
);

function inferName(el: HTMLElement | null): string {
  if (!el) return '';
  const id = el.id ? `#${el.id}` : '';
  const cls =
    el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
}
