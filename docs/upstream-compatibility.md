# DeepSeek Harness compatibility contract

Status: accepted integration baseline; implementation verification open

## Rule

DSH Work records upstream source provenance and the runtime package family independently. The pinned upstream source is a read-only, byte-clean compatibility baseline, not a product-owned implementation tree. Upstream pin updates, runtime package updates, and DSH Work behavior changes remain separate changes with separate evidence.

DSH Work must not modify or copy upstream source to implement product behavior, or rebuild Harness-owned Agent, session, model, tool, authorization, or plugin-lifecycle services. A verified gap in native Profiles, Bundles, plugins, or public services returns to research and an upstream extension proposal.

## Current selection

| Item | Value | Evidence |
| --- | --- | --- |
| Source repository | `https://github.com/deepseek-ai/deepseek-harness` | Project README |
| Source revision | `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` (`dsh-v0.1.5-rc.1`) | [ADR 0021](decisions/0021-dsh-015-runtime-upgrade.md) |
| Source integration method | Read-only provenance baseline; launch the official `dsh --profile` CLI as a child | [ADR 0021](decisions/0021-dsh-015-runtime-upgrade.md) |
| Runtime package family | Official npm `@deepseek-ai/dsh@0.1.5-rc.1` | rc.1 verification is recorded separately; prior alpha.2 evidence does not cover this selection |
| Runtime integrity | `sha512-rmNmzQCg3oIc1z8xH7izRSOuy1TNzq+/NILyfM+7e8DKOyV+yBtg47WEsqR2SiIe1ATec3L/rUa1YhIcfQ2XEg==` | npm registry, archive-byte checks, and active product lockfile |
| Standalone Node baseline | Node.js `24.11.1` | macOS arm64 and Windows x64 Node archives and executable bytes verified |
| Package manager boundary | pnpm `10.34.4` only in controlled build/materialization; no package manager at ordinary launch | macOS arm64 relocated package launches passed; Windows rc.1 evidence pending |
| Historical alpha.2 verification | 2026-09-01, macOS arm64 and Windows x64 product CLI/Profile and Electron lifecycle | [CI 33465087985](https://github.com/zxheyi/dsh-work/actions/runs/33465087985), tested `4fd63dd`; [frozen receipt and scope](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/acceptance/electron-lifecycle-slice.md#native-receipt) |

These values are the accepted rc.1 upgrade baseline, not an implementation-complete distribution manifest. The machine-readable active selection is [`runtime/baseline.json`](../runtime/baseline.json). Historical rc.2/alpha.1 observations remain associated with their original revisions. Product implementation must use only the accepted rc.1 public services; later HEAD behavior is not implicitly available.

## Required compatibility checks

The frozen [isolated alpha.2 probe](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/prototypes/m0-runtime-upgrade/README.md) supplied the native adoption evidence. Its original candidate manifests remain on the research branch and are not the active product selection. The executable gate checks actual source/artifacts before and after execution; document-text checks cannot replace product integration evidence.

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

## Local Profile compatibility

[ADR 0016](decisions/0016-familiar-desktop-startup.md) permits an explicit local-data mode without changing the selected runtime pair. Discovery reads only regular profile manifests below the resolved local Harness home. The runtime launches an owned shadow of an admitted base-plus-web Profile and applies product plugins through final `--patch` overlays; it never executes a system `dsh` or writes the source Profile.

The shadow may point the pinned official settings, credential, session, attachment and storage providers at the user-selected Harness home. This is Harness-native provider configuration rather than a copied persistence implementation. Compatibility verification must prove the exact provider row ids and configuration fields against the pinned package family, prove source Profile bytes stay unchanged, and prove safe mode uses no selected external path. A future upstream pin that changes these rows or path contracts blocks shared-profile mode until its dedicated compatibility change passes.

### Shared Agent presets

The owned shared generation maps `.agent-presets` to the selected home's `.agent-presets` with a directory symlink (junction on Windows). The pinned `dsh-agent-presets` registry derives its user root from `dshHomePath('.agent-presets')`; mapping that directory preserves its complete Profile configuration, including `default`, configured `roots`, root precedence, `includeUserRoot`, and `includeShippedRoot`. A config overlay cannot safely add a root because pinned Cordis patching replaces the whole `config` field.

Preparation creates an empty selected-home preset directory when absent so native authoring can work through the link. It never copies preset contents or changes the source Profile. Existing generation directories or links to other targets are rejected without deleting their data. Native copy/delete act on the shared home; isolated and safe-mode generations have no such mapping. This completes ADR 0016's selected-home reuse rather than introducing another preset service.

| Scenario | Expected behavior | Verification |
| --- | --- | --- |
| Shared home with presets | Native listing and copy/delete use the selected home | Shadow native scanner/authoring test and real CLI integration |
| Explicit roots or disabled user root | Preserve the Profile's native configuration and precedence | Byte comparison and real CLI configured-root test |
| No preset directory yet | Create an empty user root so later authoring succeeds | Empty-root regression |
| Existing owned directory or different link | Reject without removing existing data | Conflict regressions |
| Independent or safe-mode generation | Keep user presets isolated | Isolated CLI test and existing Guardian safe-mode tests |

Regression evidence: `tests/shadow-profile.test.ts` uses the pinned native discovery/copy/delete functions; `tests/runtime-integration.test.ts` boots the official CLI to verify shared discovery, explicit user-root disabling and custom-root preservation, and isolated behavior.

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
