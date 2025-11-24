# 3DS Authentication Deployment Modes

This guide explains how to deploy the Checkout API with different 3DS authentication service modes: Mock (in-memory) and Full (DynamoDB-backed).

## Overview

The Checkout API supports two 3DS authentication modes:

1. **Mock Mode** - Uses in-memory session storage (MockAuthenticationService)
   - Best for: Development, testing, CI/CD pipelines
   - Benefits: No infrastructure dependencies, faster deployment, simpler setup
   - Limitations: Sessions don't persist across Lambda cold starts

2. **Full Mode** - Uses DynamoDB for persistent session storage
   - Best for: UAT, Production, persistent testing
   - Benefits: Sessions persist across Lambda invocations, production-ready
   - Requirements: DynamoDB table must be deployed first

## Quick Start

### Deploy with Mock Authentication (Default for dev/sit)

```bash
# Using npm scripts (recommended)
npm run deploy:single              # Mock mode with bypass authorizer
npm run deploy:single:auth         # Mock mode with authentication

# Using deployment script directly
./deploy-single-account.sh --use-mock-auth true
```

### Deploy with Full 3DS Authentication (Default for uat/prod)

```bash
# Using npm scripts (recommended)
npm run deploy:single:full-3ds              # Full mode with bypass authorizer
npm run deploy:single:full-3ds:auth         # Full mode with authentication

# Using deployment script directly
./deploy-single-account.sh --use-mock-auth false
```

## Detailed Deployment Options

### Command-Line Flags

All deployment scripts support the following flags:

```bash
./deploy-single-account.sh [OPTIONS]

Options:
  --profile PROFILE          AWS CLI profile name (default: dw-sandbox)
  --environment ENV          Deployment environment (default: dev)
  --use-mock-auth true|false 3DS authentication mode (auto-detected if not specified)

Examples:
  # Deploy to dev with mock auth (explicit)
  ./deploy-single-account.sh --environment dev --use-mock-auth true

  # Deploy to uat with full 3DS (explicit)
  ./deploy-single-account.sh --environment uat --use-mock-auth false

  # Deploy to prod (auto-detects full mode)
  ./deploy-single-account.sh --environment prod --profile prod-profile
```

### Auto-Detection Rules

If `--use-mock-auth` is not specified, the mode is auto-detected based on environment:

| Environment | Default Mode | Reason |
|-------------|--------------|--------|
| `dev`       | Mock         | Fast development iteration |
| `sit`       | Mock         | System integration testing without infrastructure overhead |
| `uat`       | Full         | User acceptance testing with production-like setup |
| `prod`      | Full         | Production deployment requires persistent sessions |

## What Happens During Deployment

### Mock Mode Deployment

1. Install dependencies (`npm ci`)
2. Build CDK infrastructure (`npm run build`)
3. **Skip** 3DS Session Service infrastructure deployment
4. Deploy Lambda with `USE_MOCK_AUTH=true`
5. Deploy API Gateway

**Environment Variables Set:**
- `USE_MOCK_AUTH=true`
- `AUTH_SESSION_TABLE_NAME=checkout-api-{env}-3ds-sessions` (configured but not used)

### Full Mode Deployment

1. Install dependencies (`npm ci`)
2. Build CDK infrastructure (`npm run build`)
3. **Deploy 3DS Session Service infrastructure** (DynamoDB table)
   - Table name: `checkout-api-{env}-3ds-sessions`
   - TTL enabled (30 minutes)
   - On-demand billing
   - CloudWatch alarms
4. Deploy Lambda with `USE_MOCK_AUTH=false`
   - IAM permissions for DynamoDB access automatically configured
5. Deploy API Gateway

**Environment Variables Set:**
- `USE_MOCK_AUTH=false`
- `AUTH_SESSION_TABLE_NAME=checkout-api-{env}-3ds-sessions`

## Diff Before Deployment

Check what will change before deploying:

```bash
# Mock mode
npm run diff:single

# Full mode
./diff-single-account.sh --use-mock-auth false

# With specific environment
./diff-single-account.sh --environment uat --use-mock-auth false
```

## NPM Scripts Reference

| Script | Mode | Authorizer | Description |
|--------|------|------------|-------------|
| `npm run deploy:single` | Mock | Bypass | Fast dev deployment with mock auth |
| `npm run deploy:single:auth` | Mock | Enabled | Mock auth with API authentication |
| `npm run deploy:single:full-3ds` | Full | Bypass | Full 3DS with bypass authorizer |
| `npm run deploy:single:full-3ds:auth` | Full | Enabled | Full 3DS with authentication |
| `npm run diff:single` | Mock | Bypass | Preview mock mode changes |
| `npm run diff:single:auth` | Mock | Enabled | Preview mock mode with auth |

## Switching Between Modes

To switch from Mock to Full mode (or vice versa):

1. Run a diff to see what will change:
   ```bash
   ./diff-single-account.sh --use-mock-auth false
   ```

2. Deploy with the new mode:
   ```bash
   ./deploy-single-account.sh --use-mock-auth false
   ```

3. The Lambda environment variable `USE_MOCK_AUTH` will be updated automatically

**Note:** Switching modes doesn't destroy the DynamoDB table if it exists. To remove the table, use the destroy script in the 3DS session service package.

## Verifying Deployment Mode

After deployment, verify which mode is active:

```bash
# Check Lambda environment variables
aws lambda get-function-configuration \
  --function-name dwaws-{env}-checkout-order-capture-lambda \
  --query 'Environment.Variables.USE_MOCK_AUTH'

# Should return: "true" (Mock) or "false" (Full)
```

You can also check the deployment output:
```
🔐 Authentication Mode: Mock (in-memory)
```
or
```
🔐 Authentication Mode: DynamoDB (persistent)
```

## Testing 3DS Flows

### Testing Mock Mode

```bash
# Deploy in mock mode
npm run deploy:single

# Run API tests
npm run examples

# The 3DS flow will use in-memory sessions
# Sessions are lost on Lambda cold starts
```

### Testing Full Mode

```bash
# Deploy in full mode
npm run deploy:single:full-3ds

# Run API tests
npm run examples

# The 3DS flow will use DynamoDB sessions
# Sessions persist across Lambda invocations
# Sessions auto-expire after 30 minutes (TTL)
```

## Troubleshooting

### DynamoDB Table Not Found

**Error:** `Requested resource not found: Table: checkout-api-dev-3ds-sessions not found`

**Cause:** Deployed with `--use-mock-auth false` but DynamoDB table doesn't exist

**Solution:**
```bash
# Option 1: Deploy the 3DS infrastructure manually
cd packages/checkout-3ds-session-service/scripts
./deploy.sh --environment dev --profile dw-sandbox

# Option 2: Re-deploy with --use-mock-auth false (will auto-deploy table)
./deploy-single-account.sh --use-mock-auth false
```

### Mock Mode Not Working

**Error:** Lambda tries to connect to DynamoDB even though `USE_MOCK_AUTH=true`

**Cause:** Cached Lambda container or environment variable not updated

**Solution:**
```bash
# Force Lambda update by changing environment variable
aws lambda update-function-configuration \
  --function-name dwaws-{env}-checkout-order-capture-lambda \
  --environment Variables={USE_MOCK_AUTH=true,...}

# Or redeploy
./deploy-single-account.sh --use-mock-auth true
```

### Permission Denied for DynamoDB

**Error:** Lambda gets access denied when writing to DynamoDB

**Cause:** IAM permissions not properly configured

**Solution:** IAM permissions are automatically added by CDK. Check the Lambda execution role:
```bash
aws iam get-role-policy \
  --role-name LambdaStack-ServiceLambdaServiceRole... \
  --policy-name LambdaStack-ServiceLambdaServiceRoleDefaultPolicy...
```

The policy should include `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:DeleteItem` for the table.

## Architecture Details

### Mock Mode Architecture

```
API Gateway
    ↓
Lambda Function (Node.js 22)
    ↓
MockAuthenticationService (in-memory Map)
    └─ Sessions stored in Lambda container memory
    └─ Lost on cold start
```

### Full Mode Architecture

```
API Gateway
    ↓
Lambda Function (Node.js 22)
    ↓
DynamoDBAuthenticationService
    ↓
DynamoDB Table
    └─ checkout-api-{env}-3ds-sessions
    └─ TTL: 30 minutes
    └─ On-demand billing
```

## Best Practices

1. **Development**: Use mock mode for fast iteration
   ```bash
   npm run deploy:single
   ```

2. **CI/CD**: Use mock mode to avoid infrastructure dependencies
   ```bash
   ./deploy-single-account.sh --environment sit --use-mock-auth true
   ```

3. **UAT/Production**: Always use full mode
   ```bash
   ./deploy-single-account.sh --environment uat --use-mock-auth false
   ./deploy-single-account.sh --environment prod --use-mock-auth false
   ```

4. **Testing**: Test both modes before production deployment
   ```bash
   # Test mock mode
   npm run deploy:single && npm run examples

   # Test full mode
   npm run deploy:single:full-3ds && npm run examples
   ```

5. **Diff First**: Always check what will change before deploying
   ```bash
   npm run diff:single          # Mock mode
   npm run diff:single:auth     # Mock mode with auth
   ```

## Related Documentation

- [Getting Started with Payments](./getting-started-payments.md) - Complete payment integration guide
- [Advanced 3DS Integration](./advanced-3ds-integration.md) - Deep dive into 3DS implementation
- [Multi-Account Deployment](./multi-account-deployment.md) - Production deployment strategies
- [3DS Session Service README](../../packages/checkout-3ds-session-service/README.md) - Session service architecture

## CDK Context Reference

The `useMockAuth` configuration is passed to CDK via context:

```bash
npx cdk deploy LambdaStack \
  -c useMockAuth=true \
  -c environment=dev \
  -c apiAccountId=123456789012 \
  -c serviceAccountId=123456789012
```

This is automatically handled by the deployment scripts, but can be used for manual CDK commands.
