# User Story: Implement 3DS Validate-Capture Endpoints

**Date Created:** 2025-11-04
**Status:** Ready for JIRA
**Target:** Direct Wines Checkout Microservice Team
**Related:** Checkout API v0.5.0 - 3DS Validate-Capture Endpoints

---

## Story Title
**Implement 3D Secure authentication completion endpoints for order creation**

## User Story

**As a** customer completing a 3D Secure authentication challenge
**I want** to finalize my order by submitting the 3DS completion data
**So that** my payment can be authorized and my order created securely

## Background / Context

Following the stateful 3DS authentication pattern (see Confluence: "Technical Report: 3DS Authentication Flow Design - Stateful vs. Stateless Analysis"), we need to implement two endpoints that complete the checkout process after customers successfully complete 3D Secure authentication challenges.

**Initial Flow Context:**
1. Customer initiates checkout via `POST /me/token/capture`
2. If 3DS authentication required, API returns **HTTP 202 Accepted** with `threeDSSessionId` and 3DS challenge URL
3. Customer completes 3DS challenge in browser/app
4. **[This story]** Customer submits completion data to validate-capture endpoint
5. Order is created and payment authorized

**Architectural Decision:** Industry research (Stripe, PayPal, Adyen, Checkout.com) confirms that stateful session management is the standard pattern for 3DS flows. The authentication session preserves cart state, payment tokens, and billing details server-side for security, PCI compliance, and data integrity.

## Acceptance Criteria

### AC1: OpenAPI Specification Compliance
- [ ] **GIVEN** the OpenAPI specification for `/me/3ds/validate-capture` and `/in-brand/{brandkey}/3ds/validate-capture`
- [ ] **WHEN** implementing the endpoints
- [ ] **THEN** all request/response schemas, status codes, and error responses MUST match the specification exactly
- [ ] **AND** the implementation MUST handle all documented error scenarios (403, 409, 422)

### AC2: Stateful Authentication Session Integration
- [ ] **GIVEN** a request with valid `threeDSSessionId`
- [ ] **WHEN** the validate-capture endpoint is called
- [ ] **THEN** the system MUST retrieve the authentication session from a stateful session store
- [ ] **AND** the session MUST contain all data from the initial capture request (cart reference, payment token, billing details)
- [ ] **AND** validate that the session exists, is pending, and not expired (30-minute TTL)
- [ ] **AND** return **HTTP 409 Conflict** with appropriate error code if session is invalid, used, or expired

### AC3: Session Ownership Validation (Security Requirement)
- [ ] **GIVEN** an authentication session created by a specific customer/anonymous user
- [ ] **WHEN** a different customer/anonymous user attempts to complete it
- [ ] **THEN** the system MUST return **HTTP 403 Forbidden** with error code `SessionOwnershipViolation`
- [ ] **AND** log the security violation event with HIGH severity
- [ ] **AND** for `/in-brand/{brandkey}` endpoints, validate brand context matches session

### AC4: Cart State Validation (Data Integrity)
- [ ] **GIVEN** an authentication session with stored cart version
- [ ] **WHEN** validating the session
- [ ] **THEN** the system MUST verify the current cart version matches the session's cart version
- [ ] **AND** return **HTTP 422 Unprocessable Entity** with error code `CartModified` if versions differ
- [ ] **AND** prevent order creation if cart has been modified during 3DS flow

### AC5: Payment Authorization with 3DS Completion
- [ ] **GIVEN** valid 3DS completion data (authenticationTransactionId, cavv, eciIndicator)
- [ ] **WHEN** authorizing payment
- [ ] **THEN** the system MUST use stored payment token and billing details from authentication session
- [ ] **AND** merge 3DS completion data from request
- [ ] **AND** submit complete authorization request to payment processor
- [ ] **AND** return **HTTP 422 Unprocessable Entity** with appropriate error codes if payment declined or 3DS validation fails
- [ ] **NOTE:** Payment decline = HTTP 422 (not HTTP 200), because Checkout API creates orders

### AC6: Order Creation on Success
- [ ] **GIVEN** successful payment authorization
- [ ] **WHEN** completing the validate-capture flow
- [ ] **THEN** the system MUST create an order using cart reference and payment result
- [ ] **AND** mark the authentication session as used (single-use enforcement)
- [ ] **AND** return **HTTP 201 Created** with Order object and `Location` header
- [ ] **AND** clean up authentication session data after successful completion

### AC7: Both Endpoint Variants Supported
- [ ] **GIVEN** the two endpoint paths
- [ ] **WHEN** implementing the feature
- [ ] **THEN** both `/me/3ds/validate-capture` (customer context) and `/in-brand/{brandkey}/3ds/validate-capture` (brand context) MUST be implemented
- [ ] **AND** share common validation and processing logic
- [ ] **AND** handle brand-specific merchant configuration appropriately

### AC8: Payment Decline Error Mapping
- [ ] **GIVEN** payment processor declines a payment
- [ ] **WHEN** processing the decline response
- [ ] **THEN** the system MUST return **HTTP 422 Unprocessable Entity** (NOT HTTP 200)
- [ ] **AND** map processor-specific decline reasons to appropriate validation error codes (PaymentDeclined, CardExpired, InsufficientFunds, etc.)
- [ ] **AND** provide clear error messages in response body

## Technical Constraints

### Required: Stateful Authentication Session Management
The implementation **MUST** integrate with a stateful authentication session service that provides:

**Session Storage Requirements:**
- Stores authentication sessions with payment tokens, cart references, and billing details
- Supports 30-minute TTL with automatic cleanup
- Enforces single-use sessions (status transitions: pending → used)
- Tracks session ownership (customerId for authenticated users, anonymousId for guests)
- Implements secure storage with encryption at rest

**Session Lifecycle:**
- Sessions created when initial `/me/token/capture` returns HTTP 202
- Sessions retrieved and validated during `/3ds/validate-capture` requests
- Sessions marked as "used" after successful order creation
- Sessions automatically expired and cleaned up after 30 minutes

### OpenAPI Specification Compliance
- **MUST** implement endpoints exactly as defined in the OpenAPI specification
- **MUST NOT** add additional required fields beyond the spec
- **MUST** support all documented error responses (403, 409, 422)
- Request body contains ONLY `threeDSSessionId` and `threeDSData.completion` - no cart or payment data resubmission

### Security Requirements
- OAuth 2.0 authentication via API Gateway Global Authorizer (pre-configured)
- Session ownership validation against OAuth token claims (customerId/anonymousId)
- Security event logging for all ownership violations (HIGH severity)
- Payment token handling per PCI DSS requirements (minimize exposure)

### Data Integrity Requirements
- Cart version validation (prevent cart modifications during 3DS flow)
- Single-use session enforcement (prevent replay attacks)
- Frozen cart/payment context from initial capture attempt

### Error Handling Requirements
All error responses must align with OpenAPI specification:
- **HTTP 403 Forbidden**: Session ownership violations, brand context mismatches
- **HTTP 409 Conflict**: Session not found, already used, or expired; cart modified
- **HTTP 422 Unprocessable Entity**: Payment declines, 3DS validation failures, business rule violations

## Definition of Done

- [ ] Both endpoint variants (`/me` and `/in-brand/{brandkey}`) implemented and deployed
- [ ] All 8 acceptance criteria verified with automated tests
- [ ] Unit tests cover success paths and all error scenarios (403, 409, 422)
- [ ] Integration tests validate end-to-end 3DS flow (initial capture → 3DS challenge → validate-capture → order creation)
- [ ] Stateful session service integrated and tested
- [ ] OpenAPI specification compliance verified
- [ ] Security review completed for session ownership validation
- [ ] Error handling verified for all payment decline scenarios
- [ ] Monitoring/logging implemented for session operations and security events
- [ ] Code reviewed and merged to main branch
- [ ] Deployed to development environment and smoke tested
- [ ] Product Owner accepts demo of complete 3DS flow

## References

**Confluence Documentation:**
- **"Technical Report: 3DS Authentication Flow Design - Stateful vs. Stateless Analysis"** (Architectural decision record with industry research)
- **OpenAPI Specification v0.5.0** - 3DS Validate-Capture Endpoints

**Related Stories:**
- [Link to initial capture endpoint story, if exists]
- [Link to authentication session service implementation story, if exists]

## Story Points
**Estimate:** [To be determined by team - suggest 8-13 points given complexity of session management, payment integration, and security requirements]

## Labels
`3ds`, `authentication`, `payment`, `checkout`, `api`, `security`, `stateful-session`

---

## Implementation Notes for Team

### Key Architectural Decisions

#### 1. Stateful Session Pattern (Not Stateless)
- Do NOT require clients to resubmit cart, payment token, or billing data
- Only `threeDSSessionId` and 3DS completion data required in request
- Industry standard pattern used by Stripe, PayPal, Adyen, Checkout.com
- See Confluence: "Technical Report: 3DS Authentication Flow Design - Stateful vs. Stateless Analysis" for detailed research

#### 2. Security: Session Ownership is Critical
- Prevents session hijacking attacks
- Validate OAuth token customerId/anonymousId matches session owner
- Log all violations with HIGH severity
- Return HTTP 403 for ownership violations (different from cart/payment validation errors)

#### 3. Data Integrity: Cart Version Validation
- Prevents price manipulation and race conditions
- Cart frozen at initial capture time
- Reject if cart modified during 3DS flow
- Return HTTP 409 Conflict with `CartModified` error code

#### 4. Payment Declines = HTTP 422 (Not HTTP 200)
- **Important:** This differs from Payment API behavior
- Checkout API creates orders, so decline = validation error
- Map processor decline reasons to validation error codes:
  - `PaymentDeclined` (generic)
  - `CardExpired`
  - `InsufficientFunds`
  - `CardDeclined`
  - `FraudSuspected`
  - (See OpenAPI spec for complete list)

#### 5. Single-Use Sessions
- Each session can only complete one order
- Prevents replay attacks and duplicate orders
- Status tracking: `pending` → `used`
- Return HTTP 409 Conflict if session already used

### Implementation Freedom

The team has full flexibility to choose:
- **Session storage technology** (DynamoDB, Redis, ElastiCache, etc.)
- **Session service architecture** (library, microservice, embedded)
- **Merchant configuration management** approach
- **Cart and order service integration** patterns
- **Programming language and framework** (as per team standards)

The only requirements are:
1. **API contract** (OpenAPI specification compliance)
2. **Architectural constraints** (stateful session, ownership validation, cart versioning)
3. **Security requirements** (OAuth integration, logging, PCI compliance)

### Request/Response Examples

**Request:**
```json
POST /me/3ds/validate-capture
Authorization: Bearer {oauth_token}
Content-Type: application/json

{
  "threeDSSessionId": "auth_abc123xyz",
  "threeDSData": {
    "phase": "completion",
    "completion": {
      "authenticationTransactionId": "txn_3ds_456def",
      "cavv": "AAABCZIhcQAAAABZlyFxAAAAAAA=",
      "eciIndicator": "05"
    }
  }
}
```

**Success Response (HTTP 201):**
```json
HTTP/1.1 201 Created
Location: /orders/ord_789ghi
Content-Type: application/json

{
  "id": "ord_789ghi",
  "version": 1,
  "status": "completed",
  "cart": { ... },
  "paymentDetails": [
    {
      "id": "pay_123",
      "status": "authorized",
      "amount": { "amount": 100.00, "currencyCode": "GBP" }
    }
  ],
  ...
}
```

**Error Response - Session Ownership Violation (HTTP 403):**
```json
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "errors": [
    {
      "code": "SessionOwnershipViolation",
      "message": "Authentication session belongs to a different customer",
      "type": "Forbidden"
    }
  ],
  "statusCode": 403,
  "message": "Authentication session belongs to a different customer"
}
```

**Error Response - Session Expired (HTTP 409):**
```json
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "errors": [
    {
      "code": "SessionNotFound",
      "message": "Authentication session not found or expired",
      "type": "Conflict"
    }
  ],
  "statusCode": 409,
  "message": "Authentication session not found or expired"
}
```

**Error Response - Payment Declined (HTTP 422):**
```json
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "orderLevel": [
    {
      "code": "CardExpired",
      "message": "Payment card has expired"
    }
  ],
  "lineItemLevel": []
}
```

### Session Data Structure

The authentication session stored server-side must contain (at minimum):

```typescript
interface AuthenticationSession {
  id: string;                     // threeDSSessionId
  cartId: string;                 // Cart reference
  cartVersion: number;            // Cart version at capture time
  paymentToken: string;           // Payment token (encrypted)
  tokenType: 'transient' | 'stored';
  billTo: BillingDetails;         // Billing information
  shipTo?: ShippingDetails;       // Shipping information (optional)
  threeDSSetupData?: object;      // Setup phase data from initial capture
  createdAt: Date;                // Session creation timestamp
  expiresAt: Date;                // Expiry timestamp (createdAt + 30 minutes)
  status: 'pending' | 'used' | 'expired';
  customerId?: string;            // For authenticated customers
  anonymousId?: string;           // For guest users
  brandKey?: string;              // For /in-brand/ endpoints
  totalAmount: {                  // Total amount from cart
    amount: number;
    currencyCode: string;
  };
}
```

### Testing Checklist

**Unit Tests:**
- [ ] Session retrieval with valid threeDSSessionId
- [ ] Session not found error (HTTP 409)
- [ ] Session expired error (HTTP 409)
- [ ] Session already used error (HTTP 409)
- [ ] Session ownership validation (HTTP 403)
- [ ] Brand context validation for /in-brand/ endpoints (HTTP 403)
- [ ] Cart version mismatch (HTTP 422)
- [ ] Payment declined scenarios (HTTP 422)
- [ ] Successful order creation (HTTP 201)

**Integration Tests:**
- [ ] Complete 3DS flow: initial capture → challenge → validate-capture
- [ ] Session expiration after 30 minutes
- [ ] Concurrent requests with same session (only one succeeds)
- [ ] Cross-customer session hijacking attempt (HTTP 403)

**Security Tests:**
- [ ] OAuth token validation
- [ ] Session ownership enforcement
- [ ] Security event logging verification
- [ ] Payment token encryption verification

---

## JIRA Ticket Creation

When creating the JIRA ticket, include:
1. This entire user story as the description
2. Each acceptance criterion as a checklist or sub-task
3. Links to Confluence documentation (Architecture report, OpenAPI spec)
4. Story points estimate (suggested: 8-13)
5. Labels: `3ds`, `authentication`, `payment`, `checkout`, `api`, `security`, `stateful-session`
6. Epic link (if applicable)
7. Sprint assignment (if known)

---

**Version:** 1.0
**Last Updated:** 2025-11-04
**Contact:** Checkout API Team
