#!/bin/bash
set -e

# Usage: ./diff-single-account.sh [OPTIONS]
#
# Options:
#   --profile PROFILE                      AWS CLI profile (default: dw-sandbox)
#   --environment ENV                      Deployment environment (default: dev)
#   --use-mock-3ds-session-service <bool>  Use mock 3DS session service (true/false)
#   --use-3ds-session-service <bool>       Use DynamoDB 3DS session service (true/false, inverted)
#
# Shows infrastructure changes before deployment

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
if [ -z "$USE_MOCK_3DS" ]; then
  if [[ "$ENVIRONMENT" == "dev" || "$ENVIRONMENT" == "sit" ]]; then
    USE_MOCK_3DS="true"
  else
    USE_MOCK_3DS="false"
  fi
fi

echo "🔍 Checking infrastructure changes for environment: $ENVIRONMENT"
echo "🔐 3DS Session Service: $([ "$USE_MOCK_3DS" = "true" ] && echo "Mock (in-memory)" || echo "DynamoDB (persistent)")"

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)

npm ci && npm run build && cd infra

# Diff Lambda stack
echo "📦 Lambda Stack Changes:"
npx cdk diff LambdaStack --profile "$PROFILE" \
  -c environment="$ENVIRONMENT" \
  -c apiAccountId="$ACCOUNT_ID" \
  -c serviceAccountId="$ACCOUNT_ID" \
  -c useMock3ds="$USE_MOCK_3DS"

# Diff API stack if Lambda exists
FUNCTION_NAME="dwaws-${ENVIRONMENT}-checkout-order-capture-lambda"
if LAMBDA_ARN=$(aws lambda list-aliases --function-name "$FUNCTION_NAME" --profile "$PROFILE" \
  --query 'Aliases[?Name==`live`].AliasArn' --output text 2>/dev/null) && [[ -n "$LAMBDA_ARN" ]]; then
  echo "🌐 API Stack Changes:"
  npx cdk diff ApiStack --profile "$PROFILE" \
    -c lambdaLiveAliasArn="$LAMBDA_ARN" \
    -c environment="$ENVIRONMENT" \
    -c apiAccountId="$ACCOUNT_ID" \
    -c serviceAccountId="$ACCOUNT_ID" \
    -c useMock3ds="$USE_MOCK_3DS"
else
  echo "⚠️  Lambda not deployed yet - deploy Lambda first to see API changes"
fi
