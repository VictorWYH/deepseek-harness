# Dashboard Web Shell 与 3080/3081 完全隔离

## 状态

Draft

## 背景

当前 DSH 原生 Web Shell 以 Workspace/Session 为主要导航，不能直接表达“共享 Agent、用户独立 Session”的产品模型。开发环境还需要同时保留一个原生 DSH 实例和一个 Dashboard Shell 实例；仅使用不同端口不能保证代码、运行时 Home、Profile、Session、Memory 与凭据完全隔离。

## 目标

- 在不修改 Cordis 内核的前提下，为 DSH 增加可替换的 Web Shell 入口。
- 保留原生 Web Shell 作为 3080 对照/调试环境。
- 让 3081 使用 Dashboard Shell，并与 3080 使用不同源码产物、不同 `DSH_HOME`、不同端口和不同数据目录。
- 为后续多用户 Dashboard 建立 Shell 与 Runtime 的清晰边界。
- 新 Shell 的目标交互为：左侧 Agent，右侧当前用户在该 Agent 下的 Session/Agent 看板。

## 非目标

- 不修改 `vendor/` 中的 Cordis 内核。
- 本变更第一阶段不实现完整公司账户、RBAC、审计和本地 Runner。
- 不迁移或重写 DSH Session 持久化格式。
- 不删除原生 DSH Web Shell。

## 设计

### 运行实例隔离

| 实例 | 用途 | 源码/产物 | 端口 | DSH_HOME |
|---|---|---|---:|---|
| native | 原生 DSH 对照与调试 | 官方构建或独立 worktree | 3080 | `D:\DSHAgent\native-home` |
| dashboard-dev | 当前开发会话之外的 Dashboard Shell 验证 | `H:\AIWork\dsh-fork` 构建产物 | 3082 | `D:\DSHAgent\dashboard-dev-home` |
| dashboard | Dashboard Shell 最终实例 | `H:\AIWork\dsh-fork` 构建产物 | 3081 | `D:\DSHAgent\dashboard-home` |

启动配置必须显式指定端口和 `DSH_HOME`，禁止通过当前目录、全局 npm 安装位置或隐含环境变量推断隔离关系。凭据文件、Profile 插件目录、Session 存储、Memory 存储和临时输出都必须位于各自 Home 或显式的实例目录。

### Web Shell 边界

`apps/web` 继续是薄入口；原生 Shell 仍由 `@deepseek-ai/dsh-client-web` 提供。新增 Dashboard Shell 使用独立的客户端包或明确的 Shell 选择入口，避免把 Dashboard 业务页面散落到原生 Workspace 组件中。Shell 只消费 DSH 客户端 Runtime/RPC 能力，不修改 Cordis。

第一阶段先提供一个可测试的 Shell 选择机制和 Dashboard Shell 骨架；后续再接入 Agent 注册、用户 Session、Profile 绑定和看板数据。

### 产品数据关系

后续 Dashboard Session 创建必须持久化以下关系：

```text
userId + agentId + profileId + workspaceId + memoryScope + permissionPolicy
```

同一 Agent/Profile 可被多个用户使用，但 Session、Workspace 访问范围和用户级 Memory 必须按用户隔离。该数据模型不在第一阶段伪造完成；第一阶段只保留 Runtime 接口扩展位置和隔离验收证据。

## 分阶段实施

1. **隔离启动基线**：为 native/dashboard 实例提供显式配置、启动脚本/文档和验证检查；确认 3080/3081 不共享代码产物、Home、Profile、Session、Memory 或凭据。
2. **Shell 选择骨架**：新增独立 Dashboard Shell 包或入口，能在不影响原生 Shell 的情况下构建和启动；Dashboard Shell 先展示 Agent/Session 的静态运行时占位结构。第一阶段采用 Web bundle patch 启用 Dashboard Shell；开发验证使用 3082，避免重启当前 3081 会话。
3. **Runtime 接入**：复用现有 DSH Client Runtime/RPC，形成 Dashboard 侧可用的 Session、Workspace、Event 调用面。
4. **多用户模型**：在 Dashboard Shell/Adapter 层实现登录、权限、Agent 映射、用户 Session 隔离和审计；Profile 作为 Session 创建时的不可变元数据保存。
5. **生产部署**：服务器 Workspace、独立 Home、服务账户、反向代理、TLS、备份和恢复演练。

## 验收标准

- `3080` 和 `3081` 启动命令明确显示各自的代码来源、端口和 `DSH_HOME`。
- 修改 Dashboard Shell 源码并重建只影响 3081，不影响 3080 原生 Shell。
- 两个实例的 `DSH_HOME`、Profile 安装目录、Session 存储、Memory 存储和 credentials 路径无交集。
- 原生 Web Shell 可以独立启动和访问；Dashboard Shell 可以独立启动和访问。
- 未改动 Cordis 源码；隔离测试能在清理环境中重复执行。
- Dashboard Shell 的后续 Session 创建入口能够携带明确的 `agentId/profileId/workspaceId`，而不是从左侧 Workspace 名称推断 Profile。

## 风险与回滚

- 如果当前 Web Host 没有根 Shell 替换扩展点，第一阶段允许在 `apps/web` 入口提供显式 Shell 选择；不改变原生默认行为。
- 如果构建产物或 Profile 目录被意外共享，启动器必须 fail closed，而不是继续启动。
- 原生实例始终保留为回滚路径；Dashboard Shell 失败时不修改 native 配置或数据。
