# OpenAPI Specification Workflow

This directory contains the complete OpenAPI specification workflow for the Cart API, isolated from microservice development and deployment concerns.

## Purpose

This workflow directory provides complete separation of concerns:

- **API Specification Teams** work exclusively in this directory
- **Microservice Development** remains in `/apis/carts/` without OpenAPI workflow interference
- **DevOps/Infrastructure** operates in `/apis/carts/cdk/` for pure infrastructure concerns

## Target File

All operations target the OpenAPI specification file at:

```
../apis/carts/cdk/lib/apigateway/openapi-spec/carts-openapi-unresolved.yaml
```

The workflow scripts operate on this file but maintain complete independence from the microservice codebase.

## Quick Start

```bash
cd openapi-spec-workflow

# Install dependencies
npm install

# Validate OpenAPI specification
npm run validate

# Bump version and update schema
npm run version:bump minor

# Sync to SwaggerHub for development
npm run sync:dev

# Publish to SwaggerHub for production
npm run publish:prod
```

## Available Scripts

| Script                        | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `npm run validate`            | Complete validation (Spectral + schema)        |
| `npm run validate:spectral`   | API linting with Spectral                      |
| `npm run validate:schemas`    | OpenAPI 3.0 schema validation                  |
| `npm run compare:specs`       | Compare OpenAPI specifications for differences |
| `npm run version:bump <type>` | Version management (major/minor/patch)         |
| `npm run sync:dev`            | Sync unpublished version to SwaggerHub         |
| `npm run publish:prod`        | Publish stable version to SwaggerHub           |

## Documentation

See [OpenAPI-Specification-Workflow.md](./OpenAPI-Specification-Workflow.md) for complete workflow documentation.

## Architecture Benefits

✅ **Complete Isolation**: Zero impact on microservice development
✅ **Independent Dependencies**: No OpenAPI packages in microservice code
✅ **Clear Ownership**: API specification teams have dedicated workspace
✅ **Maintained Integration**: Scripts operate on actual OpenAPI file used by infrastructure

## Directory Structure

```
openapi-spec-workflow/
├── package.json                    # OpenAPI workflow dependencies
├── scripts/                        # All workflow automation
│   ├── validate-schemas.js
│   ├── version-bump.js
│   ├── publish.js
│   ├── sync-dev.js
│   └── compare-specs.sh           # OpenAPI specification comparison
├── output/                         # Generated comparison reports
├── .spectral.yaml                  # API linting configuration
├── OpenAPI-Specification-Workflow.md  # Complete documentation
└── README.md                       # This file
```

## OpenAPI Specification Comparison

The workflow includes a powerful comparison tool for identifying differences between OpenAPI specifications:

```bash
# Compare current spec with version 1.4.2
npm run compare:specs
```

This tool uses [oasdiff](https://github.com/oasdiff/oasdiff) for accurate OpenAPI specification comparison:

- **Automatic installation** - oasdiff binary is downloaded and managed automatically
- **High accuracy** - Filters out cosmetic changes (descriptions) to focus on functional differences
- **Multiple output formats**: HTML (visual), Markdown (readable), and YAML (structured)
- **Breaking change detection** - Specifically identifies backward-incompatible changes
- **Clean reporting** - Excludes description-only changes for cleaner analysis

### Output Files

Reports are generated in the `output/` directory with timestamps:

- `spec-diff-YYYYMMDD_HHMMSS.html` - Interactive visual diff (recommended for review)
- `spec-diff-YYYYMMDD_HHMMSS.md` - Detailed markdown report
- `spec-diff-YYYYMMDD_HHMMSS.yaml` - Structured YAML diff
- Console output shows immediate summary of functional changes only

### Requirements

The comparison tool automatically downloads and manages the oasdiff binary - no additional dependencies required.

## Prerequisites

- Node.js 22+
- npm 11+
- Internet connection (for oasdiff binary download on first run)
- SwaggerHub API Key (for publishing operations)

---

**Maintained by**: DW Digital Commerce Team
**Related**: [Cart API Repository](https://github.com/dw-digital-commerce/cart-api)
