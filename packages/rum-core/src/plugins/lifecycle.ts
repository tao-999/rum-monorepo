// plugins/lifecycle.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

let offA: (()=>void)|undefined, offB: (()=>void)|undefined;

export const lifecyclePlugin: RumPlugin = {
  name:'lifecycle',
  setup(ctx: RumContext, t: RumTransport){
    const onShow = (e: PageTransitionEvent)=>{ if((e as any).persisted) t.track({ type:'bfcache-restore', pageId: ctx.pageId }); };
    const onVis  = ()=> t.track({ type:'visibility', state: document.visibilityState, pageId: ctx.pageId });
    addEventListener('pageshow', onShow as any);
    document.addEventListener('visibilitychange', onVis, true);
    offA=()=>removeEventListener('pageshow', onShow as any);
    offB=()=>document.removeEventListener('visibilitychange', onVis, true);
  },
  teardown(){ offA?.(); offB?.(); offA=offB=undefined; }
};
