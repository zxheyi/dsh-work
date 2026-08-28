## User outcome / 用户结果

<!-- What can the user do now, or what defect is prevented? / 用户现在能做到什么，或避免了什么问题？ -->

## Related Issue / 关联 Issue

<!-- Fixes #123, Closes #456, or N/A -->

## Scope and boundary / 范围与边界

<!-- What changed? Does this affect Harness, DSH Work, Profile, Bundle, or plugin ownership? / 改了什么？是否影响职责边界？ -->

- [ ] Harness-native composition is used; pinned upstream source is unchanged and no Harness-owned service is duplicated. / 使用 Harness 原生组合；固定上游源码未改动，且没有重复实现 Harness 核心服务。

## Type / 类型

- [ ] Feature / 功能
- [ ] Bug fix / 修复
- [ ] Architecture or upstream / 架构或上游
- [ ] Documentation / 文档
- [ ] Tests only / 仅测试
- [ ] Release or packaging / 发布或打包

## Platforms / 平台

- [ ] macOS Apple Silicon
- [ ] macOS Intel
- [ ] Windows 11 x64
- [ ] Windows 10 x64
- [ ] Linux or unsupported smoke / Linux 或未支持平台冒烟
- [ ] Not platform-specific / 与平台无关

## Acceptance evidence / 验收证据

<!-- Map each Issue acceptance criterion to a test, log, screenshot, or manual observation. / 将每条验收标准映射到测试、日志、截图或人工结果。 -->

## Verification actually run / 实际执行的验证

<!-- Do not claim an unrun check passed. Mark it as not run and explain why. / 不要声称未运行的检查已经通过。 -->

- [ ] `node --test scripts/verify-contract.test.mjs`
- [ ] `node scripts/verify-contract.mjs`
- [ ] Targeted tests / 目标测试
- [ ] Affected integration or compatibility checks / 相关集成或兼容检查
- [ ] Platform package or launch smoke / 平台打包或启动冒烟
- [ ] Desktop E2E or screenshots / 桌面 E2E 或截图
- [ ] Manual product judgment / 人工产品判断

Commands, results, and evidence locations:

```text

```

## Decision, dependency, or upstream impact / 决策、依赖或上游影响

<!-- Link the decision, patch ledger, dependency/license evidence, or write N/A. -->

## Risks and rollback / 风险与回滚

## Release notes / 发布说明

<!-- User-visible change, migration, known limitation, or N/A. -->
