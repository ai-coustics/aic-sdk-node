#!/bin/bash
set -e

platforms=(
  "x86_64-unknown-linux-gnu:linux-x64-gnu"
  "aarch64-unknown-linux-gnu:linux-arm64-gnu"
  "x86_64-apple-darwin:darwin-x64"
  "aarch64-apple-darwin:darwin-arm64"
  "x86_64-pc-windows-msvc:win32-x64-msvc"
  "aarch64-pc-windows-msvc:win32-arm64-msvc"
)

for platform in "${platforms[@]}"; do
  IFS=':' read -r target npm_platform <<< "$platform"
  echo "Building $npm_platform..."

  cargo build --release --target "$target"
  mkdir -p "npm/$npm_platform"

  if [[ "$target" == *"windows"* ]]; then
    cp "target/$target/release/index.node" "npm/$npm_platform/index.node" 2>/dev/null || \
    cp "target/$target/release/aic_sdk.dll" "npm/$npm_platform/index.node" 2>/dev/null || true
  else
    cp "target/$target/release/libaic_sdk.so" "npm/$npm_platform/index.node" 2>/dev/null || \
    cp "target/$target/release/libaic_sdk.dylib" "npm/$npm_platform/index.node" 2>/dev/null || true
  fi
done

echo "Done. Binaries in npm/<platform>/index.node"
