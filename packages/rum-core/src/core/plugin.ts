// packages/rum-core/src/core/plugin.ts

/** 运行时上下文：插件只读（除非框架暴露 setter） */
export type RumContext = {
  appId: string;
  release: string;
  env: string;
  sessionId: string;
  pageId: string;
  tags?: Record<string, string>;
  sampleRate: number;
  allowDomains: Set<string>;
  allowParams: Set<string>;
};

/** 传输层：插件通过它上报事件；带事件总线订阅口（用于 Demo/DevTools） */
export type RumTransport = {
  track: (e: any) => void;
  flush: (urgent?: boolean) => void;
  /** 订阅所有经由 transport.track 的事件（返回取消订阅函数） */
  __subscribe: (cb: (e: any) => void) => () => void;
};

/** 插件协议：setup 时拿到上下文与传输层；可选 teardown */
export type RumPlugin = {
  name: string;
  setup(ctx: RumContext, transport: RumTransport): void;
  teardown?(): void;
};

/** 插件管理器接口 */
export type PluginManager = {
  /** 注册插件（同名去重，后续再调用会被忽略） */
  use(p: RumPlugin): void;
  /** 依序初始化所有已注册插件 */
  setupAll(ctx: RumContext, t: RumTransport): void;
  /** 逆序卸载所有插件（后注册的先卸载） */
  teardownAll(): void;
  /** 查询：是否已注册某插件 */
  has(name: string): boolean;
  /** 列出当前注册的插件名（按注册顺序） */
  list(): string[];
};

/** 简易插件管理器（容错+去重+逆序卸载） */
export function createPluginManager(): PluginManager {
  const plugins: RumPlugin[] = [];
  const installed = new Set<string>();

  return {
    use(p: RumPlugin) {
      if (!p || !p.name) {
        try { console.warn?.('[RUM] invalid plugin ignored:', p); } catch {}
        return;
      }
      if (installed.has(p.name)) {
        try { console.warn?.(`[RUM] plugin "${p.name}" already registered, skip`); } catch {}
        return;
      }
      plugins.push(p);
      installed.add(p.name);
    },

    setupAll(ctx: RumContext, t: RumTransport) {
      for (const p of plugins) {
        try { p.setup(ctx, t); }
        catch (err) {
          try { console.error?.(`[RUM] plugin "${p.name}" setup failed:`, err); } catch {}
        }
      }
    },

    teardownAll() {
      for (let i = plugins.length - 1; i >= 0; i--) {
        const p = plugins[i];
        try { p.teardown?.(); }
        catch (err) {
          try { console.error?.(`[RUM] plugin "${p.name}" teardown failed:`, err); } catch {}
        }
      }
      plugins.length = 0;
      installed.clear();
    },

    has(name: string) {
      return installed.has(name);
    },

    list() {
      return plugins.map(p => p.name);
    }
  };
}
