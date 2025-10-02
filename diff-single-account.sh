#!/bin/bash
set -e

# Usage: ./diff-single-account.sh [--profile PROFILE] [--environment ENV]
# Shows infrastructure changes before deployment

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
FUNCTION_NAME="checkout-${ENVIRONMENT}-service-lambda"
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
