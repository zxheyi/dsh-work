# DeepSeek Harness compatibility contract

Status: strategy not yet selected

## Rule

DSH Work records upstream source provenance and the runtime package family independently. Product feature branches treat pinned upstream source as read-only. Upstream pin updates, runtime package updates, and DSH Work behavior changes remain separate changes with separate evidence.

## Current selection

| Item | Value | Evidence |
| --- | --- | --- |
| Source repository | `https://github.com/deepseek-ai/deepseek-harness` | Project README |
| Source revision | Not selected | Requires architecture decision |
| Source integration method | Not selected | Requires architecture decision |
| Runtime package family | Not selected | Requires architecture decision |
| Package manager boundary | Not selected | Requires desktop stack decision |
| Last compatibility verification | Not run | No runtime implementation exists |

## Required compatibility checks

When an integration strategy is accepted, the repository gate must be able to verify:

- the expected upstream remote and exact source revision;
- a clean upstream working tree or immutable source artifact;
- the selected runtime package family;
- the allowed package-manager boundary;
- the native Profile, Bundle, or plugin entry used by DSH Work;
- headless Loader/Profile activation;
- public service and extension boundaries used by DSH Work;
- Windows and macOS behavior affected by the update.

## Update workflow

1. Open an upstream-update Issue with old/new source and runtime versions.
2. Review upstream release notes and relevant source diffs.
3. Update the source pin or artifact in a dedicated commit.
4. Update the runtime package family in a separate commit when applicable.
5. Run the full compatibility and affected platform matrix.
6. Record changed contracts, migrations, diagnostics, and rollback.
7. Merge product adaptations separately after the new baseline is understood.

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
