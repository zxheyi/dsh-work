# DSH Work repository contract

DSH Work is a desktop product layer composed on DeepSeek Harness. Compose Harness; do not reimplement it. Preserve the upstream Agent runtime and native plugin boundaries while keeping the desktop host focused on operating-system integration and process lifecycle.

## Context

- **Scope:** read `docs/product-scope.md` before changing product behavior or proposing a milestone.
- **Delivery:** read `docs/workflow.md` before implementing, reviewing, or declaring a change complete.
- **V1 baseline:** read `docs/workflow-v1.zh-CN.md` when auditing or changing the AI Native delivery workflow v1 contract.
- **Milestones:** read the applicable file under `docs/acceptance/` before milestone work.
- **Architecture:** read `docs/decisions/README.md` before changing a public interface, persistence format, technology stack, security boundary, or production dependency.
- **Upstream:** read `docs/upstream-compatibility.md` before changing Harness integration, versions, patches, Profiles, Bundles, or plugin lifecycle behavior.

## Change loop

1. **Scope:** define the user outcome, non-goals, affected boundary, and acceptance checks. Scope is complete when each outcome is objectively testable.
2. **Research:** inspect repository and pinned upstream evidence before choosing an integration or architecture. Research is complete when facts, alternatives, and unresolved risks are explicit.
3. **Plan:** split the change into independently verifiable vertical slices. Planning is complete when every acceptance check has a verification method.
4. **Red:** reproduce a defect or create a failing executable check before changing behavior. For new infrastructure, establish the smallest failing smoke check.
5. **Build:** implement only the current slice and preserve unrelated work.
6. **Verify:** run targeted checks first, then every affected contract, integration, platform, and repository gate.
7. **Handoff:** report the user-visible result, actual checks run, evidence, risks, and unresolved work. Agent completion claims are not verification.

## Boundaries

- DeepSeek Harness owns Agent runtime, sessions, models, tools, authorization, and plugin lifecycle.
- DSH Work owns desktop windows, operating-system integration, process lifecycle, diagnostics, and product presentation.
- Product capabilities compose through Harness-native Profiles, Bundles, and plugins.
- Keep pinned upstream source read-only and byte-clean; product features land outside the upstream source tree.
- Do not copy or rebuild Harness-owned services inside DSH Work.
- Keep upstream pin updates, runtime package updates, and product behavior changes in separate commits.
- Record every temporary upstream patch in `docs/upstream-compatibility.md` with evidence, protection tests, and a removal condition.
- Keep one extension ecosystem: Harness-native Profiles, Bundles, and plugins. If native composition cannot satisfy a verified outcome, stop and propose an upstream extension; changing this invariant requires an explicit product-scope change and accepted decision before implementation.

## Discipline

- One branch and pull request represent one independently verifiable user outcome.
- Pair behavior changes with tests and contract documentation in the same change.
- Record stable decisions in `docs/decisions/`; keep temporary exploration in Issues and pull requests.
- Add a production dependency only with necessity, license, packaging, and rollback evidence.
- Keep credentials, tokens, account data, and private user content out of the repository and public diagnostics.
- Preserve a defect as a permanent regression check after fixing it.

## Verification

- The repository configuration is the source of truth for build and test commands once implementation begins.
- Until a product toolchain is accepted, run `node --test scripts/verify-contract.test.mjs` and `node scripts/verify-contract.mjs` for every change.
- Keep builds, type checks, unit tests, contract checks, and Loader smokes headless-safe. Launch graphical applications only in explicit desktop tests.
- A change is complete only when its acceptance checks pass and the recorded evidence matches the checks actually run.
