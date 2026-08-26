# DSH 实例隔离

本目录定义原生 DSH 与 Dashboard Shell 的运行实例边界。

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

- `native` 使用官方/基线构建，不从 `H:\AIWork\dsh-fork` 读取代码。
- `dashboard-dev` 和 `dashboard` 使用 `H:\AIWork\dsh-fork` 的构建产物。

这些 JSON 是部署契约，不会自动启动服务，也不会修改现有运行实例。
