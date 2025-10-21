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
npx cdk deploy ApiStack --profile "$PROFILE" --require-approval never \
  -c lambdaLiveAliasArn="$LAMBDA_ARN" \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"

echo "✅ Deployment complete!"
