# @deepseek-ai/dsh-client-ui-dashboard-shell

[English](README.md) | 中文

产品壳插件（Agent-native Dashboard 第一阶段）：深色两栏产品框架，注册进运行时内建 `root` 槽，优先级为 `-1`（最低者渲染），从而遮蔽原生 AppFrame 的优先级 0 注册并接管整个浏览器界面。本壳为可选启用：随附的 [web-app bundle](../../bundle/web-app/cordis.patch.yml) 保持原生不变，由 [dashboard overlay](../../bundle/web-app/dashboard.patch.yml) 插入本壳，将 `ui-layout` 设为 `registerRoot: false`，禁用原生界面（ui-sidebar / ui-settings-* / ui-brand-official / ui-workspace / ui-input-trigger / ui-commands / ui-skill / ui-subagent / ui-reference / ui-jobs / ui-goal / ui-message-feedback / ui-model-selection / ui-permission-presets / ui-agent-preset / ui-settings-plugins / ui-plan / ui-user-questions / ui-trajectory 及对话相邻功能席位），保留底层服务（client-runtime、ui-renderer、ui-theme、locale、ui-settings）与 `ui-conversation`，使 Dashboard 主区可以重新托管真实聊天界面。

框架以组件本地状态持有 Agent 选择，并把只读的 `useSessions` / `useWorkspaces` 标准 hooks 投影到所选 Agent 的工作台：统计卡片（工作区 / 会话 / 运行中计数）以及按工作区分组的会话列表。点击会话行即通过运行时 sessions 服务打开；**新建会话**调用运行时共享的 New Session 流程（`workspaces.startSession`），可全局或按工作区发起。

框架声明两个 root 作用域子席位，并通过 `renderSlot` 渲染（内置回退），后续阶段可注册进席位替换任一区域：

- `dashboard.sidebar` — Agent 导航栏（内置回退渲染静态名单 `coder` / `btender` / `invest` / `video`）。
- `dashboard.main` — 所选 Agent 的工作台（内置回退渲染统计与分组会话列表）。

当前尚无 Profile 平面：Agent 名单是静态的，会话不按 Agent 过滤，新建会话也不会原子创建 Profile——这些属于后续阶段。

`DashboardFrameComponentProps` 组合了 root 属主份额、全局 `useSessions` 与 `useWorkspaces` 钩子、两个子槽渲染份额，以及注入的 `openSession` / `startSession` 回调。本插件不注册 store。

`/client` 导出仅包含插件主体（`apply`/`inject`）与契约类型；DashboardFrame、回退组件与分组投影保持包内私有，位于槽注册之后。

## 模型体验

无：工作台壳仅渲染浏览器会话列表，此处不触及任何模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。

## 已知限制与暂缓事项

- **静态 Agent 名单** — `coder` / `btender` / `invest` / `video` 为硬编码；未来 Profile 平面以这些 id 为键，并从 `profiles/` 推导名单。
- **无 Agent 到会话的过滤** — 每个 Agent 下都展示全部会话；按 Agent 的会话列表将随 Profile 绑定而来。
- **无原子 Profile 创建** — 新建会话仅调用 `workspaces.startSession()`；Profile 与会话绑定属后续阶段。
- **无会话操作** — 行仅支持打开；重命名 / 派生 / 归档属于后续阶段。
