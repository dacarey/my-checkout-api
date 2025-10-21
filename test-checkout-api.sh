#!/bin/bash

# Test script for Checkout API Mock Service using xh
# Usage: ./test-checkout-api.sh [API_GATEWAY_URL]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# API Gateway URL (can be passed as argument or set as environment variable)
API_URL="${1:-${API_GATEWAY_URL:-https://kcemzg9bxh.execute-api.eu-west-1.amazonaws.com/dev}}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Checkout API Mock Service Test Suite${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "API URL: ${YELLOW}${API_URL}${NC}\n"

# Function to print test header
print_test() {
    echo -e "\n${GREEN}>>> TEST: $1${NC}"
    echo -e "${YELLOW}$2${NC}\n"
}

# Function to generate unique idempotency key
generate_idempotency_key() {
    echo "TEST-$(date +%s)-$(uuidgen | cut -d'-' -f1)"
}

# Test 1: Single tokenised payment - COMPLETED order
print_test "Single Tokenised Payment" "POST /me/token/capture (Single credit card - amount < 150)"

echo '{
    "cartId": "test-cart-123",
    "version": 1,
    "payments": [
        {
            "type": "tokenised",
            "amount": {"amount": 49.99, "currencyCode": "GBP"},
            "tokenisedPayment": {
                "paymentToken": "tkn_abc123xyz",
                "tokenType": "transient",
                "billTo": {
                    "firstName": "John",
                    "lastName": "Doe",
                    "email": "john.doe@example.com",
                    "address": {
                        "address1": "123 Main Street",
                        "locality": "London",
                        "postalCode": "SW1A 1AA",
                        "country": "GB"
                    }
                }
            }
        }
    ]
}' | xh POST "${API_URL}/me/token/capture" \
    Content-Type:application/json \
    Idempotency-Key:"$(generate_idempotency_key)"

# Test 2: Mixed payment methods - Gift voucher + credit card
print_test "Mixed Payment Methods" "POST /me/token/capture (Gift voucher + credit card)"

echo '{
    "cartId": "test-cart-456",
    "version": 1,
    "payments": [
        {
            "type": "stored",
            "amount": {"amount": 20.00, "currencyCode": "GBP"},
            "storedPayment": {
                "paymentMethod": "giftvoucher",
                "giftVoucherDetails": {
                    "voucherCode": "GV-2024-ABC123",
                    "pin": "1234"
                }
            }
        },
        {
            "type": "tokenised",
            "amount": {"amount": 29.99, "currencyCode": "GBP"},
            "tokenisedPayment": {
                "paymentToken": "tkn_xyz789def",
                "tokenType": "transient",
                "billTo": {
                    "firstName": "Jane",
                    "lastName": "Smith",
                    "email": "jane.smith@example.com",
                    "address": {
                        "address1": "456 High Street",
                        "locality": "Manchester",
                        "postalCode": "M1 1AA",
                        "country": "GB"
                    }
                }
            }
        }
    ]
}' | xh POST "${API_URL}/me/token/capture" \
    Content-Type:application/json \
    Idempotency-Key:"$(generate_idempotency_key)"

# Test 3: 3DS required scenario (amount > 150)
print_test "3DS Required Scenario" "POST /me/token/capture (Amount > 150 triggers 3DS)"

echo '{
    "cartId": "test-cart-3ds",
    "version": 1,
    "payments": [
        {
            "type": "tokenised",
            "amount": {"amount": 159.99, "currencyCode": "EUR"},
            "tokenisedPayment": {
                "paymentToken": "tkn_3ds_test",
                "tokenType": "transient",
                "billTo": {
                    "firstName": "Michael",
                    "lastName": "Johnson",
                    "email": "michael.johnson@example.com",
                    "address": {
                        "address1": "789 Park Avenue",
                        "locality": "Dublin",
                        "postalCode": "D02 1AA",
                        "country": "IE"
                    }
                }
            }
        }
    ]
}' | xh POST "${API_URL}/me/token/capture" \
    Content-Type:application/json \
    Idempotency-Key:"$(generate_idempotency_key)"

# Test 4: Stateless endpoint (in-brand)
print_test "Stateless Endpoint" "POST /in-brand/uklait/token/capture"

echo '{
    "cartId": "test-cart-789",
    "version": 1,
    "payments": [
        {
            "type": "tokenised",
            "amount": {"amount": 89.99, "currencyCode": "GBP"},
            "tokenisedPayment": {
                "paymentToken": "tkn_agent_test",
                "tokenType": "transient",
                "billTo": {
                    "firstName": "Sarah",
                    "lastName": "Customer",
                    "email": "sarah.customer@example.com",
                    "address": {
                        "address1": "101 Customer Road",
                        "locality": "Edinburgh",
                        "postalCode": "EH1 1AA",
                        "country": "GB"
                    }
                }
            }
        }
    ]
}' | xh POST "${API_URL}/in-brand/uklait/token/capture" \
    Content-Type:application/json \
    Idempotency-Key:"$(generate_idempotency_key)"

# Test 5: 422 Validation Error - Cart version mismatch
print_test "422 Validation Error" "POST /me/token/capture (version=999 triggers validation error)"

echo '{
    "cartId": "test-cart-error",
    "version": 999,
    "payments": [
        {
            "type": "tokenised",
            "amount": {"amount": 49.99, "currencyCode": "GBP"},
            "tokenisedPayment": {
                "paymentToken": "tkn_test",
                "tokenType": "transient",
                "billTo": {
                    "firstName": "Test",
                    "lastName": "User",
                    "email": "test@example.com",
                    "address": {
                        "address1": "123 Test Street",
                        "locality": "London",
                        "postalCode": "SW1A 1AA",
                        "country": "GB"
                    }
                }
            }
        }
    ]
}' | xh POST "${API_URL}/me/token/capture" \
    Content-Type:application/json \
    Idempotency-Key:"$(generate_idempotency_key)" || true

# Test 6: 422 Validation Error - Out of stock
print_test "422 Out of Stock Error" "POST /me/token/capture (cartId with 'outofstock' triggers error)"

echo '{
    "cartId": "test-cart-outofstock",
    "version": 1,
    "payments": [
        {
            "type": "tokenised",
            "amount": {"amount": 49.99, "currencyCode": "GBP"},
            "tokenisedPayment": {
                "paymentToken": "tkn_test",
                "tokenType": "transient",
                "billTo": {
                    "firstName": "Test",
                    "lastName": "User",
                    "email": "test@example.com",
                    "address": {
                        "address1": "123 Test Street",
                        "locality": "London",
                        "postalCode": "SW1A 1AA",
                        "country": "GB"
                    }
                }
            }
        }
    ]
}' | xh POST "${API_URL}/me/token/capture" \
    Content-Type:application/json \
    Idempotency-Key:"$(generate_idempotency_key)" || true

# Test 7: 400 Bad Request - Missing required fields
print_test "400 Bad Request Error" "POST /me/token/capture (missing required fields)"

echo '{
    "cartId": "test-cart-badrequest"
}' | xh POST "${API_URL}/me/token/capture" \
    Content-Type:application/json \
    Idempotency-Key:"$(generate_idempotency_key)" || true

# Test 8: OPTIONS request (CORS preflight)
print_test "CORS Preflight" "OPTIONS /me/token/capture"

xh OPTIONS "${API_URL}/me/token/capture"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}All tests completed!${NC}"
echo -e "${BLUE}========================================${NC}\n"
