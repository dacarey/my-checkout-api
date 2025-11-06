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

# Remove deployment lock file if it exists
LOCK_FILE="../.api-deployment.lock"
if [ -f "$LOCK_FILE" ]; then
  rm -f "$LOCK_FILE"
  echo "🗑️  Removed deployment lock file"
fi

echo "✅ Cleanup complete!"
