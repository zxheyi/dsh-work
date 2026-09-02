# DSH Work 启动流程设计 v1

状态：提案，作为下一轮 PRD 与启动壳优化基准

关联事实源：[`ADR 0004：崩溃安全的 Runtime 所有权`](../decisions/0004-crash-safe-runtime-ownership.md)、[`ADR 0006：Work 产品聚合`](../decisions/0006-work-as-product-owned-aggregate.md)、[`ADR 0007：可信桌面页面交接`](../decisions/0007-authenticated-desktop-surface-handoff.md)、[`首页设计规格 v2`](work-home-v2.md)、[`Desktop Work Shell 验收`](../acceptance/desktop-work-shell.md)

## 1. 设计结论

启动时，用户只需要理解三件事：

1. **开始新工作**；
2. **继续自己的工作**；
3. **继续已有对话**。

Runtime、Harness、Profile、Workspace、Primary Session、Turn、DSH_HOME、Guardian 和认证 URL 都属于实现，不进入普通启动界面。

“继续已有对话”是兼容入口，不是默认工作方式：

- DSH Work Web 创建的 Work 自动出现在桌面端，不叫导入；
- DSH Desktop 或普通 DSH Web 创建的外部 Session，只有用户主动选择后才进入导入流程；
- 外部 Session 默认保持不变，DSH Work 创建新的受管 Work、Workspace 和 Primary Session；
- 外部会话内容以带来源的上下文快照进入新 Session，不把原 Session 变成由两个产品共同写入的对象。

## 2. 产品原则

### 2.1 架构约束不是用户步骤

内部仍坚持：

`1 Work = 1 个 DSH Work 管理的 Workspace + 1 个 Primary Session + 多个 Turn + 成果版本`

用户界面只表达：

`一项工作 = 目标 + 资料 + 进展 + 成果`

用户不会被要求“创建 Session”“绑定 Workspace”或“选择 Harness”。

### 2.2 启动不依赖系统 Harness

正式安装包必须使用产品内置并校验过的 Node、官方 Harness、pnpm 和基础 Profile。系统 PATH 中是否存在 `dsh` 不影响核心启动。

系统 Harness 只在用户主动进入“继续已有对话”时作为一个可选来源被读取。普通启动不扫描 `~/.dsh`，以避免启动变慢、权限弹窗、隐私误解和版本耦合。

### 2.3 恢复状态，不重放意图

重启可以恢复 Work、页面位置、成果和安全的执行状态，但不能自动重放一个可能产生副作用的 Turn、工具调用或导出动作。

- 干净退出：恢复上次页面和 Work，不重复提交输入；
- 意外退出：恢复 Work，显示“继续处理”；
- 运行环境归属不确定：先进入安全恢复，不自动连接旧进程；
- 创建 Work 中断：通过幂等 provisioning 继续，不创建重复 Workspace 或 Session。

## 3. 用户可见流程

### 3.1 普通启动

```text
打开 DSH Work
    ↓
短暂启动壳：正在打开 DSH Work
    ↓
恢复最近的工作和运行环境
    ↓
┌───────────────────────────────┐
│ 上次停留在某项 Work → 回到该 Work │
│ 上次停留在首页       → 进入首页     │
│ 首次使用／没有 Work   → 进入空首页   │
└───────────────────────────────┘
```

正常情况下不展示检查步骤、版本号或技术日志。只有启动明显变慢时，启动壳才把说明从“正在打开”更新为“正在恢复最近的工作”。

### 3.2 首次使用

首次启动不设置 Harness、不选择 Workspace，也不强制扫描本机已有会话。

首页呈现：

```text
你想完成什么？
[ 描述想要的结果……                         ]

[开始工作]

添加资料（可选）        继续已有对话
```

用户点击“开始工作”后，系统在后台依次完成：

1. 创建 Work provisioning 记录；
2. 分配产品管理的 Workspace；
3. 创建 Primary Session；
4. 提交目标作为第一个 Turn；
5. 进入 Work 页面。

如果尚未具备可用的模型凭据，在用户第一次开始工作时再显示产品语言的“连接 AI 服务”，不以 Harness 配置向导阻塞首页。

### 3.3 干净重启

```text
退出前：用户正在 Work A 中审核成果
    ↓
安全保存最后路由与 Work 投影
    ↓
再次打开
    ↓
重新启动受管 Runtime
    ↓
回到 Work A 的审核位置
```

恢复页面不等于恢复执行。退出前没有运行中的 Turn，就不得创建新 Turn。

### 3.4 意外中断

能够确认旧 Runtime 已停止时：

```text
回到原 Work
    ↓
顶部提示：上次处理意外中断，你的工作和已有成果已保留
    ↓
[继续处理]  [稍后]
```

“继续处理”在原 Primary Session 中追加一个明确的恢复 Turn。它不是静默重放中断前的工具操作。

无法确认旧 Runtime 是否仍有写入能力时：

```text
启动壳：需要安全恢复
    ↓
解释：为保护已有工作，暂不连接上一次运行环境
    ↓
[安全恢复]  [导出诊断]
```

安全恢复创建隔离 generation，但不删除或覆盖旧数据。

### 3.5 DSH Work Web 与桌面切换

DSH Work Web 必须通过同一 Work Client API 创建和推进 Work：

```text
DSH Work Web ─────┐
                  ├── Work Remote ── Work / Session Binding / 成果
DSH Work Desktop ─┘
```

桌面启动后按 Work ID 获取变化并展示。用户只看到“在 Web 上更新”，不需要导入、绑定或选择 Session。

如果同一 Work 已在另一端执行，桌面展示执行状态，不得再次提交相同命令。执行所有权由服务端 Work mutation／lease 决定，而不是由最后打开的客户端决定。

### 3.6 继续已有对话

入口使用产品语言“继续已有对话”，不使用“导入 Session”。只有用户点击入口后才查找来源。

当前安全实现先支持“粘贴可读内容”：用户从 DSH Desktop、DSH Web 或 CLI 复制／导出可读对话，选择来源后创建新 Work。自动列出另一产品的本机会话，需要来源产品提供明确授权的只读适配器或可移植导出契约；在此之前不得扫描 `~/.dsh`、打开外部 Profile 数据库或解析私有持久化格式。

```text
继续已有对话
    ↓
选择来源
├─ DSH Desktop
├─ DSH Web／CLI
└─ 其他来源
    ↓
粘贴用户主动复制／导出的可读内容
    ↓
确认工作名称；按需补充资料
    ↓
创建 DSH Work 受管 Work
    ↓
将外部对话转换为带来源的上下文快照
    ↓
创建新的 Primary Session 并继续
```

默认保证：

- 不移动、不删除、不修改原 Session；
- 不复制外部 Profile 的 `node_modules`、运行锁或缓存；
- 不把外部绝对路径直接当作 DSH Work Workspace；
- 导入文件前展示范围并获得用户确认；
- Work 保存 `sourceSystem`、`sourceSessionId`、来源版本和导入时间，用于追溯；
- 当前粘贴入口没有可靠 Session ID 或来源版本时保存为空，不伪造标识；
- Canonical transcript 仍由原 Harness 保存；Work 聚合只保存来源引用、允许的快照和摘要；新的持续历史由 DSH Work Primary Session 保存。

版本不兼容、来源缺失或远端不可达时，不尝试共同写入原 Session。可以提供“仅导入可读内容并开始新工作”，不能承诺原 Session 原位续写。

## 4. 内部启动编排

### 4.1 阶段

```text
Electron ready
    ↓
获取单实例所有权
    ↓
打开本地启动壳
    ↓
读取 product root 与 generation 记录
    ↓
校验应用内 Runtime manifest
    ↓
确认上次 generation 的清理／恢复状态
    ↓
启动或复用受管 Guardian generation
    ↓
启动官方 dsh --profile dsh-work
    ↓
等待结构化 Ready 与可信 surface
    ↓
完成一次性认证页面交接
    ↓
读取 Work 恢复计划
    ↓
进入首页或上次 Work
```

### 4.2 Runtime 预检

预检只检查产品拥有的内容：

- 内置 Node 是否存在且版本／完整性匹配；
- `@deepseek-ai/dsh` 是否来自安装包并符合 baseline；
- pnpm 和基础 Profile 资源是否完整；
- 产品专属 DSH_HOME 是否可安全读写；
- generation 记录是否可恢复；
- 应用拥有的 `dsh` shim 是否位于子进程 PATH 首位。

不检查或采用 PATH 中的系统 `dsh`。开发模式可以显式注入 Node，但正式包不能把该配置暴露给用户。

### 4.3 深模块 Interface

启动复杂度集中在一个 `StartupCoordinator` Module 后面。Electron 窗口不分别理解 Runtime 校验、Guardian、Work 恢复或路由决策。

```ts
type StartupRoute =
  | { readonly kind: 'home' }
  | { readonly kind: 'work'; readonly workId: string }

type StartupOutcome =
  | { readonly kind: 'ready'; readonly route: StartupRoute }
  | { readonly kind: 'recoverable'; readonly reason: string }
  | { readonly kind: 'repair-required'; readonly reason: string }

interface StartupCoordinator {
  start(): Promise<StartupOutcome>
  retry(): Promise<StartupOutcome>
  recover(): Promise<StartupOutcome>
}
```

可信 surface 引用和认证 URL 只在主进程内部 seam 中流转，不成为渲染层可读取的 `StartupOutcome` 字段。窗口只消费稳定的产品状态和允许的动作。

本地与远端执行差异不进入该 Interface。Work 执行使用独立的 Runtime seam：本地由 Bundled Harness Adapter 实现，远端由 Remote Harness Adapter 实现。

## 5. 启动壳状态与文案

| 状态 | 标题 | 说明 | 操作 |
| --- | --- | --- | --- |
| 正常准备 | 正在打开 DSH Work | 正在恢复最近的工作并准备你的工作台。 | 无 |
| 时间较长 | 仍在准备工作台 | 首次启动或升级后可能需要更长时间。 | 无，达到超时后再给操作 |
| 安装不完整 | DSH Work 安装不完整 | 运行组件缺失或校验失败，已有工作不会被删除。 | 重新打开、修复安装 |
| 上次清理不确定 | 需要安全恢复 | 为保护已有工作，当前不会自动连接上次环境。 | 安全恢复、导出诊断 |
| Runtime 意外退出 | 工作台意外停止 | 已有工作和成果已保留。 | 重新打开、安全恢复 |
| Work 创建中断 | 正在继续创建工作 | 将从安全步骤继续，不会重复创建工作。 | 失败后显示重试 |

技术错误码可以在“诊断详情”中显示，但默认界面不出现 Node、Harness、Profile、Session、PID 或路径。

## 6. 恢复路由优先级

启动成功后按以下优先级决定页面：

1. 用户触发的合法 Work deep link；
2. 尚未完成且可幂等恢复的 Work provisioning；
3. 上次干净保存的页面路由；
4. 首页。

异常中断时可以恢复上次 Work 页面，但不能自动执行新的 Work command。已完成或已交付的 Work 可以重新打开查看，不因为“最近访问”而改变生命周期。

## 7. 阶段范围

### 第一阶段

- 内置 Runtime 预检；
- 独立产品 Home；
- 单实例、Guardian generation 和安全恢复；
- 首次启动进入首页；
- 干净重启回到上次 Work；
- 意外中断后由用户确认继续；
- 一个 Work、一个受管 Workspace、一个 Primary Session；
- 不扫描、不导入外部 Session。

### 第二阶段

- DSH Work Web 与 Desktop 共享 Work Remote；
- 多客户端同步 Work 状态；
- 执行 lease 与重复命令防护；
- Web 创建的 Work 自动出现在桌面端。

### 第三阶段

- “继续已有对话”；
- 用户触发后只读发现本机 DSH／DSH Desktop Session；
- 兼容性、来源和文件范围预览；
- 上下文快照导入；
- 原 Session 保持不变；
- 不兼容时降级为“基于可读内容开始新工作”。

## 8. 验收标准

1. 未安装系统 Harness 的机器能够正常启动 DSH Work。
2. 系统安装另一个版本的 `dsh` 不改变 DSH Work 实际 Runtime 版本。
3. 普通启动不读取或扫描用户的 `~/.dsh`。
4. 首次启动直接进入 Work 首页，不出现 Runtime、Profile、Workspace 或 Session 设置。
5. 干净重启恢复上次页面和 Work，但不增加 Turn。
6. 意外退出后恢复 Work 与成果，必须由用户确认后才继续执行。
7. 中断 Work provisioning 后重启不会产生重复 Work、Workspace 或 Session。
8. Runtime 缺失或损坏只显示产品语言，并保留可导出的稳定错误码。
9. DSH Work Web 创建的 Work 自动出现在桌面端，不出现导入步骤。
10. 外部 Session 只有用户进入“继续已有对话”后才被发现和读取。
11. 导入外部会话不会修改原 Session，也不会复制其 `node_modules`、缓存或运行锁。
12. 普通界面和普通错误信息不出现 Harness 内部概念。

## 9. 需要后续 ADR 明确的事项

在实现第二、三阶段前分别记录：

1. Work Remote 的执行 lease、离线写入与冲突规则；
2. 外部会话导入的来源协议、快照格式、隐私授权、文件策略与追溯字段；
3. Runtime 升级后已有 Work／Session 的兼容、迁移和回滚规则。
