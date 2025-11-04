# 3D Secure Validate-Capture Documentation

This directory contains comprehensive documentation for the 3D Secure (3DS) authentication flow implementation in the Checkout API, specifically the validate-capture endpoints that complete order creation after successful customer authentication.

---

## Feature Overview

### What is 3DS Validate-Capture?

The 3DS validate-capture flow is a two-step payment authentication process:

1. **Initial Capture** (`/me/token/capture`) → Returns **HTTP 202** if 3DS authentication required
2. **Validate-Capture** (`/me/3ds/validate-capture`) → Completes order creation after customer authentication

### Why Stateful Session Design?

After comprehensive industry research (Stripe, PayPal, Adyen, Checkout.com), we adopted a **stateful session-based architecture** for 3DS flows. This approach:

- **Enhances security**: Payment tokens transmitted once, not repeated
- **Prevents manipulation**: Cart frozen at authentication time with version validation
- **Improves UX**: Client only tracks `authenticationId` during redirect
- **Ensures compliance**: Minimizes PCI DSS scope by reducing sensitive data exposure

### Key Components

- **Authentication Sessions**: Temporary (30-minute) server-side storage of cart and payment context
- **Session Ownership**: OAuth-based validation ensuring only the session creator can complete it
- **Single-Use Enforcement**: Sessions can only be consumed once to prevent replay attacks
- **Phase-Based 3DS**: Aligned with Payment API v0.2.0 discriminator model

---

## Documentation Guide

| Document | Purpose | Audience | Start Here If... |
|----------|---------|----------|------------------|
| [**ARCHITECTURE-3DS-Stateful-Design-Decision.md**](./ARCHITECTURE-3DS-Stateful-Design-Decision.md) | Architectural decision record validating stateful design vs stateless alternatives with industry research | Solution Architects, Technical Leads | You need to understand **why** we chose stateful sessions |
| [**SPEC-Authentication-Session-Library.md**](./SPEC-Authentication-Session-Library.md) | Technical specification for `@dw-digital-commerce/checkout-authentication-service` npm library | Backend Developers, Library Maintainers | You're implementing the **authentication session library** |
| [**SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md**](./SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md) | Review of OpenAPI endpoint implementation with enhancement recommendations | Technical Architects, API Designers | You need to validate **OpenAPI specification** completeness |
| [**SPEC-Lambda-3DS-Validate-Capture-Implementation.md**](./SPEC-Lambda-3DS-Validate-Capture-Implementation.md) | Technical specification for Lambda handler implementation of validate-capture endpoints | Lambda Developers, Backend Engineers | You're implementing the **Lambda handlers** for validate-capture |
| [**INTEGRATION-Payments-SDK-Mapping.md**](./INTEGRATION-Payments-SDK-Mapping.md) | Integration guide mapping Checkout API to `@dw-digital-commerce/payments-sdk` | Integration Engineers, Backend Developers | You need to understand **payments-sdk integration** |

---

## Quick Start Guides

### For Lambda Developers
1. Start with [SPEC-Lambda-3DS-Validate-Capture-Implementation.md](./SPEC-Lambda-3DS-Validate-Capture-Implementation.md)
2. Reference [SPEC-Authentication-Session-Library.md](./SPEC-Authentication-Session-Library.md) for session management
3. Use [INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md) for payment processing

### For Solution Architects
1. Start with [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md)
2. Review [SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md](./SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md)
3. Check [INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md) for integration strategy

### For Technical Architects (Microservice TA)
1. Start with [SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md](./SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md)
2. Review [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md) for design rationale
3. Reference [SPEC-Authentication-Session-Library.md](./SPEC-Authentication-Session-Library.md) for infrastructure requirements

---

## Key Concepts

### Authentication Session Lifecycle

```
1. Initial Capture (HTTP 202)
   └─> Create authentication session
       └─> Store: cartId, cartVersion, paymentToken, billTo, customerId/anonymousId
       └─> Return: authenticationId, threeDSUrl

2. Customer 3DS Challenge
   └─> Customer redirected to issuer authentication page
       └─> Completes verification (fingerprint, password, OTP)
       └─> Returns to merchant with 3DS completion data

3. Validate-Capture (HTTP 201)
   └─> Retrieve session by authenticationId
       └─> Validate: ownership, TTL, cart version
       └─> Call payments-sdk with stored context + 3DS data
       └─> Create order
       └─> Mark session as used
       └─> Delete session
```

### Session Ownership Validation

Sessions are tied to the OAuth token's principal (customer or anonymous user):

- **Authenticated customers**: `customerId` from OAuth `sub` claim
- **Guest users**: `anonymousId` from OAuth `sub` claim

Only the principal who created the session can complete it, preventing session hijacking attacks.

### HTTP Status Code Patterns

| Status | Meaning | When Used |
|--------|---------|-----------|
| **201 Created** | Order successfully created | Payment authorized, order created |
| **202 Accepted** | 3DS authentication required | Customer must complete 3DS challenge |
| **409 Conflict** | Session conflict | Session not found, already used, expired, or ownership violation |
| **422 Unprocessable Entity** | Business validation failed | 3DS validation failed, cart modified, payment declined |

---

## Related Documentation

### External References
- [Payment API v0.2.0](https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0) - 3DS data structures and token authorization
- [Checkout API OpenAPI Specification](../../openapi/checkout-openapi-unresolved.yaml) - Complete API definition

### Industry Standards
- **EMV 3-D Secure Specification** - Authentication protocol standards
- **PCI DSS** - Payment Card Industry Data Security Standard
- **ISO 19160-1** - International address standard (billing/shipping)

---

## Implementation Status

| Component | Status | Version |
|-----------|--------|---------|
| OpenAPI Endpoints | ✅ Complete | v0.5.0 |
| Authentication Session Library | 📝 Specification | v1.0.0 (draft) |
| Lambda Implementation | 🔄 In Development | v0.5.0 |
| DynamoDB Provider | 🔄 Planned | v1.0.0 |
| Mock Provider | 🔄 Planned | v1.0.0 |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-04 | Initial documentation structure with architectural research, library spec, integration guide, and implementation specs |

---

**Last Updated:** 2025-11-04
**Contact:** Checkout API Team
