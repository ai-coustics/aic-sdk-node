# Publishing

## Setup

Add `NPM_TOKEN` to GitHub Secrets (Settings → Secrets → Actions).

## Publish

```bash
npm run version:update 0.2.0
git add .
git commit -m "chore: bump version to 0.2.0"
git tag 0.2.0
git push origin main --tags
```

GitHub Actions builds and publishes all packages automatically.

## Manual Publish

```bash
# Build all platforms
cargo build --release --target <target>
cp target/<target>/release/<binary> npm/<platform>/index.node

# Publish
for platform in linux-x64-gnu linux-arm64-gnu darwin-x64 darwin-arm64 win32-x64-msvc win32-arm64-msvc; do
  cd npm/$platform && npm publish --access public && cd ../..
done
npm publish --access public
```
