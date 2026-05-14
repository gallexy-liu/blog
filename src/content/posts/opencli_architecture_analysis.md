---
title: "OpenCLI 架构深度分析：把任意网站变成 CLI"
date: "2026-05-14"
section: "tech"
description: "从源码设计视角拆解 OpenCLI 的 CLI、Daemon、Chrome Extension、CDP 桥接、工作空间租约和 DOM 快照机制。"
tags: ["OpenCLI", "架构分析", "Chrome Extension", "CDP"]
cover: "/images/opencli-architecture.svg"
draft: false
---

OpenCLI 的目标很直接：**Make any website your CLI**。它希望用户像调用 API 一样，通过命令行访问网站数据或执行网页操作。

这件事听起来像 Playwright 的常规能力，但 OpenCLI 的关键差别在于：它不优先启动一个干净的自动化浏览器，而是通过 Chrome Extension 桥接用户已经登录的 Chrome。这样，CLI 命令可以复用现有 Cookie、Session 和 2FA 登录状态。

这篇文章从架构层面拆解 OpenCLI：它如何注册命令、如何判断是否需要浏览器、如何把 CLI 请求转发到扩展、又如何通过 Chrome Debugger Protocol 操作页面。

## 总体架构

OpenCLI 可以看成四个部分：

| 层级 | 角色 | 主要职责 |
| --- | --- | --- |
| CLI 进程 | 用户入口 | 解析命令、加载适配器、执行 pipeline 或函数 |
| Daemon 进程 | 本地中转 | 提供 HTTP/WebSocket 服务，连接 CLI 和扩展 |
| Chrome Extension | 浏览器桥接 | 接收 daemon 命令，访问 tabs、cookies、debugger |
| Chrome 页面 | 执行环境 | 真实网站页面或自动化容器标签页 |

控制链路大致是：

```text
opencli 命令
  -> CLI execution engine
  -> HTTP POST localhost daemon
  -> WebSocket 转发给 Chrome Extension
  -> chrome.debugger / chrome.tabs / chrome.cookies
  -> 页面执行、截图、读取 Cookie 或返回 DOM 快照
```

这条链路比 Playwright 更长，但它换来的能力也很明确：不用重新登录，不用导出 `storageState`，也不用要求用户以 `--remote-debugging-port` 启动 Chrome。

## 第一层：命令注册与适配器系统

OpenCLI 的上层是命令适配器。每个站点或工具都可以注册成一个 CLI 命令，声明自己需要什么参数、采用哪种认证策略、是否需要浏览器，以及执行逻辑是什么。

典型策略包括：

| 策略 | 含义 | 是否需要浏览器 |
| --- | --- | --- |
| `PUBLIC` | 访问公开 API、RSS 或网页 | 否 |
| `LOCAL` | 封装本地工具 | 否 |
| `COOKIE` | 复用浏览器 Cookie | 是 |
| `HEADER` | 注入请求头或 Token | 视情况 |
| `INTERCEPT` | 捕获 XHR/Fetch 请求 | 是 |
| `UI` | 完整页面自动化 | 是 |

这种设计的好处是，简单任务可以不启动浏览器。例如抓取 Hacker News 公共 API，只需要 fetch、map、filter、limit 这类 pipeline 步骤；需要登录态的任务才走浏览器控制层。

换句话说，OpenCLI 不把所有网站都粗暴当成“要打开浏览器点页面”的问题，而是先判断：这个命令能不能走轻量数据管道？只有在需要 Cookie、交互、截图或网络拦截时，才进入浏览器路径。

## 第二层：Pipeline 与命令式函数

OpenCLI 支持两种适配器写法。

第一种是声明式 pipeline，适合“取数据、变换、筛选、输出”的任务：

```js
cli({
  site: "hackernews",
  name: "top",
  strategy: Strategy.PUBLIC,
  browser: false,
  pipeline: [
    { fetch: "https://hacker-news.firebaseio.com/v0/topstories.json" },
    { limit: "{{args.limit || 10}}" },
    { map: { /* transform item */ } }
  ]
});
```

第二种是命令式 `func()`，适合需要页面对象的任务：

```js
cli({
  site: "twitter",
  name: "trending",
  strategy: Strategy.COOKIE,
  domain: "x.com",
  func: async (page, kwargs) => {
    await page.goto("https://x.com/explore/tabs/trending");
    return page.evaluate("/* extract data */");
  }
});
```

这两种模式让 OpenCLI 同时覆盖“轻量数据抓取”和“真实网页自动化”。它不是单纯的浏览器控制器，更像一个站点命令运行时。

## 第三层：BrowserBridge 与 CDPBridge

OpenCLI 的浏览器控制层有两条路径。

`BrowserBridge` 是主路径：CLI 通过 daemon 和 Chrome Extension 控制用户 Chrome。它适合常规网站，因为它能复用真实登录状态。

`CDPBridge` 是直连路径：CLI 直接连接某个 CDP endpoint。它更适合 Electron 应用或已经暴露调试端口的环境，例如 VS Code、Slack 这类基于 Chromium 的桌面应用。

两条路径最终都实现同一套 `IPage` 抽象：`goto()`、`evaluate()`、`click()`、`typeText()`、`screenshot()`、`getCookies()`、`cdp()` 等。上层适配器不需要关心底层到底是 daemon 转发，还是直接 CDP 连接。

这个抽象很重要。它把“网站命令怎么写”和“浏览器到底怎么连”分开，使 OpenCLI 可以在不同控制路径之间切换。

## Daemon：为什么需要一个常驻中转层

Daemon 监听本地端口，例如 `127.0.0.1:19825`，对 CLI 暴露 HTTP 接口，同时与 Chrome Extension 保持 WebSocket 连接。

它承担三个职责：

1. 接收 CLI 命令，比如 navigate、exec、cookies、screenshot、tabs、cdp。
2. 把命令转发给已连接的 Chrome Extension。
3. 管理多个 Chrome Profile 或多个扩展连接的上下文。

Daemon 的存在避免了每次 CLI 调用都重新建立复杂连接。对用户来说，这意味着可以连续执行命令；对扩展来说，则可以维持和本地进程的双向通信。

但 daemon 也是安全边界。因为它监听本地端口，必须防止网页或本地恶意进程伪造请求。合理的防护包括 Origin 校验、自定义请求头、禁用 CORS、限制 body 大小、WebSocket 握手校验，以及未来更细粒度的命令授权。

## Chrome Extension：真正接触浏览器状态的地方

Chrome Extension 是 OpenCLI 能复用登录态的关键。它可以访问浏览器标签页、Cookie，并通过 `chrome.debugger` 附加到页面执行 CDP 命令。

扩展接到 daemon 命令后，会按 action 分发：

| action | 作用 |
| --- | --- |
| `navigate` | 创建或跳转标签页 |
| `exec` | 在页面中执行 JavaScript |
| `cookies` | 读取指定域名 Cookie |
| `screenshot` | 调用 CDP 截图 |
| `cdp` | 透传 CDP 命令 |
| `tabs` | 管理标签页 |
| `bind` | 绑定到用户已有标签页 |
| `network-capture` | 捕获网络请求 |
| `set-file-input` | 处理文件上传 |

这里的能力非常强，因此权限设计必须谨慎。OpenCLI 的体验优势来自扩展，最大风险也来自扩展：一旦扩展或本地 daemon 被滥用，用户的真实浏览器上下文会受到影响。

## 工作空间与标签页租约

OpenCLI 不是每次命令都随便开关标签页，而是引入工作空间和标签页租约模型。

可以把它理解为三类页面所有权：

| 类型 | 所有权 | 生命周期 | 适用场景 |
| --- | --- | --- | --- |
| Ephemeral | OpenCLI 拥有 | 命令结束后关闭 | 一次性抓取 |
| Persistent | OpenCLI 拥有 | 空闲一段时间后回收 | 多步任务 |
| Bound | 借用用户已有标签页 | 直到解除绑定 | 操作用户已经打开的页面 |

这个模型比“每个命令新开一个页面”更灵活。它既能隔离自动化页面，又能在需要时绑定真实用户标签页。对 AI Agent 场景也很有价值，因为多轮任务往往需要保持页面上下文。

## DOM 快照：面向 AI Agent 的页面理解层

如果只给 AI 一张截图，模型需要依赖视觉识别判断按钮、输入框和链接。OpenCLI 更接近 Playwright MCP 的思路：把 DOM 转成结构化文本快照，让 Agent 看到可交互元素、文本层级和引用 ID。

一个好的 DOM snapshot 系统通常要解决四件事：

1. 提取可访问性树或近似结构。
2. 给可点击、可输入元素分配稳定 ref。
3. 只保留视口附近或重要节点，避免上下文爆炸。
4. 支持元素重新识别，避免页面刷新后 ref 全部失效。

OpenCLI 的 DOM 快照能力使它不只是“远程执行 JavaScript”，而是更适合被上层 Agent 驱动。Agent 可以先读快照，再决定点击哪个 ref、输入什么内容、是否需要重新截图。

## 反检测机制：真实浏览器不等于完全不可检测

OpenCLI 复用用户 Chrome，天然比干净的 headless 浏览器更接近真实用户环境。但只要通过 CDP 和脚本控制页面，仍然可能留下自动化痕迹。

因此它需要注入 stealth 逻辑，例如隐藏 `navigator.webdriver`、修补 `window.chrome`、填充 plugins/languages、清理自动化全局变量、伪装 `Function.prototype.toString`、处理 Error stack、过滤 Performance API 中的 CDP 注入痕迹等。

这类措施不能保证永远绕过风控，但能降低“默认 Playwright 指纹”带来的误伤。更重要的是，OpenCLI 的真实用户浏览器状态、扩展桥接和 stealth 注入共同构成了它的反检测策略。

## 设计取舍总结

OpenCLI 最聪明的地方，是没有把所有问题都抽象成“启动浏览器并自动化”。它把任务分层：能用 pipeline 解决的，不进浏览器；必须用登录态的，走扩展桥接；需要 Electron 的，走 CDPBridge；需要 AI 理解页面的，输出 DOM 快照。

它的主要代价也很清楚：

- 架构链路长，调试难度高。
- Chrome Extension 安装和权限提示会劝退一部分用户。
- 缺少原生 MCP 时，AI Agent 集成不如 Playwright MCP 自然。
- 共享用户浏览器上下文，对安全审计和权限控制要求更高。

## 结论

OpenCLI 的架构可以概括为一个判断：**对许多真实任务来说，登录态比浏览器实例更重要。**

Playwright 擅长创造一个可控、隔离、可重复的浏览器；OpenCLI 则擅长进入用户已经拥有上下文的浏览器。前者适合测试和标准自动化，后者适合个人数据提取、内部系统操作和账号状态高度复杂的网站。

如果未来要继续演进，OpenCLI 最值得补强的是三件事：MCP Server 封装、更细的权限模型，以及可审计的操作日志。这样它就不只是“把网站变成 CLI”，而是能成为 AI Agent 使用真实 Web 能力的一层安全网关。
