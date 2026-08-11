# Version Update and Publishing

```bash
npm run version:update x.x.x
```

Also add a new `## x.x.x - YYYY-MM-DD` section to the top of [CHANGELOG.md](./CHANGELOG.md)
describing the release. Its heading must match the tag being pushed: GitHub Actions extracts
that section and uses it as the GitHub Release body.

After merging the changes to main and creating a tag, GitHub Actions builds and publishes all packages automatically.
