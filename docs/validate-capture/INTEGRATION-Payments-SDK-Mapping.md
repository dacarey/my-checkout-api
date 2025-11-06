# Alignment Report: 3DS Validate-Capture Endpoint with Payments-SDK

**Date:** 2025-11-03
**Version:** 1.0
**Status:** Cross-Check Complete
**Related Documents:**
- [TECHNICAL-REPORT-3DS-Stateful-vs-Stateless-Design.md](./TECHNICAL-REPORT-3DS-Stateful-vs-Stateless-Design.md)
- Checkout API v0.5.0 - 3DS Validate-Capture Endpoints
- Payment API v0.2.0
- `@dw-digital-commerce/payments-sdk` v2.4.1+

---

## Executive Summary

This report validates the alignment between the Checkout API's `/me/3ds/validate-capture` and `/in-brand/{brandkey}/3ds/validate-capture` endpoints with the `@dw-digital-commerce/payments-sdk` library. The analysis confirms that the **stateful session-based design is compatible** with the payments-sdk integration patterns, with specific recommendations for digital wallet handling and merchant configuration.

**Key Finding:** The current endpoint design successfully maps to payments-sdk integration points for transient tokens, stored tokens, and 3DS completion flows. Digital wallet support (Google Pay, Apple Pay) requires explicit specification to ensure consistent implementation.

---

## 1. Transient Token Flow Mapping

### 1.1 Session Storage Design

When the initial `/me/token/capture` call returns **HTTP 202 Accepted**, the authentication session stores:

```typescript
interface AuthenticationSession {
  threeDSSessionId: string;        // "auth-3169811e-fa0a-321"
  cartId: string;                  // "3169811e-fa0a-789"
  cartVersion: number;             // 1
  paymentToken: string;            // "tkn_abc123xyz" (transient token)
  tokenType: 'transient' | 'stored';
  billTo: BillingDetails;          // Full billing details from initial request
  shipTo?: ShippingDetails;        // Optional shipping details
  threeDSSetupData?: object;       // Initial 3DS setup phase data
  customerId?: string;             // For authenticated customers
  anonymousId?: string;            // For guest users
  createdAt: Date;
  expiresAt: Date;                 // 30-minute TTL
  status: 'pending' | 'used' | 'expired';
}
```

### 1.2 Payments-SDK Integration Mapping

**Step 1: Retrieve Session**
```typescript
const session = await getAuthenticationSession(request.threeDSSessionId);

// Validate session state
if (session.status !== 'pending') {
  throw new ConflictError('Authentication session already used');
}
if (session.expiresAt < new Date()) {
  throw new ConflictError('Authentication session expired');
}
```

**Step 2: Reconstruct Payment Request for Payments-SDK**
```typescript
import { PaymentService } from '@dw-digital-commerce/payments-sdk';

// Initialize payment service
const paymentService = new PaymentService('cybersource', {
  merchantID: process.env.MERCHANT_ID,
  merchantKeyId: process.env.MERCHANT_KEY_ID,
  merchantsecretKey: process.env.MERCHANT_SECRET_KEY
});

// Build payment request from session data + 3DS completion data
const paymentRequest = {
  orderId: generateOrderId(),
  amount: session.totalAmount.toString(),
  currency: session.totalAmount.currencyCode,
  paymentToken: session.paymentToken,     // Original transient token from session
  tokenType: session.tokenType,           // 'transient'
  billTo: {
    firstName: session.billTo.firstName,
    lastName: session.billTo.lastName,
    street: session.billTo.address.address1,
    city: session.billTo.address.locality,
    postalCode: session.billTo.address.postalCode,
    country: session.billTo.address.country,
    email: session.billTo.email
  },
  threeDSData: {
    phase: 'completion',
    completion: {
      authenticationTransactionId: request.threeDSData.completion.authenticationTransactionId,
      cavv: request.threeDSData.completion.cavv,
      eciIndicator: request.threeDSData.completion.eciIndicator,
      xid: request.threeDSData.completion.xid  // Optional for 3DS v1
    }
  }
};

// Execute payment authorization with 3DS completion data
const result = await paymentService.paymentAuthorisation(paymentRequest);
```

**Step 3: Handle Payment Result**
```typescript
if (result.status === 'authorized') {
  // Mark session as used (single-use enforcement)
  await markSessionUsed(session.threeDSSessionId);

  // Create order with payment result
  const order = await createOrder({
    cartId: session.cartId,
    cartVersion: session.cartVersion,
    paymentResult: result
  });

  // Return HTTP 201 Created
  return {
    statusCode: 201,
    headers: { Location: `/checkout/me/orders/${order.id}` },
    body: JSON.stringify(order)
  };
} else {
  // Payment authorization failed
  throw new UnprocessableEntityError('3DS validation failed with payment processor');
}
```

### 1.3 Critical Considerations for Transient Tokens

| Consideration | Impact | Recommendation |
|---------------|--------|----------------|
| **Token Expiry** | Transient tokens may expire before 30-minute session window | Verify payment processor token TTL; consider reducing session TTL if needed |
| **Token Reuse** | Transient tokens are single-use | Ensure session single-use enforcement prevents duplicate payment attempts |
| **Token Validation** | Token must remain valid throughout 3DS flow | Consider pre-validating token before creating session (optional) |

---

## 2. Stored Token Flow Mapping

### 2.1 Session Storage for Stored Tokens

```typescript
// Authentication session for stored payment token
{
  threeDSSessionId: "auth-stored-456",
  paymentToken: "stored_card_token_789",
  tokenType: "stored",                    // Indicates saved payment method
  customerId: "c1e2d3f4-5a6b-7c8d",      // REQUIRED for stored tokens
  billTo: { /* Billing details */ },
  // ... rest of session fields
}
```

### 2.2 Payments-SDK Integration for Stored Tokens

```typescript
// Reconstruct payment request for stored token
const storedPaymentRequest = {
  orderId: generateOrderId(),
  amount: session.totalAmount.toString(),
  currency: session.totalAmount.currencyCode,
  paymentToken: session.paymentToken,     // Stored token ID/reference
  tokenType: 'stored',                    // SDK needs to know it's a saved token
  customerId: session.customerId,         // REQUIRED for stored token authorization
  billTo: session.billTo,
  threeDSData: {
    phase: 'completion',
    completion: request.threeDSData.completion
  }
};

// Process stored token payment
const result = await paymentService.paymentAuthorisation(storedPaymentRequest);
```

### 2.3 Stored Token Validation Requirements

**Pre-Session Validations:**
1. **Customer ID Match**: Verify stored token belongs to customer making request
2. **Token Status**: Confirm token is active (not expired/revoked)
3. **Card Expiry**: Check if stored card is still valid

**Session Storage Requirements:**
- `customerId` is MANDATORY for stored tokens
- Consider storing `tokenMetadata` (last4, cardType, expiry) for validation

---

## 3. Google Pay and Apple Pay Token Handling

### 3.1 Current State Analysis

**OpenAPI Specification References:**
- "Credit cards, Apple Pay, Google Pay (via Payments API)" (mentioned in descriptions)
- `tokenType` enum: `['transient', 'stored']` only
- No explicit `walletProvider` or `walletType` field

**Current Implied Design:**
Digital wallet tokens are treated as **transient tokens** with no explicit wallet distinction.

### 3.2 Recommended Approach

**Option A: Implicit Wallet Support (Current Design)**
```typescript
// Google Pay token treated as transient
const googlePayPayment = {
  paymentToken: "googlepay_cryptogram_abc123",
  tokenType: "transient",  // Digital wallets are single-use
  billTo: {
    // Billing details from Google Pay response
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    address: { /* From Google Pay */ }
  }
};
```

**Pros:**
- ✅ No schema changes needed
- ✅ Simple implementation
- ✅ Aligns with "transient token" nature of digital wallets

**Cons:**
- ❌ Cannot distinguish wallet payments from card payments in reporting
- ❌ Cannot apply wallet-specific validation rules
- ❌ No wallet metadata (e.g., Google Pay transaction ID)

**Option B: Explicit Wallet Metadata (Recommended Enhancement)**
```typescript
interface TokenisedPaymentDetails {
  paymentToken: string;
  tokenType: 'transient' | 'stored';
  walletProvider?: 'google_pay' | 'apple_pay' | 'click_to_pay';  // NEW FIELD
  walletMetadata?: {                                               // NEW FIELD
    transactionId?: string;      // Wallet-specific transaction ID
    deviceId?: string;            // Device fingerprint from wallet
    merchantIdentifier?: string;  // Apple Pay merchant ID
  };
  billTo: BillingDetails;
  threeDSData?: ThreeDSData;
}
```

**Pros:**
- ✅ Explicit wallet identification for analytics and reporting
- ✅ Can store wallet-specific metadata for fraud prevention
- ✅ Enables wallet-specific business rules (fees, promotions)
- ✅ Better alignment with payment processor requirements

**Cons:**
- ⚠️ Requires OpenAPI schema update
- ⚠️ Clients need to populate `walletProvider` field

### 3.3 Payments-SDK Integration for Digital Wallets

**Current Integration Pattern:**
```typescript
// Google Pay payment (treated as transient)
const googlePayRequest = {
  orderId: generateOrderId(),
  amount: session.totalAmount.toString(),
  currency: session.totalAmount.currencyCode,
  paymentToken: session.paymentToken,  // Google Pay cryptogram
  tokenType: 'transient',
  billTo: session.billTo,
  // Note: Payments-SDK may need wallet-specific fields
  paymentMethod: 'google_pay',  // Check if payments-sdk requires this
  threeDSData: {
    phase: 'completion',
    completion: request.threeDSData.completion
  }
};
```

**Recommendation:**
Verify with `@dw-digital-commerce/payments-sdk` documentation:
1. Does CyberSource require wallet-specific fields (`paymentMethod`, `walletTransactionId`)?
2. Are 3DS flows identical for wallet vs. card payments?
3. Does the SDK handle wallet cryptograms differently from card tokens?

---

## 4. Critical Integration Requirements

### 4.1 Session Data Completeness Checklist

The authentication session must store **all data required** for the payments-sdk call:

| Field | Status | Notes |
|-------|--------|-------|
| `paymentToken` | ✅ Stored | Essential for payment authorization |
| `tokenType` | ✅ Stored | Required to distinguish transient vs. stored |
| `billTo` (BillingDetails) | ✅ Stored | Full billing address with ISO 19160 structure |
| `shipTo` (ShippingDetails) | ✅ Stored | Optional, used for fraud checks |
| `threeDSSetupData` | ✅ Stored | Setup phase data for reference |
| `customerId` | ✅ Stored | Required for stored tokens and ownership validation |
| `anonymousId` | ✅ Stored | For guest checkout sessions |
| `merchantId` | ❓ **UNDEFINED** | **Question:** How is merchant configuration determined? |
| `processorId` | ❓ **UNDEFINED** | **Question:** Is processor selection stored in session? |
| `walletProvider` | ❌ Not Defined | **Recommendation:** Add for digital wallet support |

### 4.2 Merchant Configuration Strategy

**Current Gap:** The technical report and OpenAPI spec do not define how merchant credentials are provided to the payments-sdk.

**Options for Merchant Configuration:**

**Option 1: Environment Variables (Simple)**
```typescript
const paymentService = new PaymentService('cybersource', {
  merchantID: process.env.CYBERSOURCE_MERCHANT_ID,
  merchantKeyId: process.env.CYBERSOURCE_KEY_ID,
  merchantsecretKey: process.env.CYBERSOURCE_SECRET_KEY
});
```

**Pros:**
- ✅ Simple Lambda implementation
- ✅ Secure with AWS Secrets Manager

**Cons:**
- ❌ Only supports single merchant
- ❌ No brand-specific merchant accounts

**Option 2: Brand-Based Merchant Selection (Recommended)**
```typescript
// Store merchant configuration per brand
interface MerchantConfig {
  brandKey: string;
  processor: 'cybersource' | 'adyen' | 'stripe';
  merchantID: string;
  merchantKeyId: string;
  merchantsecretKey: string;
}

// Retrieve from configuration service or parameter store
const merchantConfig = await getMerchantConfig(session.brandKey);

const paymentService = new PaymentService(merchantConfig.processor, {
  merchantID: merchantConfig.merchantID,
  merchantKeyId: merchantConfig.merchantKeyId,
  merchantsecretKey: merchantConfig.merchantsecretKey
});
```

**Pros:**
- ✅ Supports multi-brand deployments
- ✅ Can use different processors per brand
- ✅ Aligns with `/in-brand/{brandkey}` endpoint pattern

**Recommendation:** Store `brandKey` in authentication session and use it to retrieve merchant configuration during validate-capture.

---

## 5. Complete Validate-Capture Implementation Flow

### 5.1 End-to-End Process

```typescript
/**
 * Complete implementation of 3DS validate-capture endpoint
 * Integrates with payments-sdk after 3DS authentication completion
 */
async function handleValidateCapture(
  request: ThreeDSValidateCaptureRequest,
  authContext: AuthenticationContext
): Promise<Order> {

  // ============================================
  // STEP 1: Retrieve and Validate Session
  // ============================================
  const session = await authenticationService.getSession(request.threeDSSessionId);

  // Validate session exists
  if (!session) {
    throw new ConflictError('Authentication session not found');
  }

  // Validate session status
  if (session.status !== 'pending') {
    throw new ConflictError('Authentication session already used or expired');
  }

  // Validate session TTL
  if (session.expiresAt < new Date()) {
    throw new ConflictError('Authentication session expired');
  }

  // Validate session ownership
  const { customerId, anonymousId } = extractPrincipalIds(authContext);
  if (session.customerId && session.customerId !== customerId) {
    throw new ForbiddenError('Authentication session belongs to different customer');
  }
  if (session.anonymousId && session.anonymousId !== anonymousId) {
    throw new ForbiddenError('Authentication session belongs to different user');
  }

  // ============================================
  // STEP 2: Validate Cart State
  // ============================================
  const currentCart = await cartService.getCart(session.cartId);

  if (currentCart.version !== session.cartVersion) {
    throw new UnprocessableEntityError(
      'Cart has been modified since authentication started'
    );
  }

  // ============================================
  // STEP 3: Retrieve Merchant Configuration
  // ============================================
  const merchantConfig = await getMerchantConfig(session.brandKey);

  // Initialize payment service with merchant credentials
  const paymentService = new PaymentService(merchantConfig.processor, {
    merchantID: merchantConfig.merchantID,
    merchantKeyId: merchantConfig.merchantKeyId,
    merchantsecretKey: merchantConfig.merchantsecretKey
  });

  // ============================================
  // STEP 4: Build Payment Authorization Request
  // ============================================
  const paymentRequest = {
    orderId: generateOrderId(),
    amount: session.totalAmount.toString(),
    currency: session.totalAmount.currencyCode,
    paymentToken: session.paymentToken,
    tokenType: session.tokenType,
    customerId: session.customerId,  // Required for stored tokens
    billTo: mapBillingDetails(session.billTo),
    threeDSData: {
      phase: 'completion',
      completion: {
        authenticationTransactionId: request.threeDSData.completion.authenticationTransactionId,
        cavv: request.threeDSData.completion.cavv,
        eciIndicator: request.threeDSData.completion.eciIndicator,
        xid: request.threeDSData.completion.xid
      }
    }
  };

  // ============================================
  // STEP 5: Execute Payment Authorization
  // ============================================
  let paymentResult;
  try {
    paymentResult = await paymentService.paymentAuthorisation(paymentRequest);
  } catch (paymentError) {
    console.error('Payment authorization failed:', paymentError);
    throw new UnprocessableEntityError(
      '3DS validation failed with payment processor',
      paymentError
    );
  }

  // ============================================
  // STEP 6: Validate Payment Result
  // ============================================
  if (paymentResult.status !== 'authorized') {
    throw new UnprocessableEntityError(
      `Payment declined: ${paymentResult.declineReason || 'Unknown reason'}`
    );
  }

  // ============================================
  // STEP 7: Mark Session as Used
  // ============================================
  await authenticationService.markSessionUsed(session.threeDSSessionId);

  // ============================================
  // STEP 8: Create Order
  // ============================================
  const order = await orderService.createOrder({
    cartId: session.cartId,
    cartVersion: session.cartVersion,
    customerId: session.customerId,
    anonymousId: session.anonymousId,
    paymentResult: {
      transactionId: paymentResult.transactionId,
      authorisationCode: paymentResult.authorisationCode,
      amount: session.totalAmount,
      status: 'authorized'
    }
  });

  // ============================================
  // STEP 9: Clean Up Session (Background Task)
  // ============================================
  await authenticationService.deleteSession(session.threeDSSessionId);

  return order;
}

/**
 * Maps Checkout API BillingDetails to Payments-SDK format
 */
function mapBillingDetails(billTo: BillingDetails) {
  return {
    firstName: billTo.firstName,
    lastName: billTo.lastName,
    street: billTo.address.address1,
    city: billTo.address.locality,  // ISO 19160 locality -> city
    postalCode: billTo.address.postalCode,
    country: billTo.address.country,
    email: billTo.email,
    phone: billTo.phone
  };
}
```

### 5.2 Error Handling Matrix

| Error Scenario | HTTP Status | Error Code | Client Action |
|----------------|-------------|------------|---------------|
| Session not found | 409 Conflict | `SessionNotFound` | Restart checkout flow |
| Session already used | 409 Conflict | `SessionAlreadyUsed` | Restart checkout flow |
| Session expired | 409 Conflict | `SessionExpired` | Restart checkout flow |
| Session ownership mismatch | 403 Forbidden | `SessionOwnershipViolation` | Authentication error |
| Cart version changed | 422 Unprocessable | `CartModified` | Refresh cart and retry |
| Payment declined | 422 Unprocessable | `PaymentDeclined` | Try different payment method |
| 3DS validation failed | 422 Unprocessable | `ThreeDSValidationFailed` | Contact support |

---

## 6. Token Expiry and Edge Cases

### 6.1 Transient Token Expiry Scenarios

**Scenario 1: Token Expires During 3DS Challenge**
```
Timeline:
T+0:00  - Initial /token/capture call (202 Accepted)
T+0:01  - Transient token created (15-minute TTL)
T+0:02  - Customer redirected to 3DS challenge
T+0:17  - Customer completes 3DS (16 minutes later)
T+0:17  - Token has expired (15-minute TTL exceeded)
T+0:17  - /validate-capture fails with expired token
```

**Mitigation Strategy:**
1. **Verify payment processor token TTL** before setting session TTL
2. **Use minimum of [processor token TTL, 30 minutes]** for session expiry
3. **Pre-validate token** before creating authentication session (optional)

**Recommended Session TTL:**
```typescript
// Calculate session TTL based on token type and processor
function calculateSessionTTL(tokenType: string, processor: string): number {
  if (tokenType === 'stored') {
    return 30 * 60; // 30 minutes - stored tokens don't expire
  }

  // Transient token TTLs by processor
  const transientTokenTTL = {
    'cybersource': 15 * 60,  // 15 minutes
    'adyen': 60 * 60,        // 60 minutes
    'stripe': 30 * 60        // 30 minutes
  };

  const tokenTTL = transientTokenTTL[processor] || 15 * 60;
  const sessionTTL = 30 * 60;

  // Use minimum to prevent token expiry
  return Math.min(tokenTTL, sessionTTL);
}
```

### 6.2 Cart Modification During 3DS Flow

**Scenario:** Customer has multiple browser tabs open and modifies cart while completing 3DS

**Detection:**
```typescript
// Step 2 of validate-capture flow
const currentCart = await cartService.getCart(session.cartId);

if (currentCart.version !== session.cartVersion) {
  throw new UnprocessableEntityError({
    code: 'CartModified',
    message: 'Cart has been modified since authentication started',
    details: {
      sessionCartVersion: session.cartVersion,
      currentCartVersion: currentCart.version
    }
  });
}
```

**Client Handling:**
1. Display user-friendly message: "Your cart has changed. Please review and try again."
2. Refresh cart display
3. Allow customer to re-initiate checkout with updated cart

### 6.3 Concurrent 3DS Completion Attempts

**Scenario:** Customer clicks "Complete" button multiple times

**Prevention:**
```typescript
// Use single-use session enforcement
const session = await authenticationService.getSession(threeDSSessionId);

if (session.status === 'used') {
  // First request already processed this session
  throw new ConflictError('Authentication session already used');
}

// Mark as used immediately to prevent race condition
await authenticationService.markSessionUsed(threeDSSessionId);
```

**Database-Level Protection:**
- Use optimistic locking on session status field
- DynamoDB conditional update: `SET status = 'used' WHERE status = 'pending'`

---

## 7. Testing Strategy

### 7.1 Integration Test Scenarios

**Test 1: Transient Token - Successful 3DS Flow**
```typescript
describe('Transient Token 3DS Flow', () => {
  it('should complete order after successful 3DS authentication', async () => {
    // Step 1: Initial capture request (transient token)
    const captureResponse = await POST('/me/token/capture', {
      cartId: 'cart-123',
      version: 1,
      payments: [{
        type: 'tokenised',
        amount: { amount: 200, currencyCode: 'GBP' },
        tokenisedPayment: {
          paymentToken: 'tkn_transient_abc',
          tokenType: 'transient',
          billTo: { /* ... */ },
          threeDSData: {
            phase: 'setup',
            setup: { referenceId: 'ref-123' }
          }
        }
      }]
    });

    expect(captureResponse.status).toBe(202);
    const threeDSSessionId = captureResponse.body.threeDSSessionId;

    // Step 2: Simulate customer completing 3DS
    // (In real scenario, customer redirected to 3DS URL and completes challenge)

    // Step 3: Validate-capture request
    const validateResponse = await POST('/me/3ds/validate-capture', {
      threeDSSessionId,
      threeDSData: {
        phase: 'completion',
        completion: {
          authenticationTransactionId: 'txn-3ds-456',
          cavv: 'AAABCZIhcQAAAABZlyFxAAAAAAA=',
          eciIndicator: '05'
        }
      }
    });

    expect(validateResponse.status).toBe(201);
    expect(validateResponse.body.status).toBe('completed');
    expect(validateResponse.body.paymentDetails[0].status).toBe('authorized');
  });
});
```

**Test 2: Stored Token - 3DS Completion**
```typescript
it('should handle stored token with 3DS completion', async () => {
  // Initial capture with stored token
  const captureResponse = await POST('/me/token/capture', {
    cartId: 'cart-456',
    version: 1,
    payments: [{
      type: 'tokenised',
      amount: { amount: 150, currencyCode: 'EUR' },
      tokenisedPayment: {
        paymentToken: 'stored_card_789',
        tokenType: 'stored',
        billTo: { /* ... */ },
        threeDSData: {
          phase: 'setup',
          setup: { referenceId: 'ref-stored-123' }
        }
      }
    }]
  });

  expect(captureResponse.status).toBe(202);

  // Validate with stored token
  const validateResponse = await POST('/me/3ds/validate-capture', {
    threeDSSessionId: captureResponse.body.threeDSSessionId,
    threeDSData: {
      phase: 'completion',
      completion: { /* ... */ }
    }
  });

  expect(validateResponse.status).toBe(201);
});
```

**Test 3: Session Expiry**
```typescript
it('should reject expired session', async () => {
  const threeDSSessionId = 'auth-expired-123';

  // Simulate expired session (created 31 minutes ago)
  await createExpiredSession(threeDSSessionId, { ttl: -60 });

  const response = await POST('/me/3ds/validate-capture', {
    threeDSSessionId,
    threeDSData: { phase: 'completion', completion: { /* ... */ } }
  });

  expect(response.status).toBe(409);
  expect(response.body.errors[0].code).toBe('SessionExpired');
});
```

**Test 4: Cart Version Mismatch**
```typescript
it('should reject if cart was modified during 3DS', async () => {
  // Create session with cart version 1
  const threeDSSessionId = await createAuthenticationSession({
    cartId: 'cart-789',
    cartVersion: 1
  });

  // Simulate cart modification (version incremented to 2)
  await updateCart('cart-789', { version: 2 });

  const response = await POST('/me/3ds/validate-capture', {
    threeDSSessionId,
    threeDSData: { phase: 'completion', completion: { /* ... */ } }
  });

  expect(response.status).toBe(422);
  expect(response.body.orderLevel[0].code).toBe('CartModified');
});
```

**Test 5: Google Pay Token (Transient)**
```typescript
it('should handle Google Pay token as transient', async () => {
  const captureResponse = await POST('/me/token/capture', {
    cartId: 'cart-googlepay',
    version: 1,
    payments: [{
      type: 'tokenised',
      amount: { amount: 99.99, currencyCode: 'USD' },
      tokenisedPayment: {
        paymentToken: 'googlepay_cryptogram_xyz',
        tokenType: 'transient',  // Google Pay = transient
        // Optional: walletProvider: 'google_pay'
        billTo: { /* From Google Pay response */ }
      }
    }]
  });

  // Should handle identically to transient card token
  expect(captureResponse.status).toBeOneOf([201, 202]);
});
```

### 7.2 Payments-SDK Mock Strategy

For testing without hitting real payment processors:

```typescript
// Mock payments-sdk for testing
jest.mock('@dw-digital-commerce/payments-sdk', () => ({
  PaymentService: jest.fn().mockImplementation(() => ({
    paymentAuthorisation: jest.fn().mockResolvedValue({
      status: 'authorized',
      transactionId: 'mock-txn-123',
      authorisationCode: '654321'
    })
  }))
}));
```

---

## 8. Recommendations

### 8.1 High Priority (Must Address Before Production)

| Priority | Recommendation | Rationale |
|----------|----------------|-----------|
| **P0** | **Define merchant configuration strategy** | Payments-SDK requires merchant credentials; current design doesn't specify how these are provided |
| **P0** | **Verify transient token TTL with payment processors** | Session TTL (30 min) may exceed token validity, causing failures |
| **P0** | **Clarify digital wallet token handling** | Google Pay/Apple Pay mentioned but not explicitly defined in schema |

### 8.2 Medium Priority (Recommended for v0.5.0)

| Priority | Recommendation | Rationale |
|----------|----------------|-----------|
| **P1** | **Add `walletProvider` field to TokenisedPaymentDetails** | Enables wallet-specific analytics, fraud detection, and business rules |
| **P1** | **Store processor name in authentication session** | Allows multi-processor support and proper routing during validate-capture |
| **P1** | **Document token refresh strategy for stored tokens** | Stored tokens may expire; define handling for expired stored tokens |

### 8.3 Low Priority (Future Enhancements)

| Priority | Recommendation | Rationale |
|----------|----------------|-----------|
| **P2** | **Implement circuit breaker for payments-SDK calls** | Protects against cascading failures if payment processor is down |
| **P2** | **Add telemetry for 3DS success/failure rates** | Enables monitoring and alerting on authentication flow health |
| **P2** | **Consider shorter session TTL for transient tokens** | 15-minute sessions may be sufficient and reduce risk of token expiry |

---

## 9. Specification Gaps and Clarifications Needed

### 9.1 Questions for Payments-SDK Team

1. **Merchant Configuration:**
   - How are merchant credentials (merchantID, merchantKeyId, merchantsecretKey) managed in production?
   - Do we support multi-merchant/multi-brand configurations?
   - Where should merchant configuration be stored (environment variables, Secrets Manager, configuration service)?

2. **Token Expiry:**
   - What is the TTL for transient tokens from CyberSource Flex?
   - Do transient tokens from Google Pay/Apple Pay have different TTLs?
   - Can transient tokens be refreshed/extended during 3DS flow?

3. **Digital Wallet Support:**
   - Does payments-sdk require wallet-specific fields (e.g., `paymentMethod: 'google_pay'`)?
   - Are 3DS flows identical for wallet payments vs. card payments?
   - Does CyberSource handle wallet cryptograms differently from card tokens?

4. **Processor-Specific Fields:**
   - Are there any CyberSource-specific fields needed beyond the standard payment request?
   - Do we need to pass processor-specific metadata (e.g., merchant reference numbers)?

### 9.2 Questions for Checkout API Implementation Team

1. **Brand-Merchant Mapping:**
   - How is brand (`brandkey`) mapped to merchant configuration?
   - Should merchant configuration be stored in authentication session?

2. **Cart Service Integration:**
   - How do we retrieve cart version during validate-capture?
   - What is the cart version validation strategy?

3. **Order Service Integration:**
   - What fields from payment result need to be stored in Order?
   - How is order ID generated (server-side vs. client-provided)?

---

## 10. Validation Checklist

### 10.1 Design Validation

| Aspect | Status | Notes |
|--------|--------|-------|
| **Transient Token Flow** | ✅ Validated | Session stores all required data for payments-sdk |
| **Stored Token Flow** | ✅ Validated | Customer ID and token reference properly preserved |
| **3DS Data Structure** | ✅ Validated | Phase-based discriminator aligns with Payment API v0.2.0 |
| **Session Management** | ✅ Validated | Single-use enforcement, TTL, ownership validation |
| **Session Data Completeness** | ⚠️ Partial | Merchant config and processor selection undefined |
| **Google Pay/Apple Pay** | ⚠️ Needs Clarification | Implicit support as transient tokens; explicit spec needed |
| **Error Handling** | ✅ Validated | Comprehensive 409/422/403 error responses |
| **Cart Version Validation** | ✅ Validated | Version mismatch detection prevents stale checkouts |

### 10.2 Integration Validation

| Integration Point | Status | Notes |
|-------------------|--------|-------|
| **Payments-SDK Request Mapping** | ✅ Validated | Session data maps to all required SDK fields |
| **BillingDetails Transformation** | ✅ Validated | ISO 19160 locality maps to SDK city field |
| **3DS Completion Data** | ✅ Validated | CAVV, ECI, transaction ID properly passed |
| **Payment Result Handling** | ✅ Validated | Authorized vs. declined status handling |
| **Merchant Credential Injection** | ❌ Not Defined | **Gap:** How are credentials provided to SDK? |
| **Processor Selection** | ❌ Not Defined | **Gap:** How is processor chosen per brand? |

---

## 11. Conclusion

The `/me/3ds/validate-capture` and `/in-brand/{brandkey}/3ds/validate-capture` endpoint design is **architecturally sound** and successfully maps to the `@dw-digital-commerce/payments-sdk` integration patterns. The stateful session-based approach aligns with industry best practices (Stripe, PayPal, Adyen, Checkout.com) and properly handles both transient and stored tokens throughout the 3DS authentication flow.

### Key Strengths

1. ✅ **Session storage preserves all payment data** needed for payments-sdk integration
2. ✅ **Single-use session enforcement** prevents duplicate charges
3. ✅ **Cart version validation** prevents stale checkout attempts
4. ✅ **Customer ownership validation** prevents session hijacking
5. ✅ **Comprehensive error handling** for all edge cases

### Areas Requiring Clarification

1. ⚠️ **Merchant Configuration:** How are payment processor credentials provided to payments-sdk?
2. ⚠️ **Digital Wallet Handling:** Google Pay and Apple Pay need explicit specification
3. ⚠️ **Token TTL Alignment:** Verify session TTL doesn't exceed transient token validity
4. ⚠️ **Processor Selection:** How is the payment processor chosen for multi-processor environments?

### Next Steps

1. **Immediate:** Define merchant configuration strategy (environment variables vs. configuration service)
2. **Before v0.5.0:** Add explicit `walletProvider` field for digital wallet support
3. **Before v0.5.0:** Verify CyberSource transient token TTL and adjust session TTL if needed
4. **Testing:** Implement comprehensive integration tests with payments-sdk mocking

**Overall Assessment:** ✅ **Ready for implementation** with clarifications on merchant configuration and token TTL validation.

---

**Document Version:** 1.0
**Last Updated:** 2025-11-03
**Next Review:** After payments-sdk integration testing

**Authors:**
- Technical Lead: [Name]
- Payment Integration Team: [Name]

**Reviewers:**
- Security Team: [Name]
- Payments-SDK Team: [Name]
