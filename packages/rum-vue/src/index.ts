// packages/rum-vue/src/index.ts
import type { App, ComponentPublicInstance } from 'vue';

export type RumVueOptions = {
  /** 直接传 rum-core 客户端（优先级低于 track） */
  client?: { track: (e: any) => void };
  /** 自定义上报函数（优先级高） */
  track?: (e: any) => void;

  /** 业务侧可接入的错误回调（原样透传） */
  onError?: (err: unknown, instance: ComponentPublicInstance | null, info: string) => void;
  /** 业务侧可接入的告警回调（注意：Vue3 的 trace 是 string，不是 string[]） */
  onWarn?: (msg: string, instance: ComponentPublicInstance | null, trace: string) => void;

  /** 是否包含组件 props（默认 false，谨慎开启避免 PII） */
  includeProps?: boolean;
  /** warn 采样率（0~1，默认 0 不采） */
  warnSampleRate?: number;

  /** 去重时间窗（毫秒） */
  dedupWindowMs?: number;
  /** 截断长度（防 payload 过大） */
  maxMessageLen?: number;
  maxStackLen?: number;
};

export default {
  install(app: App, opts: RumVueOptions = {}) {
    const track = opts.track ?? opts.client?.track;
    const warnSample = typeof opts.warnSampleRate === 'number' ? opts.warnSampleRate : 0;
    const DEDUP = opts.dedupWindowMs ?? 10_000;
    const MAX_MSG = opts.maxMessageLen ?? 500;
    const MAX_STACK = opts.maxStackLen ?? 2000;
    const INCLUDE_PROPS = !!opts.includeProps;

    const seen = new Map<string, number>();
    const prevErr = app.config.errorHandler;
    const prevWarn = app.config.warnHandler;

    // 全局错误处理
    app.config.errorHandler = (err: unknown, instance: ComponentPublicInstance | null, info: string): void => {
      try {
        const message = safeMessage(err, MAX_MSG);
        const stack = safeStack(err, MAX_STACK);
        const name = compName(instance);
        const props = INCLUDE_PROPS ? shallowProps(instance) : undefined;

        const key = hash(`${message}|${name}|${firstLines(stack, 5)}|${info}`).toString(36);
        if (!dedup(seen, key, DEDUP)) {
          track?.({ type: 'vue-error', message, stack, name, info, props });
        }
      } catch {}

      try { opts.onError?.(err, instance, info); } catch {}
      try { prevErr?.(err as any, instance as any, info); } catch {}
    };

    // 全局告警（注意 trace 是 string）
    if (warnSample > 0 || opts.onWarn) {
      app.config.warnHandler = (msg: string, instance: ComponentPublicInstance | null, trace: string): void => {
        try {
          opts.onWarn?.(msg, instance, trace);
          if (warnSample > 0 && Math.random() < warnSample) {
            const traceLines = String(trace || '').split('\n').slice(0, 5); // 如需数组，这里自行拆
            track?.({
              type: 'vue-warn',
              message: String(msg).slice(0, MAX_MSG),
              name: compName(instance),
              trace,          // 原样 string
              traceLines      // 方便后端/分析（可选）
            });
          }
        } catch {}

        try { prevWarn?.(msg, instance, trace); } catch {}
      };
    }

    // 给业务一个全局入口
    try { (app.config.globalProperties as any).$rum = (evt: any) => track?.(evt); } catch {}
  }
};

/* ------------------------- 工具函数 ------------------------- */

function safeMessage(err: unknown, max: number): string {
  if (err == null) return '';
  if (typeof err === 'string') return cut(err, max);
  const any = err as any;
  const name = any?.name ? String(any.name) + ': ' : '';
  const msg = any?.message ? String(any.message) : String(any);
  return cut(name + msg, max);
}

function safeStack(err: unknown, max: number): string {
  const s = (err as any)?.stack ? String((err as any).stack) : '';
  return cut(s, max);
}

function compName(i: ComponentPublicInstance | null | undefined): string {
  try {
    const any = i as any;
    return (
      any?.$?.type?.name ||
      any?.$?.type?.__name ||
      any?.$options?.name ||
      any?.$?.type?.__file ||
      'AnonymousComponent'
    );
  } catch { return 'AnonymousComponent'; }
}

function shallowProps(i: ComponentPublicInstance | null | undefined): Record<string, unknown> | undefined {
  try {
    const src = (i as any)?.$props || (i as any)?.$?.props;
    if (!src) return undefined;
    const dst: Record<string, unknown> = {};
    Object.keys(src).slice(0, 20).forEach(k => {
      const v = src[k];
      if (v == null) dst[k] = v;
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') dst[k] = v;
      else dst[k] = String(v).slice(0, 120);
    });
    return dst;
  } catch { return undefined; }
}

function cut(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
function firstLines(txt: string, n = 5): string {
  return (txt || '').split('\n').slice(0, n).join('\n');
}
function hash(input: string): number {
  let h = 5381, i = input.length;
  while (i) h = (h * 33) ^ input.charCodeAt(--i);
  return h >>> 0;
}
function dedup(seen: Map<string, number>, key: string, win: number): boolean {
  const now = Date.now();
  const last = seen.get(key) || 0;
  if (now - last < win) return true;
  seen.set(key, now);
  if (seen.size > 200) {
    const cutoff = now - win * 2;
    for (const [k, ts] of seen) if (ts < cutoff) seen.delete(k);
  }
  return false;
}
