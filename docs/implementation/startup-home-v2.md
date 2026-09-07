# DSH Work 启动与首页 v2 实现验收

## 结果

[启动与首页交互设计](../design/startup-home-v2/index.html)已经落到桌面应用。启动阶段现在用统一的展示模型驱动环境选择、准备、恢复和停止四种场景；首页继续使用 Harness 原生 Workspace、Session、设置和对话结构，只通过公开插槽加入 DSH Work 品牌、资料入口、成果卡片与详情面板。

首次发现兼容的本地 DSH 配置时，应用会停留在环境选择页。用户可以复用已有配置，也可以创建独立环境。选择会被安全记忆，后续启动直接进入工作台。运行时不可用或进程异常时，应用保留明确的恢复入口和固定诊断码。

## 实现切片

| 顺序 | 变更 | 提交 |
| --- | --- | --- |
| 1 | 集中管理启动展示状态、文案与动作 | `a85c655` |
| 2 | 实现双栏启动壳、环境卡片、进度与恢复布局 | `b8ca989` |
| 3 | 加入本地官方 DeepSeek 鲸鱼资源和严格资源策略 | `246cee7` |
| 4 | 通过原生插槽对齐 DSH Work 品牌与工作台色彩 | `141c5de` |
| 5 | 对齐会话成果卡片和文件详情面板 | `fd2301b` |
| 6 | 移除未挂载的旧 Work 首页和侧栏实现 | `406161f` |
| 7 | 补齐私有协议模块白名单并完成真实桌面验收 | 当前提交 |

启动展示模型位于 [startup-presentation.ts](../../apps/desktop/startup-presentation.ts)，桌面结构和样式位于 [index.html](../../apps/desktop/index.html) 与 [style.css](../../apps/desktop/style.css)。Harness 原生工作台扩展集中在 [surface.ts](../../packages/work-api/surface.ts)。

## 自动验收

- `pnpm test`：224/224 通过。
- `pnpm check`：类型检查和仓库契约通过。
- `node --test scripts/verify-contract.test.mjs`：12/12 通过。
- `DSH_WORK_NODE=<Node 24.11.1> pnpm test:desktop`：正常启动、本地配置选择、本地配置记忆重启、运行时缺失、渲染器崩溃、运行时恢复和 Guardian 异常恢复全部通过。
- `DSH_WORK_NODE=<Node 24.11.1> pnpm test:session-output`：成果发现、Markdown 安全预览、来源、版本、比较、恢复、修改和保存流程通过。

Electron 验收同时检查了沙箱、上下文隔离、禁用 Node 集成、私有协议资源白名单、导航拦截、环境选择页结构、恢复页结构、官方鲸鱼、`DW` 品牌标识和原生首页。生成的截图与 JSON 报告位于本地忽略目录 `artifacts/desktop/` 和 `artifacts/session-output/`。

## 证据边界

该改造合并时，`pnpm verify:familiar-v5` 按设计拒绝了当时源码，因为 [Familiar v5 冻结证据](../acceptance/familiar-work-v5-evidence.json)记录的是改造前 `surface.ts` 的摘要。这里没有改写旧截图、旧执行结果或待完成的 F13 真人观察来伪造一致性；若要重新发布 Familiar v5 验收，需要基于当前版本重新采集整套冻结证据。

2026-09-07：发布准备重新执行七组自动化验收并采集当前截图及源码摘要，见 [当前验收证据](../acceptance/familiar-work-v5-evidence.md)。F13 真人观察仍待完成。
