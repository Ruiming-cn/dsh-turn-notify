# Releasing

## Prerequisites

- `gh` CLI authenticated with repository write access.
- Node.js ≥ 22 (tests run with `--experimental-strip-types`).

## Steps

```bash
# 1. Build and verify
npm ci
npm run check

# 2. Create the prebuilt tarball (its name carries the version)
npm pack

# 3. Tag and create the GitHub release with the tarball asset
gh release create v1.0.0 \
  --repo Ruiming-cn/dsh-turn-notify \
  --title "dsh-turn-notify v1.0.0" \
  --notes "See CHANGELOG.md" \
  ./dsh-turn-notify-1.0.0.tgz

# 4. Verify the asset and the repository metadata
gh release view v1.0.0 --repo Ruiming-cn/dsh-turn-notify --json assets
gh repo view Ruiming-cn/dsh-turn-notify --json description,repositoryTopics
```

## Keep in sync before every cut

- `package.json` description, keywords, repository/homepage/bugs fields.
- `README.md` and `README.zh.md`.
- `CHANGELOG.md`, plus `locale/en.json` and `locale/zh.json` (the Plugin Manager
  copy).
- The release tarball is what storefronts offer, so re-check its download URL
  after every cut.

## Versioning

The package version, the tag and the tarball filename move together. The plugin
declares `dsh.bundle`, so it installs from the tarball, from a checkout, or from
npm; the release tarball is the path the curated list points at.
