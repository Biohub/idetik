# Contributing to idetik

Thank you for your interest in contributing to idetik. This project is under active development. We welcome bug reports and new ideas but are not prepared to review or accept major contributions at this time.

## Releasing

Releases are cut from `main` by pushing a version tag. The `Release` workflow checks that the tag matches the version in `package.json`, runs the full lint/test/build, publishes to npm via trusted publishing, and creates a GitHub release with auto-generated notes from the merged PR titles.

While Idetik is pre-1.0, breaking changes bump the minor version and everything else bumps the patch version.

```bash
git checkout main && git pull
npm version minor   # or patch; this commits and tags vX.Y.Z
git push --follow-tags
```
