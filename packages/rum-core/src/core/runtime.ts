import type { RumContext } from './plugin';

export function createRuntime(opts: {
  appId: string;
  release: string;
  env?: string;
  sampleRate?: number;
  allowDomains?: string[];
  allowUrlParams?: string[];
}): RumContext {
  return {
    appId: opts.appId,
    release: opts.release,
    env: opts.env ?? 'prod',
    sessionId: genId(),
    pageId: genId(),
    sampleRate: opts.sampleRate ?? 1,
    allowDomains: new Set(opts.allowDomains ?? []),
    allowParams: new Set(opts.allowUrlParams ?? [])
  };
}

export function resetPage(ctx: { pageId: string }) {
  (ctx as any).pageId = genId();
}

export function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
