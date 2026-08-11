#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/update-version.sh <version>"
  exit 1
fi

VERSION="$1"

# Update main package. `npm version` fails when the version is already the target one, so
# skip it in that case to keep this script idempotent.
if [ "$(node -p "require('./package.json').version")" != "$VERSION" ]; then
  npm version "$VERSION" --no-git-tag-version
else
  echo "package.json already at version $VERSION"
fi

# Update Cargo.toml
if [ -f "Cargo.toml" ]; then
  sed -i.bak "s/^version = \".*\"/version = \"$VERSION\"/" Cargo.toml
  rm -f Cargo.toml.bak
  echo "Updated Cargo.toml to version $VERSION"
fi

# Update all platform packages
for dir in npm/*/; do
  if [ -f "$dir/package.json" ]; then
    cd "$dir"
    if [ "$(node -p "require('./package.json').version")" != "$VERSION" ]; then
      npm version "$VERSION" --no-git-tag-version
    else
      echo "$dir already at version $VERSION"
    fi
    cd ../..
  fi
done

# Update optionalDependencies versions in root package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.optionalDependencies) {
  for (const dep in pkg.optionalDependencies) {
    pkg.optionalDependencies[dep] = '$VERSION';
  }
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
}
"

# `npm version` above rewrote package-lock.json while optionalDependencies still held the previous
# version, so the lockfile's copy of the root manifest is stale. Rewrite it from the updated
# package.json. The platform packages for this version are not published yet, so resolve nothing.
npm install --package-lock-only --ignore-scripts >/dev/null
echo "Updated package-lock.json to version $VERSION"

echo "Updated to version $VERSION"
echo "Next: git add . && git commit -m 'chore: bump version to $VERSION' && git tag $VERSION && git push origin main --tags"
