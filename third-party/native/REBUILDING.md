# Native library sources and replacement

This directory accompanies DSH Work's unchanged sharp/libvips binaries. DSH Work is MIT; these libraries retain their own licenses. `native-attributions.txt`, `GPL-3.0.txt`, `LGPL-3.0.txt` and `MPL-2.0.txt` contain notices and license texts. The upstream sharp-libvips distribution elects LGPLv3 under the libraries' "or later" clauses. Users may modify the libraries and reverse-engineer the combined work to debug those modifications; DSH Work adds no restriction on these activities.

## Contents and provenance

`materials.json` binds the actual native package version, component versions and library SHA-256 values to the supplied source archives, upstream build recipes, patches, Rust crate sources and this guide. All referenced materials for the installed platform are included here, not merely linked to an external download. Source archives retain their original copyright notices and license files, including notices embedded in source files. The extracted attribution collection is supplementary and does not replace those source notices.

- macOS arm64: sharp-libvips 1.3.3 build commit `6e5971d333377743163edc3ad9e5d0b897abcbc9`, libvips 8.18.6, AOM 3.15.0.
- Windows x64: sharp 0.35.4, build-win64-mxe v8.18.6 commit `09cfccf20b91b441fbe97fa7a7ed8a597e55e830`, AOM 3.14.1. The MXE source snapshot used by that build branch is supplied separately. The Windows vips source bundle and POSIX bundle share most component versions but differ in patches/build configuration.
- `rsvg.tar.xz` includes Cargo.lock. The supplied `.crate` archives are the complete registry dependency set in that lock, including build/test/platform dependencies as a deliberate source superset; each checksum matches Cargo.lock. This is not a claim that every crate is linked into every platform binary.
- `rust-src-macos.tar.xz` is the 2026-08-26 standard-library source (the macOS binary embeds rustc commit `787af2b8c80638c51a4fc8e44f84e6891f243ec7`); the Windows MXE recipe selects the 2026-06-05 source in `rust-src-windows.tar.xz`. Their original COPYRIGHT and license files are retained. MinGW 14.0.0 and LLVM 22.1.7 runtime notices accompany the Windows source recipes.
- `sharp-source.tgz` contains the matching sharp wrapper/addon source. The `.node` addon dynamically loads libvips. Libraries combined inside the libvips DLL/dylib are rebuilt together from the supplied sources.

## Build the libraries

Use a separate build directory. Unpack `sharp-libvips-build.tar.gz` for the macOS recipes or `windows-build.tar.gz` plus `windows-mxe.tar.gz` for Windows. All upstream modifications (including inline sed changes) are in those recipes; the four POSIX patch downloads are supplied as `.patch` files with their original URL and digest in the manifest. DSH Work applies no extra native source patches.

On macOS, the upstream entry point is `./build.sh darwin-arm64v8`; install the Xcode command-line tools and the tools listed by the supplied GitHub workflow (Homebrew build tools and Rust). The script compiles and combines its static dependencies into a replaceable libvips shared library. Use the source archives supplied here for the URLs in `build/posix.sh`, including the exact supplied patch files. The source lock records each URL-to-file mapping. Do not silently substitute a newer dependency or a different libimagequant repository.

On Windows, run the supplied build-win64-mxe `./build.sh --without-prebuilt -t x86_64-w64-mingw32.static vips-web` on a Linux host with Docker or Podman. Its container/base.Dockerfile identifies the toolchain; use the supplied MXE snapshot instead of resolving the mutable branch again. The source archive includes all build/plugins recipes and patches. Use `windows-aom.tar.gz` for AOM 3.14.1. After building, `sharp-libvips`'s supplied `build/win.sh` documents the packaging step; use your rebuilt vips zip instead of downloading the upstream binary. Sharp's own matching source contains its C++ wrapper and addon build instructions.

For Rust, unpack each `.crate` into a vendor directory and use Cargo's directory-source configuration and checksums from Cargo.lock. `materialize-rust.py` performs this step without downloading or executing source code. Point the librsvg workspace at that directory after applying the upstream Cargo.toml feature edits. The upstream `cargo update --workspace` step changes workspace resolution, not the archived source code. Compilers, SDKs and build utilities are external prerequisites; this source delivery does not claim a fully offline toolchain image or byte-for-byte reproducible compiler output.

## Replace the shared libraries

1. Quit DSH Work and its runtime. Work on a copy of the unsigned application so you can restore the original.
2. Locate `Contents/Resources/app/node_modules/@img/` inside the macOS app, or `resources/app/node_modules/@img/` inside the Windows folder.
3. On macOS replace `sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.6.dylib` with an ABI-compatible modified build. Preserve the expected filename and dependency install names. For a local modified copy, apply an ad-hoc signature with `codesign --force --sign - <library>` if needed; modifying a signed distribution invalidates its original signature.
4. On Windows replace the libvips DLLs in `sharp-win32-x64/lib/` with matching ABI-compatible builds. Preserve DLL names/imports. Rebuild the C++ wrapper from the supplied sharp/libvips sources when changing that ABI.
5. Relaunch the copied application. No DSH Work license key, signing key or library hash allowlist is required to load a replacement. If you intentionally change the ABI, rebuild the matching sharp addon from `sharp-source.tgz` first.

The repository's native replacement smoke test loads the addon with byte-modified ABI-equivalent libraries in a temporary copy. It checks that the loader accepts replacement bytes; it is not a claim that an arbitrary modification will preserve the ABI, nor a complete native rebuild test. Keep all supplied notices and source materials with any public application download.
