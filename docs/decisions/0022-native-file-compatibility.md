# 0022: Native file workflows and historical output identity

Status: accepted

Date: 2026-09-10

## Context and decision

The requested completion of the four rc.1 upgrade follow-ups extends ADR 0021. Harness owns Session migrations, attachment storage, upload receipts, upload lifecycle, proxy routing and explicit delivery events. DWork owns immutable output versions and their source presentation. No upstream patch or second upload service is introduced.

1. A generated output already recorded for one Session/file/completed turn is not republished when a native migration renumbers events. Existing version IDs, records, blobs and historical `throughSeq` values remain unchanged. Those values are historical coordinates, not indices into a migrated event array. New output queries always use the current Session projection. New turns still create new versions.
2. Both child boundaries forward only the eight uppercase/lowercase HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and NO_PROXY names. Preserve empty values and casing; the native HTTP proxy policy owns precedence, validation and loopback bypass. No proxy values enter product diagnostics or recovery records. Existing Node/PATH/home isolation remains in force.
3. The native composer owns the sole attachment picker, drag/drop, upload progress, send gate, retry and cancellation. Remove the DWork browser copy pipeline and interception. Retain the existing public legacy resource import API for old callers, historical workspace copies and revision snapshots; the current composer does not invoke it. DWork's dock only handles text/revision recovery and references. Native pending file drafts have the upstream lifecycle; DWork does not serialize receipt authority or browser File objects into its text recovery record.
4. Track native `user/message` file references alongside old workspace sources. Resolve host paths and verify bounded streams through `attachments.fileHostPath` and `attachments.readFileStream`; never read an event-supplied absolute path as an attachment. A successful native read-tool result distinguishes read from merely attached sources. Keep each immutable version's source receipt. Current verification has a 25 MiB budget; larger files remain native uploads but are not claimed as verified DWork sources.
5. Consume `deliverables/presented` after a completed turn. Keep legacy successful write/edit inference for old Sessions. Existing workspace boundary, regular-file, stable-byte, snapshot, save and revision checks apply equally to explicit delivery. `present` may follow Bash or code execution, so it supersedes earlier full-write digest predictions for that file. It does not extend DWork output ownership outside the Session workspace. Such native deliveries retain their upstream tool surface.

## Evidence and acceptance

Pinned source: `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`. Public contracts are in `packages/session/session-persistence-jsonl`, `packages/attachment/attachment`, `packages/client/file-upload`, `packages/client/ui-conversation`, `packages/util/http-proxy` and `packages/fs/tool-present`.

- Restore frozen V0 bytes emitted and inspected by the official alpha.2 writer through the installed native persistence service, publish V3, reopen cold, retain old JSONL bytes, message identity and output version IDs despite changed coordinates. Existing output/revision tests preserve later-turn behavior.
- Probe and spawn both process layers with proxy and hostile Node variables; test the actual captured first-layer environment as input to the second.
- Store binary native attachments through the official provider; test source status, corruption, cancellation and immutable source snapshots. Desktop test the single picker, failed upload/retry, cancellation, mixed image/file drop, Session isolation and actual receipt submission without a workspace copy.
- Test explicit delivery without write events, failed presentation, unfinished turns, outside/symlink/missing paths, immutable version reads and selected-version saves. Desktop fixture uses real native present for an existing file and Bash-generated CSV, then exercises preview, versions, revision recovery and narrow layouts.

## Alternatives and rollback

Renumbering DWork journals would mutate historical receipts and require reconstructing a private migration map. A second upload service would duplicate native authority and cancellation. Both are rejected. Removing all legacy output inference would hide existing files, so it remains compatible.

Revert this product slice together with its tests if needed. Original Session generations and output journals remain intact. Reverting the runtime itself still requires the data precautions in ADR 0021; it is not a Session downgrade operation.
