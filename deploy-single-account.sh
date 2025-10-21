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
LAMBDA_ARN=$(aws lambda list-aliases --function-name "$FUNCTION_NAME" --profile "$PROFILE" \
  --query 'Aliases[?Name==`live`].AliasArn' --output text)

echo "🌐 Deploying API Stack..."
npx cdk deploy ApiStack --profile "$PROFILE" --require-approval never \
  -c lambdaLiveAliasArn="$LAMBDA_ARN" \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID"

echo "✅ Deployment complete!"
