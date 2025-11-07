# 3D Secure Validate-Capture Implementation Guide

This directory contains comprehensive documentation for implementing 3D Secure (3DS) authentication completion endpoints in the Direct Wines Checkout microservice.

---

## Overview

### What is 3DS Validate-Capture?

The 3DS validate-capture flow is a two-step payment authentication process that completes order creation after customer authentication:

1. **Initial Capture** (`POST /me/token/capture` or `/in-brand/{brandkey}/token/capture`)
   - If 3DS authentication required → Returns **HTTP 202 Accepted**
   - Includes `threeDSSessionId` and 3DS challenge URL
   - Creates server-side authentication session

2. **Validate-Capture** (`POST /me/3ds/validate-capture` or `/in-brand/{brandkey}/3ds/validate-capture`)
   - Customer completes 3DS challenge
   - Submits completion data with `threeDSSessionId`
   - Order created on successful authorization → Returns **HTTP 201 Created**

### Implementation Status

| Component | Status | Version |
|-----------|--------|---------|
| **Checkout API Specification** | ✅ Released | v0.5.0 |
| **Authentication Session Library** | ✅ Implemented | [packages/checkout-3ds-session-service](../../../packages/checkout-3ds-session-service) |
| **Reference Lambda Implementation** | ✅ Complete | [lambda/src/handlers](../../../lambda/src/handlers) |

**Note for Direct Wines Team:** This repository contains a reference implementation showing the full 3DS flow. Your production implementation will additionally integrate with commercetools for cart and order management, while continuing to use the `@dw-digital-commerce/payments-sdk` for payment processing.

---

## Documentation Guide

### For Architects & Technical Leads

| Document | Purpose | Read This If... |
|----------|---------|----------------|
| **[ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md)** | Architectural decision record with industry research (Stripe, PayPal, Adyen, Checkout.com) validating the stateful session design | You need to understand **why we chose stateful sessions** over stateless REST patterns |

**Key takeaways:**
- ✅ Stateful session management is the **universal industry standard** for 3DS flows
- ✅ Enhances security by transmitting payment tokens only once
- ✅ Prevents cart manipulation via version validation
- ✅ Aligns with PCI DSS compliance requirements

### For Backend Developers

| Document | Purpose | Read This If... |
|----------|---------|----------------|
| **[SPEC-Authentication-Session-Library.md](./SPEC-Authentication-Session-Library.md)** | Technical specification for the authentication session service | You're implementing **session management** for 3DS flows |
| **[INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md)** | Integration guide for mapping sessions to payments-sdk calls | You need to integrate with **payments-sdk** for payment authorization |

**Reference Implementation Available:**
- Session service: [packages/checkout-3ds-session-service/library](../../../packages/checkout-3ds-session-service/library)
- Lambda handlers: [lambda/src/handlers](../../../lambda/src/handlers)
  - `token-capture-handler.ts` - Initial capture (creates sessions)
  - `validate-capture-handler.ts` - Completion (uses sessions)

### For Product Owners & Project Managers

| Document | Purpose | Read This If... |
|----------|---------|----------------|
| **[USER-STORY-3DS-Validate-Capture-Implementation.md](./USER-STORY-3DS-Validate-Capture-Implementation.md)** | User story with acceptance criteria and implementation notes | You need to understand **requirements and definition of done** |

---

## Quick Start

### Understanding the Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Initial Capture (HTTP 202)                                   │
│    POST /me/token/capture                                       │
├─────────────────────────────────────────────────────────────────┤
│    • Receives: cart + payment token + billing details           │
│    • Creates authentication session (30-min TTL)                │
│    • Stores: cartId, cartVersion, paymentToken, billTo          │
│    • Returns: threeDSSessionId + 3DS challenge URL              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Customer 3DS Challenge (External)                            │
│    Customer redirected to issuer                                │
├─────────────────────────────────────────────────────────────────┤
│    • Customer completes authentication (password, OTP, etc.)    │
│    • Issuer validates customer identity                         │
│    • Returns 3DS completion data (CAVV, ECI, transaction ID)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Validate-Capture (HTTP 201)                                  │
│    POST /me/3ds/validate-capture                                │
├─────────────────────────────────────────────────────────────────┤
│    • Receives: threeDSSessionId + 3DS completion data           │
│    • Retrieves session (validates ownership, TTL, cart version) │
│    • Authorizes payment with stored token + completion data     │
│    • Creates order                                              │
│    • Marks session as used                                      │
│    • Returns: Order object                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Implementation Principles

#### 1. Stateful Session Design
- ✅ Client submits **only** `threeDSSessionId` + 3DS completion data
- ❌ Client does NOT resubmit cart, payment token, or billing details
- Server retrieves all context from authentication session

#### 2. Security Requirements
- **Session Ownership Validation:** Only the OAuth principal (customer/anonymous) who created the session can complete it
- **Cart Version Validation:** Prevents cart modifications during 3DS flow
- **Single-Use Sessions:** Each session can only complete one order
- **30-Minute TTL:** Sessions automatically expire

#### 3. Error Handling Patterns

| HTTP Status | Error Type | Examples |
|-------------|------------|----------|
| **403 Forbidden** | Authorization failure | Session ownership violation, brand context mismatch |
| **409 Conflict** | Session state conflict | Session not found, already used, expired |
| **422 Unprocessable Entity** | Business validation failure | Payment declined, cart modified, 3DS validation failed |

---

## Integration with Direct Wines Platform

### Required Integrations

Your production implementation will need to integrate with:

1. **commercetools** (Cart & Order Management)
   - Retrieve cart details and validate cart version
   - Create orders after successful payment authorization
   - Not present in reference implementation

2. **@dw-digital-commerce/payments-sdk** (Payment Processing)
   - Tokenize payment methods (done before initial capture)
   - Authorize payments with 3DS completion data
   - ✅ Fully demonstrated in reference implementation

3. **Authentication Session Service** (3DS State Management)
   - Create sessions on HTTP 202 responses
   - Retrieve and validate sessions during completion
   - ✅ Reference implementation available in this repo

### Reference Implementation Structure

```
my-checkout-api/
├── packages/checkout-3ds-session-service/
│   ├── library/                    # Authentication session service
│   │   ├── src/core/              # Interface definitions, types, errors
│   │   ├── src/providers/
│   │   │   ├── dynamodb/          # DynamoDB provider (production)
│   │   │   └── mock/              # Mock provider (testing)
│   │   └── src/factory/           # Service factory
│   └── infra/                     # CDK stack for DynamoDB table
│
├── lambda/src/handlers/
│   ├── token-capture-handler.ts   # Initial capture → creates sessions
│   └── validate-capture-handler.ts # Completion → uses sessions
│
└── openapi/checkout-openapi-unresolved.yaml  # API specification v0.5.0
```

**What to use from this repo:**
- ✅ Authentication session service library (DynamoDB + Mock providers)
- ✅ OpenAPI specification patterns
- ✅ Error handling patterns
- ✅ Session validation logic
- ⚠️ Lambda handler patterns (adapt for commercetools integration)

**What you'll add:**
- commercetools cart retrieval and version validation
- commercetools order creation
- Brand-specific merchant configuration
- OAuth integration specific to Direct Wines

---

## Related Documentation

### Internal References
- [Checkout API OpenAPI Specification](../../../openapi/checkout-openapi-unresolved.yaml) - Full API definition v0.5.0
- [Reference Implementation](../../../lambda/src) - Lambda handlers demonstrating full flow
- [3DS Session Service](../../../packages/checkout-3ds-session-service) - Reusable authentication session library

### External Standards
- **Payment API v0.2.0** - 3DS data structures and token authorization patterns
- **EMV 3-D Secure Specification** - Authentication protocol standards
- **PCI DSS** - Payment Card Industry Data Security Standard
- **ISO 19160-1** - International address standard (billing/shipping)

---

## Support & Questions

For questions about implementing 3DS validate-capture endpoints:
- **Architecture questions:** See [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md)
- **Session implementation:** See [SPEC-Authentication-Session-Library.md](./SPEC-Authentication-Session-Library.md)
- **Payments-SDK integration:** See [INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md)
- **User story & acceptance criteria:** See [USER-STORY-3DS-Validate-Capture-Implementation.md](./USER-STORY-3DS-Validate-Capture-Implementation.md)

---

**Last Updated:** 2025-11-07 (Post v0.5.0 Release)
**Documentation Version:** 2.0
**Checkout API Version:** v0.5.0
