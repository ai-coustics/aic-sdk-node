#!/bin/bash
# Builds the native module for one target and places it at the given destination.
#
# Usage: scripts/build-target.sh <destination> [cargo-target] [profile]
#
# The release matrix in .github/workflows/build.yml runs this once per target, on that
# target's native runner. `npm run build` and `npm run debug` run it for the host.
set -euo pipefail

destination="${1:?Usage: scripts/build-target.sh <destination> [cargo-target] [profile]}"
target="${2:-$(rustc -vV | sed -n 's/^host: //p')}"
profile="${3:-release}"

profile_flag=()
if [ "$profile" = "release" ]; then
  profile_flag=(--release)
fi

# Let cargo report which file it produced rather than reconstructing the per-platform name
# (libaic_sdk_node.so, libaic_sdk_node.dylib, aic_sdk_node.dll).
messages="$(mktemp)"
trap 'rm -f "$messages"' EXIT

cargo build "${profile_flag[@]}" --locked --target "$target" \
  --message-format=json-render-diagnostics >"$messages"

binary="$(node -e '
const fs = require("fs");
let found;
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
  if (!line) continue;
  const message = JSON.parse(line);
  if (message.reason !== "compiler-artifact") continue;
  if (!message.target.kind.includes("cdylib")) continue;
  found = message.filenames.find((name) => /\.(so|dylib|dll)$/.test(name));
}
if (!found) {
  console.error("No cdylib artifact in cargo output. Is crate-type still cdylib?");
  process.exit(1);
}
process.stdout.write(found);
' "$messages")"

mkdir -p "$(dirname "$destination")"
cp "$binary" "$destination"
echo "Built $target ($profile) -> $destination"
