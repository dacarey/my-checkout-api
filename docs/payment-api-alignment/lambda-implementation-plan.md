# Lambda Implementation Rework Plan
## Checkout API v0.4.0 - Payment API Alignment

**Document Version:** 1.0
**Date:** 2025-10-20
**Target File:** `lambda/src/index.ts`
**Purpose:** Mock/Demonstration Implementation
**Status:** Implementation Ready

---

## Overview

This document provides step-by-step instructions for updating the Lambda implementation to handle the new Payment API v0.2.0 aligned request and response structures. Since this is a **mock/demonstration** implementation, the focus is on showing correct patterns rather than full business logic.

---

## Key Principles

1. **Demonstrate Patterns**: Show how to handle nested structures correctly
2. **Type Safety**: Use proper TypeScript types aligned with OpenAPI
3. **Flexible Handling**: Accept new structure while being lenient during alpha
4. **Clear Examples**: Make code easy to understand as a reference

---

## Change Summary

### Type Definitions to Update
- [ ] `Address` → Split into `PaymentAddress` and `BillingDetails`
- [ ] `TokenisedPaymentDetails.billTo` → Use `BillingDetails` type
- [ ] `TokenisedPaymentDetails.tokenType` → Support lowercase enums
- [ ] `TokenisedPaymentDetails.threeDSData` → Use structured type

### Handler Logic to Update
- [ ] Extract billing info from nested structure
- [ ] Support both old and new formats (graceful degradation)
- [ ] Log format detection for debugging
- [ ] Update mock response generation

---

## Detailed Implementation Changes

### CHANGE 1: Update Type Definitions

**Location:** Lines 7-54 (Type Definitions section)

**Current Types:**
```typescript
interface Address {
  firstName: string;
  lastName: string;
  address1: string;
  city: string;  // ← OLD
  postalCode: string;
  country: string;
  email: string;
  phone?: string;
}

interface TokenisedPaymentDetails {
  merchantId: string;
  paymentToken: string;
  tokenType: 'TRANSIENT' | 'STORED';  // ← UPPERCASE
  setupRecurring?: boolean;
  billTo: Address;  // ← FLAT
  threeDSData?: Record<string, any>;  // ← UNSTRUCTURED
}
```

**New Types:**
```typescript
// ========================================
// Type Definitions Aligned with Payment API v0.2.0
// ========================================

/**
 * ISO 19160-compliant address structure from Payment API v0.2.0
 */
interface PaymentAddress {
  address1: string;
  address2?: string;
  locality: string;  // ISO 19160 term for city
  administrativeArea?: string;  // State/province
  postalCode: string;
  country: string;  // ISO 3166-1 alpha-2
}

/**
 * Billing contact information with nested address from Payment API v0.2.0
 */
interface BillingDetails {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address: PaymentAddress;
}

/**
 * 3DS Setup phase data
 */
interface ThreeDSSetupData {
  referenceId: string;
  authenticationInformation?: Record<string, any>;
}

/**
 * 3DS Completion phase data
 */
interface ThreeDSCompletionData {
  authenticationResult: 'Y' | 'N' | 'A' | 'U' | 'R';
  cavv?: string;
  eci?: string;
  xid?: string;
  paSpecificationVersion?: string;
  directoryServerTransactionId?: string;
  acsOperatorID?: string;
}

/**
 * Phase-based 3DS data structure from Payment API v0.2.0
 */
interface ThreeDSData {
  phase: 'setup' | 'completion';
  setup?: ThreeDSSetupData;
  completion?: ThreeDSCompletionData;
}

/**
 * Tokenised payment details aligned with Payment API v0.2.0
 */
interface TokenisedPaymentDetails {
  merchantId: string;
  paymentToken: string;
  tokenType: 'transient' | 'stored' | 'TRANSIENT' | 'STORED';  // Support both during alpha
  setupRecurring?: boolean;
  billTo: BillingDetails;  // NEW: nested structure
  threeDSData?: ThreeDSData;  // NEW: structured
}
```

**Explanation:**
- Added `PaymentAddress` with `locality` instead of `city`
- Added `BillingDetails` to separate person from address
- Added structured `ThreeDSData`, `ThreeDSSetupData`, `ThreeDSCompletionData`
- Updated `TokenisedPaymentDetails` to use new types
- Made `tokenType` accept both cases during alpha transition

---

### CHANGE 2: Add Helper Functions for Structure Detection

**Location:** After line 135 (after getCurrentTimestamp function)

**Add New Helper Functions:**
```typescript
// ========================================
// Structure Detection and Normalization
// ========================================

/**
 * Detects which address structure is being used
 * Alpha-phase helper to support both old and new formats
 */
function detectAddressFormat(billTo: any): 'v0.4-nested' | 'v0.3-flat' | 'unknown' {
  if (billTo.address && billTo.address.locality) {
    return 'v0.4-nested';  // New Payment API aligned format
  } else if (billTo.city) {
    return 'v0.3-flat';  // Old flat format
  }
  return 'unknown';
}

/**
 * Extracts customer email from either old or new billTo structure
 * Demonstrates how to handle both formats gracefully
 */
function extractCustomerEmail(billTo: any): string | undefined {
  const format = detectAddressFormat(billTo);

  if (format === 'v0.4-nested') {
    // New format: email is at billTo.email
    return billTo.email;
  } else if (format === 'v0.3-flat') {
    // Old format: email is at billTo.email (same location!)
    return billTo.email;
  }
  return undefined;
}

/**
 * Extracts locality/city from either format
 * Demonstrates field name mapping
 */
function extractLocality(billTo: any): string | undefined {
  const format = detectAddressFormat(billTo);

  if (format === 'v0.4-nested') {
    // New format: nested address.locality
    return billTo.address?.locality;
  } else if (format === 'v0.3-flat') {
    // Old format: flat billTo.city
    return billTo.city;
  }
  return undefined;
}

/**
 * Normalizes tokenType to lowercase for internal processing
 * Accepts both uppercase (old) and lowercase (new) formats
 */
function normalizeTokenType(tokenType: string): 'transient' | 'stored' {
  return tokenType.toLowerCase() as 'transient' | 'stored';
}

/**
 * Checks if 3DS data is provided and structured correctly
 */
function hasStructuredThreeDSData(threeDSData: any): boolean {
  return threeDSData &&
         typeof threeDSData === 'object' &&
         'phase' in threeDSData &&
         (threeDSData.phase === 'setup' || threeDSData.phase === 'completion');
}
```

**Explanation:**
- `detectAddressFormat`: Identifies which structure is being used
- `extractCustomerEmail`: Safely extracts email from either format
- `extractLocality`: Maps `city` or `locality` to common value
- `normalizeTokenType`: Accepts both casings
- `hasStructuredThreeDSData`: Validates 3DS structure

---

### CHANGE 3: Update handleCaptureOrder with Format Detection

**Location:** Lines 268-343 (handleCaptureOrder function)

**Update Request Processing:**
```typescript
function handleCaptureOrder(event: APIGatewayProxyEvent, brandkey?: string): APIGatewayProxyResult {
  console.log('Processing order capture:', {
    path: event.path,
    method: event.httpMethod,
    brandkey,
    body: event.body
  });

  try {
    // Parse and validate request
    if (!event.body) {
      const error = createErrorResponse(400, 'BadRequest', 'Request body is required');
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify(error)
      };
    }

    const request: CheckoutDraft = JSON.parse(event.body);

    // Basic validation
    if (!request.cartId || !request.version || !request.payments || request.payments.length === 0) {
      const error = createErrorResponse(400, 'BadRequest', 'Missing required fields: cartId, version, payments');
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify(error)
      };
    }

    // NEW: Log request structure for debugging
    const firstTokenisedPayment = request.payments.find(p => p.type === 'tokenised');
    if (firstTokenisedPayment?.tokenisedPayment) {
      const billTo = firstTokenisedPayment.tokenisedPayment.billTo;
      const format = detectAddressFormat(billTo);

      console.log('Request structure detected:', {
        addressFormat: format,
        tokenType: firstTokenisedPayment.tokenisedPayment.tokenType,
        hasStructuredThreeDS: hasStructuredThreeDSData(firstTokenisedPayment.tokenisedPayment.threeDSData),
        locality: extractLocality(billTo),
        email: extractCustomerEmail(billTo)
      });

      // Validation: Warn if using old format (in alpha, still accept it)
      if (format === 'v0.3-flat') {
        console.warn('ALPHA WARNING: Client using deprecated flat address structure. Expected nested BillingDetails format.');
      }

      // Validation: Warn if using uppercase token type
      if (firstTokenisedPayment.tokenisedPayment.tokenType === 'TRANSIENT' ||
          firstTokenisedPayment.tokenisedPayment.tokenType === 'STORED') {
        console.warn('ALPHA WARNING: Client using uppercase tokenType. Expected lowercase: transient, stored');
      }

      // Validation: Warn if 3DS data is unstructured
      if (firstTokenisedPayment.tokenisedPayment.threeDSData &&
          !hasStructuredThreeDSData(firstTokenisedPayment.tokenisedPayment.threeDSData)) {
        console.warn('ALPHA WARNING: Client using unstructured threeDSData. Expected phase-based structure.');
      }
    }

    // Check for version mismatch scenario (if version is 999, trigger validation error)
    if (request.version === 999) {
      const validations = createValidationError('version-mismatch');
      return {
        statusCode: 422,
        headers: getCorsHeaders(),
        body: JSON.stringify(validations)
      };
    }

    // Check for out-of-stock scenario (if cartId contains 'outofstock')
    if (request.cartId.toLowerCase().includes('outofstock')) {
      const validations = createValidationError('out-of-stock');
      return {
        statusCode: 422,
        headers: getCorsHeaders(),
        body: JSON.stringify(validations)
      };
    }

    // Generate mock order
    const order = createMockOrder(request);

    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: JSON.stringify(order)
    };

  } catch (error) {
    console.error('Error processing checkout:', error);

    const errorResponse = createErrorResponse(
      500,
      'InternalError',
      'Internal server error processing checkout'
    );

    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify(errorResponse)
    };
  }
}
```

**Key Changes:**
1. Added structure detection logging
2. Added warnings for deprecated formats (logged, not rejected)
3. Shows graceful handling during alpha migration

---

### CHANGE 4: Add 3DS Detection to createMockOrder

**Location:** Inside createMockOrder function (around line 144)

**Update 3DS Detection:**
```typescript
function createMockOrder(request: CheckoutDraft): Order {
  const timestamp = getCurrentTimestamp();
  const orderId = generateOrderId();

  // Check if this should be a 3DS scenario
  const totalAmount = request.payments.reduce((sum, p) => sum + p.amount.amount, 0);

  // NEW: Also check if structured 3DS data is present (indicates 3DS flow)
  const firstTokenisedPayment = request.payments.find(p => p.type === 'tokenised');
  const hasThreeDSSetup = firstTokenisedPayment?.tokenisedPayment?.threeDSData &&
                          hasStructuredThreeDSData(firstTokenisedPayment.tokenisedPayment.threeDSData);

  const requires3DS = totalAmount > 150 || hasThreeDSSetup;

  console.log('3DS Detection:', {
    totalAmount,
    hasThreeDSSetup,
    requires3DS,
    threeDSPhase: firstTokenisedPayment?.tokenisedPayment?.threeDSData?.phase
  });

  // Build payment details based on request
  const paymentDetails: OrderPaymentDetail[] = request.payments.map(payment => {
    if (payment.type === 'tokenised') {
      if (requires3DS) {
        // If 3DS setup data is provided with phase 'setup', return 3DS challenge required
        if (hasThreeDSSetup && firstTokenisedPayment?.tokenisedPayment?.threeDSData?.phase === 'setup') {
          console.log('Returning 3DS challenge required for setup phase');
          return {
            type: 'tokenised',
            amount: payment.amount,
            status: 'requires_3ds',
            tokenisedPaymentResult: {
              transactionId: generateTransactionId('auth'),
              threeDSUrl: 'https://3ds.psp.com/challenge/abc123',
              merchantReference: payment.tokenisedPayment?.merchantId || 'YOUR_MID'
            }
          };
        }
      }

      // Default: completed payment
      return {
        type: 'tokenised',
        amount: payment.amount,
        status: 'completed',
        tokenisedPaymentResult: {
          transactionId: generateTransactionId('auth'),
          authorisationCode: Math.floor(Math.random() * 900000 + 100000).toString(),
          merchantReference: payment.tokenisedPayment?.merchantId || 'YOUR_MID'
        }
      };
    } else {
      // stored payment (gift voucher) - unchanged
      return {
        type: 'stored',
        amount: payment.amount,
        status: 'completed',
        storedPaymentResult: {
          paymentMethod: 'giftvoucher',
          transactionId: generateTransactionId('gv'),
          remainingBalance: {
            amount: Math.max(0, 50 - payment.amount.amount),
            currencyCode: payment.amount.currencyCode
          }
        }
      };
    }
  });

  const status = requires3DS ? 'REQUIRES_3DS_VALIDATION' : 'COMPLETED';

  return {
    id: orderId,
    version: 1,
    status,
    totalLineItems: 2,
    totalItemQuantity: 3,
    numberOfBottles: 36,
    totalListPrice: {
      amount: totalAmount + 10,
      currencyCode: request.payments[0].amount.currencyCode
    },
    totalPrice: {
      amount: totalAmount,
      currencyCode: request.payments[0].amount.currencyCode
    },
    customerId: 'c1e2d3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f',
    responseCode: 'VAJ1C',
    paymentDetails,
    createdAt: timestamp,
    lastModifiedAt: timestamp
  };
}
```

**Key Changes:**
1. Added detection of structured 3DS data
2. Enhanced logging for 3DS scenarios
3. Check 3DS phase to determine response

---

## Testing Strategy

### 1. Unit Tests to Add

Create `lambda/test/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Address Format Detection', () => {
  it('should detect v0.4 nested format', () => {
    const billTo = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      address: {
        address1: '123 Main St',
        locality: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB'
      }
    };

    expect(detectAddressFormat(billTo)).toBe('v0.4-nested');
  });

  it('should detect v0.3 flat format', () => {
    const billTo = {
      firstName: 'John',
      lastName: 'Doe',
      address1: '123 Main St',
      city: 'London',
      postalCode: 'SW1A 1AA',
      country: 'GB',
      email: 'john@example.com'
    };

    expect(detectAddressFormat(billTo)).toBe('v0.3-flat');
  });

  it('should extract locality from nested format', () => {
    const billTo = {
      address: {
        locality: 'London'
      }
    };

    expect(extractLocality(billTo)).toBe('London');
  });

  it('should extract city from flat format', () => {
    const billTo = {
      city: 'London'
    };

    expect(extractLocality(billTo)).toBe('London');
  });
});

describe('Token Type Normalization', () => {
  it('should normalize uppercase to lowercase', () => {
    expect(normalizeTokenType('TRANSIENT')).toBe('transient');
    expect(normalizeTokenType('STORED')).toBe('stored');
  });

  it('should keep lowercase as-is', () => {
    expect(normalizeTokenType('transient')).toBe('transient');
    expect(normalizeTokenType('stored')).toBe('stored');
  });
});

describe('3DS Data Detection', () => {
  it('should detect structured 3DS setup data', () => {
    const threeDSData = {
      phase: 'setup',
      setup: {
        referenceId: 'ref_123',
        authenticationInformation: {}
      }
    };

    expect(hasStructuredThreeDSData(threeDSData)).toBe(true);
  });

  it('should detect structured 3DS completion data', () => {
    const threeDSData = {
      phase: 'completion',
      completion: {
        authenticationResult: 'Y'
      }
    };

    expect(hasStructuredThreeDSData(threeDSData)).toBe(true);
  });

  it('should reject unstructured 3DS data', () => {
    const threeDSData = {
      someField: 'someValue'
    };

    expect(hasStructuredThreeDSData(threeDSData)).toBe(false);
  });
});
```

### 2. Manual Testing Payloads

**Test 1: New Format (v0.4 nested address)**
```json
{
  "cartId": "test-cart-new-format",
  "version": 1,
  "payments": [
    {
      "type": "tokenised",
      "amount": {
        "amount": 49.99,
        "currencyCode": "GBP"
      },
      "tokenisedPayment": {
        "merchantId": "YOUR_MID",
        "paymentToken": "tkn_new_format",
        "tokenType": "transient",
        "billTo": {
          "firstName": "John",
          "lastName": "Doe",
          "email": "john@example.com",
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
}
```

**Test 2: Old Format (v0.3 flat address) - should still work**
```json
{
  "cartId": "test-cart-old-format",
  "version": 1,
  "payments": [
    {
      "type": "tokenised",
      "amount": {
        "amount": 49.99,
        "currencyCode": "GBP"
      },
      "tokenisedPayment": {
        "merchantId": "YOUR_MID",
        "paymentToken": "tkn_old_format",
        "tokenType": "TRANSIENT",
        "billTo": {
          "firstName": "John",
          "lastName": "Doe",
          "address1": "123 Main Street",
          "city": "London",
          "postalCode": "SW1A 1AA",
          "country": "GB",
          "email": "john@example.com"
        }
      }
    }
  ]
}
```

**Test 3: 3DS Flow with Structured Data**
```json
{
  "cartId": "test-cart-3ds-flow",
  "version": 1,
  "payments": [
    {
      "type": "tokenised",
      "amount": {
        "amount": 75.50,
        "currencyCode": "EUR"
      },
      "tokenisedPayment": {
        "merchantId": "YOUR_MID",
        "paymentToken": "tkn_3ds_test",
        "tokenType": "transient",
        "billTo": {
          "firstName": "Jane",
          "lastName": "Smith",
          "email": "jane@example.com",
          "address": {
            "address1": "456 High Street",
            "locality": "Manchester",
            "postalCode": "M1 1AA",
            "country": "GB"
          }
        },
        "threeDSData": {
          "phase": "setup",
          "setup": {
            "referenceId": "d5180465-bae3-4df7-940d-3b029b7de81a",
            "authenticationInformation": {
              "deviceCollectionAccessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
              "deviceDataCollectionUrl": "https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect"
            }
          }
        }
      }
    }
  ]
}
```

**Expected Results:**
- Test 1: Should succeed, no warnings in logs
- Test 2: Should succeed, warnings logged about deprecated format
- Test 3: Should return 202/3DS challenge required

---

## Deployment and Testing Checklist

- [ ] Update TypeScript types
- [ ] Add helper functions
- [ ] Update handleCaptureOrder
- [ ] Update createMockOrder
- [ ] Add unit tests
- [ ] Run TypeScript compilation: `npm run build` in lambda/
- [ ] Deploy to dev: `npm run deploy:single`
- [ ] Test with new format payload
- [ ] Test with old format payload (verify warnings)
- [ ] Test with 3DS payload
- [ ] Review CloudWatch logs for structure detection
- [ ] Document any issues found

---

## Future Enhancements (Post-Alpha)

Once we exit alpha and move to beta/production:

1. **Remove Backward Compatibility**: Stop accepting old flat address format
2. **Enforce Lowercase**: Reject uppercase token types
3. **Strict 3DS Validation**: Require properly structured 3DS data
4. **Integration**: Connect to real Payment API for 3DS flows
5. **Error Messages**: Return specific validation errors for malformed requests

---

## Summary

This Lambda implementation demonstrates:

✅ **Type Safety**: Proper TypeScript types aligned with Payment API v0.2.0
✅ **Graceful Degradation**: Accepts old and new formats during alpha
✅ **Clear Logging**: Helps developers understand structure differences
✅ **Pattern Demonstration**: Shows how to handle nested structures
✅ **3DS Support**: Basic phase-based 3DS flow demonstration

The code serves as a **reference implementation** for how to integrate with the aligned OpenAPI specification.

---

**Document Status**: Ready for implementation

**Estimated Time**: 3-4 hours for implementation and testing

**Next Steps**: Execute changes, test thoroughly, deploy to dev
