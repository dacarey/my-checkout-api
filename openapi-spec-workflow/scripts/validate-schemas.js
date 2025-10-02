#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const OpenAPISchemaValidator = require("@seriousme/openapi-schema-validator");

/**
 * Configuration
 */
const CONFIG = {
  // Default directory to scan for OpenAPI schema files
  defaultSchemasDir: path.join(__dirname, "..", "..", "apis", "carts", "cdk", "lib", "apigateway", "openapi-spec"),
};

/**
 * Recursively find all YAML files in a directory
 */
function findYamlFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...findYamlFiles(fullPath));
    } else if (item.endsWith(".yaml") || item.endsWith(".yml")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Validate a single OpenAPI schema file
 */
async function validateSchema(filePath) {
  try {
    console.log(`Validating ${filePath}...`);

    const validator = new OpenAPISchemaValidator({
      version: 3,
    });

    const content = fs.readFileSync(filePath, "utf8");
    const result = await validator.validate(content);

    if (!result.valid) {
      console.error(`❌ Validation failed for ${filePath}:`);
      if (result.errors) {
        result.errors.forEach((error, index) => {
          console.error(`  ${index + 1}. ${error.message}`);
          if (error.instancePath) {
            console.error(`     Location: ${error.instancePath}`);
          }
          if (error.schemaPath) {
            console.error(`     Schema rule: ${error.schemaPath}`);
          }
          if (index < result.errors.length - 1) {
            console.error(""); // Empty line between errors
          }
        });
      }
      console.error("");
      console.error("💡 Common fixes:");
      console.error("   • Ensure all required properties are defined");
      console.error('   • Use "nullable: true" instead of "x-nullable" for OpenAPI 3.0');
      console.error("   • Check that version numbers follow semantic versioning");
      console.error("   • Verify all $ref references point to valid schemas");
      return false;
    } else {
      console.log(`✅ ${filePath} is valid`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Error validating ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    file: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" && i + 1 < args.length) {
      options.file = args[i + 1];
      i++; // Skip the next argument as it's the file path
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

/**
 * Show help information
 */
function showHelp() {
  console.log("🔍 OpenAPI Schema Validator");
  console.log("===========================");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/validate-schemas.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --file <path>    Validate only the specified file");
  console.log("  --help, -h       Show this help message");
  console.log("");
  console.log("Examples:");
  console.log("  node scripts/validate-schemas.js                                    # Validate all YAML files");
  console.log("  node scripts/validate-schemas.js --file ../apis/carts/.../file.yaml # Validate specific file");
}

/**
 * Main validation function
 */
async function main() {
  const options = parseArguments();

  if (options.help) {
    showHelp();
    return;
  }

  let filesToValidate = [];

  if (options.file) {
    // Validate specific file
    const filePath = path.resolve(options.file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${options.file}`);
      process.exit(1);
    }
    filesToValidate = [filePath];
    console.log(`Validating specific file: ${options.file}\n`);
  } else {
    // Validate all files in directory (original behavior)
    if (!fs.existsSync(CONFIG.defaultSchemasDir)) {
      console.error("❌ OpenAPI spec directory not found");
      process.exit(1);
    }

    filesToValidate = findYamlFiles(CONFIG.defaultSchemasDir);

    if (filesToValidate.length === 0) {
      console.log("⚠️  No YAML files found in OpenAPI spec directory");
      process.exit(0);
    }

    console.log(`Found ${filesToValidate.length} schema file(s) to validate:\n`);
  }

  let allValid = true;

  for (const file of filesToValidate) {
    const isValid = await validateSchema(file);
    if (!isValid) {
      allValid = false;
    }
    console.log(""); // Empty line for readability
  }

  if (allValid) {
    console.log("🎉 All schemas are valid!");
    process.exit(0);
  } else {
    console.error("💥 Some schemas failed validation");
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
  });
}

module.exports = { validateSchema, findYamlFiles };
