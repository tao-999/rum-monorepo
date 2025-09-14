// packages/rum-core/src/plugins/route.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';
import { resetPage } from '../core/runtime';

type AnyFn = (...a: any[]) => void;

let restorePush: AnyFn | undefined;
let restoreReplace: AnyFn | undefined;
let offPop: AnyFn | undefined;
let offHash: AnyFn | undefined;
let offHidden: AnyFn | undefined;

export const routePlugin: RumPlugin = {
  name: 'route',

  setup(ctx: RumContext, t: RumTransport) {
    t.track({ type: '__plugin_loaded', plugin: 'route' });

    let currentUrl = stripUrl(location.href, ctx.allowParams, /*keepHash*/ true);
    let startAt = now();
    let closed = false;

    t.track({
      type: 'pv',
      url: currentUrl,
      referrer: stripUrl(document.referrer || '', ctx.allowParams, true),
      title: safeTitle(),
      pageId: ctx.pageId
    });

    // —— Hook history —— //
    const rawPush = history.pushState;
    const rawReplace = history.replaceState;

    // ✅ 显式声明 this 的类型：History
    (history.pushState as any) = function (
      this: History,
      data: any,
      unused: string,
      url?: string | URL | null
    ) {
      const ret = (rawPush as any).call(this, data, unused, url);
      handleUrlChange(url ?? location.href);
      return ret;
    };

    (history.replaceState as any) = function (
      this: History,
      data: any,
      unused: string,
      url?: string | URL | null
    ) {
      const ret = (rawReplace as any).call(this, data, unused, url);
      handleUrlChange(url ?? location.href);
      return ret;
    };

    restorePush = () => { history.pushState = rawPush; };
    restoreReplace = () => { history.replaceState = rawReplace; };

    const onPop = () => handleUrlChange(location.href);
    const onHash = () => handleUrlChange(location.href);
    addEventListener('popstate', onPop);
    addEventListener('hashchange', onHash);
    offPop = () => removeEventListener('popstate', onPop);
    offHash = () => removeEventListener('hashchange', onHash);

    const onHidden = () => {
      if (closed) return;
      if (document.visibilityState === 'hidden') {
        closed = true;
        t.track({
          type: 'route-leave',
          url: currentUrl,
          dur: now() - startAt,
          reason: 'hidden',
          pageId: ctx.pageId
        });
      }
    };
    document.addEventListener('visibilitychange', onHidden, true);
    addEventListener('pagehide', onHidden, { capture: true, once: true } as any);
    offHidden = () => {
      document.removeEventListener('visibilitychange', onHidden, true);
      removeEventListener('pagehide', onHidden as any, true as any);
    };

    function handleUrlChange(next: string | URL | null | undefined) {
      const nextUrl = stripUrl(String(next ?? location.href), ctx.allowParams, true);
      if (!nextUrl || nextUrl === currentUrl) return;

      t.track({ type: 'route-leave', url: currentUrl, dur: now() - startAt, pageId: ctx.pageId });

      resetPage(ctx as any);
      const prev = currentUrl;
      currentUrl = nextUrl;
      startAt = now();
      closed = false;

      t.track({ type: 'pv', url: currentUrl, referrer: prev, title: safeTitle(), pageId: ctx.pageId });
    }
  },

  teardown() {
    try { restorePush?.(); } catch {}
    try { restoreReplace?.(); } catch {}
    try { offPop?.(); } catch {}
    try { offHash?.(); } catch {}
    try { offHidden?.(); } catch {}
    restorePush = restoreReplace = offPop = offHash = offHidden = undefined;
  }
};

/* ------------------------------ 工具区 ------------------------------ */

function stripUrl(u: string, allow: Set<string>, keepHash = true): string {
  if (!u) return '';
  try {
    const x = new URL(u, location.href);
    if (allow && allow.size > 0) {
      const keep = new URLSearchParams();
      x.searchParams.forEach((v, k) => { if (allow.has(k)) keep.set(k, v); });
      x.search = keep.toString();
    } else {
      x.search = '';
    }
    if (!keepHash) x.hash = '';
    return x.toString();
  } catch { return String(u || ''); }
}
function now() { try { return performance.now(); } catch { return Date.now(); } }
function safeTitle() { try { return String(document.title || '').slice(0, 200); } catch { return ''; } }
