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
git tag vx.x.x && git push origin vx.x.x
```

The `v` prefix is required: `napi prepublish` names the GitHub release `v<version>`, so a
bare tag makes it create a second one alongside yours.

Pushing the tag builds all six targets, runs the tests and examples, and publishes to npm.
The tag must match the version in `package.json` or the publish step fails. A tag with a
prerelease suffix, such as `v0.24.0-rc.1`, publishes under the `next` dist-tag instead of
`latest`.

The GitHub release notes are the matching `CHANGELOG.md` section, extracted by
`scripts/changelog-section.mjs`. A release whose version has no section there fails rather
than publishing empty notes.
