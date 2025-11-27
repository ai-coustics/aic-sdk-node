#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/update-version.sh <version>"
  exit 1
fi

VERSION="$1"

# Update main package
npm version "$VERSION" --no-git-tag-version

# Update all platform packages
for dir in npm/*/; do
  if [ -f "$dir/package.json" ]; then
    cd "$dir"
    npm version "$VERSION" --no-git-tag-version
    cd ../..
  fi
done

echo "Updated to version $VERSION"
echo "Next: git add . && git commit -m 'chore: bump version to $VERSION' && git tag $VERSION && git push origin main --tags"
