// packages/rum-core/src/plugins/error.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

/**
 * 错误采集插件（纯原生）：
 * - JS 运行时错误（ErrorEvent）
 * - 资源加载错误（<img>/<script>/<link> 等，capture 阶段）
 * - Promise 未处理拒绝（unhandledrejection）
 * - CSP 违规（securitypolicyviolation）
 * 附加：
 * - 指纹去重（短时间内相同错误只上报一次）
 * - URL 白名单脱敏（仅保留 ctx.allowParams 指定的 query）
 * - 栈与字段长度截断，防止超大 payload
 */

type AnyFn = (...a: any[]) => void;

const DEDUP_WINDOW_MS = 10_000; // 指纹去重窗口
const MAX_STACK = 2000;
const MAX_MSG   = 500;

let offErr: AnyFn | undefined;
let offRej: AnyFn | undefined;
let offCsp: AnyFn | undefined;

export const errorPlugin: RumPlugin = {
  name: 'error',
  setup(ctx: RumContext, t: RumTransport) {
    // 自检事件
    t.track({ type: '__plugin_loaded', plugin: 'error' });

    const seen = new Map<string, number>();

    const onError = (ev: Event) => {
      // 资源错误：ev.target 有 src/href；不会冒泡，必须 capture
      const any = ev as any;
      const target = (any as any).target;
      if (target && (target.src || target.href)) {
        const tag = (target.tagName || '').toUpperCase();
        const rawUrl = target.src || target.href;
        const url = stripUrl(rawUrl, ctx.allowParams);
        if (dedup(seen, fpRes(tag, url))) return;
        t.track({
          type: 'res-error',
          tag,
          url,
          pageId: ctx.pageId
        });
        return;
      }

      // JS 运行时错误
      const e = ev as ErrorEvent;
      // 某些环境（旧 X5）filename 可能为空
      const filename = safeStr(e.filename, 300);
      const message = safeStr(e.message, MAX_MSG);
      const lineno  = e.lineno ?? 0;
      const colno   = e.colno ?? 0;
      const stack   = safeStr(e.error?.stack || '', MAX_STACK);

      if (dedup(seen, fpJs(message, filename, lineno, colno, stack))) return;

      t.track({
        type: 'js-error',
        message,
        filename,
        lineno,
        colno,
        stack,
        pageId: ctx.pageId
      });
    };

    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = toReason(ev.reason);
      const stack  = extractStack(ev.reason);
      if (dedup(seen, fpRej(reason, stack))) return;
      t.track({
        type: 'promise-reject',
        reason,
        stack,
        pageId: ctx.pageId
      });
    };

    const onCsp = (e: any) => {
      // 不是所有浏览器都有此事件；有就采
      try {
        const payload = {
          type: 'csp-violation',
          effectiveDirective: String(e.effectiveDirective || ''),
          violatedDirective: String(e.violatedDirective || ''),
          blockedURI: safeStr(e.blockedURI || '', 500),
          sourceFile: safeStr(e.sourceFile || '', 300),
          lineNumber: e.lineNumber ?? 0,
          columnNumber: e.columnNumber ?? 0,
          pageId: ctx.pageId
        };
        const key = hash(jsonStable(payload)).toString(36);
        if (dedup(seen, key)) return;
        t.track(payload);
      } catch {}
    };

    // 绑定（资源错误必须 capture: true）
    addEventListener('error', onError as any, true);
    addEventListener('unhandledrejection', onRejection as any);
    if (typeof document !== 'undefined') {
      document.addEventListener('securitypolicyviolation', onCsp as any);
    }

    // 提供 teardown
    offErr = () => removeEventListener('error', onError as any, true);
    offRej = () => removeEventListener('unhandledrejection', onRejection as any);
    offCsp = () => document.removeEventListener?.('securitypolicyviolation', onCsp as any);
  },

  teardown() {
    offErr?.();  offErr = undefined;
    offRej?.();  offRej = undefined;
    offCsp?.();  offCsp = undefined;
  }
};

/* ------------------------- 工具方法（本文件私有） ------------------------- */

function stripUrl(u: string, allow: Set<string>): string {
  try {
    const x = new URL(u, location.href);
    if (allow && allow.size > 0) {
      const keep = new URLSearchParams();
      x.searchParams.forEach((v, k) => { if (allow.has(k)) keep.set(k, v); });
      x.search = keep.toString();
    } else {
      x.search = ''; // 默认去掉所有 query，防止 PII 泄露
    }
    // 可按需保留 hash：此处统一去掉
    x.hash = '';
    return x.toString();
  } catch {
    return String(u || '');
  }
}

function safeStr(s: any, max = 1000): string {
  if (s == null) return '';
  const str = typeof s === 'string' ? s : String(s);
  return str.length > max ? str.slice(0, max) : str;
}

function toReason(r: any): string {
  if (r == null) return '';
  if (typeof r === 'string') return safeStr(r, MAX_MSG);
  // Error/DOMException 等
  if (r && (r.stack || r.message)) {
    const msg = r.message ? `${r.name ? r.name + ': ' : ''}${r.message}` : '';
    return safeStr(msg || String(r), MAX_MSG);
  }
  try { return safeStr(JSON.stringify(r), MAX_MSG); } catch { return safeStr(r, MAX_MSG); }
}

function extractStack(r: any): string {
  const stack = r?.stack || '';
  return safeStr(stack, MAX_STACK);
}

function dedup(seen: Map<string, number>, key: string): boolean {
  const now = Date.now();
  const last = seen.get(key) || 0;
  if (now - last < DEDUP_WINDOW_MS) return true;
  seen.set(key, now);
  // 清理过期（轻量）
  if (seen.size > 200) {
    const cutoff = now - DEDUP_WINDOW_MS * 2;
    for (const [k, ts] of seen) if (ts < cutoff) seen.delete(k);
  }
  return false;
}

function fpJs(message: string, filename: string, line: number, col: number, stack: string) {
  const key = `${message}|${basename(filename)}|${line}|${col}|${firstLines(stack, 5)}`;
  return hash(key).toString(36);
}

function fpRes(tag: string, url: string) {
  return hash(`${tag}|${url}`).toString(36);
}

function fpRej(reason: string, stack: string) {
  return hash(`${reason}|${firstLines(stack, 5)}`).toString(36);
}

function basename(p: string) {
  try { return p.split('?')[0].split('#')[0].split('/').pop() || p; } catch { return p; }
}

function firstLines(txt: string, n = 5) {
  return (txt || '').split('\n').slice(0, n).join('\n');
}

// 简洁 djb2 hash
function hash(input: string): number {
  let h = 5381, i = input.length;
  while (i) h = (h * 33) ^ input.charCodeAt(--i);
  return h >>> 0;
}

function jsonStable(obj: any) {
  try {
    return JSON.stringify(obj, Object.keys(obj).sort());
  } catch { return String(obj); }
}
