# Contributing to idetik

Thank you for your interest in contributing to idetik. This project is under active development. We welcome bug reports and new ideas but are not prepared to review or accept major contributions at this time.

## Releasing

Releases are cut from `main` by pushing a version tag. The `Release` workflow checks that the tag matches the version in `package.json`, runs the full lint/test/build, publishes to npm via trusted publishing, and creates a GitHub release with auto-generated notes from the merged PR titles.

To rehearse a release without publishing, run the `Release` workflow manually from the Actions tab on any branch. Manual runs do everything except publish, ending in an `npm publish --dry-run`. Checking `publish_prerelease` instead publishes a real prerelease of the next patch version, such as `0.52.1-next.abc1234`, under the `next` dist-tag so it can be installed with `npm install @idetik/core@next`. Published versions are permanent, so use this only when you need a build to test.

While Idetik is pre-1.0, breaking changes bump the minor version and everything else bumps the patch version.

```bash
git checkout main && git pull
npm version minor   # or patch; this commits and tags vX.Y.Z
git push --follow-tags
```
