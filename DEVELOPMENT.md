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
