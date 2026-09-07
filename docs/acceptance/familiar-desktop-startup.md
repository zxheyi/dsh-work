# Familiar desktop startup acceptance

Status: implemented and verified

Fact source: [ADR 0016](../decisions/0016-familiar-desktop-startup.md). Delivery issue: [#24](https://github.com/zxheyi/dsh-work/issues/24).

| ID | Observable result | Verification |
| --- | --- | --- |
| S1 | DSH Work always runs its accepted packaged Harness and Node pair, regardless of locally installed commands | Launcher unit test, runtime provenance gate |
| S2 | The first status surface identifies compatible local profiles without revealing machine paths or reading through links | Discovery unit tests, renderer bridge negative checks |
| S3 | Choosing an existing profile preserves its manifest, patch and dependencies byte-for-byte while a product-owned shadow composes the Work layer | Shadow-profile integration test, source-tree digest comparison |
| S4 | The visible status surface precedes any runtime start; an explicit first-run choice is remembered and Ready switches to the authenticated Work surface | Renderer tests, two-launch Electron E2E, screenshots |
| S5 | Healthy startup records a bounded checkpoint; incompatible startup can retry or enter a fresh isolated safe mode without opening shared data | Guardian integration and Electron recovery E2E |
| S6 | Closing during active Agent work hides the window and keeps the Host alive; closing while idle performs the bounded clean shutdown | Lifecycle protocol tests, close-policy tests, conversation Electron E2E |
| S7 | The tray can show the window, stop the runtime, start safe mode, and quit after bounded cleanup | Tray unit tests and Electron E2E |

Security acceptance applies to every item: the status bridge carries only fixed commands, booleans, symbolic labels and bounded profile names; no raw path, settings, credential, session content, patch bytes, arbitrary error, or authenticated URL is exposed.

The selected profile must not be run concurrently in another Harness process. The product explains this before the first shared-data launch; automatic cross-process locking is not claimed.
