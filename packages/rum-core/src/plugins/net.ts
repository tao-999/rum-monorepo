// packages/rum-core/src/plugins/net.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

/**
 * 网络监控插件：
 * - 拦截 fetch / XHR，统计 method/status/duration/traceId
 * - 仅在 allowDomains 为空（全采集）或 host 命中白名单时上报
 * - URL 脱敏：只保留 ctx.allowParams 指定的 query，去掉 hash
 * - 不修改响应体；失败/超时/中断也会上报（XHR）
 * - teardown 可恢复原始 fetch / XHR
 */

type AnyFn = (...a: any[]) => any;

let restoreFetch: AnyFn | undefined;
let restoreXHR: AnyFn | undefined;

export const netPlugin: RumPlugin = {
  name: 'net',

  setup(ctx: RumContext, t: RumTransport) {
    t.track({ type: '__plugin_loaded', plugin: 'net' });

    /* -------------------------- fetch 拦截 -------------------------- */
    if (typeof window.fetch === 'function') {
      const rawFetch = window.fetch.bind(window);

      window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const meta = extractFetchMeta(input, init);
        if (!shouldCapture(meta.url, ctx.allowDomains)) {
          return rawFetch(input as any, init as any);
        }

        const traceId = genId();
        const started = perfNow();

        // 合并/注入 headers 的安全方式：
        // - string/URL：直接合并到 init.headers
        // - Request：new Request(input, { headers }) 复制并注入
        let nextInput: any = input;
        let nextInit: RequestInit | undefined = init ? { ...init } : undefined;
        try {
          const merged = mergeHeaders(
            input instanceof Request ? input.headers : undefined,
            init?.headers
          );
          merged.set('x-trace-id', traceId);

          if (input instanceof Request) {
            nextInput = new Request(input, { headers: merged }); // 复制 Request 注入头
          } else {
            nextInit = { ...(nextInit || {}), headers: merged };
          }
        } catch {
          // headers 注入失败不影响请求
        }

        return rawFetch(nextInput as any, nextInit as any)
          .then((res) => {
            const dur = perfNow() - started;
            t.track({
              type: 'api',
              url: stripUrl(meta.url, ctx.allowParams),
              method: meta.method,
              status: res.status,
              ok: res.ok,
              dur,
              traceId,
              pageId: ctx.pageId
            });
            return res;
          })
          .catch((err) => {
            const dur = perfNow() - started;
            t.track({
              type: 'api',
              url: stripUrl(meta.url, ctx.allowParams),
              method: meta.method,
              status: 0,
              error: String(err?.message || err),
              dur,
              traceId,
              pageId: ctx.pageId
            });
            throw err;
          });
      };

      restoreFetch = () => { window.fetch = rawFetch; };
    }

    /* --------------------------- XHR 拦截 --------------------------- */
const XHR = window.XMLHttpRequest;
if (XHR && XHR.prototype) {
  const O = XHR.prototype.open;
  const S = XHR.prototype.send;
  const SRH = XHR.prototype.setRequestHeader;

  // 关键点 1：赋值时把原型方法强转 any，避免触发重载签名检查
  (XHR.prototype.open as any) = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    (this as any).__rum_meta = {
      method: (method || 'GET').toUpperCase(),
      url: String(url)
    };
    // 关键点 2：用 call 显式传参，别用不定长数组 apply
    return (O as any).call(this, method, url, async, username, password);
  };

  (XHR.prototype.setRequestHeader as any) = function (this: XMLHttpRequest, k: string, v: string) {
    if (!(this as any).__rum_hdrs) (this as any).__rum_hdrs = new Headers();
    (this as any).__rum_hdrs.set(k, v);
    return (SRH as any).call(this, k, v);
  };

  (XHR.prototype.send as any) = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = (this as any).__rum_meta || { method: 'GET', url: '' };
    const url = String(meta.url || '');
    const method = String(meta.method || 'GET').toUpperCase();

    if (!shouldCapture(url, ctx.allowDomains)) {
      return (S as any).call(this, body as any);
    }

    const traceId = genId();
    try {
      // 若业务没设置，我们注入 traceId
      const hdrs: Headers = (this as any).__rum_hdrs || new Headers();
      if (!hdrs.has('x-trace-id')) {
        this.setRequestHeader('x-trace-id', traceId);
      }
    } catch {}

    const start = perfNow();
    const onDone = (kind?: 'timeout' | 'abort' | 'error') => {
      const dur = perfNow() - start;
      const status = (this.status === 1223 ? 204 : this.status) ?? 0;
      t.track({
        type: 'api',
        url: stripUrl(url, ctx.allowParams),
        method,
        status: status || 0,
        dur,
        traceId,
        pageId: ctx.pageId,
        kind
      });
    };

    this.addEventListener('loadend', () => onDone());
    this.addEventListener('timeout', () => onDone('timeout'));
    this.addEventListener('abort', () => onDone('abort'));
    this.addEventListener('error', () => onDone('error'));

    // 关键点 3：send 也用 call，body 明确为 XMLHttpRequestBodyInit
    return (S as any).call(this, body as any);
  };

  restoreXHR = () => {
    XHR.prototype.open = O;
    XHR.prototype.send = S;
    XHR.prototype.setRequestHeader = SRH;
  };
}
  },

  teardown() {
    restoreFetch?.();  restoreFetch = undefined;
    restoreXHR?.();    restoreXHR = undefined;
  }
};

/* ------------------------------ 工具函数 ------------------------------ */

function extractFetchMeta(input: RequestInfo | URL, init?: RequestInit) {
  let url = '';
  let method = 'GET';

  if (typeof input === 'string' || input instanceof URL) {
    url = input.toString();
    method = (init?.method || 'GET').toUpperCase();
  } else {
    // Request
    url = input.url;
    method = (input.method || init?.method || 'GET').toUpperCase();
  }
  return { url, method };
}

function mergeHeaders(a?: HeadersInit, b?: HeadersInit): Headers {
  const h = new Headers();
  const appendAll = (src?: HeadersInit) => {
    if (!src) return;
    if (src instanceof Headers) { src.forEach((v, k) => h.set(k, v)); return; }
    if (Array.isArray(src)) { src.forEach(([k, v]) => h.set(k, v)); return; }
    Object.entries(src).forEach(([k, v]) => h.set(k, String(v)));
  };
  appendAll(a); appendAll(b);
  return h;
}

function shouldCapture(u: string, allow: Set<string>): boolean {
  if (!u) return false;
  if (!allow || allow.size === 0) return true; // 未配置白名单 → 全采集
  try {
    const host = new URL(u, location.href).host;
    for (const d of allow) if (host.includes(d)) return true;
    return false;
  } catch {
    return false;
  }
}

function stripUrl(u: string, allowParams: Set<string>): string {
  try {
    const x = new URL(u, location.href);
    if (allowParams && allowParams.size > 0) {
      const keep = new URLSearchParams();
      x.searchParams.forEach((v, k) => { if (allowParams.has(k)) keep.set(k, v); });
      x.search = keep.toString();
    } else {
      x.search = '';
    }
    x.hash = '';
    return x.toString();
  } catch {
    return String(u || '');
  }
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function perfNow(): number {
  try { return performance.now(); } catch { return Date.now(); }
}
