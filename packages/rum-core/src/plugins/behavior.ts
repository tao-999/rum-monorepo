// plugins/behavior.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

let offClick: (()=>void)|undefined;
let offScroll: (()=>void)|undefined;

export const behaviorPlugin: RumPlugin = {
  name:'behavior',
  setup(ctx: RumContext, t: RumTransport){
    // 点击采样（10%）
    const sample = Math.random()<0.1;
    let clicks:number[]=[];

    const onClick = (e: MouseEvent)=>{
      if(sample){
        const target = (e.target as HTMLElement|null);
        t.track({ type:'click', x:e.clientX, y:e.clientY, tag: target?.tagName, id: target?.id, cls: target?.className?.toString()?.slice(0,80), pageId: ctx.pageId });
      }
      // Rage: 1.5s 内三连点同区域（50px 内）
      const now=Date.now(); clicks = clicks.filter(ts=>now-ts<1500).concat(now);
      if(clicks.length>=3){
        t.track({ type:'rage-click', x:e.clientX, y:e.clientY, pageId: ctx.pageId });
        clicks.length=0;
      }
    };
    const onScroll = ()=>{
      // 只记滚动到的最大百分比（节流）
      const h = document.documentElement;
      const max = Math.max(1, h.scrollHeight - h.clientHeight);
      const pct = Math.round((h.scrollTop / max) * 100);
      t.track({ type:'scroll-depth', value:pct, pageId: ctx.pageId });
    };

    addEventListener('click', onClick, true);
    let scrollTO:number|undefined;
    const onScrollWrap=()=>{ clearTimeout(scrollTO); scrollTO=window.setTimeout(onScroll, 400); };
    addEventListener('scroll', onScrollWrap, { passive: true });
    offClick=()=>removeEventListener('click', onClick, true);
    offScroll=()=>removeEventListener('scroll', onScrollWrap as any);
  },
  teardown(){ offClick?.(); offScroll?.(); offClick=offScroll=undefined; }
};
