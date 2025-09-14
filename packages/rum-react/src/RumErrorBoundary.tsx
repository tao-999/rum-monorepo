import * as React from 'react';

type TrackFn = (e: any) => void;

export type Props = {
  /** 兜底 UI（优先级最低） */
  fallback?: React.ReactNode;
  /** 兜底 UI：渲染函数 */
  fallbackRender?: (p: { error: Error; reset: () => void }) => React.ReactElement | null;
  /** 兜底 UI：组件 */
  FallbackComponent?: React.ComponentType<{ error: Error; reset: () => void }>;

  /** 业务回调（原样透传 React 的 info） */
  onError?: (err: Error, info: React.ErrorInfo) => void;

  /** 接到 rum-core 的客户端（低优先级） */
  client?: { track: TrackFn };
  /** 自定义上报函数（优先级高于 client） */
  track?: TrackFn;

  /** 当这些 key 变化且当前处于错误态时，自动 reset */
  resetKeys?: unknown[];
  /** 手动/自动复位时回调 */
  onReset?: (reason: 'keys' | 'api', prevKeys?: unknown[], nextKeys?: unknown[]) => void;

  /** 保护参数：去重窗口、截断长度 */
  dedupWindowMs?: number;       // 默认 10s
  maxMessageLen?: number;       // 默认 500
  maxStackLen?: number;         // 默认 2000

  children?: React.ReactNode;
};

type State = { err: Error | null; info?: React.ErrorInfo | null };

/** —— 轻量去重 —— */
const globalSeen = new Map<string, number>();
const DEFAULT_WIN = 10_000;
const DEFAULT_MAX_MSG = 500;
const DEFAULT_MAX_STACK = 2000;

export class RumErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    this.setState({ info });

    const { track, client, dedupWindowMs, maxMessageLen, maxStackLen } = this.props;
    const win = dedupWindowMs ?? DEFAULT_WIN;
    const MAX_MSG = maxMessageLen ?? DEFAULT_MAX_MSG;
    const MAX_STACK = maxStackLen ?? DEFAULT_MAX_STACK;

    const payload = {
      type: 'react-error',
      message: cut(String(err?.name ? `${err.name}: ${err.message}` : err?.message || String(err)), MAX_MSG),
      stack: cut(String((err as any)?.stack || ''), MAX_STACK),
      componentStack: cut(info?.componentStack || '', MAX_STACK)
    };

    const key = hash(
      `${payload.message}|${firstLines(payload.stack, 5)}|${firstLines(payload.componentStack, 3)}`
    ).toString(36);

    if (!dedup(globalSeen, key, win)) {
      (track ?? client?.track)?.(payload);
    }

    // 业务侧回调
    this.props.onError?.(err, info);
  }

  componentDidUpdate(prevProps: Readonly<Props>) {
    const { resetKeys } = this.props;
    if (this.state.err && resetKeys && !shallowEqual(prevProps.resetKeys, resetKeys)) {
      const prev = prevProps.resetKeys;
      const next = resetKeys;
      this.reset('keys', prev, next);
    }
  }

  /** 手动复位：恢复正常渲染 */
  reset = (reason: 'keys' | 'api' = 'api', prev?: unknown[], next?: unknown[]) => {
    this.setState({ err: null, info: null }, () => {
      this.props.onReset?.(reason, prev, next);
    });
  };

  render(): React.ReactNode {
    const { err } = this.state;
    if (err) {
      const reset = () => this.reset('api');
      const { FallbackComponent, fallbackRender, fallback } = this.props;

      if (typeof fallbackRender === 'function') {
        return fallbackRender({ error: err, reset });
      }
      if (FallbackComponent) {
        return <FallbackComponent error={err} reset={reset} />;
      }
      return (fallback ?? null) as React.ReactElement | null;
    }
    return this.props.children as React.ReactElement | null;
  }
}

export default RumErrorBoundary;

/* ====================== HOC：一把梭包一层边界 ====================== */

export function withRUMErrorBoundary<C extends React.ComponentType<any>>(
  Wrapped: C,
  boundaryProps?: Omit<Props, 'children'>
) {
  // P = Wrapped 组件真实 props（含 LibraryManagedAttributes + IntrinsicAttributes，例如 key）
  type P = JSX.LibraryManagedAttributes<C, React.ComponentProps<C>>;

  const Bound: React.FC<P> = (props: P) => (
    <RumErrorBoundary {...boundaryProps}>
      {React.createElement(Wrapped as React.ComponentType<any>, props)}
    </RumErrorBoundary>
  );

  Bound.displayName = `withRUMErrorBoundary(${(Wrapped as any).displayName || Wrapped.name || 'Component'})`;
  return Bound;
}

/* ====================== Hook：手动上报/配合 try/catch ====================== */

export function useRUMReport(track?: TrackFn) {
  const ref = React.useRef<TrackFn | undefined>(track);
  React.useEffect(() => { ref.current = track; }, [track]);
  return React.useCallback((err: unknown) => {
    if (!ref.current) return;
    const e = normalizeError(err);
    ref.current({
      type: 'react-error',
      message: cut(e.message, DEFAULT_MAX_MSG),
      stack: cut(String(e.stack || ''), DEFAULT_MAX_STACK),
      componentStack: '' // hook 里拿不到 React 的 componentStack
    });
  }, []);
}

/* =============================== 小工具区 =============================== */

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  try {
    const asAny = err as any;
    const msg = asAny?.message ? String(asAny.message) : String(err);
    const e = new Error(msg);
    (e as any).stack = asAny?.stack || e.stack;
    return e;
  } catch {
    return new Error(String(err));
  }
}

function shallowEqual(a?: unknown[], b?: unknown[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function cut(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}

function firstLines(txt: string, n = 5) {
  return (txt || '').split('\n').slice(0, n).join('\n');
}

// 简洁 djb2
function hash(input: string): number {
  let h = 5381, i = input.length;
  while (i) h = (h * 33) ^ input.charCodeAt(--i);
  return h >>> 0;
}

function dedup(seen: Map<string, number>, key: string, win: number) {
  const now = Date.now();
  const last = seen.get(key) || 0;
  if (now - last < win) return true;
  seen.set(key, now);
  if (seen.size > 300) {
    const cutoff = now - win * 2;
    for (const [k, ts] of seen) if (ts < cutoff) seen.delete(k);
  }
  return false;
}
