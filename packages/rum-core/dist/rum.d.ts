type RumInitOptions = {
    appId: string;
    release: string;
    env?: string;
    endpoint?: string;
    features?: {
        error?: boolean;
        net?: boolean;
        perf?: boolean;
        route?: boolean;
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
type RumClient = {
    version: string;
    track: (e: any) => void;
    flush: (urgent?: boolean) => void;
    setUserId: (uid?: string) => void;
    setTags: (tags: Record<string, string>) => void;
    destroy: () => void;
    /** ✅ 订阅 SDK 事件总线（插件与业务上报统一出口） */
    onEvent: (cb: (e: any) => void) => () => void;
};

declare function initRUM(opts: RumInitOptions): RumClient;
declare const version = "0.1.0";

export { initRUM, version };
