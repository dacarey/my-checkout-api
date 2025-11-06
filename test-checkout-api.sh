#!/bin/bash

# Test script for Checkout API - Runs examples from examples/ directory
# Usage: ./test-checkout-api.sh [OPTIONS]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
VERBOSE=""
EXAMPLE=""
API_ID=""
BRAND_KEY=""
REGION=""

# Function to print usage
print_usage() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Checkout API Test Suite${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "Usage: ./test-checkout-api.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --api-id <id>       API Gateway ID (auto-loaded from .api-deployment.lock if available)"
    echo "  --brand-key <key>   Brand key (default: uklait)"
    echo "  --region <region>   AWS region (default: eu-west-1)"
    echo "  --example <name>    Run specific example (e.g., token-capture)"
    echo "  --verbose, -v       Verbose output"
    echo "  --help, -h          Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  API_ID              API Gateway ID"
    echo "  CHECKOUT_API_ID     Alternative API Gateway ID"
    echo "  BRAND_KEY           Brand key"
    echo "  AWS_REGION          AWS region"
    echo ""
    echo "Examples:"
    echo "  ./test-checkout-api.sh                                  # Uses .api-deployment.lock"
    echo "  ./test-checkout-api.sh --api-id abc123xyz9              # Override with API ID"
    echo "  ./test-checkout-api.sh --example token-capture -v       # Run specific example with verbose output"
    echo "  API_ID=abc123xyz9 ./test-checkout-api.sh                # Environment variable"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-id)
            API_ID="$2"
            shift 2
            ;;
        --brand-key|--brand)
            BRAND_KEY="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --example|-e)
            EXAMPLE="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE="--verbose"
            shift
            ;;
        --help|-h)
            print_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Checkout API Test Suite${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if .api-deployment.lock exists
LOCK_FILE=".api-deployment.lock"
if [ -f "$LOCK_FILE" ] && [ -z "$API_ID" ]; then
    echo -e "${GREEN}✅ Found deployment lock file${NC}"
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
        API_ID="$LOCK_API_ID"
        echo -e "${YELLOW}Using API ID from lock file: ${API_ID}${NC}"
    fi
fi

# Check if examples directory exists
if [ ! -d "examples" ]; then
    echo -e "${RED}❌ Error: examples/ directory not found${NC}"
    echo "Make sure you're running this script from the project root"
    exit 1
fi

# Change to examples directory
cd examples

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing example dependencies...${NC}"
    npm ci --ignore-scripts
    echo ""
fi

# Build examples if needed
if [ ! -d "dist" ] || [ "src" -nt "dist" ]; then
    echo -e "${YELLOW}🔨 Building examples...${NC}"
    npm run build
    echo ""
fi

# Build command arguments
CMD_ARGS=()

if [ -n "$API_ID" ]; then
    CMD_ARGS+=("--api-id" "$API_ID")
fi

if [ -n "$BRAND_KEY" ]; then
    CMD_ARGS+=("--brand-key" "$BRAND_KEY")
fi

if [ -n "$REGION" ]; then
    CMD_ARGS+=("--region" "$REGION")
fi

if [ -n "$EXAMPLE" ]; then
    CMD_ARGS+=("--example" "$EXAMPLE")
fi

if [ -n "$VERBOSE" ]; then
    CMD_ARGS+=("$VERBOSE")
fi

# Run the examples
echo -e "${BLUE}🚀 Running examples...${NC}"
echo ""

if [ ${#CMD_ARGS[@]} -gt 0 ]; then
    node dist/runner.js "${CMD_ARGS[@]}"
else
    node dist/runner.js
fi

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests completed successfully${NC}"
else
    echo -e "${RED}❌ Some tests failed${NC}"
fi

exit $EXIT_CODE
