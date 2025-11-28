#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/update-version.sh <version>"
  exit 1
fi

VERSION="$1"

# Update main package
npm version "$VERSION" --no-git-tag-version

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
    npm version "$VERSION" --no-git-tag-version
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

echo "Updated to version $VERSION"
echo "Next: git add . && git commit -m 'chore: bump version to $VERSION' && git tag $VERSION && git push origin main --tags"
