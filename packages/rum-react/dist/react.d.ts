import * as React from 'react';

type TrackFn = (e: any) => void;
type Props = {
    /** 兜底 UI（优先级最低） */
    fallback?: React.ReactNode;
    /** 兜底 UI：渲染函数 */
    fallbackRender?: (p: {
        error: Error;
        reset: () => void;
    }) => React.ReactElement | null;
    /** 兜底 UI：组件 */
    FallbackComponent?: React.ComponentType<{
        error: Error;
        reset: () => void;
    }>;
    /** 业务回调（原样透传 React 的 info） */
    onError?: (err: Error, info: React.ErrorInfo) => void;
    /** 接到 rum-core 的客户端（低优先级） */
    client?: {
        track: TrackFn;
    };
    /** 自定义上报函数（优先级高于 client） */
    track?: TrackFn;
    /** 当这些 key 变化且当前处于错误态时，自动 reset */
    resetKeys?: unknown[];
    /** 手动/自动复位时回调 */
    onReset?: (reason: 'keys' | 'api', prevKeys?: unknown[], nextKeys?: unknown[]) => void;
    /** 保护参数：去重窗口、截断长度 */
    dedupWindowMs?: number;
    maxMessageLen?: number;
    maxStackLen?: number;
    children?: React.ReactNode;
};
type State = {
    err: Error | null;
    info?: React.ErrorInfo | null;
};
declare class RumErrorBoundary extends React.Component<Props, State> {
    state: State;
    static getDerivedStateFromError(err: Error): Partial<State>;
    componentDidCatch(err: Error, info: React.ErrorInfo): void;
    componentDidUpdate(prevProps: Readonly<Props>): void;
    /** 手动复位：恢复正常渲染 */
    reset: (reason?: "keys" | "api", prev?: unknown[], next?: unknown[]) => void;
    render(): React.ReactNode;
}

export { RumErrorBoundary };
