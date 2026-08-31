# Official runtime upgrade compatibility probe

Status: candidate research evidence — not the DSH Work product implementation.

Adoption update (2026-08-31): [ADR 0003](../../docs/decisions/0003-dsh-alpha2-runtime-upgrade.md) is now accepted using [native CI 33391284357](https://github.com/zxheyi/dsh-work/actions/runs/33391284357) at `77a7aa3` (macOS arm64 and Windows x64, each 6/6). Candidate labels and original input files below are preserved to reproduce that evidence; they do not override the active product baseline. The original local-only status below is historical.

This probe tests `@deepseek-ai/dsh@0.1.2-alpha.2` through the official CLI, using an external Bundle and isolated Harness homes. The old desktop-host prototypes and accepted rc.2 baseline remain untouched. [ADR 0003](../../docs/decisions/0003-dsh-alpha2-runtime-upgrade.md) must be accepted before this candidate becomes the product baseline. Keep this research fixture on the research branch; it is not a product plugin to copy unreviewed into main.

## Run from the repository root

Prerequisites: Git, system `tar` (including zip support on Windows), Node, pnpm `10.34.4`, and network access during materialization. No Rust/Tauri or global dsh is used. Download/installation is a controlled test setup step, never ordinary runtime startup.

```sh
pnpm install --dir prototypes/m0-runtime-upgrade --frozen-lockfile --ignore-scripts
node --test scripts/*.test.mjs
node scripts/verify-contract.mjs
node prototypes/m0-runtime-upgrade/prepare.mjs
node prototypes/m0-runtime-upgrade/verify.mjs
```

`prepare.mjs` downloads hash-pinned official Node/npm artifacts to a newly created temporary directory, extracts Node, and clones the exact official release tag there. It writes an ignored `artifacts/context.json` describing those paths. `verify.mjs` may instead receive a previously materialized context file as its only argument. It validates artifacts before executing the downloaded Node binary.

`verify.mjs` writes ignored `artifacts/result.json` and `artifacts/lifecycle.tap`. The report records the Git revision, test-input SHA-256 hashes, platform, source/runtime identity, and before/after checks. A report's input hashes must match the reviewed files; a pre-commit report is not evidence for an unrelated later revision.

The native [CI workflow](../../.github/workflows/m0-runtime-upgrade.yml) runs on macOS and Windows. Its upload contains only the result and sanitized TAP, not the temporary home, raw Harness output, auth values, or local path context. Configuration is not proof that a remote job ran.

## Tested public boundaries

1. One custom Profile loads one external Bundle through `dsh --profile` and receives launcher-owned Ready.
2. stdin EOF requests official exit, the fixture disposer runs, and the child exits zero without host kill.
3. Deliberate delayed plugin rejection wins over an early EOF; both the loaded and rejected markers are required, preventing unrelated bootstrap failures from satisfying the test.
4. The real base/web Profile binds loopback/port zero: unauthenticated root is 401; token exchange is 303; a signed cookie obtains HTTP 200 HTML. Sensitive values stay inside the child.
5. Turning official `printUrl` back on causes the smoke to reject a real token leak; split-chunk detection also has a unit regression. Arbitrary Harness stdout/stderr are never forwarded.
6. A valid early EOF disposes the minimal Bundle; the same isolated home restarts after rejected startup and across three normal cycles.

The fixture owns an otherwise unused stdin pipe and calls `resume()`. The official EOF helper deliberately does not consume input. The fixture cannot be combined unchanged with a second stdin protocol owner. Its async web check is aborted on disposal, and cannot announce Ready afterward.

## Evidence at 2026-08-31

Native macOS arm64: `RUNTIME_PASS` for the checks above on officially hash-verified Node `24.11.1`. The official root npm archive's 10 files match the installed package, and the candidate installation contains 215 distinct DSH-family packages at `0.1.2-alpha.2`. The exact dependency closure is frozen by pnpm. Source remote/tag/revision and clean tree checks pass before and after execution. Per-file input hashes and actual TAP counts are in the generated report.

Windows native: `NOT_RUN` locally; the workflow is prepared, but a push and successful remote run are still required. Electron/browser interaction E2E and product packaging: `NOT_RUN` and not implemented by this probe.

The first failing checks and subsequent fixes were exercised locally: missing Bundle fixture; deliberate rejection not implemented; missing authenticated-web assertion; incorrect 302 expectation corrected to official 303; absent source/runtime verifier exports; missing rejection-path marker; missing sensitive-output guard. These are test development records, not claims of upstream defects.

## Safety, limitations, and cleanup

- Every test uses a newly created temporary home and an environment allowlist; it does not use provider credentials or existing user state. `DSH_TELEMETRY_DISABLED=1` opts out of launcher telemetry. No model task is submitted.
- stdin EOF, a fixture-disposal marker, and exit zero prove this test sequence only. Full Harness descendant/resource cleanup, port release after exit, host crashes, and corrupt-state recovery remain unverified.
- Each child has a 15-second failure cleanup deadline. Any host force-kill makes a normal-path assertion fail. This direct-child fallback is not a product process-tree cleanup design.
- The provenance gate checks the root release bytes and DSH-family versions, not every transitive installed file or license. Artifact hashes are sourced from the official npm metadata and [Node checksum list](https://nodejs.org/dist/v24.11.1/SHASUMS256.txt), not a claim of independent signing verification.
- pnpm reports a React DOM 19 / React 18 peer mismatch. Do not infer a functional renderer from HTML delivery or add silent overrides; actual UI compatibility is an open gate.
- No user-home migration or downgrade compatibility was tested. Preserve the old runtime and keep test homes separate.
- Test-owned homes are removed after their child exits. Downloaded artifacts and the read-only source clone remain in the specifically generated temporary directory for evidence reuse; they may be removed by their exact recorded path after review. Do not delete a broad temp/workspace directory.

See [upstream research](../../docs/research/dsh-alpha2-upgrade.md) for version-specific public contracts and [M0 acceptance](../../docs/acceptance/m0.md) for the remaining product gates.
