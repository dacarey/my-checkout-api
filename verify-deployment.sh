#!/bin/bash
set -e

# Usage: ./verify-deployment.sh [--profile PROFILE] [--environment ENV]
# Verify AWS deployment by checking Lambda function, alias, and API Gateway

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

echo "🔍 Verifying deployment for environment: $ENVIRONMENT"
echo ""

FUNCTION_NAME="checkout-${ENVIRONMENT}-service-lambda"

# Check Lambda function exists
echo "📦 Checking Lambda function..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --profile "$PROFILE" &>/dev/null; then
  echo "✅ Lambda function exists: $FUNCTION_NAME"
else
  echo "❌ Lambda function not found: $FUNCTION_NAME"
  exit 1
fi

# Check Lambda alias exists
echo "📡 Checking Lambda alias 'live'..."
if aws lambda get-alias --function-name "$FUNCTION_NAME" --name live --profile "$PROFILE" &>/dev/null; then
  echo "✅ Lambda alias 'live' exists"
else
  echo "❌ Lambda alias 'live' not found"
  exit 1
fi

# Find API Gateway
echo "🌐 Checking API Gateway..."
API_ID=$(aws apigateway get-rest-apis --profile "$PROFILE" --query 'items[?name==`CheckoutApi`].id' --output text)

if [[ -n "$API_ID" ]]; then
  echo "✅ API Gateway found: $API_ID"
  API_URL="https://${API_ID}.execute-api.eu-west-1.amazonaws.com/${ENVIRONMENT}"
  echo ""
  echo "🎉 Deployment verification successful!"
  echo ""
  echo "API URL: $API_URL"
  echo "Endpoint: POST $API_URL/checkout/process"
else
  echo "❌ API Gateway 'CheckoutApi' not found"
  exit 1
fi
