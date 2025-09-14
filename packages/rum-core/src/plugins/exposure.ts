// plugins/exposure.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

let io: IntersectionObserver | undefined;

export type ExposureSpec = { id: string; selector: string; threshold?: number };
// 由业务在 init 选项里传入你想观察的选择器清单（也可以做成 SDK API）
const WATCHES: ExposureSpec[] = []; // TODO: 从 ctx.tags 或 init 里读取更合适

export const exposurePlugin: RumPlugin = {
  name:'exposure',
  setup(ctx: RumContext, t: RumTransport){
    if(!WATCHES.length) return;
    const seen = new Set<string>();
    io = new IntersectionObserver((entries)=>{
      entries.forEach(en=>{
        if(en.isIntersecting){
          const id = (en.target as any).__rumExpId as string;
          if(id && !seen.has(id)){
            seen.add(id);
            t.track({ type:'exposure', id, ratio: en.intersectionRatio, pageId: ctx.pageId });
          }
        }
      });
    }, { threshold:[0,0.25,0.5,0.75,1] });

    for(const spec of WATCHES){
      document.querySelectorAll(spec.selector).forEach(el=>{
        (el as any).__rumExpId = spec.id;
        io!.observe(el);
      });
    }
  },
  teardown(){ try{ io?.disconnect(); }catch{} io=undefined; }
};
