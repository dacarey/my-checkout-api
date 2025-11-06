# Version Bump Guide

This guide explains how to bump versions in the my-checkout-api project using the standard `npm version` command with automatic OpenAPI schema synchronization.

## Overview

The project uses **npm's native `npm version` command** with a lifecycle hook that automatically syncs the OpenAPI schema version whenever you bump the openapi-spec-workflow package version.

### Independent Version Tracking

**Important:** The OpenAPI schema version can diverge from the package.json versions over time. The sync script intelligently:

- **Detects the bump type** applied to package.json (patch/minor/major)
- **Applies the same bump type** to the OpenAPI schema's current version
- **Maintains independent versioning** between package.json and OpenAPI schema

**Example:**
- package.json: `0.5.0` → `0.5.1` (patch)
- OpenAPI schema: `2.1.5` → `2.1.6` (same patch bump applied)

This allows the OpenAPI specification to version independently while staying synchronized with the type of changes being made.

## Quick Reference

### Bump OpenAPI Spec Workflow + Schema

```bash
# From root directory
npm run version:openapi patch        # 0.5.0 → 0.5.1 (with git commit/tag)
npm run version:openapi minor        # 0.5.0 → 0.6.0 (with git commit/tag)
npm run version:openapi major        # 0.5.0 → 1.0.0 (with git commit/tag)

# Without git commit/tag
npm run version:openapi patch -- --no-git-tag-version
```

### Bump All Workspaces

```bash
# From root directory
npm run version:all patch            # Bumps root + lambda + infra + openapi-spec-workflow
npm run version:all minor
npm run version:all major
```

### Advanced Usage

```bash
# Prerelease versions
npm run version:openapi prerelease -- --preid=beta    # 0.5.0 → 0.5.1-beta.0
npm run version:openapi prepatch -- --preid=rc        # 0.5.0 → 0.5.1-rc.0

# Explicit version
npm run version:openapi 1.2.3 -- --no-git-tag-version

# Allow same version (useful for fixing schema sync issues)
npm run version:openapi patch -- --allow-same-version
```

## How It Works

### The Lifecycle Hook

When you run `npm version` on the openapi-spec-workflow package:

1. **`preversion` script** saves the current package.json version to `.version-old` file
2. **npm updates** `openapi-spec-workflow/package.json` version
3. **`version` lifecycle script** runs (`scripts/sync-openapi-version.js`):
   - Reads old and new package.json versions
   - Detects bump type (patch/minor/major)
   - Reads current OpenAPI schema version
   - Applies same bump type to schema version (independently)
   - Updates OpenAPI schema in `openapi/checkout-openapi-unresolved.yaml`
   - Validates the schema to ensure it's still valid
   - Stages the schema file with git
4. **npm creates** git commit and tag (unless `--no-git-tag-version`)
5. **`postversion` script** cleans up the `.version-old` file

### Independent Version Bumping

The script maintains independent versions by applying the same **bump type** rather than syncing to the same **absolute version**:

| Scenario | package.json | OpenAPI Schema | Bump Type | Result |
|----------|--------------|----------------|-----------|---------|
| Initial state | 0.5.0 | 2.1.5 | - | - |
| Run `patch` | 0.5.0 → 0.5.1 | 2.1.5 → 2.1.6 | patch | Both patched |
| Run `minor` | 0.5.1 → 0.6.0 | 2.1.6 → 2.2.0 | minor | Both minor |
| Run `major` | 0.6.0 → 1.0.0 | 2.2.0 → 3.0.0 | major | Both major |

This allows the OpenAPI specification to maintain its own version lineage while staying aligned with the nature of changes.

### What Gets Updated

When bumping openapi-spec-workflow version:
- ✅ `openapi-spec-workflow/package.json` → version field (bumped by npm)
- ✅ `openapi/checkout-openapi-unresolved.yaml` → info.version field (same bump type applied to current version)
- ✅ Git commit created (unless `--no-git-tag-version`)
- ✅ Git tag created (unless `--no-git-tag-version`)

When bumping all workspaces:
- ✅ Root `package.json` → version field
- ✅ `lambda/package.json` → version field
- ✅ `infra/package.json` → version field
- ✅ `openapi-spec-workflow/package.json` → version field
- ✅ `openapi/checkout-openapi-unresolved.yaml` → info.version field (bumped independently)
- ✅ Git commit created (unless `--no-git-tag-version`)
- ✅ Git tag created (unless `--no-git-tag-version`)

**Note:** The OpenAPI schema version is bumped using the same bump type (patch/minor/major) but from its own current version, allowing it to maintain an independent version number.

## Common Workflows

### Development Workflow (No Git Operations)

When you're iterating and don't want git commits/tags:

```bash
npm run version:openapi patch -- --no-git-tag-version
```

Then manually commit when ready:
```bash
git add .
git commit -m "chore: bump version to 0.5.1"
```

### Release Workflow (With Git Operations)

For official releases:

```bash
# Ensure you're on a feature branch
git checkout -b feature/CHECK-XXX-version-bump-0.5.1

# Bump version (creates commit + tag)
npm run version:openapi patch

# Push with tags
git push origin feature/CHECK-XXX-version-bump-0.5.1 --follow-tags

# Create PR to merge into main
```

### Prerelease Workflow

For alpha/beta/rc releases:

```bash
# Create first prerelease
npm run version:openapi prerelease -- --preid=beta
# 0.5.0 → 0.5.1-beta.0

# Increment prerelease
npm run version:openapi prerelease -- --preid=beta
# 0.5.1-beta.0 → 0.5.1-beta.1

# Graduate to release
npm run version:openapi patch
# 0.5.1-beta.1 → 0.5.1
```

### Syncing All Package Versions

To keep all package.json files in sync:

```bash
npm run version:all patch
```

This updates:
- Root package.json: 0.5.0 → 0.5.1
- lambda/package.json: 0.5.0 → 0.5.1
- infra/package.json: 0.5.0 → 0.5.1
- openapi-spec-workflow/package.json: 0.5.0 → 0.5.1
- openapi/checkout-openapi-unresolved.yaml: Bumps from its current version (e.g., 2.1.5 → 2.1.6)

### Version Divergence Example

The OpenAPI schema can maintain its own version lineage:

```bash
# Initial state:
# package.json: 0.5.0
# OpenAPI schema: 2.1.5

npm run version:openapi patch
# package.json: 0.5.0 → 0.5.1
# OpenAPI schema: 2.1.5 → 2.1.6 (same bump type applied)

npm run version:openapi minor
# package.json: 0.5.1 → 0.6.0
# OpenAPI schema: 2.1.6 → 2.2.0 (same bump type applied)

# Versions remain independent but bump types stay synchronized
```

## Supported npm version Commands

All standard npm version bump types are supported:

| Command | Example | Description |
|---------|---------|-------------|
| `patch` | 0.5.0 → 0.5.1 | Bug fixes |
| `minor` | 0.5.0 → 0.6.0 | New features (backwards compatible) |
| `major` | 0.5.0 → 1.0.0 | Breaking changes |
| `prepatch` | 0.5.0 → 0.5.1-0 | Prerelease patch |
| `preminor` | 0.5.0 → 0.6.0-0 | Prerelease minor |
| `premajor` | 0.5.0 → 1.0.0-0 | Prerelease major |
| `prerelease` | 0.5.1-0 → 0.5.1-1 | Increment prerelease |
| `<version>` | 1.2.3 | Explicit version |
| `from-git` | (from tag) | Use version from git tag |

## Supported Flags

All standard npm version flags are supported:

| Flag | Description | Example |
|------|-------------|---------|
| `--no-git-tag-version` | Skip git commit/tag | `npm run version:openapi patch -- --no-git-tag-version` |
| `--allow-same-version` | Allow setting same version | `npm run version:openapi patch -- --allow-same-version` |
| `--preid=<id>` | Prerelease identifier | `npm run version:openapi prerelease -- --preid=beta` |
| `--no-commit-hooks` | Skip git hooks | `npm run version:openapi patch -- --no-commit-hooks` |
| `--sign-git-tag` | GPG sign tags | `npm run version:openapi patch -- --sign-git-tag` |
| `--json` | JSON output | `npm run version:openapi patch -- --json` |

## Independent Versioning Strategy

### Why Allow Version Divergence?

The OpenAPI specification version can (and often should) diverge from the package.json version because:

1. **Different Release Cycles** - API specifications may version independently from implementation
2. **Semantic Meaning** - Breaking changes in the API (major version) might not coincide with code changes
3. **API Stability** - The API contract can stabilize (reach v1.0, v2.0) while implementation continues to evolve
4. **Consumer Expectations** - API consumers track the spec version, not the package version

### How It Works

The sync script uses **bump type synchronization** instead of **version synchronization**:

- ✅ When you bump package.json by `patch` → OpenAPI schema bumps by `patch` from its current version
- ✅ When you bump package.json by `minor` → OpenAPI schema bumps by `minor` from its current version
- ✅ When you bump package.json by `major` → OpenAPI schema bumps by `major` from its current version

This ensures both versions evolve together in **type** while maintaining independent **values**.

### Example Scenario

```bash
# API reaches stable v1.0.0 while code is still v0.5.0
# Manually edit OpenAPI schema to 1.0.0

# Later, bug fix in implementation:
npm run version:openapi patch
# Result:
#   package.json: 0.5.0 → 0.5.1 (implementation patch)
#   OpenAPI: 1.0.0 → 1.0.1 (API patch)

# New API feature requiring major version:
npm run version:openapi major
# Result:
#   package.json: 0.5.1 → 1.0.0 (implementation reaches v1)
#   OpenAPI: 1.0.1 → 2.0.0 (API breaking change)
```

### When Versions Align

If you want versions to match exactly, you can:

1. Use explicit version numbers:
   ```bash
   npm run version:openapi 1.0.0 -- --no-git-tag-version
   # Both package.json and OpenAPI schema will be set to 1.0.0
   ```

2. Manually edit the OpenAPI schema to match package.json before bumping

3. Start with aligned versions and use bump types consistently

## Troubleshooting

### Schema Validation Fails

If the schema validation fails during version bump:

```bash
# The version bump is aborted to prevent invalid schema
# Fix the schema issues first:
cd openapi-spec-workflow
npm run validate

# Then retry the version bump
npm run version:openapi patch
```

### Version Out of Sync

If you need to manually align or fix version synchronization:

```bash
# Check current versions
echo "Package:" && grep '"version"' openapi-spec-workflow/package.json | head -1
echo "Schema:" && grep "^  version:" openapi/checkout-openapi-unresolved.yaml

# To force OpenAPI schema to match package.json version exactly:
# Manually edit openapi/checkout-openapi-unresolved.yaml
# Then validate:
cd openapi-spec-workflow
npm run validate

# Or use allow-same-version to re-trigger the bump
npm run version:openapi patch -- --allow-same-version --no-git-tag-version
```

**Note:** Under normal operation, versions are intentionally allowed to diverge. The sync script ensures they bump together by type (patch/minor/major), not by absolute version number.

### Git Commit Message Customization

By default, npm creates commit messages like `v0.5.1`. To customize:

```bash
# Use --no-git-tag-version and commit manually
npm run version:openapi patch -- --no-git-tag-version
git add .
git commit -m "chore(version): bump to 0.5.1 with schema updates"
```

Or configure git commit message template in `.npmrc` or `package.json`.

## Migration from Old version:bump Script

### Old Way (Deprecated)
```bash
npm run version:bump patch --workspace=openapi-spec-workflow
```

### New Way (Recommended)
```bash
npm run version:openapi patch
```

The old `version:bump` script is kept for backwards compatibility but should be considered deprecated.

## Standalone Script Usage

You can also run the sync script directly for manual version management:

### Report Current Versions

```bash
node openapi-spec-workflow/scripts/sync-openapi-version.js
```

This displays the current versions **without making any changes**. Safe to run anytime to check version status:

```
📦 Package version: 0.5.0
📄 OpenAPI schema version: 0.4.0

ℹ️  Running in report mode (no changes made)
   To update schema version, provide explicit version:
   node scripts/sync-openapi-version.js <version>

⚠️  Versions are different:
   Package: 0.5.0
   Schema:  0.4.0
   This is OK - versions can diverge independently
```

### Set Explicit Version

```bash
node openapi-spec-workflow/scripts/sync-openapi-version.js 1.2.3
```

This sets the OpenAPI schema to an explicit version, regardless of the package.json version. Useful for:
- Manual version corrections
- Setting initial versions
- Quick version adjustments without bumping package.json

**Note:** When run standalone, the script:
- ✅ **Report mode (no args)**: Shows versions, makes NO changes
- ✅ **Explicit version**: Updates schema, validates, and stages for git
- ✅ Handles same-version gracefully (no-op)
- ❌ Does NOT create git commits/tags (run manually or use `npm run version:openapi`)

## Benefits of New Approach

✅ **Standard npm commands** - Uses native `npm version` behavior  
✅ **All flags supported** - Inherits all npm version flags automatically  
✅ **Git integration** - Commits and tags work by default  
✅ **Workspace support** - Can bump individual or all workspaces  
✅ **Prerelease support** - Full support for alpha/beta/rc versions  
✅ **Independent versioning** - OpenAPI schema can maintain its own version lineage  
✅ **Bump type synchronization** - Same bump type applied to both versions  
✅ **Simpler code** - Lifecycle hook is much simpler than custom wrapper  
✅ **Better validation** - Schema validated before commit  
✅ **Maintainable** - Uses npm's standard lifecycle, not custom logic

## References

- [npm version documentation](https://docs.npmjs.com/cli/v10/commands/npm-version)
- [npm workspaces documentation](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
- [Semantic Versioning](https://semver.org/)
