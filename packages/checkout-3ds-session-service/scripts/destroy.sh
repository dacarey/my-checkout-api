#!/bin/bash

# Destroy Authentication Session Infrastructure
# WARNING: This will delete the DynamoDB table and all session data

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
    --force)
      FORCE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--profile PROFILE] [--environment ENVIRONMENT] [--region REGION] [--account-id ACCOUNT_ID] [--force]"
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
echo "WARNING: Destroying Authentication Session Infrastructure"
echo "=========================================="
echo "Profile:     $PROFILE"
echo "Environment: $ENVIRONMENT"
echo "Region:      $REGION"
echo "Account ID:  $ACCOUNT_ID"
echo "=========================================="

# Confirm destruction unless --force is used
if [ "$FORCE" != "true" ]; then
  echo ""
  echo "This will DELETE the DynamoDB table and all session data."
  echo "This action cannot be undone!"
  echo ""
  read -p "Are you sure you want to proceed? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Destruction cancelled."
    exit 0
  fi
fi

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

# Destroy the stack
echo "Destroying stack..."
npx cdk destroy \
  --profile "$PROFILE" \
  --force \
  -c environment="$ENVIRONMENT" \
  -c region="$REGION" \
  -c accountId="$ACCOUNT_ID"

echo ""
echo "=========================================="
echo "Destruction completed successfully!"
echo "=========================================="
