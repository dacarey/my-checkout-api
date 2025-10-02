## Template: Multi-Account Serverless API with Blue-Green Deployments (CDK + TypeScript)

**Goal**  
Stand up a repeatable skeleton for a serverless microservice in which:

-   **API Gateway (REST)** lives in a _shared_ AWS account.
-   **Lambda** runs in a _service-specific_ AWS account.
-   Both API Gateway _and_ Lambda support blue-green (traffic-shifting) deployments.
-   IaC and code are written in TypeScript and managed with AWS CDK.
-   Deployments run via **GitHub Actions** for shared/production accounts and **CDK CLI** for developer accounts. 

----------

### 1 - Repository Layout

```
my-service/
├── .github/workflows/         # CI/CD pipelines (GitHub Actions)
├── openapi/                   # OpenAPI 3 spec files
│   └── openapi.yaml
├── lambda/                    # Lambda source (TypeScript)
│   ├── package.json
│   └── src/
│       └── index.ts
├── infra/                     # CDK IaC (TypeScript)
│   ├── cdk.json
│   ├── package.json
│   ├── vitest.config.ts       # Vitest test configuration
│   ├── src/
│   │   ├── bin/
│   │   │   └── infra.ts       # CDK app entry point
│   │   └── lib/
│   │       ├── config.ts      # Configuration management
│   │       ├── lambda-stack.ts # Account B
│   │       └── api-stack.ts   # Account A
│   └── test/
│       └── infra.test.ts      # CDK stack tests
├── package.json               # NPM workspace root configuration
├── deploy-single-account.sh   # Single account deployment script
├── destroy-single-account.sh  # Single account cleanup script
├── diff-single-account.sh     # Infrastructure change preview script
├── verify-deployment.sh       # Deployment verification script
└── test-api.sh                # API endpoint testing script

```

----------

### 2 - Initialise the Project (once)

```bash
# 1 Create repo & folders
mkdir my-service && cd my-service
mkdir openapi lambda infra

# 2 Initialize root workspace configuration
npm init -y
# Update package.json to add workspaces and set Node.js 22 requirement
cat > package.json << 'EOF'
{
  "name": "my-service",
  "version": "0.1.0",
  "description": "Multi-account serverless API using AWS CDK with TypeScript",
  "private": true,
  "engines": {
    "node": ">=22.0.0"
  },
  "workspaces": [
    "lambda",
    "infra"
  ],
  "scripts": {
    "build": "npm run build --workspace=infra",
    "test": "npm run test --workspace=infra",
    "deploy:single": "BYPASS_AUTHORIZER=true ./deploy-single-account.sh",
    "deploy:single:auth": "./deploy-single-account.sh",
    "diff:single": "BYPASS_AUTHORIZER=true ./diff-single-account.sh",
    "diff:single:auth": "./diff-single-account.sh",
    "destroy:single": "./destroy-single-account.sh"
  }
}
EOF

# 3 Initialise the Lambda package
cd lambda
npm init -y                       # always use npm
npm install -D typescript @types/node    # runtime already has AWS SDK v3

# 4 Initialise the CDK app
cd ../infra
npx cdk init app --language typescript

# 5 Install CDK constructs and testing framework
npm install aws-cdk-lib constructs
npm install -D esbuild vitest      # esbuild for bundling, vitest for testing

# 6 Install dependencies using workspace (from root)
cd ..
npm ci                           # installs all workspace dependencies

```

----------

### 3 - Write the Lambda Handler

`lambda/src/index.ts`

```ts
export const handler = async (event: any) => {
  return { statusCode: 200, body: JSON.stringify({ message: 'hello' }) };
};

```

----------

### 4 - Define the **Lambda Stack**  (Account B)

`infra/src/lib/lambda-stack.ts`

```ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

// Configuration interface (define in config.ts)
export interface ServiceConfig {
  environment: string;
  region: string;
  apiAccountId: string;
  serviceAccountId: string;
  functionNamePrefix?: string;
}

export interface LambdaStackProps extends StackProps {
  config: ServiceConfig;
}

export class LambdaStack extends Stack {
  public readonly liveAlias: lambda.Alias;
  public readonly serviceFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.serviceAccountId, region: props.config.region }
    });

    // Generate function name based on configuration
    const functionName = `${props.config.functionNamePrefix || 'my'}-${props.config.environment}-service-lambda`;

    const fn = new NodejsFunction(this, 'ServiceLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,         // Node.js 22
      entry: '../lambda/src/index.ts',
      handler: 'handler',
      functionName: functionName,                   // configurable name
      timeout: Duration.seconds(10),
      bundling: { 
        minify: true, 
        target: 'node22',
        // Exclude optional dependencies that cause bundling issues
        externalModules: []
      }
    });

    this.serviceFunction = fn;

    const version = fn.currentVersion;
    this.liveAlias = new lambda.Alias(this, 'LiveAlias', {
      aliasName: 'live',
      version
    });

    // Add cross-account API Gateway invoke permissions
    const sourceArn = `arn:aws:execute-api:${props.config.region}:${props.config.apiAccountId}:*/*/*`;
    
    // Permission for base function (backwards compatibility)
    this.serviceFunction.addPermission('ApiGatewayInvokePermissionBase', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceAccount: props.config.apiAccountId,
      action: 'lambda:InvokeFunction',
      sourceArn: sourceArn
    });

    // Permission for live alias (blue-green deployments)
    this.liveAlias.addPermission('ApiGatewayInvokePermission', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceAccount: props.config.apiAccountId,
      action: 'lambda:InvokeFunction',
      sourceArn: sourceArn
    });
  }
}

```

----------

### 5 - Define the **API Gateway Stack** (Account A)

`infra/src/lib/api-stack.ts`

```ts
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ApiStackProps extends StackProps {
  lambdaLiveAliasArn: string;   // ARN from Lambda stack (same or cross-account)
  config: ServiceConfig;        // Configuration object
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.apiAccountId, region: props.config.region }
    });

    // 1. Import the live alias
    const importedFn = lambda.Function.fromFunctionArn(
      this, 'ImportedLiveAlias', props.lambdaLiveAliasArn
    );

    // 2. Process OpenAPI spec with variable substitution
    const openApiSpecPath = path.join(__dirname, '../../../openapi/openapi.yaml');
    let openApiSpec = fs.readFileSync(openApiSpecPath, 'utf8');
    
    // Replace Lambda integration URI with actual ARN
    const lambdaIntegrationUri = `arn:aws:apigateway:${props.config.region}:lambda:path/2015-03-31/functions/${props.lambdaLiveAliasArn}/invocations`;
    
    // Replace template variables in OpenAPI spec
    openApiSpec = openApiSpec.replace(/\$\{LambdaIntegrationUri\}/g, lambdaIntegrationUri);
    openApiSpec = openApiSpec.replace(/\$\{AWSRegion\}/g, props.config.region);
    openApiSpec = openApiSpec.replace(/\$\{Environment\}/g, props.config.environment);
    
    // Optional: Development-only authorizer bypass
    const isDevelopment = props.config.environment === 'dev';
    const bypassAuthorizer = process.env.BYPASS_AUTHORIZER === 'true' && isDevelopment;
    
    if (bypassAuthorizer) {
      console.warn('🔓 BYPASS_AUTHORIZER enabled - removing security requirements (dev only)');
      // Remove security requirements from POST endpoints
      openApiSpec = openApiSpec.replace(/security:\s*-\s*GlobalAuthoriser:\s*\[\]/g, '');
    }

    // Parse processed YAML into JavaScript object
    const openApiObject = yaml.load(openApiSpec) as any;
    
    // 3. Create API with processed spec
    const api = new apigw.SpecRestApi(this, 'MyServiceApi', {
      apiDefinition: apigw.ApiDefinition.fromInline(openApiObject),
      endpointTypes: [apigw.EndpointType.REGIONAL],
      deployOptions: { stageName: props.config.environment }
    });

    // 4. Add CloudFormation outputs
    new cdk.CfnOutput(this, 'ApiGatewayId', {
      value: api.restApiId,
      description: 'API Gateway REST API ID'
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL'
    });

    // Note: Lambda permissions are handled in the Lambda stack
    console.log('✅ Lambda permissions handled in Lambda stack');
  }
}
```

#### OpenAPI Spec Template Structure

Your `openapi/openapi.yaml` should use template variables for flexibility:

```yaml
openapi: 3.0.3
info:
  title: My Service API
  version: 0.1.0
paths:
  /service/action:
    post:
      security:
        - GlobalAuthoriser: []  # Removed in bypass mode
      x-amazon-apigateway-integration:
        uri: ${LambdaIntegrationUri}
        type: aws_proxy
        httpMethod: POST
      responses:
        '200':
          description: Success
components:
  securitySchemes:
    GlobalAuthoriser:
      type: apiKey
      name: Authorization
      in: header
      x-amazon-apigateway-authorizer:
        type: request
        uri: arn:aws:apigateway:${AWSRegion}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWSRegion}:AUTHORIZER_ACCOUNT:function:authorizer-lambda/invocations
```

----------

### 6 - Configuration Management System

Create a centralized configuration system to manage multi-environment deployments.

`infra/src/lib/config.ts`

```ts
import * as cdk from 'aws-cdk-lib';

export interface ServiceConfig {
  /** AWS region for deployment */
  region: string;
  /** Environment name (dev, sit, uat, prod) */
  environment: string;
  /** API Gateway stage name */
  stageName: string;
  /** Account ID for API Gateway deployment */
  apiAccountId: string;
  /** Account ID for Lambda deployment */
  serviceAccountId: string;
  /** Function name prefix for resource naming */
  functionNamePrefix: string;
}

export function getServiceConfig(app: cdk.App): ServiceConfig {
  // Configuration priority: CDK context -> Environment variables -> Defaults
  const config: ServiceConfig = {
    region: app.node.tryGetContext('region') || process.env.AWS_REGION || 'eu-west-1',
    environment: app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev',
    stageName: app.node.tryGetContext('stageName') || process.env.STAGE_NAME || 
               app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev',
    apiAccountId: app.node.tryGetContext('apiAccountId') || process.env.API_ACCOUNT_ID || 
                  process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT_PLACEHOLDER',
    serviceAccountId: app.node.tryGetContext('serviceAccountId') || process.env.SERVICE_ACCOUNT_ID || 
                     process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT_PLACEHOLDER',
    functionNamePrefix: app.node.tryGetContext('functionNamePrefix') || process.env.FUNCTION_NAME_PREFIX || 'my'
  };

  // Validation
  if (config.apiAccountId === 'ACCOUNT_PLACEHOLDER' || config.serviceAccountId === 'ACCOUNT_PLACEHOLDER') {
    throw new Error('Account IDs must be provided via CDK context or environment variables');
  }

  return config;
}
```

----------

### 7 - CDK App Entry Point

Update your CDK app to use the configuration system.

`infra/src/bin/infra.ts`

```ts
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LambdaStack } from '../lib/lambda-stack';
import { ApiStack } from '../lib/api-stack';
import { getServiceConfig } from '../lib/config';

const app = new cdk.App();

// Get centralized configuration
const config = getServiceConfig(app);

// Display current configuration
console.log('🔧 Configuration:');
console.log(`   Environment: ${config.environment}`);
console.log(`   Region: ${config.region}`);
console.log(`   API Account: ${config.apiAccountId}`);
console.log(`   Service Account: ${config.serviceAccountId}`);
console.log('');

const lambdaLiveAliasArn = app.node.tryGetContext('lambdaLiveAliasArn') as string;

// Validation for ApiStack deployment
if (!lambdaLiveAliasArn && process.env.STACK === 'ApiStack') {
  throw new Error('Pass -c lambdaLiveAliasArn=<ARN> when deploying ApiStack');
}

// Deploy Lambda stack
const lambdaStack = new LambdaStack(app, 'LambdaStack', {
  config,
  env: { account: config.serviceAccountId, region: config.region }
});

// Deploy API stack (only if context is provided)
if (lambdaLiveAliasArn) {
  new ApiStack(app, 'ApiStack', { 
    lambdaLiveAliasArn, 
    config,
    env: { account: config.apiAccountId, region: config.region }
  });
}
```

----------

### 8 - Deployment Wrapper Scripts

Create shell scripts to simplify development workflows and ensure consistent deployments.

#### `deploy-single-account.sh` - Automated Single Account Deployment

```bash
#!/bin/bash
set -e

# Usage: ./deploy-single-account.sh [--profile PROFILE] [--environment ENV]
# Deploys both Lambda and API stacks to the same AWS account
# Supports --profile for AWS profile and --environment for deployment environment

PROFILE=${AWS_PROFILE:-"dw-sandbox"}
ENVIRONMENT="dev"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2"; shift 2;;
    --environment) ENVIRONMENT="$2"; shift 2;;
    *) echo "Unknown option $1"; exit 1;;
  esac
done

echo "🚀 Deploying to single account using profile: $PROFILE"
echo "📦 Environment: $ENVIRONMENT"

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)

echo "🔧 Installing dependencies..."
npm ci

echo "🏗️ Building project..."
npm run build

cd infra

echo "🚀 Deploying Lambda Stack..."
npx cdk deploy LambdaStack --profile "$PROFILE" --require-approval never \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"

echo "📡 Getting Lambda alias ARN..."
FUNCTION_NAME="my-${ENVIRONMENT}-service-lambda"
LAMBDA_ARN=$(aws lambda list-aliases --function-name "$FUNCTION_NAME" --profile "$PROFILE" \
  --query 'Aliases[?Name==`live`].AliasArn' --output text)

echo "🌐 Deploying API Stack..."
npx cdk deploy ApiStack --profile "$PROFILE" --require-approval never \
  -c lambdaLiveAliasArn="$LAMBDA_ARN" \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"

echo "✅ Deployment complete!"
```

#### `diff-single-account.sh` - Infrastructure Change Preview

```bash
#!/bin/bash
set -e

# Usage: ./diff-single-account.sh [--profile PROFILE] [--environment ENV]
# Shows infrastructure changes before deployment

PROFILE=${AWS_PROFILE:-"dw-sandbox"}
ENVIRONMENT="dev"

# Parse arguments (same pattern as deploy script)
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2"; shift 2;;
    --environment) ENVIRONMENT="$2"; shift 2;;
    *) echo "Unknown option $1"; exit 1;;
  esac
done

echo "🔍 Checking infrastructure changes for environment: $ENVIRONMENT"

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)

npm ci && npm run build && cd infra

# Diff Lambda stack
echo "📦 Lambda Stack Changes:"
npx cdk diff LambdaStack --profile "$PROFILE" \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"

# Diff API stack if Lambda exists
FUNCTION_NAME="my-${ENVIRONMENT}-service-lambda"
if LAMBDA_ARN=$(aws lambda list-aliases --function-name "$FUNCTION_NAME" --profile "$PROFILE" \
  --query 'Aliases[?Name==`live`].AliasArn' --output text 2>/dev/null) && [[ -n "$LAMBDA_ARN" ]]; then
  echo "🌐 API Stack Changes:"
  npx cdk diff ApiStack --profile "$PROFILE" \
    -c lambdaLiveAliasArn="$LAMBDA_ARN" \
    -c environment="$ENVIRONMENT" \
    -c apiAccountId="$ACCOUNT_ID" \
    -c serviceAccountId="$ACCOUNT_ID"
else
  echo "⚠️  Lambda not deployed yet - deploy Lambda first to see API changes"
fi
```

#### `destroy-single-account.sh` - Infrastructure Cleanup

```bash
#!/bin/bash
set -e

# Usage: ./destroy-single-account.sh [--profile PROFILE] [--environment ENV]
# Destroys both API and Lambda stacks

PROFILE=${AWS_PROFILE:-"dw-sandbox"}
ENVIRONMENT="dev"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2"; shift 2;;
    --environment) ENVIRONMENT="$2"; shift 2;;
    *) echo "Unknown option $1"; exit 1;;
  esac
done

echo "🗑️ Destroying infrastructure for environment: $ENVIRONMENT"

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
cd infra

# Destroy API stack first (depends on Lambda)
echo "🌐 Destroying API Stack..."
npx cdk destroy ApiStack --profile "$PROFILE" --force \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID" || true

echo "📦 Destroying Lambda Stack..."
npx cdk destroy LambdaStack --profile "$PROFILE" --force \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"

echo "✅ Cleanup complete!"
```

#### `verify-deployment.sh` - Deployment Verification

## Script Specification: verify-deployment.sh

**Purpose**: Verify AWS deployment by checking Lambda function, alias, and API Gateway existence

**Requirements**:
- Bash script with executable permissions (`chmod +x`)
- Accept optional `--profile` and `--environment` flags
- Default profile: `dw-sandbox`, default environment: `dev`
- Exit with error code 1 if any check fails

**Functionality**:
1. Parse command line arguments (--profile, --environment)
2. Check Lambda function exists: `my-${ENVIRONMENT}-service-lambda`
3. Check Lambda alias `live` exists for that function
4. Find API Gateway named `MyServiceApi` and extract its ID
5. Display API URL: `https://${API_ID}.execute-api.eu-west-1.amazonaws.com/${ENVIRONMENT}`
6. Print success/failure messages with emojis (✅/❌)

**AWS CLI Commands**:
- `aws lambda get-function --function-name <name> --profile <profile>`
- `aws lambda get-alias --function-name <name> --name live --profile <profile>`
- `aws apigateway get-rest-apis --profile <profile> --query 'items[?name==\`MyServiceApi\`].id' --output text`

**Error Handling**: Exit immediately on any failure (`set -e`), suppress command output except for script messages

----------

### 9 – Development Workflow

The recommended workflow uses NPM scripts and wrapper scripts for consistent, automated deployments.

#### Quick Start Development Workflow

```bash
# 1. Install dependencies (one-time setup)
npm ci

# 2. Preview changes before deploying (recommended)
npm run diff:single             # With bypass authorizer (dev testing)
npm run diff:single:auth        # With authentication enabled

# 3. Deploy to development environment
npm run deploy:single           # With bypass authorizer for testing
npm run deploy:single:auth      # With authentication enabled

# 4. Clean up when done
npm run destroy:single
```

#### NPM Scripts Reference

The root `package.json` provides convenient commands:

```json
{
  "scripts": {
    "build": "npm run build --workspace=infra",
    "test": "npm run test --workspace=infra",
    "deploy:single": "BYPASS_AUTHORIZER=true ./deploy-single-account.sh",
    "deploy:single:auth": "./deploy-single-account.sh",
    "diff:single": "BYPASS_AUTHORIZER=true ./diff-single-account.sh",
    "diff:single:auth": "./diff-single-account.sh",
    "destroy:single": "./destroy-single-account.sh"
  }
}
```

#### Best Practices

1. **Always diff before deploy**: Use `npm run diff:single` to review changes
2. **Use bypass mode for development**: `npm run deploy:single` disables auth for easier testing
3. **Use auth mode for staging/production**: `npm run deploy:single:auth` enables full security
4. **Verify deployments**: Use `./verify-deployment.sh` after deployment
5. **Clean up regularly**: Use `npm run destroy:single` to avoid cost accumulation

#### Manual CDK CLI (Advanced)

For direct CDK control, use the wrapper scripts or manual commands:

```bash
# Using wrapper scripts (recommended)
./deploy-single-account.sh --profile my-profile --environment dev
./diff-single-account.sh --profile my-profile --environment dev

# Direct CDK commands (advanced users)
cd infra
npm ci && npm run build

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile my-profile --query Account --output text)

# Deploy Lambda stack
npx cdk deploy LambdaStack --profile my-profile \
  -c environment=dev \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"

# Get Lambda ARN and deploy API stack
LAMBDA_ARN=$(aws lambda list-aliases --function-name my-dev-service-lambda \
  --profile my-profile --query 'Aliases[?Name==`live`].AliasArn' --output text)

npx cdk deploy ApiStack --profile my-profile \
  -c lambdaLiveAliasArn="$LAMBDA_ARN" \
  -c environment=dev \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"
```


----------

### 10 - Testing with Vitest

The project uses Vitest for fast, modern testing of your CDK infrastructure.

#### Test Configuration

`infra/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
  },
});
```

#### Example CDK Stack Test

`infra/test/infra.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LambdaStack } from '../src/lib/lambda-stack';

describe('LambdaStack', () => {
  it('creates Lambda function with correct runtime', () => {
    const app = new cdk.App();
    
    const config = {
      environment: 'test',
      region: 'eu-west-1',
      apiAccountId: '123456789012',
      serviceAccountId: '123456789012',
      functionNamePrefix: 'test'
    };

    const stack = new LambdaStack(app, 'TestStack', { config });
    const template = Template.fromStack(stack);

    // Assert Lambda function exists with Node.js 22 runtime
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      FunctionName: 'test-test-service-lambda'
    });

    // Assert Lambda alias exists
    template.hasResourceProperties('AWS::Lambda::Alias', {
      Name: 'live'
    });
  });
});
```

#### Running Tests

```bash
# From root directory
npm test                # Run tests in watch mode
npm run test:run        # Run tests once (for CI)

# From infra directory
cd infra
npm test               # Run tests in watch mode
npm run test:run       # Run tests once
```

----------

### 11 - GitHub Actions Pipeline (prod / integration)

`.github/workflows/deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Use Node.js 22
      uses: actions/setup-node@v4
      with:
        node-version: '22'

    - name: Install dependencies
      run: npm ci

    - name: Run tests
      run: npm run test:run

    - name: Build
      run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Use Node.js 22
      uses: actions/setup-node@v4
      with:
        node-version: '22'

    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v3
      with:
        role-to-assume: ${{ secrets.CROSS_ACCOUNT_ROLE_ARN }}
        aws-region: eu-west-1

    - name: Install dependencies
      run: npm ci

    - name: Build
      run: npm run build

    - name: Deploy Lambda Stack
      run: |
        cd infra
        npx cdk deploy LambdaStack --require-approval never \
          -c environment=prod \
          -c apiAccountId=${{ secrets.API_ACCOUNT_ID }} \
          -c serviceAccountId=${{ secrets.SERVICE_ACCOUNT_ID }}

    - name: Deploy API Stack
      run: |
        cd infra
        LAMBDA_ARN=$(aws lambda get-alias \
          --function-name my-prod-service-lambda \
          --name live --region eu-west-1 \
          --query 'AliasArn' --output text)
        
        npx cdk deploy ApiStack --require-approval never \
          -c lambdaLiveAliasArn="$LAMBDA_ARN" \
          -c environment=prod \
          -c apiAccountId=${{ secrets.API_ACCOUNT_ID }} \
          -c serviceAccountId=${{ secrets.SERVICE_ACCOUNT_ID }}

    - name: Verify deployment
      run: |
        ./verify-deployment.sh \
          --profile default \
          --environment prod

```


----------

### 12 - Blue-Green Rollback Hooks (Optional)

-   Attach CloudWatch alarms (e.g. `5XX` error alarm) to the `LambdaDeploymentGroup`.
    
-   Use API Gateway **stages** (`v1`, `v2`) if you also need blue-green at the REST API level—even though Lambda alias shifting already prevents downtime.
-   Consider implementing automatic rollback triggers based on error rates or latency thresholds.
-   The `live` alias supports gradual traffic shifting for safe deployments.
    

----------

### 13 - Summary Checklist

✔︎

Item

 

**Bootstrap already done** on all accounts (`cdk bootstrap` not required here).

 

**npm** used for all installs; commit `package-lock.json`.

 

**cdk init** executed in `infra/` to scaffold IaC project.

 

Directory layout keeps **OpenAPI**, **Lambda code**, and **IaC** in clearly separated folders.

 

**NodejsFunction** bundles Lambda with esbuild.

 

**CodeDeploy LambdaDeploymentGroup** handles blue-green traffic shifts.

 

**Cross-account invoke permission** added via `addPermission`.

 

**GitHub Actions** assumes cross-account roles; developers use CDK CLI locally.

**Updated Comprehensive Checklist:**

✅ **NPM Workspace Structure**
- Root `package.json` with workspaces configuration
- Unified npm scripts for build, test, and deployment
- Node.js 22 engine requirement specified

✅ **Deployment Automation**
- Wrapper scripts for consistent deployments (`deploy-single-account.sh`, etc.)
- Infrastructure change preview with `diff-single-account.sh`)
- Deployment verification with `verify-deployment.sh`
- NPM scripts for common development workflows

✅ **Configuration Management**
- Centralized configuration system in `config.ts`
- Support for CDK context, environment variables, and defaults
- Multi-environment and cross-account flexibility
- Validation and error handling

✅ **Infrastructure as Code**
- **cdk init** executed in `infra/` to scaffold IaC project
- **NodejsFunction** bundles Lambda with esbuild and Node.js 22
- **Lambda aliases** for blue-green deployments with `live` alias
- **Cross-account invoke permissions** configured automatically
- **OpenAPI variable substitution** for flexible API definitions

✅ **Testing & Quality**
- **Vitest** for modern, fast testing framework
- CDK stack testing with assertions
- Integration with CI/CD pipeline

✅ **Development Experience**
- **Directory separation**: OpenAPI, Lambda code, and IaC in clear folders
- **Authorizer bypass** mode for development testing (dev environment only)
- **Diff-before-deploy** workflow for safe infrastructure changes
- **GitHub Actions** with test and deploy jobs

✅ **Package Management**
- **npm** used for all installs; commit `package-lock.json`
- Workspace dependency coordination
- Proper external module handling for bundling

Use this template as a starting point for new microservices—you'll only need to adjust:
- Service names and resource prefixes
- Account IDs and AWS profiles
- OpenAPI specification for your specific API
- Lambda handler implementation for your business logic
- CI role ARNs and GitHub secrets for your organization
