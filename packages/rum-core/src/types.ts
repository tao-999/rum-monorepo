export type RumInitOptions = {
  appId: string;
  release: string;
  env?: string;
  endpoint?: string;

  // 🔧 插件开关：未显式提供时按 index.ts 的默认策略
  features?: {
    // 基础四件套（默认 true）
    error?: boolean;
    net?: boolean;
    perf?: boolean;
    route?: boolean;

    // 可选增强（默认 false）
    console?: boolean;
    resource?: boolean;
    behavior?: boolean;
    exposure?: boolean;
    lifecycle?: boolean;
    ws?: boolean;
  };

  routeMode?: 'history' | 'hash';
  sampleRate?: number;
  allowDomains?: string[];
  allowUrlParams?: string[];
};

export type RumClient = {
  version: string;
  track: (e: any) => void;
  flush: (urgent?: boolean) => void;
  setUserId: (uid?: string) => void;
  setTags: (tags: Record<string, string>) => void;
  destroy: () => void;

  /** ✅ 订阅 SDK 事件总线（插件与业务上报统一出口） */
  onEvent: (cb: (e: any) => void) => () => void;
};

