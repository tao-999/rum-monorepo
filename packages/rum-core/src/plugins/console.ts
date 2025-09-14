// plugins/console.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';

type AnyFn = (...a:any[])=>void;
let restore: (()=>void)|undefined;

export const consolePlugin: RumPlugin = {
  name: 'console',
  setup(ctx: RumContext, t: RumTransport) {
    const raw = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    const wrap = (level: 'error'|'warn'|'info'|'log') => (...args:any[]) => {
      try {
        const msg = args.map(a => toStr(a)).join(' ');
        if (level === 'error' || level === 'warn') {
          t.track({ type:'console', level, message: msg.slice(0,1000), pageId: ctx.pageId });
        }
      } catch {}
      (raw[level] as AnyFn).apply(console, args);
    };
    console.log = wrap('log') as any;
    console.info = wrap('info') as any;
    console.warn = wrap('warn') as any;
    console.error = wrap('error') as any;
    restore = () => { console.log=raw.log; console.info=raw.info; console.warn=raw.warn; console.error=raw.error; };
  },
  teardown(){ restore?.(); restore=undefined; }
};

function toStr(x:any){ try{ return typeof x==='string'? x: (x?.stack||x?.message)? String(x.stack||x.message): JSON.stringify(x); }catch{ return String(x); } }
