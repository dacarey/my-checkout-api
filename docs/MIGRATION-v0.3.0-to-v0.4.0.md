# Migration Guide: v0.3.0 to v0.4.0

## Overview

Version 0.4.0 represents a **breaking change release** that aligns the Checkout API with Payment API v0.2.0. As this is an alpha release, we've prioritized API correctness and alignment with industry standards (ISO 19160) over backward compatibility.

**Release Date**: 2025-10-20

**Key Changes**:
- Address structure aligned with ISO 19160 standard (via Payment API v0.2.0)
- 3DS data structure changed to phase-based model
- Token type enum values changed from uppercase to lowercase
- Removed top-level `billingAddress` field from `CheckoutDraft`

## Breaking Changes Summary

| Change Category | Impact Level | Required Action |
|----------------|--------------|-----------------|
| Address Structure | **HIGH** | Update all address handling code |
| Token Type Enum | **MEDIUM** | Change constant values |
| 3DS Data Structure | **MEDIUM** | Update 3DS flow implementation |
| Schema Removal | **LOW** | Remove `billingAddress` from requests |

---

## 1. Address Structure Changes

### Overview

The biggest change in v0.4.0 is the restructuring of billing address data to align with Payment API v0.2.0 and ISO 19160 address standards.

### What Changed

**v0.3.0 Structure** (Flat Address):
```json
{
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
```

**v0.4.0 Structure** (Nested BillingDetails):
```json
{
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
```

### Key Differences

1. **Person details** (firstName, lastName, email) remain at the top level of `billTo`
2. **Address fields** are now nested under `billTo.address`
3. **Field rename**: `city` → `locality` (ISO 19160 terminology)

### Migration Steps

#### Step 1: Update Request Building Code

**Before (v0.3.0)**:
```typescript
const billTo = {
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  address1: customer.address.line1,
  address2: customer.address.line2,
  city: customer.address.city,
  postalCode: customer.address.postalCode,
  country: customer.address.countryCode
};
```

**After (v0.4.0)**:
```typescript
const billTo = {
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  address: {
    address1: customer.address.line1,
    address2: customer.address.line2,
    locality: customer.address.city,  // Renamed field
    postalCode: customer.address.postalCode,
    country: customer.address.countryCode
  }
};
```

#### Step 2: Update Type Definitions

**Before (v0.3.0)**:
```typescript
interface BillingAddress {
  firstName: string;
  lastName: string;
  email: string;
  address1: string;
  address2?: string;
  city: string;
  postalCode: string;
  country: string;
  state?: string;
  phoneNumber?: string;
}
```

**After (v0.4.0)**:
```typescript
interface Address {
  address1: string;
  address2?: string;
  locality: string;  // Renamed from 'city'
  administrativeArea?: string;  // Renamed from 'state'
  postalCode: string;
  country: string;
}

interface BillingDetails {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  address: Address;  // Nested structure
}
```

#### Step 3: Update Response Parsing

If you're storing or processing order responses, update your parsing logic:

**Before (v0.3.0)**:
```typescript
const billingCity = order.paymentDetails[0]
  .tokenisedPaymentResult?.billTo?.city;
```

**After (v0.4.0)**:
```typescript
const billingCity = order.paymentDetails[0]
  .tokenisedPaymentResult?.billTo?.address?.locality;
```

### Testing Checklist

- [ ] Update all checkout form submissions to use nested address structure
- [ ] Change all references from `city` to `locality`
- [ ] Change all references from `state` to `administrativeArea` (if used)
- [ ] Test with full billing address (all fields)
- [ ] Test with minimal billing address (required fields only)
- [ ] Verify address validation logic still works
- [ ] Update any address display/formatting code

---

## 2. Token Type Enum Changes

### What Changed

Token type enum values changed from uppercase to lowercase to align with Payment API standards.

**v0.3.0**:
```json
{
  "tokenType": "TRANSIENT"
}
```

**v0.4.0**:
```json
{
  "tokenType": "transient"
}
```

### Valid Values

| v0.3.0 (OLD) | v0.4.0 (NEW) |
|--------------|--------------|
| `TRANSIENT`  | `transient`  |
| `STORED`     | `stored`     |

### Migration Steps

#### Step 1: Update Constants

**Before (v0.3.0)**:
```typescript
export const TokenType = {
  TRANSIENT: 'TRANSIENT',
  STORED: 'STORED'
} as const;
```

**After (v0.4.0)**:
```typescript
export const TokenType = {
  TRANSIENT: 'transient',
  STORED: 'stored'
} as const;
```

#### Step 2: Update Type Definitions

**Before (v0.3.0)**:
```typescript
type TokenType = 'TRANSIENT' | 'STORED';
```

**After (v0.4.0)**:
```typescript
type TokenType = 'transient' | 'stored';
```

#### Step 3: Update Code References

Search your codebase for:
- `'TRANSIENT'` → replace with `'transient'`
- `'STORED'` → replace with `'stored'`
- `TokenType.TRANSIENT` → update constant definition
- `TokenType.STORED` → update constant definition

### Testing Checklist

- [ ] Update all hardcoded token type strings
- [ ] Update enum/constant definitions
- [ ] Update type definitions
- [ ] Test transient token flow (credit card, Apple Pay, Google Pay)
- [ ] Test stored token flow (if using stored payment methods)

---

## 3. 3DS Data Structure Changes

### Overview

3D Secure data structure changed from an unstructured `additionalProperties: true` model to a structured phase-based discriminator model.

### What Changed

**v0.3.0** (Unstructured):
```json
{
  "threeDSData": {
    "referenceId": "ref_3ds_12345",
    "deviceCollectionAccessToken": "eyJ...",
    "deviceDataCollectionUrl": "https://3ds.psp.com/collect"
  }
}
```

**v0.4.0** (Phase-Based):
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

### Phase Types

The new structure uses a `phase` discriminator with two possible values:

1. **`"setup"`**: For initial 3DS device data collection
2. **`"completion"`**: For completing 3DS authentication

### Migration Steps

#### Step 1: Update Setup Phase (Device Collection)

**Before (v0.3.0)**:
```typescript
const threeDSData = {
  referenceId: threeDSRef,
  deviceCollectionAccessToken: token,
  deviceDataCollectionUrl: collectionUrl
};
```

**After (v0.4.0)**:
```typescript
const threeDSData = {
  phase: 'setup',
  setup: {
    referenceId: threeDSRef,
    authenticationInformation: {
      deviceCollectionAccessToken: token,
      deviceDataCollectionUrl: collectionUrl
    }
  }
};
```

#### Step 2: Update Completion Phase (Challenge Response)

**Before (v0.3.0)**:
```typescript
const threeDSData = {
  authenticationTransactionId: transId,
  cavv: cavvValue,
  eciIndicator: eciValue
};
```

**After (v0.4.0)**:
```typescript
const threeDSData = {
  phase: 'completion',
  completion: {
    authenticationTransactionId: transId,
    cavv: cavvValue,
    eciIndicator: eciValue
  }
};
```

#### Step 3: Update Type Definitions

**Before (v0.3.0)**:
```typescript
interface ThreeDSData {
  [key: string]: any;  // Unstructured
}
```

**After (v0.4.0)**:
```typescript
interface ThreeDSSetupData {
  referenceId: string;
  authenticationInformation: {
    deviceCollectionAccessToken: string;
    deviceDataCollectionUrl: string;
  };
}

interface ThreeDSCompletionData {
  authenticationTransactionId: string;
  cavv?: string;
  eciIndicator?: string;
}

interface ThreeDSData {
  phase: 'setup' | 'completion';
  setup?: ThreeDSSetupData;
  completion?: ThreeDSCompletionData;
}
```

#### Step 4: Update Response Parsing

**Before (v0.3.0)**:
```typescript
if (order.status === 'REQUIRES_3DS_VALIDATION') {
  const challengeUrl = order.paymentDetails[0]
    .tokenisedPaymentResult?.threeDSData?.challengeUrl;
}
```

**After (v0.4.0)**:
```typescript
if (response.status === 202) {  // HTTP 202 Accepted
  const challengeUrl = response.data.authenticationDetails
    ?.challengeUrl;
}
```

**Note**: In v0.4.0, 3DS-required responses return HTTP 202 (Accepted) instead of 201, and the structure is different.

### Testing Checklist

- [ ] Update 3DS setup request structure (phase: "setup")
- [ ] Update 3DS completion request structure (phase: "completion")
- [ ] Update type definitions for 3DS data
- [ ] Test 3DS device collection flow
- [ ] Test 3DS challenge completion flow
- [ ] Update response handling for 202 status code

---

## 4. Removed Top-Level billingAddress Field

### What Changed

The top-level `billingAddress` field has been removed from `CheckoutDraft`. Billing information is now provided within each payment method.

### Migration Steps

**Before (v0.3.0)**:
```json
{
  "cartId": "cart-123",
  "version": 1,
  "billingAddress": {
    "firstName": "John",
    "lastName": "Doe",
    "city": "London",
    ...
  },
  "payments": [...]
}
```

**After (v0.4.0)**:
```json
{
  "cartId": "cart-123",
  "version": 1,
  "payments": [
    {
      "type": "tokenised",
      "amount": {...},
      "tokenisedPayment": {
        "billTo": {
          "firstName": "John",
          "lastName": "Doe",
          "address": {
            "locality": "London",
            ...
          }
        }
      }
    }
  ]
}
```

### Action Required

- Remove any code that sets `billingAddress` at the top level of checkout requests
- Ensure billing details are included in each payment method's `billTo` field

---

## 5. HTTP Status Code Changes

### What Changed

Version 0.4.0 adopts more REST-compliant status codes, particularly for 3DS flows.

| Scenario | v0.3.0 | v0.4.0 |
|----------|--------|--------|
| Order created successfully | `201 Created` | `201 Created` ✓ |
| 3DS authentication required | `201 Created` (with `status: REQUIRES_3DS_VALIDATION`) | `202 Accepted` |
| Business validation failed | `422 Unprocessable Entity` | `422 Unprocessable Entity` ✓ |

### Migration Steps

Update your response handling to check for HTTP 202:

**Before (v0.3.0)**:
```typescript
if (response.status === 201) {
  if (response.data.status === 'REQUIRES_3DS_VALIDATION') {
    // Handle 3DS
    const challengeUrl = response.data.paymentDetails[0]
      .tokenisedPaymentResult?.threeDSData?.challengeUrl;
    redirectTo3DS(challengeUrl);
  } else {
    // Order completed
    showOrderConfirmation(response.data);
  }
}
```

**After (v0.4.0)**:
```typescript
if (response.status === 201) {
  // Order completed successfully
  showOrderConfirmation(response.data);
} else if (response.status === 202) {
  // 3DS authentication required
  const challengeUrl = response.data.authenticationDetails?.challengeUrl;
  redirectTo3DS(challengeUrl);
}
```

### Benefits

- **Clearer semantics**: HTTP status code directly indicates the outcome
- **No order created on 3DS**: In v0.4.0, orders are only created after successful payment (201) or after 3DS completion
- **Easier integration**: Standard HTTP semantics make the API more intuitive

---

## 6. Complete Migration Example

Here's a complete before/after example showing all changes:

### Before (v0.3.0)

```typescript
// Request
const checkoutRequest = {
  cartId: 'cart-123',
  version: 1,
  payments: [{
    type: 'tokenised',
    amount: {
      amount: 49.99,
      currencyCode: 'GBP'
    },
    tokenisedPayment: {
      merchantId: 'YOUR_MID',
      paymentToken: 'tkn_abc123',
      tokenType: 'TRANSIENT',  // Uppercase
      billTo: {
        firstName: 'John',
        lastName: 'Doe',
        address1: '123 Main St',
        city: 'London',  // Flat structure
        postalCode: 'SW1A 1AA',
        country: 'GB',
        email: 'john@example.com'
      },
      threeDSData: {  // Unstructured
        referenceId: 'ref_123',
        deviceCollectionAccessToken: 'token_xyz'
      }
    }
  }]
};

// Response handling
if (response.status === 201) {
  if (response.data.status === 'REQUIRES_3DS_VALIDATION') {
    redirectTo3DS(response.data.paymentDetails[0]
      .tokenisedPaymentResult?.threeDSData?.challengeUrl);
  } else {
    showConfirmation(response.data);
  }
}
```

### After (v0.4.0)

```typescript
// Request
const checkoutRequest = {
  cartId: 'cart-123',
  version: 1,
  payments: [{
    type: 'tokenised',
    amount: {
      amount: 49.99,
      currencyCode: 'GBP'
    },
    tokenisedPayment: {
      paymentToken: 'tkn_abc123',
      tokenType: 'transient',  // Lowercase
      billTo: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        address: {  // Nested structure
          address1: '123 Main St',
          locality: 'London',  // Renamed field
          postalCode: 'SW1A 1AA',
          country: 'GB'
        }
      },
      threeDSData: {  // Phase-based structure
        phase: 'setup',
        setup: {
          referenceId: 'ref_123',
          authenticationInformation: {
            deviceCollectionAccessToken: 'token_xyz',
            deviceDataCollectionUrl: 'https://...'
          }
        }
      }
    }
  }]
};

// Response handling
if (response.status === 201) {
  // Order created successfully
  showConfirmation(response.data);
} else if (response.status === 202) {
  // 3DS authentication required
  redirectTo3DS(response.data.authenticationDetails?.challengeUrl);
}
```

---

## 7. Migration Checklist

### Code Changes

- [ ] Update address structures (nest under `address` property)
- [ ] Change `city` to `locality` in all address references
- [ ] Change `state` to `administrativeArea` (if used)
- [ ] Update token type from uppercase to lowercase
- [ ] Restructure 3DS data to phase-based model
- [ ] Remove top-level `billingAddress` field
- [ ] Update HTTP 202 response handling
- [ ] Update type definitions/interfaces
- [ ] Update constants/enums

### Testing

- [ ] Test single payment method checkout
- [ ] Test mixed payment methods (gift voucher + card)
- [ ] Test 3DS setup flow
- [ ] Test 3DS completion flow
- [ ] Test address validation
- [ ] Test all payment token types (transient, stored)
- [ ] Test error responses (422 validation errors)
- [ ] Integration test with actual Payment API v0.2.0
- [ ] End-to-end checkout flow

### Documentation

- [ ] Update API client documentation
- [ ] Update integration guides
- [ ] Update code examples
- [ ] Update developer onboarding docs
- [ ] Update error handling documentation

---

## 8. Validation and Testing

### Testing Strategy

1. **Unit Tests**: Update all unit tests to use v0.4.0 structure
2. **Integration Tests**: Test against actual Payment API v0.2.0
3. **Contract Tests**: Validate OpenAPI spec compliance
4. **End-to-End Tests**: Full checkout flow testing

### Sample Test Cases

```typescript
describe('Checkout API v0.4.0 Migration', () => {
  it('should use lowercase token types', () => {
    const request = buildCheckoutRequest();
    expect(request.payments[0].tokenisedPayment.tokenType)
      .toBe('transient');
  });

  it('should use nested address structure', () => {
    const request = buildCheckoutRequest();
    const billTo = request.payments[0].tokenisedPayment.billTo;
    expect(billTo).toHaveProperty('address');
    expect(billTo.address).toHaveProperty('locality');
  });

  it('should use phase-based 3DS structure', () => {
    const request = buildCheckoutRequestWith3DS();
    const threeDSData = request.payments[0].tokenisedPayment.threeDSData;
    expect(threeDSData.phase).toBe('setup');
    expect(threeDSData.setup).toBeDefined();
  });

  it('should handle 202 response for 3DS', async () => {
    const response = await checkoutApi.capture(request);
    if (response.status === 202) {
      expect(response.data.authenticationDetails).toBeDefined();
      expect(response.data.authenticationDetails.challengeUrl).toBeDefined();
    }
  });
});
```

---

## 9. Support and Resources

### Documentation

- [CHANGELOG.md](/CHANGELOG.md) - Full list of changes
- [OpenAPI Specification](/openapi/checkout-openapi.yaml) - Complete API spec
- [Payment API v0.2.0 Alignment Docs](/docs/payment-api-alignment/) - Detailed alignment documentation

### Getting Help

If you encounter issues during migration:

1. Check the [OpenAPI specification](openapi/checkout-openapi.yaml:12) for the latest schema definitions
2. Review the [test payloads](docs/payment-api-alignment/test-payloads.json:1) for complete examples
3. Consult the [implementation summary](docs/payment-api-alignment/implementation-summary.md:1)
4. Contact the API support team at apisupport@directwines.com

### Common Issues

**Issue**: Getting 422 validation errors after migration
- **Cause**: Likely still using old address structure or uppercase token types
- **Solution**: Double-check all request structures match v0.4.0 examples

**Issue**: 3DS flow not working
- **Cause**: Using old unstructured 3DS data format
- **Solution**: Update to phase-based structure with `phase` discriminator

**Issue**: Type errors in TypeScript
- **Cause**: Old type definitions still in use
- **Solution**: Update all interfaces to match new nested structures

---

## 10. Timeline and Rollout

### Recommended Migration Path

1. **Week 1**: Update development environment
   - Update local OpenAPI specs
   - Update type definitions
   - Update code to new structures

2. **Week 2**: Testing
   - Run full test suite
   - Integration testing with Payment API v0.2.0
   - Fix any issues discovered

3. **Week 3**: Staging deployment
   - Deploy to staging environment
   - End-to-end testing
   - Performance testing

4. **Week 4**: Production rollout
   - Deploy to production
   - Monitor for issues
   - Support team on standby

### Alpha Release Notice

As this is an **alpha release** (v0.4.0), further breaking changes are possible. We recommend:

- Pin your dependencies to specific versions
- Monitor the changelog for updates
- Participate in feedback to shape the API before beta/stable release

---

## Appendix A: Field Mapping Reference

### Address Fields

| v0.3.0 Field | v0.4.0 Field | Notes |
|--------------|--------------|-------|
| `billTo.firstName` | `billTo.firstName` | No change |
| `billTo.lastName` | `billTo.lastName` | No change |
| `billTo.email` | `billTo.email` | No change |
| `billTo.address1` | `billTo.address.address1` | Now nested |
| `billTo.address2` | `billTo.address.address2` | Now nested |
| `billTo.city` | `billTo.address.locality` | Renamed + nested |
| `billTo.state` | `billTo.address.administrativeArea` | Renamed + nested |
| `billTo.postalCode` | `billTo.address.postalCode` | Now nested |
| `billTo.country` | `billTo.address.country` | Now nested |
| `billTo.phoneNumber` | `billTo.phoneNumber` | No change |

### Token Type Values

| v0.3.0 Value | v0.4.0 Value |
|--------------|--------------|
| `TRANSIENT` | `transient` |
| `STORED` | `stored` |

### 3DS Data Structure

| v0.3.0 Location | v0.4.0 Location | Notes |
|-----------------|-----------------|-------|
| `threeDSData.referenceId` | `threeDSData.setup.referenceId` | Setup phase |
| `threeDSData.deviceCollectionAccessToken` | `threeDSData.setup.authenticationInformation.deviceCollectionAccessToken` | Setup phase |
| `threeDSData.*` (completion) | `threeDSData.completion.*` | Completion phase |

---

**Document Version**: 1.0
**Last Updated**: 2025-10-21
**Applies to**: Checkout API v0.3.0 → v0.4.0 migration
