# RUM Monorepo

> 轻量可插拔的前端监控 SDK：错误抓取、网络追踪、性能指标、路由变化、资源加载、行为与生命周期、WebSocket、曝光等。  
> 支持 **ESM（现代打包器 import）** 和 **IIFE（`<script>` 全局）** 两种构建产物。  
> 提供 **React** / **Vue** 适配（错误边界、错误钩子）。

---

## 目录

- [特性](#特性)
- [包结构](#包结构)
- [安装与构建](#安装与构建)
- [产物说明（ESM / IIFE）](#产物说明esm--iife)
- [快速开始](#快速开始)
  - [Vanilla（原生）](#vanilla原生)
  - [React](#react)
  - [Vue 3](#vue-3)
- [事件总线调试（**强烈推荐**）](#事件总线调试强烈推荐)
- [初始化选项](#初始化选项)
- [客户端 API](#客户端-api)
- [插件清单与事件参考](#插件清单与事件参考)
- [传输层策略](#传输层策略)
- [性能与隐私建议](#性能与隐私建议)
- [示例项目](#示例项目)
- [常见问题 FAQ](#常见问题-faq)
- [License](#license)

---

## 特性

- 🧩 **可插拔插件体系**：按需启用 `error / net / perf / route / console / resource / behavior / lifecycle / ws / exposure`。
- ⚡ **低侵入**：默认启用“基础四件套”——错误、网络、性能、路由。
- 🛰️ **全量可视化**：`client.onEvent(cb)` 一行订阅，捕获**所有**插件与业务上报。
- 📦 **传输层降级**：`sendBeacon → fetch → Image`，失败离线缓冲（`localStorage`）。
- 🧪 **多框架适配**：原生、React（ErrorBoundary/HOC/Hook）、Vue（错误钩子）。
- 🛡️ **数据保护**：域名/参数白名单、字段截断、错误去重、行为采样。

---

## 包结构

```
packages/
  rum-core/    # 核心 SDK（插件体系 + 传输层 + initRUM）
  rum-react/   # React 适配（ErrorBoundary / HOC / Hook）
  rum-vue/     # Vue 3 适配（errorHandler 插件）
examples/
  vanilla/     # 原生示例（IIFE 直接跑）
  react/       # React Playground（IIFE）
  vue/         # Vue Playground（IIFE）
```

---

## 安装与构建

> 需求：Node 18+、pnpm 9+

```bash
# 1) 安装依赖
pnpm i

# 2) 构建全部包（生成 dist/*.js）
pnpm -r --filter ./packages/** run build

# 3) 类型检查（可选）
pnpm -r --filter ./packages/** run typecheck
```

**工作区安装到你的前端工程：**

```bash
# 在你的 React/Vue 工程包下执行（示例）
pnpm --filter your-app add @rum/rum-core@workspace:* @rum/rum-react@workspace:* @rum/rum-vue@workspace:*
```

---

## 产物说明（ESM / IIFE）

| 包名             | 给打包器（import）                        | 给 `<script>`（全局）                  |
|------------------|-------------------------------------------|----------------------------------------|
| `@rum/rum-core`  | `dist/rum.js`                              | `dist/rum.global.js` → `window.RUM`    |
| `@rum/rum-react` | `dist/react.js`                            | `dist/react.global.js` → `window.RUMReact` |
| `@rum/rum-vue`   | `dist/vue.js`                              | `dist/vue.global.js` → `window.RUMVue` |

> 工程里 **请使用 ESM**：`import { initRUM } from '@rum/rum-core'`。  
> Demo/静态页 **可用 IIFE**：直接 `<script src="...rum.global.js"></script>`。

---

## 快速开始

### Vanilla（原生）

**ESM（推荐）**
```html
<script type="module">
  import { initRUM } from '/packages/rum-core/dist/rum.js';

  const client = initRUM({
    appId: 'demo',
    release: '0.1.0',
    features: { console: true, resource: true, behavior: true, lifecycle: true }
  });

  // 订阅所有事件（插件 + 业务）
  client.onEvent(e => console.log('[RUM]', e));
</script>
```

**IIFE**
```html
<script src="/packages/rum-core/dist/rum.global.js"></script>
<script>
  const client = RUM.initRUM({ appId:'demo', release:'0.1.0' });
  client.onEvent(e => console.log('[RUM]', e));
</script>
```

---

### React

```ts
// src/main.tsx / App.tsx
import { initRUM } from '@rum/rum-core';
import { RumErrorBoundary, withRUMErrorBoundary, useRUMReport } from '@rum/rum-react';

const client = initRUM({
  appId: 'demo',
  release: '0.1.0',
  features: { console: true, resource: true, behavior: true, lifecycle: true },
});
client.onEvent(e => console.log('[RUM]', e));

// 1) 组件：ErrorBoundary
export function App() {
  return (
    <RumErrorBoundary
      fallback={<div>组件崩了，已上报</div>}
      onError={(err, info) => client.track({
        type: 'react-error',
        message: err.message,
        stack: String(err.stack||'').slice(0,1000),
        componentStack: String(info.componentStack||'').slice(0,800)
      })}
    >
      <YourComponent />
    </RumErrorBoundary>
  );
}

// 2) HOC：一把梭包一层边界
export default withRUMErrorBoundary(YourComponent, { fallback: <div>Fallback</div> });

// 3) Hook：手动上报
export function SomeHookyComponent(){
  const report = useRUMReport(client.track);
  // try/catch 后：
  // report(error);
  return null;
}
```

---

### Vue 3

```html
<script type="module">
  import { createApp, h } from 'vue';
  import { initRUM } from '/packages/rum-core/dist/rum.js';
  import RUMVue from '/packages/rum-vue/dist/vue.js'; // ESM

  const client = initRUM({
    appId: 'demo',
    release: '0.1.0',
    features: { console: true, resource: true, behavior: true, lifecycle: true }
  });

  const app = createApp({
    render(){
      return h('div', null, 'Hello Vue + RUM');
    }
  });

  app.use(RUMVue, {
    client,
    onError(err, instance, info){
      // 兜底：在插件里可直接交给 core
      client.track({
        type: 'vue-error',
        message: String(err?.message || err),
        stack: String(err?.stack || '').slice(0, 1000),
        info: String(info || '')
      });
    },
    warnSampleRate: 0.2 // 可选：上报 console.warn 的采样
  });

  client.onEvent(e => console.log('[RUM]', e));
  app.mount('#app');
</script>
```

---

## 事件总线调试（**强烈推荐**）

**不要再 wrap `client.track`！**  
所有 SDK 上报（插件/业务）都走 `transport.track` → 可通过 **总线订阅**：

```ts
const client = initRUM({ appId: 'demo', release: '0.1.0' });
const off = client.onEvent((evt) => {
  // 这里能拿到所有插件事件与业务自定义事件
  console.log('[ALL EVENTS]', evt);
});

// 不用了记得取消
off();
```

> IIFE 下也可从外部订阅：`window.__RUM_TAP__ && window.__RUM_TAP__(cb)`。

---

## 初始化选项

```ts
type RumInitOptions = {
  appId: string;             // 必填：你的应用 ID
  release: string;           // 必填：版本号（如：1.4.3）
  endpoint?: string;         // 可选：上报接收端 URL（不填则仅本地可视化）
  env?: 'prod'|'test'|string;// 可选：环境名（默认 'prod'）

  // 插件开关：四件套默认开（error/net/perf/route），其余默认关
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

  // 白名单。默认：allowDomains 空（=全放行，适合 demo），allowUrlParams 空（=移除所有查询参数）
  allowDomains?: string[];   // 只采集这些域名（net/resource）
  allowUrlParams?: string[]; // 允许保留的查询参数（其他会被剔除）

  sampleRate?: number;       // 全局采样（0~1），默认 1
};
```

---

## 客户端 API

```ts
type RumClient = {
  version: string;                     // SDK 版本
  track: (e: any) => void;             // 业务自定义上报
  flush: (urgent?: boolean) => void;   // 立即冲洗队列（urgent=true 时尝试 keepalive）
  setUserId: (uid?: string) => void;   // 绑定用户
  setTags: (tags: Record<string,string>) => void; // 追加标签
  onEvent: (cb: (e:any)=>void) => () => void;     // 订阅所有事件
  destroy: () => void;                 // 卸载（解绑监听、teardown 插件、flush）
};
```

---

## 插件清单与事件参考

> 实际字段会做**长度截断**与**去重**（避免刷屏）。

- **error**：`js-error`、`promise-reject`、`res-error`、`csp-violation`
  - `message` / `stack` / `filename` / `lineno` / `colno`…
- **net**：`api`（`fetch`/`xhr`）
  - `url`（已清理参数/Hash）、`method`、`status`、`dur`、`traceId`、`kind?`（timeout/abort）
- **perf**：`ttfb`、`nav`、`first-paint`、`first-contentful-paint`、`longtask`、`lcp`、`cls`、`fid`、`inp`、`whitescreen`、`netinfo`
- **route**：`pv`、`route-leave`、`hashchange`/`popstate`（内部合并）
  - `pv`: `url/referrer/title/pageId`
- **console**：`console`（`level`: warn/error, `message`）
- **resource**：`res`
  - `name`、`initiator`、`dur`、`ttfb`、`transfer/encoded/decoded/fromCache`
- **behavior**：`click`（采样）、`rage-click`、`scroll-depth`
- **lifecycle**：`visibility`、`bfcache-restore`
- **ws**：`ws-open`、`ws-ready`、`ws-error`、`ws-close`
  - `url`、`ttfb`、`code`、`wasClean`
- **exposure**：`exposure`（⚠️ 当前版本配置 API 暂未固化，见源码 `packages/rum-core/src/plugins/exposure.ts`）

---

## 传输层策略

- **批量策略**：队列 ≥ 20 或 2s 定时 flush。
- **发送降级**：`sendBeacon` → `fetch(keepalive)` → `Image GET`（URL 可能被长度限制，仅兜底）。
- **离线队列**：发送失败落盘 `localStorage`（键：`__RUM_OFFLINE_Q__`，最多 2000 条），下次加载回放。
- **页面卸载**：`pagehide`/`visibilitychange`（hidden）时强制 `flush(true)`。

> 生产建议使用 **IndexedDB + 退避重试**（当前实现为最小可用 Demo 版）。

---

## 性能与隐私建议

- **采样**：设置 `sampleRate`（全局）与插件内的细粒度采样（如 `console.warn`）。
- **白名单**：`allowDomains`、`allowUrlParams` 显式控制采集面（尤其在生产）。
- **字段截断**：SDK 默认截断 `message/stack/componentStack` 等；后端也应限制单次事件体积。
- **PII**：避免上报身份证号、手机号、邮箱、精确地理位置等敏感数据。

---

## 示例项目

> 已内置三套 Playground（UI 含事件流 + 清空按钮）

启动一个静态服务器（任选其一）：
```bash
# 根目录起服（推荐）
npx http-server -c-1 . -p 5500 --cors

# 或者用任何你熟悉的静态服工具
```

打开：
- `http://127.0.0.1:5500/examples/vanilla/`
- `http://127.0.0.1:5500/examples/react/`
- `http://127.0.0.1:5500/examples/vue/`

> 事件流展示依赖 `client.onEvent(addEvent)`，已在示例中接好。

---

## 常见问题 FAQ

**Q1：我 wrap 了 `client.track`，为什么看不到插件事件？**  
A：插件拿的是 `transport.track` 的引用，你的 wrap 覆盖不到。请改用 **`client.onEvent(addEvent)`** 订阅总线。

**Q2：网络事件一个都没有？**  
A：检查 `allowDomains`。空数组在某些实现中意味着“全拦截”，建议不配置或设为 `undefined` 在 Demo 阶段放行；生产再按需收紧。

**Q3：为什么路由只上报一次 `pv`？**  
A：`pv` 在初始化时上报，后续需触发 `pushState/replaceState`/`hashchange`/`popstate` 才会产生新 `pv`/`route-leave`。CSR 应用的路由跳转才会触发。

**Q4：`sendBeacon` 不生效？**  
A：浏览器兼容性或跨域限制导致，SDK 会自动降级到 `fetch(keepalive)` 或 `Image`。服务端注意接收 CORS/GET兜底。

**Q5：如何把 React/Vue 错误纳入 SDK？**  
A：React 用 `RumErrorBoundary` / `withRUMErrorBoundary` / `useRUMReport`；Vue 装 `rum-vue` 插件（内部接管 `errorHandler`）。

**Q6：能否自定义上报字段？**  
A：可以使用 `client.track({ type:'xxx', ...payload })`，后端对 `type` 路由处理。

---

## License

MIT（建议，如你有更合适的 License 可自行替换）

---

**尾声**：  
监控不是“全开即胜利”，而是**最小必要采集 + 高质量信号**。建议先启用四件套和 `console/resource`，把事件流跑起来，再按需加行为、WS、曝光。事件总线是你的瑞士军刀——**一行代码，把所有插件的心跳都接上**。🧠🛠️
