#!/usr/bin/env node

/**
 * OpenAPI Version Sync Hook
 *
 * This script runs automatically during `npm version` via the "version" lifecycle.
 * It syncs the OpenAPI schema version to match the package.json version that npm
 * just updated.
 *
 * LIFECYCLE INTEGRATION:
 * When you run `npm version patch`, npm automatically:
 * 1. Updates package.json version
 * 2. Runs this script (via "version" lifecycle hook)
 * 3. Stages the changes
 * 4. Creates git commit and tag (unless --no-git-tag-version)
 *
 * USAGE:
 * - Automatically called by npm during `npm version <bump-type>`
 * - Can also be run standalone: node scripts/sync-openapi-version.js [version]
 *
 * STANDALONE USAGE:
 *   node scripts/sync-openapi-version.js         # Report current versions (no changes)
 *   node scripts/sync-openapi-version.js 1.2.3   # Set explicit version
 *
 * SUPPORTED NPM VERSION COMMANDS:
 * - npm version patch|minor|major
 * - npm version premajor|preminor|prepatch|prerelease [--preid=<id>]
 * - npm version <explicit-version> (e.g., 1.2.3)
 * - npm version from-git
 *
 * FLAGS INHERITED FROM NPM VERSION:
 * - --no-git-tag-version: Skip git commit/tag
 * - --allow-same-version: Allow setting to current version
 * - --preid: Set prerelease identifier (alpha, beta, rc, etc.)
 * - --no-commit-hooks: Skip git commit hooks
 * - --sign-git-tag: GPG sign the git tag
 * - --workspace: Bump specific workspace
 * - --workspaces: Bump all workspaces
 *
 * @author DW Digital Commerce Team
 * @since 2025
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Configuration
 */
const CONFIG = {
  packageJsonPath: path.join(__dirname, "..", "package.json"),
  schemaFilePath: path.join(__dirname, "..", "..", "openapi/checkout-openapi-unresolved.yaml"),
};

/**
 * Colors for console output
 */
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
};

/**
 * Log with colors
 */
function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Get version from package.json or command line
 */
function getTargetVersion() {
  // If version provided as argument, use it
  if (process.argv[2]) {
    return process.argv[2];
  }

  // Otherwise, read from package.json (already updated by npm version)
  const packageJson = JSON.parse(fs.readFileSync(CONFIG.packageJsonPath, "utf8"));
  return packageJson.version;
}

/**
 * Get current version from OpenAPI schema
 */
function getCurrentSchemaVersion() {
  if (!fs.existsSync(CONFIG.schemaFilePath)) {
    return null;
  }

  const content = fs.readFileSync(CONFIG.schemaFilePath, "utf8");
  const versionRegex = /^(\s*version:\s*)([0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?)/m;
  const match = content.match(versionRegex);
  
  return match ? match[2] : null;
}

/**
 * Calculate what bump type was applied by comparing old and new package.json versions
 */
function detectBumpType(oldVersion, newVersion) {
  const parseVersion = (v) => {
    const match = v.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)(-[a-zA-Z0-9.]+)?$/);
    if (!match) return null;
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
      prerelease: match[4] || null
    };
  };

  const oldV = parseVersion(oldVersion);
  const newV = parseVersion(newVersion);

  if (!oldV || !newV) return null;

  // Detect bump type
  if (newV.major > oldV.major) return 'major';
  if (newV.minor > oldV.minor) return 'minor';
  if (newV.patch > oldV.patch) return 'patch';
  if (newV.prerelease && !oldV.prerelease) return 'prerelease';
  if (newV.prerelease && oldV.prerelease) return 'prerelease';
  
  return null; // Same version or explicit version set
}

/**
 * Apply bump type to a version
 */
function applyBump(version, bumpType) {
  const parseVersion = (v) => {
    const match = v.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)(-[a-zA-Z0-9.]+)?$/);
    if (!match) return null;
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
      prerelease: match[4] || null
    };
  };

  const v = parseVersion(version);
  if (!v) return version;

  switch (bumpType) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    case 'prerelease':
      // Simplified prerelease handling
      if (v.prerelease) {
        const prereleaseMatch = v.prerelease.match(/-([a-zA-Z]+)\.([0-9]+)$/);
        if (prereleaseMatch) {
          const id = prereleaseMatch[1];
          const num = parseInt(prereleaseMatch[2]) + 1;
          return `${v.major}.${v.minor}.${v.patch}-${id}.${num}`;
        }
      }
      return `${v.major}.${v.minor}.${v.patch + 1}-0`;
    default:
      return version;
  }
}

/**
 * Update version in OpenAPI schema YAML file
 */
function updateSchemaVersion(version, currentSchemaVersion = null) {
  if (!fs.existsSync(CONFIG.schemaFilePath)) {
    log(`❌ Schema file not found: ${CONFIG.schemaFilePath}`, "red");
    process.exit(1);
  }

  log(`🔄 Syncing OpenAPI schema to version ${version}...`, "blue");

  const content = fs.readFileSync(CONFIG.schemaFilePath, "utf8");
  
  // Match the version field in the info section of OpenAPI spec
  // Supports both regular versions (1.2.3) and prerelease versions (1.2.3-beta.0)
  const versionRegex = /^(\s*version:\s*)[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?/m;
  const updatedContent = content.replace(versionRegex, `$1${version}`);

  if (content === updatedContent) {
    // Check if it's because the version is already at the target
    if (currentSchemaVersion && currentSchemaVersion === version) {
      log(`ℹ️  Schema already at version ${version} - no update needed`, "blue");
      return false; // Indicate no change was made
    } else {
      log(`⚠️  No version found in schema file to update`, "yellow");
      process.exit(1);
    }
  }

  fs.writeFileSync(CONFIG.schemaFilePath, updatedContent);
  log(`✅ Synced OpenAPI schema to version ${version}`, "green");
  return true; // Indicate a change was made
}

/**
 * Validate schema integrity after version update
 */
function validateSchema() {
  log("🔍 Validating schema integrity...", "blue");
  
  try {
    execSync("npm run validate:schemas", { 
      stdio: "inherit",
      cwd: path.join(__dirname, "..")
    });
    log("✅ Schema validation passed", "green");
    return true;
  } catch (error) {
    log("❌ Schema validation failed!", "red");
    log("   The version bump will be aborted to prevent invalid schema.", "yellow");
    log('   Run "npm run validate" to see detailed validation errors.', "yellow");
    return false;
  }
}

/**
 * Stage the OpenAPI schema file for git commit
 * This ensures the schema changes are included in the version commit
 */
function stageSchemaFile() {
  try {
    // Check if we're in a git repository
    execSync("git rev-parse --git-dir", { stdio: "pipe" });
    
    // Stage the schema file
    execSync(`git add "${CONFIG.schemaFilePath}"`, { stdio: "pipe" });
    log("📦 Staged OpenAPI schema for commit", "blue");
  } catch (error) {
    // Not in a git repo or git not available - this is fine
    log("ℹ️  Git not available or not in a repository - schema changes won't be committed", "blue");
  }
}

/**
 * Main function
 */
function main() {
  log("", "reset");
  log("🔗 OpenAPI Version Sync", "blue");
  log("=======================", "blue");

  // Check if an explicit version was passed as command line argument
  const explicitVersion = process.argv[2];
  
  // Get the new package.json version (after npm updated it)
  const newPackageVersion = getTargetVersion();
  
  // Get the current OpenAPI schema version (before we update it)
  const currentSchemaVersion = getCurrentSchemaVersion();
  
  // Get old package version from .version-old file (created by preversion script)
  let oldPackageVersion = null;
  const versionOldPath = path.join(__dirname, "..", ".version-old");
  if (fs.existsSync(versionOldPath)) {
    oldPackageVersion = fs.readFileSync(versionOldPath, "utf8").trim();
  }

  // Check if this is standalone execution (no .version-old file and no explicit version)
  const isStandaloneReport = !oldPackageVersion && !explicitVersion;

  if (isStandaloneReport) {
    // Standalone execution without arguments - just report current versions
    log(`📦 Package version: ${newPackageVersion}`, "blue");
    log(`📄 OpenAPI schema version: ${currentSchemaVersion || 'not found'}`, "blue");
    log("", "reset");
    log(`ℹ️  Running in report mode (no changes made)`, "blue");
    log(`   To update schema version, provide explicit version:`, "reset");
    log(`   node scripts/sync-openapi-version.js <version>`, "yellow");
    log("", "reset");
    
    if (currentSchemaVersion && currentSchemaVersion !== newPackageVersion) {
      log(`⚠️  Versions are different:`, "yellow");
      log(`   Package: ${newPackageVersion}`, "reset");
      log(`   Schema:  ${currentSchemaVersion}`, "reset");
      log(`   This is OK - versions can diverge independently`, "blue");
    } else if (currentSchemaVersion === newPackageVersion) {
      log(`✅ Versions are in sync: ${newPackageVersion}`, "green");
    }
    
    log("", "reset");
    return;
  }

  // Determine target schema version
  let targetSchemaVersion;

  if (explicitVersion) {
    // Explicit version provided via command line (standalone usage)
    targetSchemaVersion = explicitVersion;
    log(`📦 Package version: ${newPackageVersion}`, "blue");
    log(`📄 OpenAPI schema version (current): ${currentSchemaVersion || 'not found'}`, "blue");
    log(`🎯 Target version (explicit): ${targetSchemaVersion}`, "blue");
  } else {
    // Normal lifecycle hook execution
    log(`📦 Package version: ${oldPackageVersion || 'unknown'} → ${newPackageVersion}`, "blue");
    log(`📄 OpenAPI schema version (current): ${currentSchemaVersion || 'not found'}`, "blue");

    if (!currentSchemaVersion) {
      // No current schema version found, use package version
      log(`⚠️  No existing schema version found, using package version`, "yellow");
      targetSchemaVersion = newPackageVersion;
    } else if (oldPackageVersion === newPackageVersion) {
      // Can't detect bump type (explicit version set or other scenario)
      // Use package version
      log(`ℹ️  Cannot detect bump type, using package version`, "blue");
      targetSchemaVersion = newPackageVersion;
    } else {
      // Detect what type of bump was applied to package.json
      const bumpType = detectBumpType(oldPackageVersion, newPackageVersion);
      
      if (bumpType) {
        // Apply the same bump type to the schema version
        targetSchemaVersion = applyBump(currentSchemaVersion, bumpType);
        log(`🔄 Detected ${bumpType} bump, applying to schema: ${currentSchemaVersion} → ${targetSchemaVersion}`, "blue");
      } else {
        // Explicit version set or can't determine bump type
        log(`ℹ️  Explicit version or unknown bump type, using package version`, "blue");
        targetSchemaVersion = newPackageVersion;
      }
    }
  }

  // Update the OpenAPI schema
  const wasUpdated = updateSchemaVersion(targetSchemaVersion, currentSchemaVersion);

  // Validate the schema
  const isValid = validateSchema();
  if (!isValid) {
    process.exit(1);
  }

  // Stage the schema file for commit (if using git and file was updated)
  if (wasUpdated) {
    stageSchemaFile();
  }

  log("", "reset");
  log("✨ OpenAPI version sync completed successfully!", "green");
  log("", "reset");
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  getTargetVersion,
  updateSchemaVersion,
  validateSchema,
};
