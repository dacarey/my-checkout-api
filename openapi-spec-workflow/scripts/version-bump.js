#!/usr/bin/env node

/**
 * Version Bump Script for OpenAPI Specification Workflow
 *
 * SYNOPSIS:
 * This script provides synchronized version management for OpenAPI specifications
 * by updating version numbers across multiple files (package.json and OpenAPI schema)
 * to maintain consistency during API releases.
 *
 * FUNCTIONALITY:
 * - Performs semantic version bumping (major, minor, patch)
 * - Updates package.json using npm version command
 * - Synchronizes version in OpenAPI schema YAML file
 * - Validates version consistency across all files
 * - Runs schema validation to ensure integrity
 * - Enforces proper Git branching workflow (prevents main branch usage)
 *
 * USAGE:
 *   node scripts/version-bump.js <bump-type>
 *
 *   Where bump-type is one of: major, minor, patch
 *
 * EXAMPLES:
 *   node scripts/version-bump.js patch   # 1.0.0 → 1.0.1
 *   node scripts/version-bump.js minor   # 1.0.0 → 1.1.0
 *   node scripts/version-bump.js major   # 1.0.0 → 2.0.0
 *
 * WORKFLOW:
 * 1. Validates current Git branch (must not be main)
 * 2. Bumps package.json version using npm version
 * 3. Updates OpenAPI schema version to match
 * 4. Validates version consistency across files
 * 5. Runs schema validation to ensure API spec integrity
 * 6. Provides next steps for tagging and publishing
 *
 * REQUIREMENTS:
 * - Must be run from a feature branch (not main)
 * - OpenAPI schema file must exist at expected path
 * - npm and git must be available in PATH
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
  // Package.json file path
  packageJsonPath: path.join(__dirname, "..", "package.json"),
  // OpenAPI schema file path
  schemaFilePath: path.join(
    __dirname,
    "..",
    "..",
    "apis/carts/cdk/lib/apigateway/openapi-spec/carts-openapi-unresolved.yaml",
  ),
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
 * Execute shell command with error handling
 */
function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: "utf8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
    return result;
  } catch (error) {
    log(`❌ Command failed: ${command}`, "red");
    log(`Error: ${error.message}`, "red");
    process.exit(1);
  }
}

/**
 * Validate semantic version format
 */
function isValidSemVer(version) {
  const semverRegex = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;
  return semverRegex.test(version);
}

/**
 * Get the current version from package.json
 */
function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync(CONFIG.packageJsonPath, "utf8"));
  return packageJson.version;
}

/**
 * Update package.json version using npm version
 */
function updatePackageJsonVersion(bumpType) {
  log(`🔄 Bumping package.json version (${bumpType})...`, "blue");

  const result = execCommand(`npm version ${bumpType} --no-git-tag-version`, { silent: true });
  const newVersion = result.trim().substring(1); // Remove 'v' prefix

  log(`✅ Updated package.json version to: ${newVersion}`, "green");
  return newVersion;
}

/**
 * Update version in schema YAML file
 */
function updateSchemaVersion(newVersion) {
  if (!fs.existsSync(CONFIG.schemaFilePath)) {
    log(`❌ Schema file not found: ${CONFIG.schemaFilePath}`, "red");
    process.exit(1);
  }

  log(`🔄 Updating schema version to: ${newVersion}`, "blue");

  const content = fs.readFileSync(CONFIG.schemaFilePath, "utf8");
  const updatedContent = content.replace(/version:\s*[0-9]+\.[0-9]+\.[0-9]+/, `version: ${newVersion}`);

  fs.writeFileSync(CONFIG.schemaFilePath, updatedContent);
  log("✅ Updated schema file version", "green");
}

/**
 * Validate version consistency
 */
function validateVersionConsistency(expectedVersion) {
  log("🔍 Validating version consistency...", "blue");

  const issues = [];

  // Check package.json
  const packageJson = JSON.parse(fs.readFileSync(CONFIG.packageJsonPath, "utf8"));
  if (packageJson.version !== expectedVersion) {
    issues.push(`package.json version (${packageJson.version}) != expected version (${expectedVersion})`);
  }

  // Check schema file
  if (fs.existsSync(CONFIG.schemaFilePath)) {
    const schemaContent = fs.readFileSync(CONFIG.schemaFilePath, "utf8");
    const versionMatch = schemaContent.match(/version:\s*([0-9]+\.[0-9]+\.[0-9]+)/);
    if (!versionMatch || versionMatch[1] !== expectedVersion) {
      const schemaVersion = versionMatch ? versionMatch[1] : "not found";
      issues.push(`schema file version (${schemaVersion}) != expected version (${expectedVersion})`);
    }
  } else {
    issues.push(`schema file not found: ${CONFIG.schemaFilePath}`);
  }

  if (issues.length === 0) {
    log("✅ Version consistency check passed", "green");
    return true;
  } else {
    log("❌ Version consistency issues found:", "red");
    issues.forEach((issue) => log(`   • ${issue}`, "yellow"));
    return false;
  }
}

/**
 * Check if running on main branch and exit if so
 */
function checkBranch() {
  try {
    const currentBranch = execCommand("git branch --show-current", { silent: true }).trim();

    if (currentBranch === "main") {
      log("❌ Version bump cannot be performed on main branch!", "red");
      log("");
      log("Due to branch protection rules, all changes must be made via PR.", "yellow");
      log("Please create a feature branch first:", "yellow");
      log("");
      log("  git checkout -b feature/CHECK-XXX-version-bump-description", "reset");
      log("  npm run version:bump <type>", "reset");
      log(`  git add package.json package-lock.json ${CONFIG.schemaFilePath}`, "reset");
      log('  git commit -m "chore(version): bump version to X.Y.Z"', "reset");
      log("  git push -u origin feature/CHECK-XXX-version-bump-description", "reset");
      log("");
      log("Then create a PR to merge into main.", "yellow");
      process.exit(1);
    }

    log(`📍 Current branch: ${currentBranch}`, "blue");
  } catch (error) {
    log("⚠️  Could not determine git branch. Proceeding with caution...", "yellow");
  }
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  const bumpType = args[0];
  const validBumpTypes = ["major", "minor", "patch"];

  if (!validBumpTypes.includes(bumpType)) {
    log(`❌ Invalid bump type: ${bumpType}`, "red");
    log(`Valid options: ${validBumpTypes.join(", ")}`, "yellow");
    return { help: true };
  }

  return { bumpType, help: false };
}

/**
 * Show help information
 */
function showHelp() {
  const currentVersion = getCurrentVersion();

  log("🚀 Version Bump Script", "blue");
  log("======================", "blue");
  log("");
  log("Updates both package.json and OpenAPI schema file versions synchronously.", "reset");
  log("");
  log("Usage:", "yellow");
  log("  node scripts/version-bump.js <bump-type>", "reset");
  log("");
  log("Bump Types:", "yellow");
  log("  major    Increment major version (1.0.0 → 2.0.0)", "reset");
  log("  minor    Increment minor version (1.0.0 → 1.1.0)", "reset");
  log("  patch    Increment patch version (1.0.0 → 1.0.1)", "reset");
  log("");
  log(`Current version: ${currentVersion}`, "blue");
  log("");
  log("Examples:", "yellow");
  log("  node scripts/version-bump.js minor", "reset");
  log("  node scripts/version-bump.js patch", "reset");
  log("");
  log("What this script does:", "blue");
  log("1. 📦 Updates package.json version using npm version", "reset");
  log("2. 📄 Updates version in OpenAPI schema file to match", "reset");
  log("3. 🔍 Validates version consistency across files", "reset");
  log("4. ✅ Runs validation to ensure schema is still valid", "reset");
  log("");
  log("Next steps after running:", "yellow");
  log("• Test locally with validation tools", "reset");
  log("• Optional: npm run sync:dev (to sync to SwaggerHub)", "reset");
  log("• When ready: git tag v<version> && git push --tags", "reset");
}

/**
 * Main function
 */
function main() {
  const options = parseArguments();

  if (options.help) {
    showHelp();
    return;
  }

  // Check if running on main branch before proceeding
  checkBranch();

  const currentVersion = getCurrentVersion();

  log("🚀 Version Bump Process", "blue");
  log("=======================", "blue");
  log(`📦 Current version: ${currentVersion}`, "blue");
  log(`🎯 Bump type: ${options.bumpType}`, "blue");
  log("");

  // Update package.json version
  const newVersion = updatePackageJsonVersion(options.bumpType);

  // Update schema file version
  updateSchemaVersion(newVersion);

  // Validate consistency
  validateVersionConsistency(newVersion);

  // Run schema validation
  log("🔍 Running schema validation...", "blue");
  try {
    execCommand("npm run validate:schemas", { silent: false });
    log("✅ Schema validation passed", "green");
  } catch (error) {
    log("⚠️  Schema validation failed. Please fix issues before proceeding.", "yellow");
    log('   Run "npm run validate" to see detailed validation errors.', "yellow");
  }

  log("");
  log("🎉 Version bump completed successfully!", "green");
  log("======================================", "green");
  log("");
  log(`📦 New version: ${newVersion}`, "blue");
  log("");
  log("Next steps:", "yellow");
  log("1. 🧪 Test locally with OpenAPI validation tools", "reset");
  log("2. 🔄 Optional: npm run sync:dev (sync to SwaggerHub for sharing)", "reset");
  log(`3. 🏷️  When ready: git tag v${newVersion}`, "reset");
  log("4. 📤 Push tag: git push --tags (triggers automated publishing)", "reset");
  log("");
  log(`📖 Schema location: ${CONFIG.schemaFilePath}`, "blue");
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  updatePackageJsonVersion,
  updateSchemaVersion,
  validateVersionConsistency,
  isValidSemVer,
};
