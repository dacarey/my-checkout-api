# Checkout API

Serverless checkout API with multi-account AWS deployment support using Lambda, API Gateway, and CDK.

## Prerequisites

- Node.js 22+
- AWS CLI configured with credentials
- AWS CDK CLI v2

## Quick Start

```bash
# Install dependencies
npm ci

# Build project
npm run build

# Run tests
npm test
```

## Development Deployment (Single Account)

```bash
# Preview changes
npm run diff:single

# Deploy (with auth bypass for testing)
npm run deploy:single

# Verify deployment
./verify-deployment.sh

# Test the API
./test-checkout-api.sh

# Clean up
npm run destroy:single
```

## Testing the API

Test the deployed API using the provided test script:

```bash
# Use default API URL (from script)
./test-checkout-api.sh

# Specify custom API Gateway URL
./test-checkout-api.sh https://your-api-id.execute-api.eu-west-1.amazonaws.com/dev

# Or set as environment variable
API_GATEWAY_URL=https://your-api-id.execute-api.eu-west-1.amazonaws.com/dev ./test-checkout-api.sh
```

The test script includes:
- **Single tokenised payment** - Credit card payment under £150 (COMPLETED order)
- **Mixed payment methods** - Gift voucher + credit card
- **3DS required scenario** - Payment over £150 triggers 3DS authentication
- **Stateless endpoint** - In-brand agent checkout
- **Error scenarios** - Validation errors (422), bad requests (400)
- **CORS preflight** - OPTIONS request handling

Requirements: `xh` (HTTPie) and `uuidgen` must be installed.

## Manual Deployment

```bash
# Deploy to specific profile/environment
./deploy-single-account.sh --profile PROFILE --environment ENV

# Default: --profile dw-sandbox --environment dev
```

## Project Structure

```
my-checkout-api/
├── lambda/         # Lambda function code (TypeScript)
├── infra/          # CDK infrastructure (TypeScript)
├── openapi/        # OpenAPI 3 specifications
└── docs/           # Documentation and guides
```

## Key Commands

| Command | Description |
|---------|-------------|
| `npm ci` | Install all dependencies |
| `npm run build` | Build CDK infrastructure |
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run tests once (CI mode) |
| `npm run diff:single` | Preview infrastructure changes |
| `npm run deploy:single` | Deploy to single AWS account |
| `npm run destroy:single` | Remove all deployed resources |

## Configuration

Configuration priority: CDK context (`-c`) → Environment variables → Defaults

Key environment variables:
- `BYPASS_AUTHORIZER=true` - Disable authentication (dev only)
- `AWS_PROFILE` - AWS CLI profile
- `ENVIRONMENT` - Deployment environment (dev, sit, uat, prod)

## Architecture

- **API Gateway**: REST API defined by OpenAPI spec
- **Lambda**: Node.js 22 runtime with esbuild bundling
- **Deployment**: Blue-green via Lambda aliases
- **Multi-Account**: API Gateway in Account A, Lambda in Account B

## Development

- Branch protection: Direct commits to `main` blocked
- Use feature branches: `feature/`, `bugfix/`, `hotfix/`, `chore/`
- All changes via pull requests

### Version Bumping

The project supports independent versioning for the OpenAPI specification and implementation code.

**Bump OpenAPI specification only:**
```bash
npm run version:openapi patch    # Bug fix to API spec
npm run version:openapi minor    # New API endpoint/feature
npm run version:openapi major    # Breaking API change
```

**Bump implementation code only (excludes OpenAPI spec):**
```bash
npm run version:impl patch       # Bug fix in code (root/lambda/infra)
npm run version:impl minor       # New implementation feature
npm run version:impl major       # Breaking code change
```

**Bump everything (all workspaces + OpenAPI spec):**
```bash
npm run version:all patch        # Bug fixes across entire project
npm run version:all minor        # New features across project
npm run version:all major        # Breaking changes across project
```

**How it works:**
- `version:openapi` bumps only `openapi-spec-workflow/package.json` + OpenAPI schema
- `version:impl` bumps root + lambda + infra (excludes openapi-spec-workflow)
- `version:all` bumps root + lambda + infra + openapi-spec-workflow + OpenAPI schema
- The OpenAPI spec version can diverge from package.json versions
- When bumping, the same bump type (patch/minor/major) is applied to each from their current versions
- Example: package.json `0.5.0 → 0.5.1` (patch) and OpenAPI spec `2.1.5 → 2.1.6` (patch)

For detailed usage, flags, and versioning strategy, see [Version Bump Guide](docs/VERSION-BUMP-GUIDE.md).

## Documentation

See [CLAUDE.md](CLAUDE.md) for detailed architecture and development guide.
