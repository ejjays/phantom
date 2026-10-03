# License

Phantom uses two licenses depending on what you're using:

| Code | License | File |
| ---- | ------- | ---- |
| Main apps (`web/`, `mobile/`) | Apache-2.0 | [`LICENSE`](../LICENSE) |
| Standalone packages (`@phantom/extractors`, `@phantom/web-mux`) | MIT | [`packages/*/LICENSE`](../packages/extractors/LICENSE) |

In short: use the apps under Apache-2.0 terms; reuse the standalone packages under MIT terms. Each package directory carries its own `LICENSE` file — that file is what applies to that package.

## Third-party media components

- Mobile currently bundles `ffmpeg-kit` (GPL) for muxing. Apache-2.0 covers Phantom's own code, not that dependency — the APK as distributed includes GPL code. It is being replaced with original mux code (`feat/native-media-mux`, work in progress).
- Web never links `ffmpeg`. The browser muxes first (`mediabunny`); the server only shells out to a system `ffmpeg` binary as fallback. The Docker image installs the distro build.
