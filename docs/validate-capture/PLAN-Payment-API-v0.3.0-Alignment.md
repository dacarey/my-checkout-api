# Implementation Plan: Payment API v0.3.0 Alignment

**Document Status:** DRAFT FOR REVIEW (v0.2)
**Created:** 2025-11-06
**Last Updated:** 2025-11-06
**Authors:** Technical Team
**Target Version:** Checkout API v0.5.0 (work in progress)

---

## Executive Summary

This document outlines the critical issues discovered during analysis of the Checkout API's `ThreeDSAuthenticationRequired` schema and proposes a comprehensive alignment strategy with Payment API v0.3.0.

### Critical Findings

1. **🔴 BLOCKER**: The current `ThreeDSAuthenticationRequired` schema is **missing the `stepUpToken` property**, which is **essential** for 3D Secure authentication to function. Without this JWT token, the frontend cannot initiate the 3DS challenge with Cardinal Commerce/Cybersource, rendering the entire 3DS flow non-functional.

2. **🔴 BLOCKER**: The schema lacks clear alignment with Payment API v0.3.0's `challengeInfo` structure, creating inconsistency between the two APIs that handle the same underlying 3DS flow.

3. **⚠️ Design Issue**: The current `nextAction` abstraction is redundant and over-engineered compared to the Payment API's direct `challengeInfo` approach.

### Proposed Solution

Redesign `ThreeDSAuthenticationRequired` to include a complete `challengeInfo` object that aligns with Payment API v0.3.0, while maintaining Checkout API-specific properties for session management (`threeDSSessionId`, `cartId`, `paymentContext`).

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Critical Issues](#2-critical-issues)
3. [Payment API v0.3.0 challengeInfo Structure](#3-payment-api-v030-challengeinfo-structure)
4. [Checkout API Current Structure](#4-checkout-api-current-structure)
5. [Gap Analysis](#5-gap-analysis)
6. [Proposed Solution](#6-proposed-solution)
7. [Implementation Details](#7-implementation-details)
8. [Migration Impact](#8-migration-impact)
9. [Validation Requirements](#9-validation-requirements)
10. [Decision Points](#10-decision-points)
11. [Timeline and Phases](#11-timeline-and-phases)

---

## 1. Current State Analysis

### 1.1 Context

The Checkout API currently references Payment API v0.2.0 for shared schemas (`AddressableParty`, `ThreeDSData`). Payment API has been upgraded to v0.3.0 with significant structural changes, particularly around 3DS authentication responses.

### 1.2 Affected Schemas

- **Checkout API**: `ThreeDSAuthenticationRequired` (returned in HTTP 202 responses from `/token/capture` endpoints)
- **Payment API**: `Payment3DSRequiredResponse` (returned in HTTP 202 responses from `/token/capture` endpoint)
- **Shared**: `ThreeDSData` (used in both initial capture and validate-capture requests)

### 1.3 Current References

```yaml
# checkout-openapi-unresolved.yaml (Line 1301)
PaymentBillingDetails:
  $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/AddressableParty'

# checkout-openapi-unresolved.yaml (Line 1304)
PaymentThreeDSData:
  $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/ThreeDSData'
```

---

## 2. Critical Issues

### 2.1 🔴 BLOCKER: Missing stepUpToken

**Issue**: The `ThreeDSAuthenticationRequired` schema does not include `stepUpToken`, which is **absolutely required** for 3DS authentication to work.

**Technical Background**:

The Cardinal Commerce/Cybersource 3DS flow requires the following steps:

```javascript
// Step 1: Receive 202 response from /token/capture
const { stepUpUrl, stepUpToken } = response.challengeInfo;

// Step 2: Create iframe
const iframe = document.createElement('iframe');

// Step 3: POST stepUpToken to stepUpUrl
const form = iframe.contentDocument.createElement('form');
form.method = 'POST';
form.action = stepUpUrl;

const jwtInput = document.createElement('input');
jwtInput.name = 'JWT';  // Cardinal Commerce expects 'JWT' parameter
jwtInput.value = stepUpToken;  // ← CRITICAL: Without this, authentication fails
form.appendChild(jwtInput);
form.submit();
```

**Without `stepUpToken`**:
- Frontend cannot authenticate the request to Cardinal Commerce
- The 3DS challenge is rejected before the customer sees it
- Payment cannot be completed
- **The entire 3DS flow is broken**

**Impact**: This is a **critical functional bug** that prevents 3DS authentication from working at all.

---

### 2.2 🔴 BLOCKER: Unclear Challenge URL Structure

**Issue**: Current schema uses generic `threeDSUrl` property without specifying its purpose.

**Current Structure** (Checkout API):
```yaml
threeDSUrl:
  type: string
  format: uri
  description: URL for the 3DS authentication challenge
  example: "https://3ds.psp.com/challenge/abc123"
```

**Payment API Structure**:
```yaml
challengeInfo:
  properties:
    stepUpUrl:
      type: string
      format: uri
      description: Cardinal Commerce/Cybersource Step-Up URL - primary endpoint for 3DS challenge iframe
      example: "https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp"

    acsUrl:
      type: string
      format: uri
      description: Issuing bank's ACS URL - for diagnostics only, not used by merchants
      example: "https://acs.issuer.com/3ds/acs/challenge"
```

**Problem**: Payment API distinguishes between:
- `stepUpUrl` - The Cardinal Commerce endpoint used by merchants
- `acsUrl` - The issuer's ACS endpoint (diagnostic only)

The Checkout API's generic `threeDSUrl` doesn't make this distinction clear.

---

### 2.3 ⚠️ Design Issue: Redundant nextAction Abstraction

**Issue**: The `nextAction` property attempts to provide Stripe-style action guidance but is redundant with the required `challengeInfo` structure.

**Current Structure**:
```yaml
nextAction:
  type: object
  required: [type, redirectToUrl]
  properties:
    type:
      type: string
      enum: [redirect_to_url]
    redirectToUrl:
      required: [url, method, returnUrl]
      properties:
        url: string (URI)          # Duplicates threeDSUrl
        method: enum [GET, POST]
        returnUrl: string (URI)
```

**Problems**:
1. `nextAction.redirectToUrl.url` duplicates `threeDSUrl`
2. The abstraction doesn't actually provide value over direct `challengeInfo`
3. Adds unnecessary complexity compared to Payment API's approach
4. Over-engineers a simple 3DS challenge flow

**Recommendation**: Remove `nextAction` in favor of direct `challengeInfo` structure.

---

### 2.4 ⚠️ Missing Alignment Fields

**Missing from Checkout API** (present in Payment API):

1. **status** field
   - Payment API: `status: requiresThreeDsValidation`
   - Checkout API: Implicit in HTTP 202
   - **Impact**: Less self-documenting response bodies

2. **timestamp** field
   - Payment API: Includes ISO 8601 timestamp
   - Checkout API: No timestamp
   - **Impact**: Cannot track session expiry (30-minute window) client-side

3. **authenticationTransactionId**
   - Payment API: Includes for correlation/debugging
   - Checkout API: Only has payment `transactionId`
   - **Impact**: Harder to debug 3DS failures with support

---

## 3. Payment API v0.3.0 challengeInfo Structure

### 3.1 Complete Schema

From `payments-openapi-unresolved.yaml`:

```yaml
Payment3DSRequiredResponse:
  type: object
  description: |
    3D Secure authentication required response with complete challenge information.
    Only used by /token/capture endpoint when 3DS challenge is required.
    The transactionId must be stored and used in subsequent /3ds/validate-capture request.
  required:
    - transactionId
    - status
    - orderId
    - timestamp
    - challengeInfo
  properties:
    transactionId:
      type: string
      description: Transaction ID to use in subsequent 3DS validation request - MUST be stored for /3ds/validate-capture call.
      example: "auth_87654321"

    status:
      type: string
      enum: [requiresThreeDsValidation]
      description: 3DS challenge required before authorization.
      example: "requiresThreeDsValidation"

    orderId:
      type: string
      description: Original order identifier.
      example: "ORD-2024-5679"

    timestamp:
      type: string
      format: date-time
      description: ISO 8601 timestamp.
      example: "2025-04-22T17:31:00Z"

    challengeInfo:
      type: object
      description: Complete authentication challenge information for 3DS processing.
      required:
        - stepUpUrl
        - stepUpToken
      properties:
        stepUpUrl:
          type: string
          format: uri
          description: Cardinal Commerce/Cybersource Step-Up URL - primary endpoint for 3DS challenge iframe.
          example: "https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp"

        stepUpToken:
          type: string
          description: JWT token to POST to stepUpUrl for challenge authentication.
          example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

        acsUrl:
          type: string
          format: uri
          description: Issuing bank's ACS URL - for diagnostics only, not used by merchants.
          example: "https://acs.issuer.com/3ds/acs/challenge"

        authenticationTransactionId:
          type: string
          description: Authentication transaction identifier for correlation.
          example: "f5d1e3c2-1234-5678-9012-345678901234"

        threeDSServerTransactionId:
          type: string
          description: 3DS server transaction identifier.
          example: "8a829417-232b-4f3e-8020-e88c9a5a8b32"

        directoryServerTransactionId:
          type: string
          description: Directory server transaction identifier.
          example: "d5180465-bae3-4df7-940d-3b029b7de81a"
```

### 3.2 Property Purpose Analysis

| Property | Required | Purpose | Frontend Usage |
|----------|----------|---------|----------------|
| **stepUpUrl** | ✅ Yes | Cardinal Commerce endpoint for 3DS iframe | ✅ **ESSENTIAL** |
| **stepUpToken** | ✅ Yes | JWT to authenticate challenge request | ✅ **ESSENTIAL** |
| acsUrl | ❌ No | Issuer ACS URL (diagnostic only) | ❌ Not used |
| authenticationTransactionId | ❌ No | Correlation ID for tracking | ⚠️ Useful for support |
| threeDSServerTransactionId | ❌ No | 3DS server transaction ID | ❌ Internal |
| directoryServerTransactionId | ❌ No | Directory server transaction ID | ❌ Internal |

**Key Insight**: Only `stepUpUrl` and `stepUpToken` are required. Other fields are for correlation, debugging, and diagnostics.

---

## 4. Checkout API Current Structure

### 4.1 Current ThreeDSAuthenticationRequired Schema

From `checkout-openapi-unresolved.yaml` (lines 1792-1877):

```yaml
ThreeDSAuthenticationRequired:
  type: object
  description: |
    Response returned when 3D Secure authentication is required before order creation.
    The customer must complete the authentication challenge before the order can be created.
    Use the `/3ds/validate-capture` endpoint after successful authentication to complete
    the order creation.
  required:
    - threeDSSessionId
    - cartId
    - threeDSUrl
    - transactionId
    - paymentContext
    - nextAction
  properties:
    threeDSSessionId:
      type: string
      description: Unique identifier for this 3DS authentication session.
      example: "auth-3169811e-fa0a-321"

    cartId:
      type: string
      description: The cart ID being checked out (will become order ID after successful authentication).
      example: "3169811e-fa0a-789"

    threeDSUrl:
      type: string
      format: uri
      description: URL for the 3DS authentication challenge.
      example: "https://3ds.psp.com/challenge/abc123"

    transactionId:
      type: string
      description: Payment processor transaction ID for tracking.
      example: "7507655240516609704808"

    merchantReference:
      type: string
      description: Merchant reference for the payment.
      example: "YOUR_MID"

    paymentContext:
      type: object
      description: Context about the payment requiring authentication.
      required:
        - amount
        - paymentMethod
      properties:
        amount:
          $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/cart-order-schemas/0.4.0#/components/schemas/Money'

        paymentMethod:
          type: string
          enum: [tokenised]
          description: Type of payment requiring authentication.
          example: "tokenised"

    nextAction:
      type: object
      description: Instructions for the next action required (following Stripe's pattern).
      required:
        - type
        - redirectToUrl
      properties:
        type:
          type: string
          enum: [redirect_to_url]
          description: Type of action required.
          example: "redirect_to_url"

        redirectToUrl:
          type: object
          description: Redirect details for 3DS authentication.
          required:
            - url
            - method
            - returnUrl
          properties:
            url:
              type: string
              format: uri
              description: The URL to redirect the customer to.
              example: "https://3ds.psp.com/challenge/abc123"

            method:
              type: string
              enum: [GET, POST]
              description: HTTP method to use for the redirect.
              example: "POST"

            returnUrl:
              type: string
              format: uri
              description: URL to return to after authentication.
              example: "https://merchant.example.com/checkout/3ds-return"
```

### 4.2 Checkout-Specific Properties

Properties that are **unique to Checkout API** and serve distinct purposes:

| Property | Purpose | Keep/Remove |
|----------|---------|-------------|
| `threeDSSessionId` | Checkout session management (30-min expiry, one-time use) | ✅ **KEEP** |
| `cartId` | Cart being checked out (order doesn't exist yet) | ✅ **KEEP** |
| `paymentContext` | Business context (amount, payment method) for UX | ✅ **KEEP** |
| `nextAction` | Stripe-style action guidance | ❌ **REMOVE** (redundant) |

---

## 5. Gap Analysis

### 5.1 Side-by-Side Comparison

| Concept | Payment API | Checkout API | Status |
|---------|-------------|--------------|--------|
| **Transaction ID** | `transactionId` | `transactionId` | ✅ Aligned |
| **Order Reference** | `orderId` | `cartId` | ✅ Different but appropriate |
| **Status Field** | `status: requiresThreeDsValidation` | ❌ Missing | ⚠️ Should add |
| **Timestamp** | `timestamp` (ISO 8601) | ❌ Missing | ⚠️ Should add |
| **Challenge URL** | `challengeInfo.stepUpUrl` | `threeDSUrl` | ⚠️ Unclear mapping |
| **Challenge Token** | `challengeInfo.stepUpToken` | ❌ **MISSING** | 🔴 **CRITICAL** |
| **ACS URL** | `challengeInfo.acsUrl` | ❌ Missing | ✅ OK (diagnostic only) |
| **Auth Transaction ID** | `challengeInfo.authenticationTransactionId` | ❌ Missing | ⚠️ Useful for support |
| **3DS Server TX ID** | `challengeInfo.threeDSServerTransactionId` | ❌ Missing | ✅ OK (internal) |
| **Directory Server TX ID** | `challengeInfo.directoryServerTransactionId` | ❌ Missing | ✅ OK (internal) |
| **Session ID** | ❌ Not needed | `threeDSSessionId` | ✅ Checkout-specific |
| **Payment Context** | ❌ Not present | `paymentContext` | ✅ Checkout-specific |
| **Next Action** | ❌ Not present | `nextAction` | ❌ Remove (redundant) |

### 5.2 Critical Missing Properties

1. **stepUpToken** (🔴 CRITICAL)
   - **Impact**: 3DS authentication cannot function
   - **Priority**: P0 - Must fix immediately

2. **stepUpUrl** (🔴 CRITICAL - Clarity)
   - **Current**: Generic `threeDSUrl`
   - **Needed**: Explicit `stepUpUrl` with clear purpose
   - **Priority**: P0 - Must clarify

3. **status** (⚠️ Important)
   - **Impact**: Less self-documenting responses
   - **Priority**: P1 - Should add for consistency

4. **timestamp** (⚠️ Important)
   - **Impact**: Cannot track session expiry client-side
   - **Priority**: P1 - Should add for session management

5. **authenticationTransactionId** (⚠️ Nice to have)
   - **Impact**: Harder debugging for support teams
   - **Priority**: P2 - Consider adding

---

## 6. Proposed Solution

### 6.1 Design Principles

1. **Functional Correctness**: Must include all properties required for 3DS to work
2. **Alignment**: Maintain consistency with Payment API v0.3.0 structure
3. **Separation of Concerns**: Keep Checkout-specific properties separate from Payment API properties
4. **Future-Proof**: Design should accommodate Payment API evolution

### 6.2 Recommended Approach: Full challengeInfo Inclusion

**Rationale**: Directly include Payment API's `challengeInfo` object structure to ensure completeness and consistency.

#### Proposed Schema

```yaml
ThreeDSAuthenticationRequired:
  type: object
  description: |
    Response returned when 3D Secure authentication is required before order creation.
    The customer must complete the authentication challenge using the challengeInfo details.
    Use the /3ds/validate-capture endpoint after successful authentication to complete
    the order creation.

    This response includes challengeInfo aligned with Payment API v0.3.0 for consistency
    in 3DS authentication flow.
  required:
    - threeDSSessionId
    - cartId
    - transactionId
    - status
    - timestamp
    - challengeInfo
    - paymentContext
  properties:
    threeDSSessionId:
      type: string
      description: |
        Unique identifier for this 3DS authentication session in the Checkout API.
        This session expires after 30 minutes and is single-use.
        Must be provided in the subsequent /3ds/validate-capture request.
      example: "auth-3169811e-fa0a-321"

    cartId:
      type: string
      description: |
        The cart ID being checked out. This will become the order ID after
        successful 3DS authentication and validation.
      example: "3169811e-fa0a-789"

    transactionId:
      type: string
      description: |
        Payment API transaction ID for this payment attempt.
        Used internally to correlate with Payment API /3ds/validate-capture call.
      example: "7507655240516609704808"

    status:
      type: string
      enum: [requires3DSAuthentication]
      description: |
        Explicit status indicating 3DS authentication is required.
        Complements HTTP 202 status code for self-documenting responses.
      example: "requires3DSAuthentication"

    timestamp:
      type: string
      format: date-time
      description: |
        ISO 8601 timestamp when this 3DS authentication session was created.
        Use this to track the 30-minute session expiry window.
      example: "2025-11-06T14:30:00Z"

    challengeInfo:
      type: object
      description: |
        Complete 3DS challenge information from Payment API v0.3.0.
        This object contains all details needed to present the 3DS challenge
        to the customer using Cardinal Commerce/Cybersource.
      required:
        - stepUpUrl
        - stepUpToken
      properties:
        stepUpUrl:
          type: string
          format: uri
          description: |
            Cardinal Commerce/Cybersource Step-Up URL - the primary endpoint for
            presenting the 3DS challenge in an iframe.
            The frontend must POST the stepUpToken to this URL.
          example: "https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp"

        stepUpToken:
          type: string
          description: |
            JWT token that must be POSTed to stepUpUrl to initiate the 3DS challenge.
            This token authenticates the challenge request to Cardinal Commerce.
            CRITICAL: Without this token, 3DS authentication will fail.
          example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

        acsUrl:
          type: string
          format: uri
          description: |
            Issuing bank's Access Control Server (ACS) URL.
            This is for diagnostic purposes only and should not be used by merchants.
          example: "https://acs.issuer.com/3ds/acs/challenge"

        authenticationTransactionId:
          type: string
          description: |
            Authentication transaction identifier used for correlation and debugging.
            Useful for support teams troubleshooting 3DS authentication issues.
          example: "f5d1e3c2-1234-5678-9012-345678901234"

        threeDSServerTransactionId:
          type: string
          description: |
            3DS server transaction identifier from the payment service provider.
            Used for internal tracking and PSP integration debugging.
          example: "8a829417-232b-4f3e-8020-e88c9a5a8b32"

        directoryServerTransactionId:
          type: string
          description: |
            Directory server transaction identifier from the card network.
            Used for payment network-level tracking and debugging.
          example: "d5180465-bae3-4df7-940d-3b029b7de81a"

    paymentContext:
      type: object
      description: |
        Business context about the payment requiring authentication.
        Helps the frontend display meaningful messages to the customer.
      required:
        - amount
        - paymentMethod
      properties:
        amount:
          $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/cart-order-schemas/0.4.0#/components/schemas/Money'
          description: Total payment amount requiring authentication

        paymentMethod:
          type: string
          enum: [tokenised]
          description: Type of payment method requiring authentication
          example: "tokenised"
```

### 6.2.1 Design Decisions Rationale

This section documents the key design decisions made for the `ThreeDSAuthenticationRequired` schema structure.

#### Decision 1: Remove `merchantReference`

**Decision**: Remove the `merchantReference` property from the response schema.

**Rationale**:
- No evidence of necessity in the 3DS authentication flow
- Not present in Payment API's `Payment3DSRequiredResponse` schema
- Likely configuration data that clients already possess from their authentication context
- If needed for correlation, should be derived from JWT claims rather than echoed in responses
- Removes unnecessary data from the response payload

**Impact**: None expected - property was optional and served no clear functional purpose.

---

#### Decision 2: Keep `status` Field

**Decision**: Retain the `status` field despite HTTP 202 status code.

**Rationale**:
1. **Self-documenting responses**: Response bodies are meaningful without HTTP headers (crucial for logs, monitoring, debugging)
2. **Type discrimination**: Enables type-safe discriminated unions in strongly-typed clients:
   ```typescript
   type CaptureResponse =
     | { status: 'completed', order: Order }
     | { status: 'requires3DSAuthentication', challengeInfo: ChallengeInfo }
     | { status: 'failed', error: Error }
   ```
3. **Semantic clarity**: HTTP 202 means "accepted for processing" - the status field provides specific semantics ("requires3DSAuthentication")
4. **Payment API alignment**: Payment API v0.3.0 includes `status: requiresThreeDsValidation`
5. **Modern REST practices**: Industry-standard APIs (Stripe, PayPal, Square) consistently include status fields in response bodies
6. **OpenAPI tooling**: Enables better discriminator support for code generation

**HTTP 202 redundancy argument rejected**: The status field provides semantic meaning beyond what the HTTP status code conveys.

**Cost**: Minimal (one additional field, ~30 bytes)

---

#### Decision 3: Keep `challengeInfo` Nested

**Decision**: Maintain nested `challengeInfo` object structure (not flatten to root level).

**Rationale**:

**Semantic cohesion**:
- Logically groups 6 related challenge properties (stepUpUrl, stepUpToken, acsUrl, authenticationTransactionId, threeDSServerTransactionId, directoryServerTransactionId)
- Clear separation of concerns: Checkout API concerns (session, cart, context) vs Payment API concerns (challenge details)

**Shared schema reusability**:
- Payment API v0.3.0 already defines `challengeInfo` as an object
- Enables potential OpenAPI reference: `$ref: 'payments-api/0.3.0#/components/schemas/ChallengeInfo'`
- Maintains alignment with Payment API structure

**Extensibility**:
- New Payment API fields in `challengeInfo` flow through naturally
- No root-level namespace pollution

**Type safety**:
- Strongly-typed clients benefit from reusable `ChallengeInfo` type
- Clear interface boundaries

**Documentation clarity**:
- Immediately obvious which properties are "challenge information" vs "checkout session information"
- Reduces cognitive load: 7 root concepts instead of 13+ flat properties

**Alternative considered**: Flat structure with all properties at root level
- Rejected due to: loss of semantic grouping, harder alignment maintenance, namespace mixing

**Trade-off accepted**: One additional nesting level (minimal convenience cost) for significant clarity, maintainability, and alignment benefits.

---

### 6.3 Changes Summary

**ADDED:**
- ✅ `status` field (explicit status indicator)
- ✅ `timestamp` field (session expiry tracking)
- ✅ `challengeInfo` object with full Payment API v0.3.0 structure
- ✅ `challengeInfo.stepUpUrl` (CRITICAL - replaces generic threeDSUrl)
- ✅ `challengeInfo.stepUpToken` (CRITICAL - fixes 3DS flow)
- ✅ `challengeInfo.acsUrl` (diagnostic)
- ✅ `challengeInfo.authenticationTransactionId` (correlation)
- ✅ `challengeInfo.threeDSServerTransactionId` (PSP tracking)
- ✅ `challengeInfo.directoryServerTransactionId` (network tracking)

**REMOVED:**
- ❌ `threeDSUrl` (replaced by `challengeInfo.stepUpUrl`)
- ❌ `nextAction` (redundant with `challengeInfo`)
- ❌ `merchantReference` (no evidence of necessity, not in Payment API)

**KEPT:**
- ✅ `threeDSSessionId` (Checkout session management)
- ✅ `cartId` (Checkout-specific domain concept)
- ✅ `transactionId` (Payment API correlation)
- ✅ `status` (self-documenting responses, type discrimination - see § 6.2.1)
- ✅ `timestamp` (session expiry tracking)
- ✅ `challengeInfo` nested structure (semantic grouping, Payment API alignment - see § 6.2.1)
- ✅ `paymentContext` (business context for UX)

---

## 7. Implementation Details

### 7.1 Updates Required

#### 7.1.1 Update External References

**File**: `openapi/checkout-openapi-unresolved.yaml`

**Line 1301** - Update PaymentBillingDetails reference:
```yaml
# OLD
PaymentBillingDetails:
  $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/AddressableParty'

# NEW
PaymentBillingDetails:
  $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.3.0#/components/schemas/AddressableParty'
```

**Line 1304** - Update PaymentThreeDSData reference:
```yaml
# OLD
PaymentThreeDSData:
  $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/ThreeDSData'

# NEW
PaymentThreeDSData:
  $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.3.0#/components/schemas/ThreeDSData'
```

**Line 20** - Update API description:
```yaml
# OLD
description: |
  **Payment API Integration**: This API is aligned with Payment API v0.2.0

# NEW
description: |
  **Payment API Integration**: This API is aligned with Payment API v0.3.0
```

#### 7.1.2 Update ThreeDSAuthenticationRequired Schema

**File**: `openapi/checkout-openapi-unresolved.yaml`
**Lines**: 1792-1877

Replace entire schema with the proposed schema from section 6.2.

#### 7.1.3 Update Example Responses

Update all example responses for 202 status to include `challengeInfo`:

**Example Response**:
```json
{
  "threeDSSessionId": "auth-3169811e-fa0a-321",
  "cartId": "3169811e-fa0a-789",
  "transactionId": "7507655240516609704808",
  "status": "requires3DSAuthentication",
  "timestamp": "2025-11-06T14:30:00Z",
  "challengeInfo": {
    "stepUpUrl": "https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp",
    "stepUpToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "authenticationTransactionId": "f5d1e3c2-1234-5678-9012-345678901234",
    "threeDSServerTransactionId": "8a829417-232b-4f3e-8020-e88c9a5a8b32",
    "directoryServerTransactionId": "d5180465-bae3-4df7-940d-3b029b7de81a"
  },
  "paymentContext": {
    "amount": {
      "amount": 159.99,
      "currencyCode": "GBP"
    },
    "paymentMethod": "tokenised"
  }
}
```

#### 7.1.4 Update ThreeDSData Examples

Ensure all ThreeDSData examples use phase-based structure:

**For `/token/capture` requests** (setup phase):
```json
{
  "threeDSData": {
    "phase": "setup",
    "setup": {
      "referenceId": "3ds-ref-12345",
      "deviceCollectionInfo": {
        "browserAcceptHeader": "text/html,application/xhtml+xml",
        "browserLanguage": "en-GB",
        "browserScreenHeight": 1080,
        "browserScreenWidth": 1920,
        "browserTimeZone": 0
      }
    }
  }
}
```

**For `/3ds/validate-capture` requests** (completion phase):
```json
{
  "threeDSSessionId": "auth-3169811e-fa0a-321",
  "threeDSData": {
    "phase": "completion",
    "completion": {
      "authenticationResult": "Y",
      "cavv": "AAABCZIhcQAAAABZlyFxAAAAAAA=",
      "eci": "05",
      "xid": "MGpHWm5VWjRjbVZOcm9vWkdkTTA="
    }
  }
}
```

### 7.2 Backend Implementation Changes

#### 7.2.1 Lambda Function Updates

**File**: `lambda/src/index.ts` (or relevant handler)

```typescript
// When Payment API returns 202 with Payment3DSRequiredResponse
async function handlePaymentThreeDSRequired(
  paymentApiResponse: Payment3DSRequiredResponse,
  checkoutSession: CheckoutSession
): Promise<ThreeDSAuthenticationRequired> {

  const threeDSSessionId = generateUUID();

  // Store session for later validate-capture call
  await storeThreeDSSession({
    threeDSSessionId,
    cartId: checkoutSession.cartId,
    cartVersion: checkoutSession.cartVersion,
    transactionId: paymentApiResponse.transactionId,
    paymentToken: checkoutSession.paymentToken,
    billingDetails: checkoutSession.billingDetails,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
  });

  // Map Payment API response to Checkout API response
  return {
    threeDSSessionId,
    cartId: checkoutSession.cartId,
    transactionId: paymentApiResponse.transactionId,
    status: 'requires3DSAuthentication',
    timestamp: new Date().toISOString(),

    // Pass through challengeInfo directly from Payment API
    challengeInfo: paymentApiResponse.challengeInfo,

    // Add Checkout-specific context
    paymentContext: {
      amount: checkoutSession.totalPrice,
      paymentMethod: 'tokenised'
    }
  };
}
```

#### 7.2.2 Session Storage Structure

```typescript
interface StoredThreeDSSession {
  threeDSSessionId: string;
  cartId: string;
  cartVersion: number;
  transactionId: string;  // Payment API transaction ID
  paymentToken: string;
  billingDetails: AddressableParty;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;  // Mark as used after validate-capture
}
```

### 7.3 Frontend Implementation Guidance

#### 7.3.1 3DS Challenge Flow

```typescript
// Step 1: Call /token/capture
const captureResponse = await fetch('/checkout/me/token/capture', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(captureRequest)
});

// Step 2: Handle 202 response
if (captureResponse.status === 202) {
  const threeDSRequired = await captureResponse.json();
  const { threeDSSessionId, challengeInfo, paymentContext } = threeDSRequired;

  // Show amount to user
  console.log(`Authenticating ${paymentContext.amount.currencyCode} ${paymentContext.amount.amount} payment`);

  // Step 3: Present 3DS challenge using challengeInfo
  await present3DSChallenge(challengeInfo);

  // Step 4: After challenge completion, call validate-capture
  const order = await fetch('/checkout/me/3ds/validate-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threeDSSessionId,
      threeDSData: {
        phase: 'completion',
        completion: completionData  // From 3DS challenge result
      }
    })
  });
}

// Helper function to present 3DS challenge
async function present3DSChallenge(challengeInfo: ChallengeInfo): Promise<ThreeDSCompletionData> {
  return new Promise((resolve, reject) => {
    // Create iframe container
    const container = document.getElementById('3ds-container');
    const iframe = document.createElement('iframe');
    iframe.id = '3ds-challenge-iframe';
    iframe.style.width = '100%';
    iframe.style.height = '500px';
    iframe.style.border = 'none';
    container.appendChild(iframe);

    // Create form to POST stepUpToken
    const iframeDoc = iframe.contentDocument;
    const form = iframeDoc.createElement('form');
    form.method = 'POST';
    form.action = challengeInfo.stepUpUrl;

    // Add JWT token as hidden input
    const jwtInput = iframeDoc.createElement('input');
    jwtInput.type = 'hidden';
    jwtInput.name = 'JWT';  // Cardinal Commerce expects 'JWT' parameter
    jwtInput.value = challengeInfo.stepUpToken;
    form.appendChild(jwtInput);

    iframeDoc.body.appendChild(form);
    form.submit();

    // Listen for Cardinal Commerce completion event
    window.addEventListener('message', (event) => {
      // Validate origin
      if (!event.origin.includes('cardinalcommerce.com')) return;

      const { Status, Payment } = event.data;

      if (Status === 'SUCCESS') {
        resolve({
          authenticationResult: Payment.ExtendedData.SignatureVerification,
          cavv: Payment.ExtendedData.CAVV,
          eci: Payment.ExtendedData.ECIFlag,
          xid: Payment.ExtendedData.XID
        });
      } else {
        reject(new Error('3DS authentication failed'));
      }

      // Clean up
      container.removeChild(iframe);
    });
  });
}
```

---

## 8. Migration Impact

### 8.1 Breaking Changes

**Frontend Breaking Changes:**

1. **Response Structure Change** (🔴 CRITICAL)
   - `threeDSUrl` removed → use `challengeInfo.stepUpUrl`
   - `nextAction` removed → use `challengeInfo` directly
   - Frontend must update to access `stepUpToken` from `challengeInfo`

2. **New Required Properties**
   - `status`, `timestamp`, `challengeInfo` are now required
   - Frontend must handle these fields

**Backend Breaking Changes:**

1. **Session Management**
   - Must store `transactionId` from Payment API for validate-capture
   - Must map between Payment API's `challengeInfo` and Checkout response

### 8.2 Migration Timeline

**Phase 1: Specification Update** (Week 1)
- Update OpenAPI spec with new schema
- Update examples and documentation
- Validate spec with tools

**Phase 2: Backend Implementation** (Week 2)
- Update Lambda to map Payment API v0.3.0 responses
- Update session storage schema
- Deploy to development environment

**Phase 3: Frontend Update** (Week 3)
- Update frontend to use `challengeInfo`
- Remove `nextAction` references
- Implement new 3DS challenge flow
- Test in development

**Phase 4: Testing & Validation** (Week 4)
- Integration testing with test cards
- End-to-end 3DS flow validation
- Performance testing

**Phase 5: Production Deployment** (Week 5)
- Deploy backend to production
- Deploy frontend to production
- Monitor 3DS success rates

### 8.3 Rollback Plan

If issues are discovered post-deployment:

1. **Immediate**: Revert frontend to previous version
2. **Backend**: Can keep v0.5.0 backend (no external clients yet)
3. **Investigation**: Analyze logs and 3DS authentication failure rates
4. **Fix Forward**: Address issues and redeploy

### 8.4 Backward Compatibility

**Not possible** - This is a fundamental structural change due to:
1. Critical missing property (`stepUpToken`)
2. Removal of redundant structure (`nextAction`)
3. Alignment with Payment API v0.3.0

**Recommendation**: Since this is alpha (v0.5.0 work-in-progress), acceptable to make breaking changes before v1.0.0 release.

---

## 9. Validation Requirements

### 9.1 OpenAPI Validation

**Commands to run:**

```bash
# Validate OpenAPI syntax
npm run validate:openapi:schemas

# Validate with Spectral rules
npm run validate:openapi:spectral

# Check external references
npm run validate:openapi:refs
```

**Expected Results:**
- ✅ No schema validation errors
- ✅ All $ref links resolve (v0.3.0 references)
- ✅ Examples validate against schemas
- ✅ No Spectral rule violations

### 9.2 3DS Flow Testing

**Test Cards** (Cardinal Commerce test environment):

| Card Number | Expected Behavior |
|-------------|-------------------|
| 4000000000001091 | Frictionless (no challenge) |
| 4000000000001000 | Challenge required |
| 4000000000001109 | Failed authentication |

**Test Scenarios:**

1. **Successful Challenge Flow**
   ```
   POST /token/capture
   → HTTP 202 with challengeInfo
   → Frontend presents challenge with stepUpToken
   → Customer completes 3DS
   → POST /3ds/validate-capture
   → HTTP 201 with Order
   ```

2. **Expired Session**
   ```
   POST /token/capture → HTTP 202 (timestamp: T0)
   → Wait 31 minutes
   → POST /3ds/validate-capture
   → HTTP 410 Gone (session expired)
   ```

3. **Missing stepUpToken Scenario** (regression test)
   ```
   If challengeInfo.stepUpToken is missing
   → Frontend cannot POST to stepUpUrl
   → 3DS challenge fails immediately
   ```

### 9.3 Integration Testing

**With Payment API v0.3.0:**

```typescript
// Test that Checkout API correctly maps Payment API responses
describe('Payment API v0.3.0 Integration', () => {
  it('should map Payment3DSRequiredResponse to ThreeDSAuthenticationRequired', async () => {
    const paymentApiResponse = {
      transactionId: 'txn_123',
      status: 'requiresThreeDsValidation',
      orderId: 'order_456',
      timestamp: '2025-11-06T14:30:00Z',
      challengeInfo: {
        stepUpUrl: 'https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp',
        stepUpToken: 'eyJhbGc...',
        authenticationTransactionId: 'auth_789'
      }
    };

    const checkoutResponse = await mapToCheckoutResponse(paymentApiResponse);

    expect(checkoutResponse.challengeInfo).toEqual(paymentApiResponse.challengeInfo);
    expect(checkoutResponse.challengeInfo.stepUpToken).toBeDefined();
    expect(checkoutResponse.challengeInfo.stepUpUrl).toBeDefined();
  });
});
```

---

## 10. Decision Points

### 10.1 Schema Structure Decision

**Option A: Nested challengeInfo** (RECOMMENDED)
```yaml
ThreeDSAuthenticationRequired:
  properties:
    challengeInfo:
      properties:
        stepUpUrl: string
        stepUpToken: string
        # ...
```

**Pros:**
- ✅ Direct alignment with Payment API v0.3.0
- ✅ Clear semantic grouping of challenge-related fields
- ✅ Future-proof (new Payment API fields flow through)
- ✅ Explicit separation of Checkout vs Payment concerns

**Cons:**
- ⚠️ Slightly more nested than flat structure
- ⚠️ Breaking change from current structure

**Option B: Flat Structure**
```yaml
ThreeDSAuthenticationRequired:
  properties:
    stepUpUrl: string
    stepUpToken: string
    # ...
```

**Pros:**
- ✅ Flatter structure (less nesting)

**Cons:**
- ❌ Loses semantic grouping
- ❌ Mixes Checkout and Payment concerns
- ❌ Harder to maintain alignment with Payment API
- ❌ Less clear which properties come from Payment API

**DECISION: Choose Option A (Nested challengeInfo)**

### 10.2 nextAction Decision

**Option A: Remove entirely** (RECOMMENDED)
- Current `nextAction` is redundant with `challengeInfo`
- Simplifies schema
- Breaking change but acceptable in alpha

**Option B: Deprecate and keep**
- Mark as deprecated in spec
- Duplicate data into both `nextAction` and `challengeInfo`
- Remove in v1.0.0

**DECISION: Choose Option A (Remove entirely)**

Rationale: Since we're in v0.5.0 (work in progress) and `nextAction` doesn't add value over `challengeInfo`, better to remove now than carry technical debt.

### 10.3 Version Number Decision

**Option A: Keep as v0.5.0** (RECOMMENDED)
- Current version is work-in-progress
- No external consumers yet
- Breaking changes acceptable in pre-v1.0

**Option B: Bump to v0.6.0**
- Signals breaking change
- But version is still WIP

**DECISION: Keep as v0.5.0**

Rationale: Since v0.5.0 is explicitly work-in-progress and has no external consumers, keep the version number and continue iterating until ready for v1.0.0 release.

### 10.4 Optional Transaction IDs

**Question**: Should we include optional PSP transaction IDs (`threeDSServerTransactionId`, `directoryServerTransactionId`)?

**Option A: Include all** (RECOMMENDED)
- Pass through everything from Payment API
- Useful for debugging
- Low cost (just additional fields)

**Option B: Only essential fields**
- Include only `stepUpUrl`, `stepUpToken`, `authenticationTransactionId`
- Omit internal PSP IDs

**DECISION: Include all (Option A)**

Rationale: These fields are helpful for support and debugging, have low cost, and maintain full alignment with Payment API.

---

## 11. Timeline and Phases

### Phase 1: Specification Update (3-5 days)

**Tasks:**
- [ ] Update external references (v0.2.0 → v0.3.0)
- [ ] Redesign ThreeDSAuthenticationRequired schema
- [ ] Remove nextAction property
- [ ] Add challengeInfo object
- [ ] Update all example responses
- [ ] Update ThreeDSData examples (phase-based)
- [ ] Update documentation strings
- [ ] Run OpenAPI validation

**Deliverables:**
- Updated `checkout-openapi-unresolved.yaml`
- Updated `checkout-openapi.yaml` (resolved)
- Validation reports (no errors)

**Review Points:**
- Technical review of schema structure
- Alignment verification with Payment API v0.3.0
- Example completeness check

---

### Phase 2: Backend Implementation (5-7 days)

**Tasks:**
- [ ] Update Lambda handler to map Payment API v0.3.0 responses
- [ ] Update 3DS session storage schema
- [ ] Implement challengeInfo passthrough
- [ ] Add timestamp generation
- [ ] Add status field population
- [ ] Update error handling for missing challengeInfo
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Deploy to development environment

**Deliverables:**
- Updated Lambda code
- Test coverage reports
- Development environment deployment

**Review Points:**
- Code review for Lambda changes
- Test coverage validation (>80%)
- Development testing results

---

### Phase 3: Frontend Update (5-7 days)

**Tasks:**
- [ ] Update frontend to use challengeInfo
- [ ] Implement stepUpToken posting to stepUpUrl
- [ ] Remove nextAction references
- [ ] Update 3DS challenge presentation logic
- [ ] Add timestamp-based session expiry tracking
- [ ] Update error handling
- [ ] Write frontend tests
- [ ] Deploy to development environment

**Deliverables:**
- Updated frontend code
- Frontend test coverage
- Development environment deployment

**Review Points:**
- Code review for frontend changes
- UX review of 3DS challenge flow
- Browser compatibility testing

---

### Phase 4: Testing & Validation (5-7 days)

**Tasks:**
- [ ] End-to-end 3DS flow testing (development)
- [ ] Test with Cardinal Commerce test cards
- [ ] Session expiry testing (30-minute window)
- [ ] Error scenario testing
- [ ] Performance testing
- [ ] Load testing
- [ ] Security testing (token handling)
- [ ] Documentation review

**Test Scenarios:**
- ✅ Successful 3DS challenge flow
- ✅ Failed authentication
- ✅ Expired session handling
- ✅ Missing/invalid stepUpToken
- ✅ Network errors during challenge
- ✅ Multiple concurrent sessions

**Deliverables:**
- Test results report
- Performance benchmarks
- Security audit results
- Updated documentation

**Review Points:**
- QA sign-off
- Security review
- Performance acceptance criteria met

---

### Phase 5: Production Deployment (3-5 days)

**Tasks:**
- [ ] Deploy backend to staging
- [ ] Deploy frontend to staging
- [ ] Staging validation
- [ ] Deploy backend to production
- [ ] Deploy frontend to production
- [ ] Monitor 3DS success rates
- [ ] Monitor error rates
- [ ] Monitor performance metrics

**Rollback Criteria:**
- 3DS success rate drops below baseline
- Error rate exceeds 5%
- Performance degradation >20%
- Critical bugs discovered

**Deliverables:**
- Production deployment
- Monitoring dashboards
- Post-deployment report

**Review Points:**
- Deployment readiness checklist
- Rollback plan review
- Monitoring setup verification

---

## Total Estimated Timeline

**Optimistic**: 3-4 weeks
**Realistic**: 4-5 weeks
**Pessimistic**: 6-7 weeks (with unforeseen issues)

---

## Appendix A: Example Payloads

### A.1 Complete 202 Response Example

```json
{
  "threeDSSessionId": "auth-3169811e-fa0a-321",
  "cartId": "3169811e-fa0a-789",
  "transactionId": "7507655240516609704808",
  "status": "requires3DSAuthentication",
  "timestamp": "2025-11-06T14:30:00Z",
  "challengeInfo": {
    "stepUpUrl": "https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp",
    "stepUpToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNWQxZTNjMi0xMjM0LTU2NzgtOTAxMi0zNDU2Nzg5MDEyMzQiLCJpYXQiOjE3MzA5MDI2MDAsImV4cCI6MTczMDkwNDQwMCwiT3JnVW5pdElkIjoiNWFlZTNjZjU4ZWEyNzgyMGYwMGYxNzk4IiwiUGF5bG9hZCI6eyJBQ1NVcmwiOiJodHRwczovL2Fjcy5pc3N1ZXIuY29tLzNkcy9hY3MvY2hhbGxlbmdlIiwiUGF5bG9hZCI6IntcIk1lcmNoYW50SURcIjpcIlVLTEFJVC1NSURcIixcIlRyYW5zYWN0aW9uSURcIjpcIjc1MDc2NTUyNDA1MTY2MDk3MDQ4MDhcIn0ifX0.DPZJxZ-j8yOZQvP8nYzI7oJo8xgJ7V_2LNE6P9uQq4s",
    "acsUrl": "https://acs.issuer.com/3ds/acs/challenge",
    "authenticationTransactionId": "f5d1e3c2-1234-5678-9012-345678901234",
    "threeDSServerTransactionId": "8a829417-232b-4f3e-8020-e88c9a5a8b32",
    "directoryServerTransactionId": "d5180465-bae3-4df7-940d-3b029b7de81a"
  },
  "paymentContext": {
    "amount": {
      "amount": 159.99,
      "currencyCode": "GBP"
    },
    "paymentMethod": "tokenised"
  }
}
```

### A.2 Complete validate-capture Request Example

```json
{
  "threeDSSessionId": "auth-3169811e-fa0a-321",
  "threeDSData": {
    "phase": "completion",
    "completion": {
      "authenticationResult": "Y",
      "cavv": "AAABCZIhcQAAAABZlyFxAAAAAAA=",
      "eci": "05",
      "xid": "MGpHWm5VWjRjbVZOcm9vWkdkTTA=",
      "paSpecificationVersion": "2.2.0",
      "directoryServerTransactionId": "d5180465-bae3-4df7-940d-3b029b7de81a",
      "acsOperatorID": "ACS-OP-12345"
    }
  }
}
```

---

## Appendix B: Risk Assessment

### High Risk Items

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| stepUpToken missing breaks 3DS | High (if not fixed) | Critical | ✅ Fixed in this plan |
| Frontend integration issues | Medium | High | Comprehensive testing, phased rollout |
| Session expiry edge cases | Medium | Medium | Thorough testing, clear error messages |
| Payment API v0.3.0 incompatibility | Low | Critical | Validate references, integration tests |

### Medium Risk Items

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Documentation gaps | Medium | Medium | Review process, example completeness |
| Testing coverage gaps | Medium | Medium | >80% test coverage requirement |
| Performance degradation | Low | Medium | Performance testing, monitoring |

### Low Risk Items

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Rollback needed | Low | Medium | Rollback plan in place |
| Browser compatibility | Low | Low | Standard browser testing |

---

## Appendix C: Success Criteria

### Functional Requirements

- [ ] 3DS authentication flow works end-to-end
- [ ] stepUpToken is present in all 202 responses
- [ ] challengeInfo structure matches Payment API v0.3.0
- [ ] Session expiry works correctly (30 minutes)
- [ ] validate-capture accepts and processes completion data
- [ ] Orders are created successfully after 3DS

### Non-Functional Requirements

- [ ] OpenAPI validation passes with no errors
- [ ] Test coverage >80%
- [ ] 3DS success rate >95% (for successful cards)
- [ ] Response time <500ms (95th percentile)
- [ ] Error rate <1%
- [ ] Documentation complete and accurate

### Acceptance Criteria

- [ ] Technical review completed and approved
- [ ] QA testing completed with no critical bugs
- [ ] Security review completed
- [ ] Documentation reviewed and published
- [ ] Monitoring dashboards configured
- [ ] Stakeholder sign-off received

---

## Document Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2025-11-06 | 0.1 | Technical Team | Initial draft for review |
| 2025-11-06 | 0.2 | Technical Team | Schema refinements: Removed `merchantReference` (no evidence of need), added design decisions rationale (§6.2.1), documented reasoning for keeping `status` field and nested `challengeInfo` structure |

---

## Next Steps

1. **Review this document** with technical team and stakeholders
2. **Address decision points** in Section 10
3. **Approve proposed schema** in Section 6.2
4. **Proceed with Phase 1** (Specification Update) upon approval
5. **Schedule regular review meetings** during implementation phases

---

**END OF IMPLEMENTATION PLAN**