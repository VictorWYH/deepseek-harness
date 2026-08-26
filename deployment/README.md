# DSH 实例隔离

本目录定义原生 DSH 与 Dashboard Shell 的运行实例边界，并附带 fail-closed 的启动器与运行态校验工具。

## 实例

- `native.json`: 原生基线，端口 `3080`，Home `D:\DSHAgent\native-home`。
- `dashboard-dev.json`: 开发验证实例，端口 `3082`，Home `D:\DSHAgent\dashboard-dev-home`。当前 3081 会话仍在使用时，只能使用该实例验收 fork 构建。
- `dashboard.json`: Dashboard 最终实例，端口 `3081`，Home `D:\DSHAgent\dashboard-home`。

## 隔离要求

每个实例必须使用自己的：

- DSH 构建产物或源码来源；
- `DSH_HOME`；
- Profile 安装目录；
- Session 存储；
- Memory 存储；
- credentials 文件；
- 临时输出目录。

不同端口不是隔离证明。启动器或部署系统必须拒绝共享 Home；当前 3081 运行期间不得由本会话重启或替换 3081。Dashboard 改动先在 3082 验证，确认后再安排 3081 切换。

## 代码来源

- `native` 使用官方/基线构建（`sourceRoot/lib/bin.js`），不从 `H:\AIWork\dsh-fork` 读取代码。
- `dashboard-dev` 和 `dashboard` 使用 `H:\AIWork\dsh-fork` 的构建产物（`sourceRoot/apps/cli/lib/bin.js`）。

## 启动器：run-instance.mjs

fail-closed 启动器。先校验实例契约，再检查目标端口未被监听，最后以显式 `DSH_HOME` 和 `--port <port>` 启动实例；`--dry-run` 只打印命令与环境，不启动。任何校验失败都会在启动前退出（exit 1），绝不会停止或重启现有服务。

```powershell
# 打印 dashboard-dev 的启动命令与环境（不启动）
node deployment\run-instance.mjs --instance dashboard-dev --dry-run -- web --no-open

# 真正启动 dashboard-dev（3082 + D:/DSHAgent/dashboard-dev-home）
node deployment\run-instance.mjs --instance dashboard-dev -- web --no-open
```

启动器强制约束：

- `--instance <id>` 必须是 `native` / `dashboard-dev` / `dashboard` 之一；
- 端口必须为整数且在 1..65535；
- 所有实例端口互不重复、Home 互不重复；
- `allowSharedHome` 必须为 `false`；
- `sourceRoot` 必须存在，且 native 与 dashboard 的 `sourceRoot` 必须不同；
- 目标端口已被监听时拒绝启动；
- `<dsh args>` 中禁止自行传 `--port`（由启动器统一管理）。

## 运行态校验：verify-runtime-isolation.mjs

只读校验（不启动、不停止、不重启任何服务）。先校验实例契约，再检查每个已配置端口的当前监听状态：

- 端口未监听 → 报告“not running”（合法，实例可能已停止）；
- 端口被监听 → 解析所属 PID 与进程命令行，并确认命令行包含该实例的预期 bin 和 `--port <port>`；
- 监听存在但 PID/命令行无法解析，或命令行与预期映射不一致 → 显式 FAIL 并以非零退出；
- 存在至少一个不匹配/不可确认项 → 整体 FAIL（exit 1）。

```powershell
node deployment\verify-runtime-isolation.mjs
```

说明：`DSH_HOME` 是启动时的进程环境，无法从进程命令行读到；Home 隔离由 `run-instance.mjs` 在启动时强制，并在此工具配置层面校验。

## 工具安全边界

- 本目录所有工具都不会修改、停止或重启运行中的实例；
- 3081 切换必须在用户明确确认停机窗口后，由人工或受控脚本执行；
- 这些 JSON 是部署契约，工具只在显式调用时才消费它们。
