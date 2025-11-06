# Changelog

All notable changes to the Checkout API will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2025-11-06

### Added
- 3DS validate-capture endpoints: `POST /me/3ds/validate-capture` and `POST /in-brand/{brandkey}/3ds/validate-capture`
- Session-based authentication system with DynamoDB-backed storage (30-minute TTL)
- `checkout-3ds-session-service` workspace package for managing 3DS sessions
- Example client implementation and test suite

### Changed
- Payment decline responses now return 422 (Unprocessable Entity) instead of 400
- Token-capture endpoint creates authentication sessions for 3DS flows, returning `threeDSSessionId` in 202 responses
- Enhanced error handling with specific codes: 404 (session expired), 409 (session already used), 503 (service unavailable)

### Fixed
- Token type mapping between provider and API formats

---

## [0.4.0] - 2025-10-20

### Changed - BREAKING CHANGES (Alpha Release)

#### Payment API v0.2.0 Alignment

This release aligns the Checkout API with Payment API v0.2.0 schemas using SwaggerHub references.
All changes are breaking changes as we're in alpha stage.

**Address Structure** (BREAKING)
- Changed from flat `Address` schema to nested `BillingDetails` → `Address` structure
- Field rename: `city` → `locality` (ISO 19160 standard)
- Billing information now separates person details from address

Before (v0.3.x):
```json
{
  "billTo": {
    "firstName": "John",
    "lastName": "Doe",
    "address1": "123 Main St",
    "city": "London",
    "postalCode": "SW1A 1AA",
    "country": "GB",
    "email": "john@example.com"
  }
}
```

After (v0.4.0):
```json
{
  "billTo": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "address": {
      "address1": "123 Main St",
      "locality": "London",
      "postalCode": "SW1A 1AA",
      "country": "GB"
    }
  }
}
```

**3DS Data Structure** (BREAKING)
- Changed from unstructured `additionalProperties: true` to phase-based model
- Requires `phase` discriminator: `"setup"` or `"completion"`

Example:
```json
{
  "threeDSData": {
    "phase": "setup",
    "setup": {
      "referenceId": "ref_3ds_12345",
      "authenticationInformation": {
        "deviceCollectionAccessToken": "eyJ...",
        "deviceDataCollectionUrl": "https://3ds.psp.com/collect"
      }
    }
  }
}
```

**Token Type Enum** (BREAKING)
- Changed from uppercase (`TRANSIENT`, `STORED`) to lowercase (`transient`, `stored`)

**Schema References**
- Added SwaggerHub references to Payment API v0.2.0 for:
  - `PaymentAddress` (ISO 19160-compliant address structure)
  - `PaymentBillingDetails` (billing contact with nested address)
  - `PaymentThreeDSData` (phase-based 3DS authentication)

**Removed**
- Removed top-level `billingAddress` field from `CheckoutDraft` (billing info now in payment methods)
- Removed legacy flat `Address` schema (replaced by Payment API references)

### Migration Guide for Alpha Users

1. **Update Address Structure**: Move person details to outer level, nest address fields:
   ```typescript
   // Old
   billTo: {
     firstName: "John",
     city: "London"
   }

   // New
   billTo: {
     firstName: "John",
     address: {
       locality: "London"
     }
   }
   ```

2. **Rename city → locality**: Update all address references

3. **Use lowercase token types**: Change `TRANSIENT` → `transient`, `STORED` → `stored`

4. **Structure 3DS Data**: If using 3DS, provide phase-based structure:
   ```json
   {
     "threeDSData": {
       "phase": "setup",
       "setup": { ... }
     }
   }
   ```

---

## [0.3.0] - 2025-10-15

### Added
- Initial alpha release
- POST /me/token/capture endpoint
- POST /in-brand/{brandkey}/token/capture endpoint
- Support for tokenised payments (credit cards, Apple Pay, Google Pay)
- Support for stored payments (gift vouchers)
- Mixed payment method support
- 3DS authentication flow (basic structure)
- Business validation error responses
- OpenAPI 3.0.3 specification

### Features
- Cart version-based concurrency control
- Idempotency key support
- GlobalAuthoriser OAuth 2.0 security
- CORS support
- Standard error responses (400, 401, 403, 422, 429, 500)
