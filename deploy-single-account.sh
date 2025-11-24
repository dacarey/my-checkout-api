#!/bin/bash
set -e

# Usage: ./deploy-single-account.sh [OPTIONS]
#
# Options:
#   --profile PROFILE                      AWS CLI profile (default: dw-sandbox)
#   --environment ENV                      Deployment environment (default: dev)
#   --use-mock-3ds-session-service <bool>  Use mock 3DS session service (true/false)
#   --use-3ds-session-service <bool>       Use DynamoDB 3DS session service (true/false, inverted)
#
# Deploys both Lambda and API stacks to the same AWS account
# Supports choosing between mock (in-memory) and full (DynamoDB) 3DS session service

PROFILE=${AWS_PROFILE:-"dw-sandbox"}
ENVIRONMENT="dev"
USE_MOCK_3DS=""  # Empty means auto-detect based on environment

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --use-mock-3ds-session-service)
      # Direct flag: true = mock, false = DynamoDB
      USE_MOCK_3DS="$2"
      shift 2
      ;;
    --use-3ds-session-service)
      # Inverted flag: true = DynamoDB, false = mock
      if [ "$2" = "true" ]; then
        USE_MOCK_3DS="false"
      else
        USE_MOCK_3DS="true"
      fi
      shift 2
      ;;
    # Legacy support
    --use-mock-auth)
      echo "⚠️  Warning: --use-mock-auth is deprecated, use --use-mock-3ds-session-service instead"
      USE_MOCK_3DS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--profile PROFILE] [--environment ENV] [--use-mock-3ds-session-service true|false] [--use-3ds-session-service true|false]"
      exit 1
      ;;
  esac
done

# Auto-detect USE_MOCK_3DS if not explicitly set
# Default to true for dev/sit, false for uat/prod
if [ -z "$USE_MOCK_3DS" ]; then
  if [[ "$ENVIRONMENT" == "dev" || "$ENVIRONMENT" == "sit" ]]; then
    USE_MOCK_3DS="true"
  else
    USE_MOCK_3DS="false"
  fi
fi

echo "🚀 Deploying to single account using profile: $PROFILE"
echo "📦 Environment: $ENVIRONMENT"
echo "🔐 3DS Session Service: $([ "$USE_MOCK_3DS" = "true" ] && echo "Mock (in-memory)" || echo "DynamoDB (persistent)")"

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)

echo "🔧 Installing dependencies..."
npm ci

echo "🏗️ Building project..."
npm run build

# Conditionally deploy 3DS Session Service Infrastructure (DynamoDB)
if [ "$USE_MOCK_3DS" = "false" ]; then
  echo ""
  echo "📊 Deploying 3DS Session Service Infrastructure (DynamoDB)..."
  echo "   Table: checkout-api-${ENVIRONMENT}-3ds-sessions"

  if [ -f "packages/checkout-3ds-session-service/scripts/deploy.sh" ]; then
    bash packages/checkout-3ds-session-service/scripts/deploy.sh \
      --profile "$PROFILE" \
      --environment "$ENVIRONMENT" \
      --account-id "$ACCOUNT_ID"
  else
    echo "⚠️  Warning: 3DS session service deployment script not found"
    echo "   Skipping DynamoDB table deployment"
  fi
  echo ""
else
  echo ""
  echo "⏭️  Skipping 3DS Session Service deployment (using mock 3DS session service)"
  echo ""
fi

cd infra

echo "🚀 Deploying Lambda Stack..."
npx cdk deploy LambdaStack --profile "$PROFILE" --require-approval never \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID" \
  -c useMock3ds="$USE_MOCK_3DS"

echo "📡 Getting Lambda alias ARN..."
FUNCTION_NAME="dwaws-${ENVIRONMENT}-checkout-order-capture-lambda"

# Execute AWS CLI command and check exit code
if ! LAMBDA_ARN=$(aws lambda list-aliases --function-name "$FUNCTION_NAME" --profile "$PROFILE" \
  --query 'Aliases[?Name==`live`].AliasArn' --output text 2>&1); then
  echo "❌ ERROR: Failed to retrieve Lambda alias ARN"
  echo "AWS CLI output: $LAMBDA_ARN"
  echo "Verify that Lambda function '$FUNCTION_NAME' exists and you have permissions to access it"
  exit 1
fi

# Validate the ARN is not empty
if [ -z "$LAMBDA_ARN" ]; then
  echo "❌ ERROR: Lambda 'live' alias not found"
  echo "Function name: $FUNCTION_NAME"
  echo "Verify that:"
  echo "  1. Lambda function exists (run LambdaStack deployment first)"
  echo "  2. 'live' alias exists on the function"
  echo "  3. You have permissions to list aliases"
  exit 1
fi

echo "✅ Found Lambda alias ARN: $LAMBDA_ARN"

echo "🌐 Deploying API Stack..."
API_STACK_OUTPUT=$(npx cdk deploy ApiStack --profile "$PROFILE" --require-approval never \
  -c lambdaLiveAliasArn="$LAMBDA_ARN" \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID" \
  -c useMock3ds="$USE_MOCK_3DS" \
  --outputs-file cdk-outputs.json)

# Extract API Gateway ID from CDK outputs
if [ -f "cdk-outputs.json" ]; then
  API_ID=$(node -e "
    const fs = require('fs');
    const outputs = JSON.parse(fs.readFileSync('cdk-outputs.json', 'utf-8'));
    const apiStack = outputs['ApiStack'] || outputs['CheckoutApiStack-${ENVIRONMENT}'];
    if (apiStack && apiStack.ApiGatewayId) {
      console.log(apiStack.ApiGatewayId);
    }
  " 2>/dev/null)

  # Clean up temporary file
  rm -f cdk-outputs.json
fi

# Fallback: Try to get API ID from AWS CLI if CDK outputs didn't work
if [ -z "$API_ID" ]; then
  echo "⚠️  Could not extract API ID from CDK outputs, querying AWS API Gateway..."
  API_ID=$(aws apigateway get-rest-apis --profile "$PROFILE" \
    --query "items[?name=='CheckoutApi-${ENVIRONMENT}'].id" \
    --output text 2>/dev/null | head -1)
fi

if [ -n "$API_ID" ]; then
  echo "✅ API Gateway ID: $API_ID"

  # Get region from AWS profile or use default
  REGION=$(aws configure get region --profile "$PROFILE" 2>/dev/null || echo "eu-west-1")

  # Create deployment lock file
  LOCK_FILE="../.api-deployment.lock"
  cat > "$LOCK_FILE" <<EOF
{
  "apiId": "$API_ID",
  "region": "$REGION",
  "stage": "$ENVIRONMENT",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "lambdaFunctionName": "$FUNCTION_NAME"
}
EOF

  echo "📝 Created deployment lock file: .api-deployment.lock"
  echo "   This file contains API deployment info for use by examples and tests"
else
  echo "⚠️  Warning: Could not determine API Gateway ID"
  echo "   You may need to manually specify API_ID when running examples"
fi

echo "✅ Deployment complete!"
