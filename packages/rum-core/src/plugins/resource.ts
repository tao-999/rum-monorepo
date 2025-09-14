// plugins/resource.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

let resObs: PerformanceObserver | undefined;

export const resourcePlugin: RumPlugin = {
  name:'resource',
  setup(ctx: RumContext, t: RumTransport){
    try{
      resObs = new PerformanceObserver(list=>{
        for(const e of list.getEntries() as PerformanceResourceTiming[]){
          // 只记关心域名（或 allowDomains 为空则全量）
          if(!should(ctx.allowDomains, e.name)) continue;
          t.track({
            type:'res',
            name: strip(e.name, ctx.allowParams, false),
            initiator: e.initiatorType,
            dur: e.duration,
            ttfb: e.responseStart - e.requestStart,
            transfer: e.transferSize,
            encoded: e.encodedBodySize,
            decoded: e.decodedBodySize,
            fromCache: e.transferSize===0 && (e.encodedBodySize>0 || e.decodedBodySize>0),
            pageId: ctx.pageId
          });
        }
      });
      safeObserve(resObs, 'resource', true);
    }catch{}
  },
  teardown(){ try{resObs?.disconnect();}catch{} resObs=undefined; }
};

function safeObserve(po: PerformanceObserver|undefined, type:string, buffered=false){
  if(!po) return;
  try{ (po as any).observe({type, buffered}); }catch{ try{ po.observe({entryTypes:[type] as any}); }catch{} }
}
function should(allow:Set<string>, u:string){ if(!allow||allow.size===0) return true; try{ const host=new URL(u).host; return [...allow].some(d=>host.includes(d)); }catch{ return false; } }
function strip(u:string, allow:Set<string>, keepHash=true){ try{ const x=new URL(u, location.href); if(allow?.size){ const qs=new URLSearchParams(); x.searchParams.forEach((v,k)=>allow.has(k)&&qs.set(k,v)); x.search=qs.toString(); } else x.search=''; if(!keepHash) x.hash=''; return x.toString(); }catch{ return u; } }
