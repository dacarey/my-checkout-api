#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Load package.json to get dynamic version
 */
const packageJson = require("../package.json");

/**
 * Configuration for publishing to SwaggerHub
 */
const CONFIG = {
  organization: "Direct_Wines",
  apiName: "checkout-api",
  visibility: "public",
  schemaPath: "../openapi/checkout-openapi-unresolved.yaml",
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
 * Execute shell command that may fail gracefully (for optional operations)
 */
function execCommandOptional(command, options = {}) {
  const result = execSync(command, {
    encoding: "utf8",
    stdio: options.silent ? "pipe" : "inherit",
    ...options,
  });
  return result;
}

/**
 * Check if SwaggerHub CLI is installed and configured
 */
function checkSwaggerHubCLI() {
  log("🔍 Checking SwaggerHub CLI...", "blue");

  try {
    execCommand("npx swaggerhub --version", { silent: true });
  } catch (error) {
    log("❌ SwaggerHub CLI not found. Please install it:", "red");
    log("   npm install -g swaggerhub-cli", "yellow");
    process.exit(1);
  }

  // Check for API key
  if (!process.env.SWAGGERHUB_API_KEY) {
    log("❌ SWAGGERHUB_API_KEY environment variable not set", "red");
    log("Please set your SwaggerHub API key:", "yellow");
    log("   export SWAGGERHUB_API_KEY=your_api_key_here", "yellow");
    process.exit(1);
  }

  log("✅ SwaggerHub CLI is ready", "green");
}

/**
 * Validate file structure and version consistency
 */
function validateFileStructure() {
  log("🔍 Validating file structure and version consistency...", "blue");

  const version = packageJson.version;
  const schemaPath = path.join(__dirname, "..", CONFIG.schemaPath);

  // Check if schema file exists
  if (!fs.existsSync(schemaPath)) {
    log(`❌ Schema file not found: ${CONFIG.schemaPath}`, "red");
    log(`Please ensure the schema file exists at the expected location.`, "yellow");
    process.exit(1);
  }

  // Check version consistency between package.json and schema file
  try {
    const schemaContent = fs.readFileSync(schemaPath, "utf8");
    const versionMatch = schemaContent.match(/version:\s*([0-9]+\.[0-9]+\.[0-9]+)/);

    if (!versionMatch) {
      log(`❌ No version found in schema file: ${CONFIG.schemaPath}`, "red");
      log(`Please ensure the schema file contains a version field.`, "yellow");
      process.exit(1);
    }

    const schemaVersion = versionMatch[1];
    if (version !== schemaVersion) {
      log(`❌ Version mismatch!`, "red");
      log(`   package.json version: ${version}`, "yellow");
      log(`   schema file version: ${schemaVersion}`, "yellow");
      log("", "reset");
      log("💡 To fix this, choose one of these options:", "yellow");
      log("1. Update package.json to match schema:", "reset");
      log(`   npm version ${schemaVersion} --no-git-tag-version`, "yellow");
      log("2. Update schema file to match package.json:", "reset");
      log(`   sed -i 's/version: ${schemaVersion}/version: ${version}/' ${CONFIG.schemaPath}`, "yellow");
      log("3. Use npm version for future version bumps:", "reset");
      log(`   npm run version:openapi <bump-type> (from project root)`, "yellow");
      process.exit(1);
    }

    log(`✅ File structure and version consistency validated (v${version})`, "green");
  } catch (error) {
    log(`❌ Error reading schema file: ${error.message}`, "red");
    process.exit(1);
  }
}

/**
 * Get version from git tag or package.json based on context
 */
function getVersion(isDevelopment = false) {
  // In development mode, always use package.json version (respects version-bump workflow)
  if (isDevelopment) {
    log("🔧 Development mode: using package.json version", "blue");
    return packageJson.version;
  }

  // In production mode, try git tag first, fallback to package.json
  try {
    const gitTag = execCommandOptional("git describe --tags --exact-match HEAD", { silent: true }).trim();
    if (gitTag.startsWith("v")) {
      log("🏷️  Using git tag version", "blue");
      return gitTag.substring(1); // Remove 'v' prefix
    }
    log("🏷️  Using git tag version", "blue");
    return gitTag;
  } catch (error) {
    // Fallback to package.json version
    log("⚠️  No git tag found, using package.json version", "yellow");
    return packageJson.version;
  }
}

/**
 * Validate schema before publishing
 */
function validateSchema() {
  log("🔍 Validating schema before publishing...", "blue");

  const schemaPath = path.join(__dirname, "..", CONFIG.schemaPath);
  if (!fs.existsSync(schemaPath)) {
    log(`❌ Schema file not found: ${CONFIG.schemaPath}`, "red");
    process.exit(1);
  }

  // Run schema validation (skip Spectral for now due to config issue)
  try {
    log("Running schema validation...", "blue");
    execCommand(`npm run validate:schemas -- --file "${CONFIG.schemaPath}"`);
    log("✅ Schema validation passed", "green");
  } catch (error) {
    log("❌ Schema validation failed", "red");
    process.exit(1);
  }
}

/**
 * Verify that the default version was set correctly
 */
function verifyDefaultVersion(expectedVersion) {
  try {
    const apiInfo = execCommandOptional(`npx swaggerhub api:get ${CONFIG.organization}/${CONFIG.apiName} --json`, {
      silent: true,
    });
    const apiData = JSON.parse(apiInfo);

    if (apiData.info && apiData.info.version === expectedVersion) {
      return true;
    } else {
      const actualVersion = apiData.info ? apiData.info.version : "unknown";
      throw new Error(`Expected default version ${expectedVersion}, but got ${actualVersion}`);
    }
  } catch (error) {
    if (error.message.includes("Expected default version")) {
      throw error;
    }
    throw new Error(`Unable to verify default version: ${error.message}`);
  }
}

/**
 * Publish to SwaggerHub
 */
function publishToSwaggerHub(version, options = {}) {
  const schemaPath = path.join(__dirname, "..", CONFIG.schemaPath);
  const swaggerhubPath = `${CONFIG.organization}/${CONFIG.apiName}/${version}`;
  const isDevelopment = options.development || false;

  log(`📤 ${isDevelopment ? "Syncing to" : "Publishing to"} SwaggerHub: ${swaggerhubPath}`, "blue");

  // Create or update the API
  const publishFlag = isDevelopment ? "--published=unpublish" : "";
  const createCommand =
    `npx swaggerhub api:create ${swaggerhubPath} --file "${schemaPath}" --visibility ${CONFIG.visibility} ${publishFlag}`.trim();

  try {
    execCommandOptional(createCommand);
    log(`✅ Successfully ${isDevelopment ? "created unpublished" : "created"} API ${swaggerhubPath}`, "green");
  } catch (error) {
    // If creation fails, try updating
    log("🔄 API exists, trying to update...", "yellow");
    const updateCommand = `npx swaggerhub api:update ${swaggerhubPath} --file "${schemaPath}" ${publishFlag}`.trim();
    execCommand(updateCommand);
    log(`✅ Successfully updated API ${swaggerhubPath}`, "green");
  }

  // For production mode, set as default and publish
  if (!isDevelopment) {
    // Set as default version
    try {
      log("🔄 Setting as default version...", "blue");
      const setDefaultCommand = `npx swaggerhub api:setdefault ${CONFIG.organization}/${CONFIG.apiName}/${version}`;
      execCommand(setDefaultCommand);
      log("✅ Successfully set as default version", "green");

      // Verify default version was set correctly
      try {
        log("🔍 Verifying default version...", "blue");
        verifyDefaultVersion(version);
        log("✅ Default version verified successfully", "green");
      } catch (verifyError) {
        log("⚠️  Warning: Could not verify default version was set correctly", "yellow");
        log(`Verification error: ${verifyError.message}`, "yellow");
      }
    } catch (error) {
      log("❌ Failed to set as default version", "red");
      log(`Error: ${error.message}`, "red");
      log("💡 This may prevent users from seeing the latest version by default", "yellow");
      log("💡 You can manually set the default version in SwaggerHub UI if needed", "yellow");
    }

    // Publish the version (make it read-only)
    try {
      log("📋 Publishing version (making it read-only)...", "blue");
      const publishCommand = `npx swaggerhub api:publish ${swaggerhubPath}`;
      execCommand(publishCommand);
      log("✅ Version published and is now read-only", "green");
    } catch (error) {
      log("⚠️  Failed to publish version (this may be normal)", "yellow");
    }
  } else {
    log("💡 Development mode: Version remains unpublished and editable", "blue");
  }
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    development: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--dev" || arg === "--development") {
      options.development = true;
    } else if (arg === "--prod" || arg === "--production") {
      options.development = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      log(`❌ Unknown argument: ${arg}`, "red");
      options.help = true;
    }
  }

  return options;
}

/**
 * Show help information
 */
function showHelp() {
  log("🚀 SwaggerHub Publishing Script", "blue");
  log("================================", "blue");
  log("");
  log("Usage:", "yellow");
  log("  node scripts/publish.js [options]", "reset");
  log("");
  log("Options:", "yellow");
  log("  --dev, --development    Sync to SwaggerHub as unpublished (development mode)", "reset");
  log("  --prod, --production    Publish to SwaggerHub as published (production mode) [default]", "reset");
  log("  --help, -h              Show this help message", "reset");
  log("");
  log("Examples:", "yellow");
  log("  node scripts/publish.js --dev       # Sync unpublished version for development", "reset");
  log("  node scripts/publish.js --prod      # Publish version (make read-only and set as default)", "reset");
  log("  node scripts/publish.js             # Default: production mode", "reset");
  log("");
  log("Production Mode Features:", "yellow");
  log("• Creates/updates API version in SwaggerHub", "reset");
  log("• Sets the version as the default version", "reset");
  log("• Publishes the version (makes it read-only)", "reset");
  log("• Verifies default version was set correctly", "reset");
  log("");
  log("Prerequisites:", "yellow");
  log(`• Schema file must exist: ${CONFIG.schemaPath}`, "reset");
  log("• package.json and schema file versions must match", "reset");
  log("• SWAGGERHUB_API_KEY environment variable must be set", "reset");
  log("");
  log("Version Management:", "blue");
  log("• Bump version: npm run version:bump <major|minor|patch>", "reset");
  log("• Version is automatically read from git tag or package.json", "reset");
  log("");
  log("Troubleshooting:", "yellow");
  log("• If default version setting fails, you can manually set it in SwaggerHub UI", "reset");
  log("• Check SwaggerHub API key permissions if commands fail", "reset");
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

  const mode = options.development ? "development" : "production";
  log(`🚀 Starting SwaggerHub ${mode} process...`, "blue");
  log("===============================================", "blue");

  validateFileStructure();
  checkSwaggerHubCLI();

  const version = getVersion(options.development);
  log(`📦 ${options.development ? "Syncing" : "Publishing"} version: ${version}`, "blue");

  validateSchema();
  publishToSwaggerHub(version, { development: options.development });

  log("", "reset");
  if (options.development) {
    log("🎉 Development sync completed successfully!", "green");
    log(
      `📖 View your unpublished API: https://app.swaggerhub.com/apis/${CONFIG.organization}/${CONFIG.apiName}/${version}`,
      "blue",
    );
    log("💡 Version remains unpublished and editable for development", "yellow");
  } else {
    log("🎉 Production publication completed successfully!", "green");
    log(
      `📖 View your published API: https://app.swaggerhub.com/apis/${CONFIG.organization}/${CONFIG.apiName}/${version}`,
      "blue",
    );
    log("🔒 Version is now published and read-only", "yellow");
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
