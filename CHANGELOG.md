# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the project is pre-1.0, breaking changes bump the minor version.

## [Unreleased]

## [0.54.0] - 2026-11-10

### Added

- `autoDraw` option (default `true`). When `false`, the frame loop keeps running but draws only on `requestRender()`.
- `isSettled` getter and `settled()` promise, which report when no layers are loading, no chunks are queued, in flight or awaiting upload, and no camera controls are moving.
- `captureFrameBlob({ type, quality })`, which draws and encodes the canvas in the same frame and resolves with a `Blob`.
- `QueueStats.awaitingUpload`.

### Changed

- `maxGpuUploadsPerUpdate` is now a total across all sources rather than per source, and chunks are uploaded in priority order across sources.
- Chunks larger than the memory limit are never requested; the chunk manager warns once when this happens.
- Resizing no longer draws synchronously from the resize observer. The new size is applied on the next frame, so there are still no blank frames.
- `stop()` followed by `start()` now works.

## [0.53.0] - 2026-10-29

### Changed

- Package renamed from `@idetik/core` to `idetik`.
- Releases are now cut by pushing a version tag instead of by semantic-release. Prerelease tags such as `v0.53.0-rc.1` publish under the `next` dist-tag and leave `latest` untouched.
- Updated zod to 4.x, vite to 6.4.5, and vitest to 4.1.12.
- Repository moved to the Biohub GitHub organization.

[Unreleased]: https://github.com/Biohub/idetik/compare/v0.54.0...HEAD
[0.54.0]: https://github.com/Biohub/idetik/compare/v0.53.0...v0.54.0
[0.53.0]: https://github.com/Biohub/idetik/compare/v0.52.0...v0.53.0
