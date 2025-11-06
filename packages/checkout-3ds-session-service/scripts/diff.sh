#!/bin/bash

# Show differences between deployed stack and local changes
# This script shows what changes would be made without deploying

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
echo "Showing Authentication Session Infrastructure Diff"
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

# Show diff
echo "Showing stack differences..."
npx cdk diff \
  --profile "$PROFILE" \
  -c environment="$ENVIRONMENT" \
  -c region="$REGION" \
  -c accountId="$ACCOUNT_ID"
