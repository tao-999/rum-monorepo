import { VERSION } from './version';
import type { RumClient, RumInitOptions } from './types';
import { createPluginManager } from './core/plugin';
import { createRuntime } from './core/runtime';
import { createTransport } from './core/transport';

// ✅ 从 barrel 导入所有插件
import {
  errorPlugin, netPlugin, perfPlugin, routePlugin,
  consolePlugin, resourcePlugin, behaviorPlugin, exposurePlugin,
  lifecyclePlugin, wsPlugin
} from './plugins';

export function initRUM(opts: RumInitOptions): RumClient {
  if (!opts?.appId || !opts?.release) throw new Error('[RUM] appId & release required');

  const ctx = createRuntime(opts);
  const transport = createTransport({ endpoint: opts.endpoint, appId: opts.appId, release: opts.release });
  const pm = createPluginManager();

  const feats = opts.features ?? {};
  const on = (k: keyof NonNullable<RumInitOptions['features']>, def: boolean) =>
    (feats[k] === undefined ? def : !!feats[k]);

  // —— 基础四件套（默认开）——
  if (on('error', true)) pm.use(errorPlugin);
  if (on('net',   true)) pm.use(netPlugin);
  if (on('perf',  true)) pm.use(perfPlugin);
  if (on('route', true)) pm.use(routePlugin);

  // —— 增强插件（默认关，按需开）——
  if (on('console',   false)) pm.use(consolePlugin);
  if (on('resource',  false)) pm.use(resourcePlugin);
  if (on('behavior',  false)) pm.use(behaviorPlugin);
  if (on('exposure',  false)) pm.use(exposurePlugin);
  if (on('lifecycle', false)) pm.use(lifecyclePlugin);
  if (on('ws',        false)) pm.use(wsPlugin);

  pm.setupAll(ctx, transport);

  // 页收尾时强制 flush
  const onPageHide = () => transport.flush(true);
  const onVis = () => { if (document.visibilityState === 'hidden') transport.flush(true); };
  addEventListener('pagehide', onPageHide);
  addEventListener('visibilitychange', onVis);

  // ✅ 对外订阅：任何事件都会从 transport.track → 这里广播出去
  const onEvent = (cb: (e: any) => void) => transport.__subscribe(cb);
  try { (window as any).__RUM_TAP__ = onEvent; } catch {}

  const client: RumClient = {
    version: VERSION,
    track: transport.track,
    flush: transport.flush,
    setUserId(uid) { (ctx as any).uid = uid; },
    setTags(tags)  { (ctx as any).tags = { ...(ctx as any).tags, ...tags }; },
    onEvent,
    destroy() {
      try { removeEventListener('pagehide', onPageHide); } catch {}
      try { removeEventListener('visibilitychange', onVis); } catch {}
      try { pm.teardownAll(); } catch {}
      try { transport.flush(true); } catch {}
    }
  };

  return client;
}

export const version = VERSION;
