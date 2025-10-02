# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a serverless checkout API project designed for multi-account AWS deployments using AWS Lambda, API Gateway, and CDK (TypeScript). The project is in alpha stage (v0.1.0) and follows a template-based architecture for serverless microservices with blue-green deployment support.

## Key Architecture Patterns

### Multi-Account Deployment Strategy
- **API Gateway**: Lives in a shared AWS account (Account A)
- **Lambda Functions**: Run in service-specific AWS accounts (Account B)
- **Cross-Account Permissions**: Lambda functions grant invoke permissions to API Gateway via IAM
- **Blue-Green Deployments**: Supported via Lambda aliases (`live` alias) for zero-downtime updates

### Project Structure
```
my-checkout-api/
├── docs/docs/howto/              # Template documentation and integration guides
├── lambda/                        # Lambda function code (TypeScript)
├── infra/                         # CDK infrastructure as code (TypeScript)
│   ├── src/bin/                   # CDK app entry point
│   ├── src/lib/                   # Stack definitions and configuration
│   └── test/                      # Vitest tests for CDK stacks
├── openapi/                       # OpenAPI 3 specification files
└── package.json                   # NPM workspace root
```

### NPM Workspace Configuration
This project uses NPM workspaces with `lambda/` and `infra/` as workspace packages. Always run `npm ci` from the root to install all dependencies.

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
- `functionNamePrefix`: Prefix for Lambda function names
- `lambdaLiveAliasArn`: ARN of Lambda live alias (required for ApiStack)

### Environment Variables
- `BYPASS_AUTHORIZER=true`: Disables API Gateway authentication (dev environment only)
- `AWS_PROFILE`: AWS CLI profile to use
- `ENVIRONMENT`: Deployment environment name

## CDK Stack Architecture

### LambdaStack (Account B)
- Creates Lambda functions with Node.js 22 runtime
- Uses `NodejsFunction` with esbuild bundling
- Creates `live` alias for blue-green deployments
- Configures cross-account invoke permissions for API Gateway
- Function naming: `{functionNamePrefix}-{environment}-service-lambda`

### ApiStack (Account A)
- Creates API Gateway REST API using OpenAPI specification
- Processes OpenAPI spec with variable substitution:
  - `${LambdaIntegrationUri}`: Lambda ARN for integration
  - `${AWSRegion}`: AWS region
  - `${Environment}`: Environment name
- Supports optional authorizer bypass for development
- Depends on LambdaStack outputs

## OpenAPI Specification

OpenAPI specs use template variables that are substituted during CDK synthesis:
- Place OpenAPI files in `openapi/` directory
- Use `${LambdaIntegrationUri}` for Lambda integrations
- Security schemes can be bypassed in dev with `BYPASS_AUTHORIZER=true`

## Testing Strategy

### Vitest Configuration
- Test framework: Vitest (fast, modern alternative to Jest)
- Test location: `infra/test/*.test.ts`
- Configuration: `infra/vitest.config.ts`
- Use CDK assertions library: `aws-cdk-lib/assertions`

### Example Test Pattern
```typescript
import { Template } from 'aws-cdk-lib/assertions';
const template = Template.fromStack(stack);
template.hasResourceProperties('AWS::Lambda::Function', { ... });
```

## Git Workflow

### Branch Protection
- **Direct commits to main are blocked** via Husky pre-commit hook
- Always create feature branches: `feature/`, `bugfix/`, `hotfix/`, `chore/`
- Use pull requests for all changes to main

### Pre-commit Hook
The `.husky/pre-commit` hook prevents direct commits to main and provides guidance on creating feature branches.

## Integration with External Packages

### GitHub Packages Registry
The project integrates with `@dw-digital-commerce/payments-sdk` from GitHub Packages:
1. Requires `.npmrc` configuration with GitHub token
2. Token must have `packages:read` permission
3. Set `GITHUB_TOKEN` environment variable before npm install/deploy
4. See `docs/docs/howto/Hoto-integrate-awslambda-with-payments-sdk.md` for details

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

## Reference Documentation

- Multi-account template guide: `docs/docs/howto/template-multi-account-serverless-api.md`
- AWS Lambda integration: `docs/docs/howto/Hoto-integrate-awslambda-with-payments-sdk.md`
