# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a serverless checkout API project designed for multi-account AWS deployments using AWS Lambda, API Gateway, and CDK (TypeScript). The project is currently at v0.5.0 and follows a template-based architecture for serverless microservices with blue-green deployment support. It implements tokenized payment capture with 3DS authentication support.

## Key Architecture Patterns

### Multi-Account Deployment Strategy
- **API Gateway**: Lives in a shared AWS account (Account A)
- **Lambda Functions**: Run in service-specific AWS accounts (Account B)
- **Cross-Account Permissions**: Lambda functions grant invoke permissions to API Gateway via IAM
- **Blue-Green Deployments**: Supported via Lambda aliases (`live` alias) for zero-downtime updates

### Project Structure
```
my-checkout-api/
├── docs/
│   ├── howto/                               # Developer guides (start here)
│   │   ├── README.md                        # Navigation hub for guides
│   │   ├── getting-started-payments.md     # Comprehensive payment integration guide
│   │   ├── advanced-3ds-integration.md     # 3DS authentication guide
│   │   └── multi-account-deployment.md     # AWS multi-account setup
│   ├── architecture/                        # Design decisions and specifications
│   │   ├── 3ds-stateful-design/            # Complete 3DS implementation docs
│   │   └── payment-api-alignment-v0.4.0-archive/  # Historical reference
│   └── VERSION-BUMP-GUIDE.md               # Version management procedures
├── lambda/                                  # Lambda function code (TypeScript)
│   └── src/handlers/                        # Request handlers for API endpoints
├── infra/                                   # CDK infrastructure as code (TypeScript)
│   ├── src/bin/                             # CDK app entry point
│   ├── src/lib/                             # Stack definitions and configuration
│   └── test/                                # Vitest tests for CDK stacks
├── openapi/                                 # OpenAPI 3 specification files
├── openapi-spec-workflow/                   # OpenAPI versioning workspace
├── packages/
│   └── checkout-3ds-session-service/
│       ├── library/                         # 3DS session management library
│       └── infra/                           # 3DS session service CDK stacks
├── examples/                                # Example client code and test suite
└── package.json                             # NPM workspace root
```

### NPM Workspace Configuration
This project uses NPM workspaces with the following packages:
- `lambda/` - Main Lambda function code
- `infra/` - Main CDK infrastructure
- `openapi-spec-workflow/` - OpenAPI versioning
- `packages/checkout-3ds-session-service/library` - 3DS session service library
- `packages/checkout-3ds-session-service/infra` - 3DS session service infrastructure
- `examples/` - Example implementations and test suite

Always run `npm ci` from the root to install all workspace dependencies.

## Development Commands

### Installation & Setup
```bash
npm ci                             # Install all workspace dependencies
```

### Build & Test
```bash
npm run build                      # Build CDK infrastructure
npm test                           # Run Vitest tests in watch mode
npm run test:run                   # Run tests once (CI mode)

# 3DS Session Service tests
npm run test:3ds                   # Run 3DS library tests in watch mode
npm run test:3ds:run               # Run 3DS library tests once
npm run test:3ds-infra             # Run 3DS infra tests in watch mode
npm run test:3ds-infra:run         # Run 3DS infra tests once

# Build 3DS packages
npm run build:3ds-lib              # Build 3DS session library
npm run build:3ds-infra            # Build 3DS infra code

# Example client tests
npm run examples                   # Run comprehensive API test suite
npm run examples:verbose           # Run tests with verbose output
npm run examples:dev               # Run examples in dev mode (TypeScript)
npm run examples:build             # Build examples
```

### Deployment (Single Account Development)
```bash
# Preview infrastructure changes
npm run diff:single                # Diff with bypass authorizer (dev testing)
npm run diff:single:auth           # Diff with authentication enabled

# Deploy to single AWS account
npm run deploy:single              # Deploy with BYPASS_AUTHORIZER=true (dev only)
npm run deploy:single:auth         # Deploy with full authentication

# Clean up resources
npm run destroy:single             # Destroy both API and Lambda stacks
```

### Manual Deployment Scripts
```bash
./deploy-single-account.sh --profile PROFILE --environment ENV
./diff-single-account.sh --profile PROFILE --environment ENV
./destroy-single-account.sh --profile PROFILE --environment ENV
./verify-deployment.sh --profile PROFILE --environment ENV
```

Default profile: `dw-sandbox`, default environment: `dev`

**Note**: Single-account deployment scripts automatically:
1. Install dependencies with `npm ci`
2. Build the project with `npm run build`
3. Deploy LambdaStack first
4. Retrieve Lambda live alias ARN using AWS CLI
5. Deploy ApiStack with the retrieved ARN
6. All CDK commands run from `infra/` directory

## Infrastructure Configuration

### Configuration Priority
1. CDK context flags (`-c key=value`)
2. Environment variables
3. Defaults in `infra/src/lib/config.ts`

### Key Configuration Parameters
- `environment`: Deployment environment (dev, sit, uat, prod)
- `region`: AWS region (default: eu-west-1)
- `apiAccountId`: AWS account ID for API Gateway
- `serviceAccountId`: AWS account ID for Lambda functions
- `functionNamePrefix`: Prefix for Lambda function names (default: 'checkout')
- `brandKey`: Default brand for payment processing (default: 'uklait')
- `lambdaLiveAliasArn`: ARN of Lambda live alias (required for ApiStack)

### Environment Variables

**Deployment Configuration:**
- `BYPASS_AUTHORIZER=true`: Disables API Gateway authentication (dev environment only)
- `AWS_PROFILE`: AWS CLI profile to use
- `ENVIRONMENT`: Deployment environment name
- `BRAND_KEY`: Default brand key

**Lambda Runtime Environment Variables:**
- `USE_REAL_PAYMENT_PROVIDER`: Set to 'true' for real Cybersource, 'false' for mock provider
- `PAYMENT_CREDENTIALS_SECRET`: AWS Secrets Manager secret name containing payment provider credentials
- `DEFAULT_BRANDKEY`: Default brand if not specified in API path (default: 'uklait')

## CDK Stack Architecture

### LambdaStack (Account B)
Defined in [infra/src/lib/lambda-stack.ts](infra/src/lib/lambda-stack.ts):
- Creates Lambda functions with Node.js 22 runtime
- Uses `NodejsFunction` with esbuild bundling (minify enabled, target: node22)
- Lambda entry point: `lambda/src/index.ts` with exported `handler` function
- Creates `live` alias for blue-green deployments
- Configures cross-account invoke permissions for API Gateway (both base function and live alias)
- Function naming: `{functionNamePrefix}-{environment}-service-lambda`
- Timeout: 10 seconds
- Key exports: `FunctionName` and `LiveAliasArn` CloudFormation outputs

### ApiStack (Account A)
Defined in [infra/src/lib/api-stack.ts](infra/src/lib/api-stack.ts):
- Creates API Gateway REST API using OpenAPI specification via `SpecRestApi`
- Requires `lambdaLiveAliasArn` as input (from LambdaStack output)
- Processes OpenAPI spec with variable substitution:
  - `${LambdaIntegrationUri}`: Lambda ARN for integration (format: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaLiveAliasArn}/invocations`)
  - `${AWSRegion}`: AWS region
  - `${Environment}`: Environment name
- OpenAPI spec location: `openapi/openapi.yaml` (note: expects this filename)
- Supports optional authorizer bypass for development (removes security requirements and scheme definitions)
- Stage name matches environment name
- Key exports: `ApiGatewayId` and `ApiGatewayUrl` CloudFormation outputs

### Configuration System
Defined in [infra/src/lib/config.ts](infra/src/lib/config.ts):
- Centralized configuration via `getServiceConfig()` function
- Configuration priority: CDK context (`-c`) → Environment variables → Defaults
- Validates that account IDs are provided (no placeholders allowed)
- Returns `ServiceConfig` object used by both stacks

## OpenAPI Specification

OpenAPI specs use template variables that are substituted during CDK synthesis:
- **Working file**: `openapi/openapi.yaml` (expected by ApiStack)
- **Source files**: `openapi/checkout-openapi.yaml` and `openapi/checkout-openapi-unresolved.yaml`
- Template variables available:
  - `${LambdaIntegrationUri}`: Replaced with Lambda integration URI
  - `${AWSRegion}`: Replaced with deployment region
  - `${Environment}`: Replaced with environment name
- Security schemes can be bypassed in dev with `BYPASS_AUTHORIZER=true`
- The API implements OAuth 2.0 security via `GlobalAuthoriser` scheme
- Base path: `/checkout` is automatically added by AWS API Gateway base path mapping

## Testing Strategy

### Vitest Configuration
- Test framework: Vitest (fast, modern alternative to Jest)
- Test location: `infra/test/*.test.ts`
- Configuration: [infra/vitest.config.ts](infra/vitest.config.ts)
- Run tests from root: `npm test` (watch mode) or `npm run test:run` (single run)
- Run tests from infra workspace: `npm test --workspace=infra`
- Use CDK assertions library: `aws-cdk-lib/assertions`

### Example Test Pattern
```typescript
import { Template } from 'aws-cdk-lib/assertions';
const template = Template.fromStack(stack);
template.hasResourceProperties('AWS::Lambda::Function', { ... });
```

### Current Test Coverage
- Infrastructure synthesis tests in [infra/test/infra.test.ts](infra/test/infra.test.ts)
- Validates CDK stack creation and resource properties

## Git Workflow

### Branch Protection
- **Direct commits to main are blocked** via Husky pre-commit hook
- Always create feature branches: `feature/`, `bugfix/`, `hotfix/`, `chore/`
- Use pull requests for all changes to main

### Pre-commit Hook
The [.husky/pre-commit](.husky/pre-commit) hook prevents direct commits to main and provides guidance on creating feature branches. Husky is configured via the `prepare` script in the root [package.json](package.json).

## Integration with External Packages

### GitHub Packages Registry
The project is configured to integrate with `@dw-digital-commerce/payments-sdk` from GitHub Packages (currently not in use):
1. Requires `.npmrc` configuration with GitHub token (not present in repository)
2. Token must have `packages:read` permission
3. Set `GITHUB_TOKEN` environment variable before npm install/deploy
4. See [docs/docs/howto/Hoto-integrate-awslambda-with-payments-sdk.md](docs/docs/howto/Hoto-integrate-awslambda-with-payments-sdk.md) for integration details

## Deployment Workflow

### Development Workflow (Single Account)
1. **Preview changes**: `npm run diff:single`
2. **Deploy**: `npm run deploy:single`
3. **Verify**: `./verify-deployment.sh`
4. **Test**: Use API endpoint from verification output
5. **Clean up**: `npm run destroy:single`

### Multi-Account Workflow (Production)
1. Deploy LambdaStack to service account
2. Get Lambda live alias ARN
3. Deploy ApiStack to API account with ARN context
4. Use GitHub Actions for automation (see template docs)

### Authorizer Bypass (Development Only)
- Set `BYPASS_AUTHORIZER=true` to disable authentication
- Only works in `dev` environment
- Automatically removes security requirements from OpenAPI spec
- Never use in staging/production

## Important Notes

- **Node.js Version**: Project requires Node.js 22+
- **AWS CDK**: Use CDK CLI v2 (aws-cdk-lib)
- **Lambda Runtime**: nodejs22.x
- **Bundler**: esbuild (via NodejsFunction)
- **Default AWS Profile**: dw-sandbox
- **Default Region**: eu-west-1
- **Package Manager**: Always use npm (never yarn/pnpm)
- **Lock Files**: Commit package-lock.json

## Lambda Function Implementation

The Lambda function is defined in [lambda/src/index.ts](lambda/src/index.ts):
- Entry point: `handler` function (must be exported)
- Runtime: Node.js 22.x
- Bundled by esbuild during CDK deployment (no separate build step required for Lambda code)
- TypeScript compilation configured in [lambda/package.json](lambda/package.json)

### API Endpoints
The Lambda handler routes requests to specialized handlers:

**Token Capture Endpoints:**
- `POST /checkout/me/token/capture` - Authenticated user token capture (may trigger 3DS)
- `POST /checkout/in-brand/{brandkey}/token/capture` - Brand-specific token capture

**3DS Validate-Capture Endpoints (v0.5.0+):**
- `POST /checkout/me/3ds/validate-capture` - Complete payment after 3DS challenge (authenticated)
- `POST /checkout/in-brand/{brandkey}/3ds/validate-capture` - Brand-specific 3DS completion

Handlers are located in `lambda/src/handlers/`:
- `token-capture-handler.ts` - Processes initial payment capture, returns 3DS session if required
- `validate-capture-handler.ts` - Completes payment after 3DS authentication

## 3DS Session Service

The `@dw-digital-commerce/checkout-3ds-session-service` package provides session management for 3DS authentication flows.

### Architecture
Located in `packages/checkout-3ds-session-service/`:
- **library/** - Core session service with multiple provider implementations
  - `SessionService` interface with `create()`, `get()`, `invalidate()` methods
  - DynamoDB provider (`./dynamodb`) for production use with 30-minute TTL
  - Mock provider (`./mock`) for testing and development
- **infra/** - CDK stack for DynamoDB table deployment

### Key Concepts
- Sessions store payment context between token-capture (202 response) and validate-capture calls
- Session IDs (`threeDSSessionId`) are returned in 202 responses when 3DS is required
- Sessions automatically expire after 30 minutes (DynamoDB TTL)
- Sessions can only be used once (invalidated on successful validate-capture)
- Error codes: 404 (expired/not found), 409 (already used), 503 (service unavailable)

### Usage
```typescript
import { SessionService } from '@dw-digital-commerce/checkout-3ds-session-service';
import { DynamoDBSessionProvider } from '@dw-digital-commerce/checkout-3ds-session-service/dynamodb';

const provider = new DynamoDBSessionProvider(tableName);
const service = new SessionService(provider);

// Create session
const sessionId = await service.create(paymentData, ttlMinutes);

// Retrieve and invalidate
const data = await service.get(sessionId);
```

## CDK Entry Point

The CDK application entry point is [infra/src/bin/infra.ts](infra/src/bin/infra.ts):
- Instantiates CDK app and loads configuration
- Creates LambdaStack (always deployed)
- Creates ApiStack (only if `lambdaLiveAliasArn` context is provided)
- Validates required context for ApiStack deployment
- Logs configuration on startup

## Examples and Testing

### Example Client Code
The `examples/` workspace provides a comprehensive test suite for the API:
- Location: `examples/src/`
- Run with: `npm run examples` or `./test-checkout-api.sh`
- Automatically uses API Gateway URL from `.api-deployment.lock` if available
- Supports verbose mode: `npm run examples:verbose`

### Test Coverage
The test suite includes scenarios for:
- Single tokenized payment (credit card under £150, immediate completion)
- Mixed payment methods (gift voucher + credit card)
- 3DS required scenario (payment over £150 triggers 3DS authentication)
- Stateless endpoint (in-brand agent checkout)
- Error scenarios (422 validation errors, 400 bad requests)
- CORS preflight (OPTIONS request handling)

### API Deployment Lock File
After deployment, a `.api-deployment.lock` file is created containing:
- API Gateway ID
- API Gateway URL
- Deployment timestamp
- Environment

This file is used by test scripts and examples to automatically discover the API endpoint.

## Version Bumping Strategy

The project supports independent versioning for OpenAPI specs and implementation code:

```bash
# Bump OpenAPI specification only
npm run version:openapi patch|minor|major

# Bump implementation code only (root/lambda/infra workspaces)
npm run version:impl patch|minor|major

# Bump everything (all workspaces + OpenAPI spec)
npm run version:all patch|minor|major
```

**Important Notes:**
- OpenAPI spec version (in schema) can diverge from package.json versions
- `version:openapi` updates `openapi-spec-workflow/package.json` and OpenAPI schema version
- `version:impl` updates root, lambda, and infra packages (excludes openapi-spec-workflow)
- `version:all` bumps all packages with the same increment type
- See [docs/VERSION-BUMP-GUIDE.md](docs/VERSION-BUMP-GUIDE.md) for detailed usage

## Documentation Navigation

### Developer Guides (Start Here)
- **[Getting Started with Payments](docs/howto/getting-started-payments.md)** - Comprehensive guide with security best practices, complete Lambda implementation, CDK stack setup, and testing
- **[Advanced 3DS Integration](docs/howto/advanced-3ds-integration.md)** - Implementing 3D Secure authentication with stateful sessions
- **[Multi-Account Deployment](docs/howto/multi-account-deployment.md)** - AWS multi-account setup and deployment strategies
- **[Developer Guides Hub](docs/howto/README.md)** - Navigation hub for all practical guides

### Architecture Documentation
- **[3DS Stateful Design](docs/architecture/3ds-stateful-design/)** - Complete implementation documentation including:
  - Architecture decision record with industry research
  - Payment SDK integration patterns (Payment API v0.3.0)
  - Technical specification for session service
  - Implementation user story
- **[Architecture Hub](docs/architecture/README.md)** - Index of all design decisions and specifications

### Additional Resources
- **[Version Bump Guide](docs/VERSION-BUMP-GUIDE.md)** - Procedures for managing API and implementation versions
- **[Historical Documentation](docs/architecture/payment-api-alignment-v0.4.0-archive/)** - Archived v0.4.0 alignment documentation
