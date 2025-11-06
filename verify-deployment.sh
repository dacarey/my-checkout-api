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

# Check for existing lock file
LOCK_FILE=".api-deployment.lock"
if [ -f "$LOCK_FILE" ]; then
  echo "📄 Found deployment lock file"
  LOCK_API_ID=$(node -e "
    const fs = require('fs');
    try {
      const lock = JSON.parse(fs.readFileSync('$LOCK_FILE', 'utf-8'));
      console.log(lock.apiId || '');
    } catch (e) {
      console.log('');
    }
  " 2>/dev/null)

  if [ -n "$LOCK_API_ID" ]; then
    echo "   Locked API ID: $LOCK_API_ID"
  fi
fi

FUNCTION_NAME="dwaws-${ENVIRONMENT}-checkout-order-capture-lambda"

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
API_NAME="CheckoutApi-${ENVIRONMENT}"
API_ID=$(aws apigateway get-rest-apis --profile "$PROFILE" --query "items[?name=='${API_NAME}'].id" --output text)

# Fallback to generic name if environment-specific name not found
if [[ -z "$API_ID" ]]; then
  API_ID=$(aws apigateway get-rest-apis --profile "$PROFILE" --query "items[?name=='CheckoutApi'].id" --output text)
fi

if [[ -n "$API_ID" ]]; then
  echo "✅ API Gateway found: $API_ID"

  # Get region from AWS profile or use default
  REGION=$(aws configure get region --profile "$PROFILE" 2>/dev/null || echo "eu-west-1")

  API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/${ENVIRONMENT}"

  # Verify lock file is up to date or create it
  if [ -n "$LOCK_API_ID" ] && [ "$LOCK_API_ID" != "$API_ID" ]; then
    echo "⚠️  Warning: Lock file API ID ($LOCK_API_ID) doesn't match deployed API ($API_ID)"
    echo "   Updating lock file..."
  fi

  # Create/update deployment lock file
  cat > "$LOCK_FILE" <<EOF
{
  "apiId": "$API_ID",
  "region": "$REGION",
  "stage": "$ENVIRONMENT",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "lambdaFunctionName": "$FUNCTION_NAME"
}
EOF

  if [ -z "$LOCK_API_ID" ]; then
    echo "📝 Created deployment lock file: .api-deployment.lock"
  else
    echo "📝 Updated deployment lock file: .api-deployment.lock"
  fi

  echo ""
  echo "🎉 Deployment verification successful!"
  echo ""
  echo "API URL: $API_URL"
  echo "Endpoint: POST $API_URL/in-brand/{brandkey}/token/capture"
  echo ""
  echo "💡 You can now run examples with: npm run examples"
  echo "   Or test the API with: ./test-checkout-api.sh"
else
  echo "❌ API Gateway 'CheckoutApi' not found"
  exit 1
fi
