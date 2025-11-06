# OpenAPI Specification: 3DS Validate-Capture Endpoints

**Version:** 1.0
**Status:** Review Complete
**Target:** Checkout API v0.5.0
**Last Updated:** 2025-11-04
**For:** Technical Architect (Microservice TA), API Designers

---

## Executive Summary

This specification reviews the current OpenAPI implementation of the 3DS validate-capture endpoints in `checkout-openapi-unresolved.yaml` and provides recommendations for enhancements aligned with the architectural research documented in [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md).

### Current Implementation Status: ✅ SUBSTANTIALLY COMPLETE

The OpenAPI specification (v0.5.0) fully implements both validate-capture endpoints with comprehensive schemas, examples, and error handling. **One enhancement is recommended** to fully align with the security requirements documented in the technical reports.

---

## Table of Contents

1. [Endpoint Implementation Review](#1-endpoint-implementation-review)
2. [Schema Validation](#2-schema-validation)
3. [Enhancement Recommendations](#3-enhancement-recommendations)
4. [Payment Decline Handling Philosophy](#4-payment-decline-handling-philosophy)
5. [Implementation Checklist](#5-implementation-checklist)
6. [Testing Requirements](#6-testing-requirements)
7. [Appendix: Complete Schema Reference](#7-appendix-complete-schema-reference)

---

## 1. Endpoint Implementation Review

### 1.1 `/me/3ds/validate-capture` (Personal Checkout API)

**Location:** `checkout-openapi-unresolved.yaml` lines 550-740

#### ✅ Implementation Completeness

| Aspect | Status | Notes |
|--------|--------|-------|
| POST operation | ✅ Complete | Full operation definition with description |
| Request body | ✅ Complete | `ThreeDSValidateCaptureRequest` schema |
| Idempotency support | ✅ Complete | `Idempotency-Key` header parameter |
| 201 Created response | ✅ Complete | Returns `Order` schema with Location header |
| 400 Bad Request | ✅ Complete | Structure validation errors |
| 401 Unauthorized | ✅ Complete | Missing/invalid authentication |
| 403 Forbidden | ⚠️ **MISSING** | **Session ownership validation failures** |
| 409 Conflict | ✅ Complete | Session conflicts (used, expired, cart modified) |
| 422 Unprocessable | ✅ Complete | 3DS validation failures, business errors |
| 429 Too Many Requests | ✅ Complete | Rate limiting |
| 500 Internal Error | ✅ Complete | Server errors |
| OPTIONS (CORS) | ✅ Complete | Pre-flight support |
| Examples | ✅ Complete | Success and error scenarios |

#### Request Example (Lines 593-614)

```yaml
examples:
  successful-3ds-completion:
    summary: Successful 3DS authentication completion
    value:
      threeDSSessionId: "auth-3169811e-fa0a-321"
      threeDSData:
        phase: "completion"
        completion:
          authenticationTransactionId: "txn_3ds_67890"
          cavv: "AAABCZIhcQAAAABZlyFxAAAAAAA="
          eciIndicator: "05"
```

### 1.2 `/in-brand/{brandkey}/3ds/validate-capture` (Stateless Checkout API)

**Location:** `checkout-openapi-unresolved.yaml` lines 1002-1196

#### ✅ Implementation Completeness

| Aspect | Status | Notes |
|--------|--------|-------|
| POST operation | ✅ Complete | Full operation definition |
| Path parameter | ✅ Complete | `brandkey` with examples (uklait, us4s, auwp) |
| Request body | ✅ Complete | Same `ThreeDSValidateCaptureRequest` schema |
| Response structure | ✅ Complete | Identical to `/me` endpoint |
| 403 Forbidden | ⚠️ **MISSING** | **Session ownership validation failures** |
| OPTIONS (CORS) | ✅ Complete | Pre-flight support |
| Examples | ✅ Complete | Call center and backend service scenarios |

#### Brand Context Support

```yaml
parameters:
  - in: path
    name: brandkey
    required: true
    description: Key of the brand.
    schema:
      type: string
    examples:
      example-uk-brand:
        value: "uklait"
      example-us-brand:
        value: "us4s"
      example-au-brand:
        value: "auwp"
```

---

## 2. Schema Validation

### 2.1 `ThreeDSValidateCaptureRequest` Schema

**Location:** Lines 1818-1893

#### ✅ Alignment with Payment API v0.2.0

```yaml
ThreeDSValidateCaptureRequest:
  type: object
  description: |
    Request to complete order creation after successful 3D Secure authentication.
    Aligned with Payment API v0.2.0 phase-based discriminator model.
  required:
    - threeDSSessionId
    - threeDSData
  properties:
    threeDSSessionId:
      type: string
      description: Authentication session ID from 202 response
      example: "auth-3169811e-fa0a-321"
    threeDSData:
      type: object
      required:
        - phase
        - completion
      properties:
        phase:
          type: string
          enum: [completion]
          description: Must be "completion"
          example: "completion"
        completion:
          type: object
          required:
            - authenticationTransactionId
            - cavv
            - eciIndicator
          properties:
            authenticationTransactionId:
              type: string
              example: "txn_3ds_67890"
            cavv:
              type: string
              example: "AAABCZIhcQAAAABZlyFxAAAAAAA="
            eciIndicator:
              type: string
              example: "05"
            xid:
              type: string
              description: Optional for 3DS v1
              example: "MDAyMTExMTYwNTI1MzEzNjI4Njg="
```

#### ✅ Validation: COMPLETE

- Phase-based discriminator (completion) matches Payment API v0.2.0
- All required 3DS completion fields present (CAVV, ECI, transaction ID)
- Optional XID field for 3DS v1 backward compatibility
- Clear descriptions and examples

### 2.2 `ThreeDSAuthenticationRequired` Response Schema

**Location:** Lines 1731-1816 (202 response from initial capture)

#### ✅ Alignment with Technical Report Recommendations

```yaml
ThreeDSAuthenticationRequired:
  type: object
  required:
    - threeDSSessionId      # ✅ Session identifier
    - cartId                # ✅ Original cart reference
    - threeDSUrl            # ✅ Challenge URL
    - transactionId         # ✅ Processor transaction ID
    - paymentContext        # ✅ Payment details
    - nextAction            # ✅ Redirect instructions
  properties:
    threeDSSessionId:
      type: string
      example: "auth-3169811e-fa0a-321"
    nextAction:
      type: object
      description: Follows Stripe-style pattern
      properties:
        type:
          type: string
          enum: [redirect_to_url]
        redirectToUrl:
          type: object
          properties:
            url:
              type: string
              format: uri
            method:
              type: string
              enum: [GET, POST]
            returnUrl:
              type: string
              format: uri
```

#### ✅ Validation: COMPLETE

All fields from technical report Section 4 (Session Data Completeness) are present:
- ✅ `threeDSSessionId` - Unique session identifier
- ✅ `cartId` - Original cart reference
- ✅ `threeDSUrl` - Challenge URL for customer redirect
- ✅ `transactionId` - Processor transaction tracking
- ✅ `paymentContext` - Amount and payment method context
- ✅ `nextAction` - Industry-standard redirect pattern

---

## 3. Enhancement Recommendations

### 3.1 Add HTTP 403 Forbidden Response

**Priority:** HIGH
**Source:** [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md) Section 6 (Session Ownership Validation)

#### Issue

The technical report documents session ownership validation as a critical security requirement:

> "Session ownership validation ensures that only the customer (authenticated or anonymous) who created the authentication session can complete it. This prevents session hijacking attacks where an attacker obtains an `threeDSSessionId` but cannot complete the transaction without the original customer's OAuth token."

However, the current OpenAPI specification **does not include an HTTP 403 response** for ownership validation failures. The 409 Conflict response covers session state issues (not found, used, expired) but not authorization failures.

#### Recommended Addition

Add the following response to **both** validate-capture endpoints:

**Location:** `/me/3ds/validate-capture` responses (after line 663)
**Location:** `/in-brand/{brandkey}/3ds/validate-capture` responses (after line 1103)

```yaml
"403":
  description: |
    **Forbidden - Session Ownership Validation Failed**

    This error occurs when the authentication session was created by a different
    principal (customer or anonymous user) than the one making the completion request.

    Session ownership is validated by comparing the OAuth token's principal identifier
    (customerId for authenticated users, anonymousId for guest users) with the
    principal who created the session.

    **Common Causes:**
    - Session created by customer A, completion attempted by customer B
    - Session created in guest checkout, completion attempted by authenticated user
    - Session created in one brand context, completion attempted in different brand

    **Security Implication:**
    This is a potential session hijacking attempt and is logged with HIGH severity
    for security monitoring.
  content:
    application/json:
      schema:
        $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/CommonModelDefinitionSuite/1.0.0#/components/schemas/ErrorMessageResponse'
      example:
        errors:
          - code: "SessionOwnershipViolation"
            message: "Authentication session belongs to a different customer"
            type: "Forbidden"
        statusCode: 403
        message: "Authentication session belongs to a different customer"
```

#### Rationale

1. **Security Clarity**: Distinguishes authorization failures (403) from resource state conflicts (409)
2. **Industry Standard**: HTTP 403 is the standard response for "authenticated but not authorized"
3. **Monitoring**: Enables separate alerting for potential security attacks vs operational issues
4. **Developer Experience**: Clear signal that the issue is permission-based, not session state

### 3.2 Enhance 409 Conflict Response Description

**Priority:** MEDIUM

Update the 409 response description to clarify it does NOT include ownership violations:

**Current (Lines 664-673):**
```yaml
"409":
  description: |
    **Conflict Errors**

    409 errors occur when there are conflicts with the authentication session:
    - Authentication session already used
    - Authentication session expired (>30 minutes)
    - Cart has been modified since authentication started
    - Duplicate idempotency key with different parameters
```

**Recommended Update:**
```yaml
"409":
  description: |
    **Conflict Errors**

    409 errors occur when there are conflicts with the authentication session **state**:
    - Authentication session already used (single-use enforcement)
    - Authentication session expired (>30 minutes TTL exceeded)
    - Authentication session not found or deleted
    - Cart has been modified since authentication started (version mismatch)
    - Duplicate idempotency key with different parameters

    **Note:** Session ownership validation failures return HTTP 403 Forbidden,
    not 409 Conflict. See 403 response documentation for details.
```

### 3.3 Add Session Ownership to 202 Response Description

**Priority:** LOW (Documentation Enhancement)

**Location:** Lines 436-467 (202 response description in `/me/token/capture`)

Add a note about session ownership in the 202 response description:

```yaml
"202":
  description: |
    3D Secure authentication required - order pending customer action

    **Session Creation:**
    An authentication session is created server-side with a unique `threeDSSessionId`.
    This session is bound to the OAuth token's principal (customerId for authenticated
    users, anonymousId for guest users) and can only be completed by the same principal.

    **Session Lifetime:** 30 minutes (expires if 3DS not completed within window)
    **Session Usage:** Single-use (cannot be reused after completion)

    Use the `/3ds/validate-capture` endpoint with the `threeDSSessionId` and 3DS
    completion data to finalize the order.
```

---

## 4. Payment Decline Handling

### 4.1 Design Decision: HTTP 422 for Payment Declines

**Status:** ✅ IMPLEMENTED in v0.5.0 (lines 154-207)

Payment declines return **HTTP 422**, not HTTP 200. This differs from the Payment API which returns HTTP 200 for declines.

**Why Different?**
- **Checkout API**: Creates orders → No order created = HTTP 422
- **Payment API**: Processes payments → Transaction attempted = HTTP 200

**Key Points:**
- Supports multiple payment methods (e.g., gift card + credit card)
- All payments must succeed; any failure rolls back entire transaction
- Consistent error handling: all checkout failures (stock, delivery, payment) use HTTP 422

### 4.2 Payment Validation Codes

The OpenAPI specification includes comprehensive payment-related validation codes:

**Supported Payment Decline Codes:**

These codes map directly to error codes returned by the `@dw-digital-commerce/payments-sdk`:

- `PaymentDeclined` - Generic payment decline (maps to SDK's `BUSINESS_PAYMENT_DECLINED`)
- `InsufficientFunds` - Gift voucher or stored payment has insufficient balance (maps to SDK's `BUSINESS_INSUFFICIENT_FUNDS`)
- `CardExpired` - Payment card has expired (maps to SDK's `BUSINESS_CARD_EXPIRED`)

**Note:** The SDK only provides these three business error codes for payment declines. More granular codes (like specific card decline reasons) are not available from the payment providers.

### 4.3 Payment Decline Examples

The BusinessError response (lines 2013-2105) includes four payment decline examples:

1. **payment-declined-single**: Single payment method declined
2. **payment-declined-mixed-payment**: Mixed payment with credit card failure
3. **payment-insufficient-funds-gift-card**: Gift card with insufficient balance
4. **payment-multiple-decline-reasons**: Multiple payment failures in one request

### 4.4 Client Implementation Guidance

See OpenAPI lines 171-207 for complete implementation pattern and example response.

---

## 5. Implementation Checklist

### For Technical Architect (Microservice TA)

- [ ] **Add HTTP 403 response** to `/me/3ds/validate-capture` endpoint
- [ ] **Add HTTP 403 response** to `/in-brand/{brandkey}/3ds/validate-capture` endpoint
- [ ] **Update 409 description** to clarify scope (state conflicts only)
- [ ] **Enhance 202 description** to document session ownership (optional)
- [ ] **Add example** for 403 response showing ownership violation error
- [ ] **Validate with Spectral** linter after changes
- [ ] **Update OpenAPI version** to v0.5.1 (patch) or v0.6.0 (minor) based on versioning strategy
- [ ] **Regenerate resolved spec** with new changes
- [ ] **Update CHANGELOG** with added 403 response

### Generated Artifacts to Update

```bash
# After OpenAPI changes
npm run validate:openapi:schemas        # Validate schema correctness
npm run validate:openapi:spectral       # Run Spectral linter rules
# Regenerate any client SDKs or documentation
```

### Version Recommendation

**Semantic Versioning Decision:**

- **v0.5.1** (patch): If treating this as a documentation/clarification fix
- **v0.6.0** (minor): If treating this as a new feature (additional response code)

**Recommendation:** Use **v0.6.0** because adding a new HTTP response code is a backward-compatible API enhancement, qualifying as a minor version increment under semver.

---

## 6. Testing Requirements

### 6.1 OpenAPI Validation Testing

After implementing the 403 response:

```bash
# Schema validation
npm run validate:openapi:schemas

# Spectral linting
npm run validate:openapi:spectral

# Expected: No errors, all rules pass
```

### 6.2 API Contract Testing

#### Test Scenario: Session Ownership Violation

**Test Case 1: Cross-Customer Ownership Violation**

```typescript
// Setup: Customer A creates session
const sessionA = await POST('/me/token/capture', {
  headers: { Authorization: 'Bearer <customer_a_token>' },
  body: checkoutDraft
});
const threeDSSessionId = sessionA.body.threeDSSessionId;

// Test: Customer B attempts completion
const response = await POST('/me/3ds/validate-capture', {
  headers: { Authorization: 'Bearer <customer_b_token>' },
  body: {
    threeDSSessionId,
    threeDSData: { phase: 'completion', completion: {...} }
  }
});

// Assert
expect(response.status).toBe(403);
expect(response.body.errors[0].code).toBe('SessionOwnershipViolation');
```

**Test Case 2: Guest to Authenticated Ownership Violation**

```typescript
// Setup: Guest user creates session
const sessionGuest = await POST('/me/token/capture', {
  headers: { Authorization: 'Bearer <anonymous_token>' },
  body: checkoutDraft
});
const threeDSSessionId = sessionGuest.body.threeDSSessionId;

// Test: Authenticated user attempts completion
const response = await POST('/me/3ds/validate-capture', {
  headers: { Authorization: 'Bearer <authenticated_token>' },
  body: {
    threeDSSessionId,
    threeDSData: { phase: 'completion', completion: {...} }
  }
});

// Assert
expect(response.status).toBe(403);
```

**Test Case 3: Brand Context Mismatch**

```typescript
// Setup: Create session in brand 'uklait'
const sessionUK = await POST('/in-brand/uklait/token/capture', {
  headers: { Authorization: 'Bearer <service_token>' },
  body: checkoutDraft
});
const threeDSSessionId = sessionUK.body.threeDSSessionId;

// Test: Attempt completion in brand 'us4s'
const response = await POST('/in-brand/us4s/3ds/validate-capture', {
  headers: { Authorization: 'Bearer <service_token>' },
  body: {
    threeDSSessionId,
    threeDSData: { phase: 'completion', completion: {...} }
  }
});

// Assert
expect(response.status).toBe(403);
expect(response.body.errors[0].message).toContain('brand context');
```

### 6.3 Documentation Testing

- [ ] Verify 403 response appears in generated API documentation (Swagger UI, ReDoc)
- [ ] Confirm examples render correctly in documentation tools
- [ ] Validate error code `SessionOwnershipViolation` is documented in error reference

---

## 7. Appendix: Complete Schema Reference

### 7.1 Request Schema Hierarchy

```
ThreeDSValidateCaptureRequest
├── threeDSSessionId: string (required)
└── threeDSData: object (required)
    ├── phase: "completion" (required, enum)
    └── completion: object (required)
        ├── authenticationTransactionId: string (required)
        ├── cavv: string (required)
        ├── eciIndicator: string (required)
        └── xid: string (optional, for 3DS v1)
```

### 7.2 Response Schema Hierarchy

#### 201 Created - Success
```
Order
├── id: string (order ID)
├── version: number (always 1 for new orders)
├── status: "completed"
├── paymentDetails: array
│   └── OrderPaymentDetail
│       ├── type: "tokenised" | "stored"
│       ├── amount: Money
│       ├── status: "authorized" | "settled"
│       └── tokenisedPaymentResult
│           ├── transactionId: string
│           ├── authorisationCode: string
│           └── merchantReference: string
└── ... (all Cart fields inherited)
```

#### 202 Accepted - 3DS Required (Initial Capture)
```
ThreeDSAuthenticationRequired
├── threeDSSessionId: string (session ID)
├── cartId: string
├── threeDSUrl: string (challenge URL)
├── transactionId: string
├── merchantReference: string
├── paymentContext: object
│   ├── amount: Money
│   └── paymentMethod: "tokenised"
└── nextAction: object
    ├── type: "redirect_to_url"
    └── redirectToUrl: object
        ├── url: string
        ├── method: "GET" | "POST"
        └── returnUrl: string
```

#### 403 Forbidden - Ownership Violation (RECOMMENDED)
```
ErrorMessageResponse
├── errors: array
│   └── ErrorMessage
│       ├── code: "SessionOwnershipViolation"
│       ├── message: string
│       └── type: "Forbidden"
├── statusCode: 403
└── message: string
```

#### 409 Conflict - Session State Conflicts
```
ErrorMessageResponse
├── errors: array
│   └── ErrorMessage
│       ├── code: "SessionNotFound" | "SessionAlreadyUsed" | "SessionExpired" | "CartVersionMismatch"
│       ├── message: string
│       └── type: "Conflict"
├── statusCode: 409
└── message: string
```

#### 422 Unprocessable Entity - Business Validation Failures
```
CheckoutValidations
├── orderLevel: array
│   └── CheckoutValidationMessage
│       ├── code: string (e.g., "PaymentDeclined")
│       └── message: string
└── lineItemLevel: array
    └── LineItemCheckoutValidation
        ├── code: string
        ├── message: string
        └── lineItemId: string
```

### 7.3 Error Code Reference

| HTTP Status | Error Code | Meaning |
|-------------|------------|---------|
| 403 | `SessionOwnershipViolation` | Session belongs to different customer/user |
| 409 | `SessionNotFound` | Session doesn't exist or was deleted |
| 409 | `SessionAlreadyUsed` | Session already consumed (single-use violation) |
| 409 | `SessionExpired` | Session TTL exceeded (>30 minutes) |
| 409 | `CartVersionMismatch` | Cart modified since session creation |
| 422 | `PaymentDeclined` | Generic payment decline from processor |
| 422 | `CardDeclined` | Credit/debit card declined by issuer |
| 422 | `CardExpired` | Payment card has expired |
| 422 | `InsufficientFunds` | Insufficient gift voucher balance |
| 422 | `InvalidCardDetails` | Card details invalid or incomplete |
| 422 | `PaymentProcessorError` | Payment processor error |
| 422 | `FraudSuspected` | Payment blocked due to fraud |
| 422 | `PaymentMethodNotSupported` | Payment method not supported |
| 422 | `ThreeDSValidationFailed` | 3DS completion data invalid |
| 422 | `CartModified` | Cart content changed during 3DS flow |

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-04 | Checkout API Team | Initial review and enhancement recommendations |

---

**Next Steps:**

1. Review this specification with Technical Architect
2. Implement HTTP 403 response in OpenAPI spec
3. Update 409 description for clarity
4. Validate changes with Spectral linter
5. Proceed with Lambda implementation using [SPEC-Lambda-3DS-Validate-Capture-Implementation.md](./SPEC-Lambda-3DS-Validate-Capture-Implementation.md)

---

**Related Documents:**
- [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md) - Architectural research and design rationale
- [SPEC-Authentication-Session-Library.md](./SPEC-Authentication-Session-Library.md) - Session management library specification
- [INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md) - Payments SDK integration guide
- [README.md](./README.md) - Documentation navigation and overview
