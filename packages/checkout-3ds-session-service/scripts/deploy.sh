#!/bin/bash

# Deploy Authentication Session Infrastructure
# This script deploys the DynamoDB table and related resources

set -e

# Default values
PROFILE="dw-sandbox"
ENVIRONMENT="dev"
REGION="eu-west-1"

# Parse command line arguments
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
    --region)
      REGION="$2"
      shift 2
      ;;
    --account-id)
      ACCOUNT_ID="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--profile PROFILE] [--environment ENVIRONMENT] [--region REGION] [--account-id ACCOUNT_ID]"
      exit 1
      ;;
  esac
done

# Get AWS account ID if not provided
if [ -z "$ACCOUNT_ID" ]; then
  echo "Getting AWS account ID..."
  ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
  if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Failed to get AWS account ID"
    exit 1
  fi
fi

echo "=========================================="
echo "Deploying Authentication Session Infrastructure"
echo "=========================================="
echo "Profile:     $PROFILE"
echo "Environment: $ENVIRONMENT"
echo "Region:      $REGION"
echo "Account ID:  $ACCOUNT_ID"
echo "=========================================="

# Navigate to infra directory
cd "$(dirname "$0")/../infra"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm ci
fi

# Build the CDK app
echo "Building CDK app..."
npm run build

# Deploy the stack
echo "Deploying stack..."
npx cdk deploy \
  --profile "$PROFILE" \
  --require-approval never \
  -c environment="$ENVIRONMENT" \
  -c region="$REGION" \
  -c accountId="$ACCOUNT_ID"

echo ""
echo "=========================================="
echo "Deployment completed successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Configure your Lambda functions with the table name:"
echo "   Environment variable: AUTH_SESSION_TABLE_NAME=${ENVIRONMENT}-checkout-authentication-sessions"
echo ""
echo "2. Grant Lambda IAM permissions to access the table:"
echo "   - dynamodb:GetItem"
echo "   - dynamodb:PutItem"
echo "   - dynamodb:UpdateItem"
echo "   - dynamodb:DeleteItem"
echo ""
echo "3. Subscribe to the SNS alarm topic to receive alerts:"
echo "   Topic: ${ENVIRONMENT}-checkout-auth-session-alarms"
