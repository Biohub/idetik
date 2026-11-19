# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the project is pre-1.0, breaking changes bump the minor version.

## [Unreleased]

### Added

- Custom chunk sources are a supported API. `Chunk`, `ChunkData`, `ChunkKey`, `ChunkChangeListener`, `ChunkSource` and `ChunkLoader` are exported, so applications can pass their own source to `ImageLayer`, `LabelLayer` and `VolumeLayer`.
- `Idetik.renderNow()` runs one frame immediately, outside the animation loop, for callers that must show the result of input before the next animation frame.
- `ChunkSource.onChunksChanged` lets a source report chunks whose data changed, or that all of them may have. Chunks that are still needed are loaded again and their textures replaced in place, keeping the old data on screen until the new data arrives. Loads in flight are restarted and chunks that are no longer needed are dropped.

### Changed

- **BREAKING:** `ChunkLoader.loadChunkData(chunk, signal)` returns the chunk's data instead of storing it on the chunk, and must treat the chunk as read-only. Idetik stores the data, so CPU memory statistics now count chunks from every source. Data a loader returns after its request was cancelled is discarded.

## [0.53.0] - 2026-10-29

### Changed

- Package renamed from `@idetik/core` to `idetik`.
- Releases are now cut by pushing a version tag instead of by semantic-release. Prerelease tags such as `v0.53.0-rc.1` publish under the `next` dist-tag and leave `latest` untouched.
- Updated zod to 4.x, vite to 6.4.5, and vitest to 4.1.12.
- Repository moved to the Biohub GitHub organization.

[Unreleased]: https://github.com/Biohub/idetik/compare/v0.53.0...HEAD
[0.53.0]: https://github.com/Biohub/idetik/compare/v0.52.0...v0.53.0
