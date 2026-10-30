# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the project is pre-1.0, breaking changes bump the minor version.

## [Unreleased]

## [0.53.0] - 2026-10-29

### Changed

- Package renamed from `@idetik/core` to `idetik`.
- Releases are now cut by pushing a version tag instead of by semantic-release. Prerelease tags such as `v0.53.0-rc.1` publish under the `next` dist-tag and leave `latest` untouched.
- Updated zod to 4.x, vite to 6.4.5, and vitest to 4.1.12.
- Repository moved to the Biohub GitHub organization.

[Unreleased]: https://github.com/Biohub/idetik/compare/v0.53.0...HEAD
[0.53.0]: https://github.com/Biohub/idetik/compare/v0.52.0...v0.53.0
