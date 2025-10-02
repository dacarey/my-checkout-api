#!/usr/bin/env node

/**
 * sync-dev.js - Development sync script for SwaggerHub
 *
 * This is a convenience wrapper around publish.js that always runs in development mode.
 * It syncs the schema to SwaggerHub as unpublished (editable) for development purposes.
 */

const { execSync } = require("child_process");
const path = require("path");

// Colors for console output
const colors = {
  blue: "\x1b[34m",
  green: "\x1b[32m",
  reset: "\x1b[0m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function main() {
  log("🔄 SwaggerHub Development Sync", "blue");
  log("==============================", "blue");
  log("This will sync your schema to SwaggerHub as unpublished (editable)", "blue");
  log("", "reset");

  try {
    // Call publish.js with development flag
    const publishScript = path.join(__dirname, "publish.js");
    const command = `node "${publishScript}" --dev`;

    log(`Executing: ${command}`, "blue");
    log("", "reset");

    execSync(command, {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
    });
  } catch (error) {
    log("❌ Development sync failed", "red");
    process.exit(1);
  }
}

// Show help if requested
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  log("🔄 SwaggerHub Development Sync", "blue");
  log("==============================", "blue");
  log("");
  log("Usage:", "blue");
  log("  node scripts/sync-dev.js", "reset");
  log("  npm run sync:dev", "reset");
  log("");
  log("Description:", "blue");
  log("  Syncs the current schema to SwaggerHub as unpublished (editable).", "reset");
  log("  Version is automatically read from package.json.", "reset");
  log("  Schema file path is dynamically constructed based on package.json version.", "reset");
  log("");
  log("Examples:", "blue");
  log("  node scripts/sync-dev.js     # Sync current version to SwaggerHub", "reset");
  log("  npm run sync:dev             # Same as above via npm script", "reset");
  log("");
  log("Note:", "blue");
  log("  - Version remains unpublished and editable in SwaggerHub", "reset");
  log("  - For production publishing, use: npm run publish:prod", "reset");
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
