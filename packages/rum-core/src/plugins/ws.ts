// plugins/ws.ts
import type { RumPlugin, RumTransport, RumContext } from '../core/plugin';
let RAW: any, restored: (()=>void)|undefined;

export const wsPlugin: RumPlugin = {
  name:'ws',
  setup(ctx: RumContext, t: RumTransport){
    const WS = window.WebSocket;
    if(!WS) return;
    RAW = WS;
    (window as any).WebSocket = function(url: string | URL, protocols?: string | string[]){
      const ws = protocols ? new RAW(url, protocols) : new RAW(url);
      const start = Date.now();
      const safeUrl = String(url);
      t.track({ type:'ws-open', url: safeUrl, pageId: ctx.pageId });
     // ws.addEventListener('open', ()=> ...)
ws.addEventListener('open', (_e: Event) => {
  t.track({ type: 'ws-ready', url: safeUrl, ttfb: Date.now() - start, pageId: ctx.pageId });
});

// ws.addEventListener('error', ()=> ...)
ws.addEventListener('error', (_e: Event) => {
  t.track({ type: 'ws-error', url: safeUrl, pageId: ctx.pageId });
});

// ❗你报错的这一行：标注 CloseEvent
ws.addEventListener('close', (e: CloseEvent) => {
  t.track({ type: 'ws-close', url: safeUrl, code: e.code, wasClean: e.wasClean, pageId: ctx.pageId });
});

// 如需记录消息事件，也要标类型
// ws.addEventListener('message', (e: MessageEvent) => {
//   t.track({ type: 'ws-message', len: typeof e.data === 'string' ? e.data.length : 0, pageId: ctx.pageId });
// });

      return ws;
    } as any;
    (window as any).WebSocket.prototype = RAW.prototype;
    restored = ()=>{ (window as any).WebSocket = RAW; };
  },
  teardown(){ restored?.(); restored=undefined; }
};
