# Development

Requires a recent Rust toolchain and Node 18+.

```bash
pnpm install
pnpm build            # release build; use build:debug while iterating
pnpm pretest          # download model fixtures into __test__/data
AIC_SDK_LICENSE=<key> pnpm test
```

The native library for the host target is downloaded during `cargo build`, so the first
build needs network access.

To benchmark, point the harness at a model file:

```bash
AIC_SDK_LICENSE=<key> AIC_SDK_MODEL=__test__/data/<model>.aicmodel pnpm bench
```

## Releasing

The npm version tracks the version of the `aic-sdk` Rust crate it wraps. Bump
`package.json`, `Cargo.toml` (both the package version and the `aic-sdk` dependency) and
`Cargo.lock` together, add a `CHANGELOG.md` entry, and merge that to `main`. Then tag the
merge commit:

```bash
git tag x.x.x && git push origin x.x.x
```

Pushing the tag builds all six targets, runs the tests and examples, and publishes to npm.
The tag must match the version in `package.json` or the publish step fails. A tag with a
prerelease suffix, such as `0.24.0-rc.1`, publishes under the `next` dist-tag instead of
`latest`.

The GitHub release is created from the tag with the matching `CHANGELOG.md` section as its
notes, extracted by `scripts/changelog-section.mjs`. A release whose version has no section
there fails rather than publishing empty notes. `napi prepublish` runs with
`--no-gh-release` because it would otherwise create its own release under a `v`-prefixed
tag.

Publishing uses npm trusted publishing over OIDC, so there is no npm token in the
repository. Each of the seven published packages (`@ai-coustics/aic-sdk` and its six
platform packages) needs a trusted publisher on npmjs.com naming this repository and the
workflow file `build.yml`, with direct `npm publish` allowed. A mismatched trusted
publisher can cause authentication errors such as `ENEEDAUTH`.

`check.yml` runs builds, lint, tests, and examples with read-only repository permissions.
It runs on main-branch pushes and pull requests, and is called by `build.yml` for release
tags. Only the publish job in `build.yml` receives `contents: write` for GitHub releases
and `id-token: write` for npm trusted publishing.
