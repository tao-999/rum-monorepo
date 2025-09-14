import { App, ComponentPublicInstance } from 'vue';

type RumVueOptions = {
    /** 直接传 rum-core 客户端（优先级低于 track） */
    client?: {
        track: (e: any) => void;
    };
    /** 自定义上报函数（优先级高） */
    track?: (e: any) => void;
    /** 业务侧可接入的错误回调（原样透传） */
    onError?: (err: unknown, instance: ComponentPublicInstance | null, info: string) => void;
    /** 业务侧可接入的告警回调（注意：Vue3 的 trace 是 string，不是 string[]） */
    onWarn?: (msg: string, instance: ComponentPublicInstance | null, trace: string) => void;
    /** 是否包含组件 props（默认 false，谨慎开启避免 PII） */
    includeProps?: boolean;
    /** warn 采样率（0~1，默认 0 不采） */
    warnSampleRate?: number;
    /** 去重时间窗（毫秒） */
    dedupWindowMs?: number;
    /** 截断长度（防 payload 过大） */
    maxMessageLen?: number;
    maxStackLen?: number;
};
declare const _default: {
    install(app: App, opts?: RumVueOptions): void;
};

export { type RumVueOptions, _default as default };
