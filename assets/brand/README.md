# DSH Work artwork

The product uses the approved jade tile and white cartoon whale concept. App and page icons contain no text or `work` badge. It is not the official DeepSeek whale mark.

- `work-whale.png`: 256px RGBA UI icon with the same framing as the system icon.
- `app-icon.png`: 1024px RGBA icon, resized from generated standalone artwork.
- `app-icon.svg`: SVG container embedding the same PNG; not an independently editable vector tracing.
- `app-icon.icns` / `app-icon.ico`: native platform containers converted from the PNG.
- `packages/work-api/brand-assets.ts`: embeds the exact UI PNG for offline native client slots.

The design reference was `exec-002b8717-daca-4f93-804e-92faecdaf772.png`; the final standalone artwork is `exec-70f019d2-582b-4932-b105-6de61cf785f7.png`, generated with the built-in image-generation tool. The extraction prompt preserves the white whale on a jade rounded square, removes the work badge, and requests a transparent background with generous inset. These identifiers record provenance, not trademark clearance or exclusivity.

Startup attribution: **基于 DeepSeek Harness 构建**. The homepage sidebar pairs the icon with a small **基于** above **DeepSeek Harness**; there is no duplicate footer attribution. The about panel retains **独立社区项目，非 DeepSeek 官方产品**.

On macOS the native window uses a hidden title bar with the native traffic lights. A presentation-only preload marker enables the transparent drag region and platform-specific spacing. The sidebar controls remain native Harness controls and retain their collapsed state. Windows and Linux retain their native title bars. No Harness source or runtime package is modified.
