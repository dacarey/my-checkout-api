#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Load package.json to get dynamic version
 */
const packageJson = require("../package.json");

/**
 * Configuration for downloading from SwaggerHub
 */
const CONFIG = {
  organization: "Direct_Wines",
  apiName: "cart-api",
  resolvedSchemaPath: "../apis/carts/cdk/lib/apigateway/openapi-spec/carts-openapi.yaml",
  resolvedSchemaDir: "../apis/carts/cdk/lib/apigateway/openapi-spec",
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
 * Get version from package.json or user-specified version
 */
function getVersion(specifiedVersion = null) {
  if (specifiedVersion) {
    // Validate version format (semantic versioning)
    if (!/^\d+\.\d+\.\d+$/.test(specifiedVersion)) {
      log(`❌ Invalid version format: ${specifiedVersion}`, "red");
      log("Please use semantic versioning format (e.g., 1.4.2)", "yellow");
      process.exit(1);
    }
    log(`📦 Using specified version: ${specifiedVersion}`, "blue");
    return specifiedVersion;
  }

  const version = packageJson.version;
  log(`📦 Using package.json version: ${version}`, "blue");
  return version;
}

/**
 * Check if the API version exists on SwaggerHub
 */
function checkApiVersionExists(version) {
  log("🔍 Checking if API version exists on SwaggerHub...", "blue");

  const swaggerhubPath = `${CONFIG.organization}/${CONFIG.apiName}/${version}`;

  try {
    execCommandOptional(`npx swaggerhub api:get ${swaggerhubPath} --json`, { silent: true });
    log(`✅ API version ${version} exists on SwaggerHub`, "green");
    return true;
  } catch (error) {
    log(`❌ API version ${version} not found on SwaggerHub`, "red");
    log("💡 You may need to sync your changes first:", "yellow");
    log("   npm run sync:dev", "yellow");
    log("", "reset");
    log("Or check if the version exists:", "yellow");
    log(`   https://app.swaggerhub.com/apis/${CONFIG.organization}/${CONFIG.apiName}/${version}`, "blue");
    return false;
  }
}

/**
 * Get output file path based on version and options
 */
function getOutputPath(version, options) {
  const currentVersion = packageJson.version;
  const isSpecificVersion = options.version && options.version !== currentVersion;

  if (isSpecificVersion) {
    // Use versioned filename for specific versions: carts-openapi-1.4.2.yaml
    const versionedFilename = `carts-openapi-${version}.yaml`;
    return path.join(__dirname, "..", CONFIG.resolvedSchemaDir, versionedFilename);
  } else {
    // Use default filename for current version: carts-openapi.yaml
    return path.join(__dirname, "..", CONFIG.resolvedSchemaPath);
  }
}

/**
 * Download resolved specification from SwaggerHub
 */
function downloadResolvedSpec(version, options) {
  const swaggerhubPath = `${CONFIG.organization}/${CONFIG.apiName}/${version}`;
  const outputPath = getOutputPath(version, options);

  const currentVersion = packageJson.version;
  const isSpecificVersion = options.version && options.version !== currentVersion;
  const targetFile = isSpecificVersion ? `carts-openapi-${version}.yaml` : "carts-openapi.yaml";

  log(`📥 Downloading resolved specification from SwaggerHub...`, "blue");
  log(`   Source: ${swaggerhubPath}`, "blue");
  log(`   Target: ${targetFile}`, "blue");

  try {
    // Download the resolved specification as YAML (default format)
    const command = `npx swaggerhub api:get ${swaggerhubPath} --resolved`;
    log(`Executing: ${command}`, "blue");

    const yamlContent = execCommandOptional(command, { silent: true });

    // Basic validation - check that we got YAML content with OpenAPI structure
    if (!yamlContent.trim()) {
      throw new Error("Downloaded specification is empty");
    }

    if (!yamlContent.includes("openapi:") && !yamlContent.includes("swagger:")) {
      throw new Error("Downloaded specification does not appear to be a valid OpenAPI/Swagger document");
    }

    // Extract version for validation
    const versionMatch = yamlContent.match(/version:\s*(['"']?)([0-9]+\.[0-9]+\.[0-9]+)\1/);
    if (!versionMatch) {
      throw new Error("Downloaded specification is missing version information");
    }
    const specVersion = versionMatch[2];

    // Ensure the output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write the resolved specification to file
    fs.writeFileSync(outputPath, yamlContent, "utf8");

    // Count endpoints and schemas for summary
    const pathsCount = (yamlContent.match(/\n {2}[a-zA-Z0-9/_\-{}]+:\s*$/gm) || []).length;
    const schemasCount = (yamlContent.match(/\n {6}[A-Z][a-zA-Z0-9]*:\s*$/gm) || []).length;

    log(`✅ Successfully downloaded resolved specification`, "green");
    log(`   Version: ${specVersion}`, "green");
    log(`   Paths: ${pathsCount} endpoints`, "green");
    log(`   Components: ${schemasCount} schemas`, "green");
    log(`   File size: ${Math.round(yamlContent.length / 1024)} KB`, "green");

    return outputPath;
  } catch (error) {
    log(`❌ Failed to download resolved specification`, "red");
    if (error.message.includes("401") || error.message.includes("unauthorized")) {
      log("💡 Check your SwaggerHub API key permissions", "yellow");
    } else if (error.message.includes("404") || error.message.includes("not found")) {
      log("💡 Verify the API version exists on SwaggerHub", "yellow");
      log(`   https://app.swaggerhub.com/apis/${CONFIG.organization}/${CONFIG.apiName}/${version}`, "blue");
    } else {
      log(`Error details: ${error.message}`, "red");
    }
    process.exit(1);
  }
}

/**
 * Validate the downloaded file
 */
function validateDownloadedFile(filePath, expectedVersion) {
  log("🔍 Validating downloaded file...", "blue");

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error("Downloaded file does not exist");
    }

    const fileContent = fs.readFileSync(filePath, "utf8");

    // Check file is not empty
    if (fileContent.trim().length === 0) {
      throw new Error("Downloaded file is empty");
    }

    // Check for basic YAML structure
    if (!fileContent.includes("openapi:") && !fileContent.includes("swagger:")) {
      throw new Error("Downloaded file does not appear to be an OpenAPI specification");
    }

    // Verify version matches expected
    const versionMatch = fileContent.match(/version:\s*(['"']?)([0-9]+\.[0-9]+\.[0-9]+)\1/);
    if (versionMatch && versionMatch[2] !== expectedVersion) {
      log(`⚠️  Version mismatch in downloaded file: expected ${expectedVersion}, found ${versionMatch[2]}`, "yellow");
    }

    // Check file size is reasonable (should be larger than unresolved due to $ref expansion)
    const fileSizeKB = Math.round(fileContent.length / 1024);
    if (fileSizeKB < 10) {
      log(`⚠️  Downloaded file seems small (${fileSizeKB} KB) - verify completeness`, "yellow");
    }

    log("✅ Downloaded file validation passed", "green");
  } catch (error) {
    log(`❌ Downloaded file validation failed: ${error.message}`, "red");
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    help: false,
    force: false,
    version: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--version" || arg === "-v") {
      if (i + 1 < args.length) {
        options.version = args[++i];
      } else {
        log("❌ --version requires a value (e.g., --version 1.4.2)", "red");
        options.help = true;
      }
    } else if (arg.startsWith("--version=")) {
      options.version = arg.split("=")[1];
      if (!options.version) {
        log("❌ --version= requires a value (e.g., --version=1.4.2)", "red");
        options.help = true;
      }
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
  log("📥 SwaggerHub Resolved Specification Download", "blue");
  log("============================================", "blue");
  log("");
  log("Usage:", "yellow");
  log("  node scripts/download-resolved.js [options]", "reset");
  log("  npm run download:resolved [options]", "reset");
  log("");
  log("Options:", "yellow");
  log("  --version, -v <version> Download specific version (e.g., --version 1.4.2)", "reset");
  log("  --force, -f             Force download even if local file exists", "reset");
  log("  --help, -h              Show this help message", "reset");
  log("");
  log("Description:", "yellow");
  log("  Downloads the resolved OpenAPI specification from SwaggerHub where all", "reset");
  log("  $ref references have been expanded inline. This creates the resolved", "reset");
  log("  version used by AWS API Gateway while keeping the unresolved version", "reset");
  log("  as the master source for development.", "reset");
  log("");
  log("Examples:", "yellow");
  log("  npm run download:resolved                    # Download current version (from package.json)", "reset");
  log("  npm run download:resolved -- --version 1.4.2 # Download specific version", "reset");
  log("  npm run download:resolved -- --force         # Force download, overwrite existing file", "reset");
  log("  node scripts/download-resolved.js --version 1.4.2 --force", "reset");
  log("");
  log("Workflow:", "yellow");
  log("  1. Edit carts-openapi-unresolved.yaml (master source)", "reset");
  log("  2. npm run sync:dev (upload unresolved to SwaggerHub)", "reset");
  log("  3. npm run download:resolved (download resolved from SwaggerHub)", "reset");
  log("  4. Both local files now in sync", "reset");
  log("");
  log("Version Management:", "yellow");
  log(`• Default: Uses version from package.json (currently ${packageJson.version})`, "reset");
  log("• Specific: Use --version to download any available version", "reset");
  log("• Historical: Access previous versions for comparison or rollback", "reset");
  log("");
  log("Prerequisites:", "yellow");
  log("• API version must exist on SwaggerHub (use npm run sync:dev first)", "reset");
  log("• SWAGGERHUB_API_KEY environment variable must be set", "reset");
  log("• SwaggerHub CLI must be installed (included in dependencies)", "reset");
  log("");
  log("Output:", "yellow");
  log("• Default version: carts-openapi.yaml (current version)", "reset");
  log("• Specific version: carts-openapi-{version}.yaml (e.g., carts-openapi-1.4.2.yaml)", "reset");
  log("• Format: YAML with all $ref references expanded inline", "reset");
  log("• Location: ../apis/carts/cdk/lib/apigateway/openapi-spec/", "reset");
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

  log("📥 Starting SwaggerHub resolved specification download...", "blue");
  log("========================================================", "blue");

  checkSwaggerHubCLI();
  const version = getVersion(options.version);

  // Check if API version exists on SwaggerHub
  if (!checkApiVersionExists(version)) {
    process.exit(1);
  }

  // Check if local file already exists (unless force flag is used)
  const outputPath = getOutputPath(version, options);
  const currentVersion = packageJson.version;
  const isSpecificVersion = options.version && options.version !== currentVersion;
  const targetFile = isSpecificVersion ? `carts-openapi-${version}.yaml` : "carts-openapi.yaml";

  if (fs.existsSync(outputPath) && !options.force) {
    log("⚠️  Resolved specification file already exists", "yellow");
    log(`   File: ${targetFile}`, "yellow");
    log("💡 Use --force flag to overwrite, or remove the file first", "yellow");
    log("   npm run download:resolved -- --force", "blue");
    process.exit(1);
  }

  // Download the resolved specification
  const downloadedPath = downloadResolvedSpec(version, options);

  // Validate the downloaded file
  validateDownloadedFile(downloadedPath, version);

  log("", "reset");
  log("🎉 Resolved specification download completed successfully!", "green");
  log(`📁 File saved to: ${targetFile}`, "blue");
  log(
    `📖 View on SwaggerHub: https://app.swaggerhub.com/apis/${CONFIG.organization}/${CONFIG.apiName}/${version}`,
    "blue",
  );
  log("", "reset");
  log("📊 Download Summary:", "blue");
  log(`   Version: ${version}${options.version ? " (specified)" : " (from package.json)"}`, "reset");
  log(`   File: ${targetFile}${isSpecificVersion ? " (versioned)" : " (default)"}`, "reset");
  log(`   Force overwrite: ${options.force ? "Yes" : "No"}`, "reset");
  log("", "reset");
  log("💡 Next steps:", "blue");
  if (isSpecificVersion) {
    log("• This versioned file can be used for comparison or historical reference", "reset");
    log("• Use the default carts-openapi.yaml file for AWS API Gateway deployment", "reset");
  } else {
    log("• The resolved specification is ready for AWS API Gateway deployment", "reset");
  }
  log("• Keep the unresolved version as your master source for future edits", "reset");
  log("• Run this command again after syncing new changes to SwaggerHub", "reset");
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
