# Official alpha.2 writer fixture

`session.jsonl` is emitted by the public `Session.create/append` and JSONL `create/append` APIs from official `0.1.2-alpha.2` packages. `events.json` is the same writer's public `inspect` result used to create the pre-upgrade DWork version. Content is synthetic; no user Session or credentials are included. Clock and message IDs are deterministic.

Regeneration requires an isolated temporary directory. Copy `writer-packages.json` there as `package.json`, install with `pnpm install --ignore-scripts`, then run `node tests/fixtures/alpha2-output/generate.mjs <absolute-temporary-directory>`. All DSH package overrides must stay alpha.2. Never install these packages in the product workspace. The ordinary regression consumes the frozen bytes and only the product's pinned rc.1 runtime; it needs no network or old installed runtime.

The regression restores and publishes these bytes through rc.1's native JSONL service, checks the original file is untouched, reopens V3 and tests stable DWork output history. Upstream source for the old writer: `0a53fb55bea101816fa226bb964ae2bed71c343b`.
