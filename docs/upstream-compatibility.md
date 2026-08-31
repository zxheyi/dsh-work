# DeepSeek Harness compatibility contract

Status: accepted integration baseline; implementation verification open

## Rule

DSH Work records upstream source provenance and the runtime package family independently. The pinned upstream source is a read-only, byte-clean compatibility baseline, not a product-owned implementation tree. Upstream pin updates, runtime package updates, and DSH Work behavior changes remain separate changes with separate evidence.

DSH Work must not modify or copy upstream source to implement product behavior, or rebuild Harness-owned Agent, session, model, tool, authorization, or plugin-lifecycle services. A verified gap in native Profiles, Bundles, plugins, or public services returns to research and an upstream extension proposal.

## Current selection

| Item | Value | Evidence |
| --- | --- | --- |
| Source repository | `https://github.com/deepseek-ai/deepseek-harness` | Project README |
| Source revision | `0a53fb55bea101816fa226bb964ae2bed71c343b` (`dsh-v0.1.2-alpha.2`) | [ADR 0003](decisions/0003-dsh-alpha2-runtime-upgrade.md) |
| Source integration method | Read-only provenance baseline; launch the official `dsh --profile` CLI as a child | [ADR 0003](decisions/0003-dsh-alpha2-runtime-upgrade.md) |
| Runtime package family | Official npm `@deepseek-ai/dsh@0.1.2-alpha.2` | macOS and Windows native compatibility probes; product matrix pending |
| Runtime integrity | `sha512-4TvTC5kRKlgtSU2UTBv+cID9a2Z+6+m6mpvjXWJfVzuTkflCff6s4MsQpFJTCmwFh/k7zNWe7qFXcLYMV/5VvA==` | npm registry, archive-byte checks, and research lockfile |
| Standalone Node baseline | Node.js `24.11.1` | macOS arm64 and Windows x64 Node archives and executable bytes verified |
| Package manager boundary | pnpm `10.34.4` only in controlled build/materialization; no package manager at ordinary launch | Development materialization passed; packaged proof pending |
| Last compatibility verification | 2026-08-31, macOS arm64 and Windows x64 official CLI/Profile lifecycle probes | [CI 33391284357](https://github.com/zxheyi/dsh-work/actions/runs/33391284357), tested `77a7aa3` |

These values are the accepted M0 baseline, not an implementation-complete runtime manifest. [runtime/baseline.json](../runtime/baseline.json) is the machine-readable active selection. Historical rc.2/alpha.1 observations remain associated with their original revisions. Product implementation must use only the accepted alpha.2 public services; later HEAD behavior is not implicitly available.

## Required compatibility checks

The [isolated alpha.2 probe](../prototypes/m0-runtime-upgrade/README.md) supplied the native adoption evidence. Its original candidate manifests are frozen research inputs, not the active product selection. The executable gate checks actual source/artifacts before and after execution; document-text checks cannot replace product integration evidence.

The repository gate must verify:

- the expected upstream remote and exact source revision;
- a clean upstream working tree or immutable source artifact;
- the selected runtime package family;
- the allowed package-manager boundary;
- the native Profile, Bundle, or plugin entry used by DSH Work;
- headless Loader/Profile activation;
- public service and extension boundaries used by DSH Work;
- the absence of product modifications in the pinned upstream source tree;
- the absence of a parallel DSH Work implementation of Harness-owned services;
- Windows and macOS behavior affected by the update.

## DSH Desktop reference

[DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) is an architectural reference, not an implementation dependency. At reviewed revision [`8bfc99c`](https://github.com/anywhere-labs/dsh-desktop/tree/8bfc99c1597a10966f3d20f963cd2efe82d6f4b1), it demonstrates three useful boundaries:

- its [repository contract](https://github.com/anywhere-labs/dsh-desktop/blob/8bfc99c1597a10966f3d20f963cd2efe82d6f4b1/AGENTS.md) treats the pinned `deepseek-harness/` source checkout as read-only on product branches;
- its [architecture](https://github.com/anywhere-labs/dsh-desktop/blob/8bfc99c1597a10966f3d20f963cd2efe82d6f4b1/docs/architecture.md) keeps the desktop host thin and composes product behavior through Harness services and plugins;
- its [upstream integration note](https://github.com/anywhere-labs/dsh-desktop/blob/8bfc99c1597a10966f3d20f963cd2efe82d6f4b1/.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md) separates source pinning, runtime packages, and product changes.

DSH Work adopts those boundary principles while selecting and verifying its own integration strategy. A temporary runtime-package patch, if ever accepted, remains an explicit ledgered exception and does not authorize modifying the pinned source checkout.

## Update workflow

1. Open an upstream-update Issue with old/new source and runtime versions.
2. Review upstream release notes and relevant source diffs.
3. Update the source pin or artifact in a dedicated commit.
4. Update the runtime package family in a separate commit when applicable.
5. Prove that the pinned source remains clean and that product code uses accepted public extension boundaries.
6. Run the full compatibility and affected platform matrix.
7. Record changed contracts, migrations, diagnostics, and rollback.
8. Merge product adaptations separately after the new baseline is understood.

## Temporary patch ledger

No temporary patch is accepted.

Every future patch entry must contain:

| Field | Required content |
| --- | --- |
| Target | Package, source revision, and affected files |
| Reason | User-visible or compatibility failure that requires the patch |
| Upstream tracking | Issue or pull request URL |
| Behavior impact | Exact contract changed by the patch |
| Protection | Regression and compatibility checks |
| Removal condition | Upstream version or decision that makes the patch unnecessary |
| Last verification | Date, platform matrix, and evidence |
