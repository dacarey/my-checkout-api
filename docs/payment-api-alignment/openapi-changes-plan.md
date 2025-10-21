# OpenAPI Specification Changes Plan
## Checkout API v0.4.0 - Payment API Alignment

**Document Version:** 1.0
**Date:** 2025-10-20
**Target File:** `openapi/checkout-openapi-unresolved.yaml`
**Status:** Implementation Ready

---

## Overview

This document provides step-by-step instructions for updating the Checkout API OpenAPI specification to align with Payment API v0.2.0 using SwaggerHub references. All changes should be made using the **openapi-editor skill** for proper validation and AWS API Gateway compatibility.

---

## Prerequisites

Before starting, verify:
- [ ] Payment API v0.2.0 exists at `https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0`
- [ ] Access to openapi-editor skill
- [ ] Current checkout-openapi-unresolved.yaml is backed up
- [ ] Git working directory is clean

---

## Change Checklist

### Phase 1: Add Payment API Schema References
- [ ] Add PaymentAddress reference
- [ ] Add PaymentBillingDetails reference
- [ ] Add PaymentThreeDSData reference

### Phase 2: Update TokenisedPaymentDetails
- [ ] Change billTo to use PaymentBillingDetails
- [ ] Change threeDSData to use PaymentThreeDSData
- [ ] Update tokenType enum to lowercase
- [ ] Update description to reference Payment API

### Phase 3: Update Examples
- [ ] Update /me/token/capture request examples
- [ ] Update /in-brand/{brandkey}/token/capture request examples
- [ ] Update 201 response examples (if needed)
- [ ] Update 202 3DS response examples

### Phase 4: Update Documentation
- [ ] Update API description to mention Payment API alignment
- [ ] Update field descriptions referencing address structure
- [ ] Add changelog entry

### Phase 5: Validation
- [ ] Validate OpenAPI spec
- [ ] Test CDK synthesis
- [ ] Generate API documentation

---

## Detailed Change Instructions

### CHANGE 1: Add Payment API Schema References

**Location:** `components/schemas` section (after line 818)

**Action:** Add new schema references after the comment about Money schema

**Current Code (lines 819-823):**
```yaml
  schemas:
    # ----------------------------------------
    #  Common Objects

    # Money schema moved to shared domain schema:
  # https://api.swaggerhub.com/apis/Direct_Wines/cart-order-schemas/0.4.0#/components/schemas/Money
```

**New Code:**
```yaml
  schemas:
    # ----------------------------------------
    #  Payment API v0.2.0 Schema References
    #
    # These schemas are defined in the Payment API and referenced here to ensure
    # consistency across payment processing endpoints.

    PaymentAddress:
      description: |
        ISO 19160-compliant address structure from Payment API v0.2.0.
        Uses 'locality' instead of 'city' per international addressing standards.
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/Address'

    PaymentBillingDetails:
      description: |
        Billing contact information with nested ISO 19160 address from Payment API v0.2.0.
        Separates person details (name, email, phone) from address structure.
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/BillingDetails'

    PaymentThreeDSData:
      description: |
        Phase-based 3D Secure authentication data structure from Payment API v0.2.0.
        Uses 'phase' discriminator to distinguish setup from completion flows.
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/ThreeDSData'

    # ----------------------------------------
    #  Common Objects

    # Money schema moved to shared domain schema:
  # https://api.swaggerhub.com/apis/Direct_Wines/cart-order-schemas/0.4.0#/components/schemas/Money
```

**Verification:**
- Check that URLs are formatted correctly (single quotes)
- Ensure proper indentation (2 spaces)
- Verify description text is helpful

---

### CHANGE 2: Remove Legacy Address Schema

**Location:** Lines 825-861

**Action:** Remove the old `Address` schema entirely (it's replaced by PaymentBillingDetails reference)

**Delete This Section:**
```yaml
    Address:
      type: object
      properties:
        firstName:
          type: string
          example: "John"
          description: First name of the customer.
        # ... (lines 825-861)
```

**Rationale:**
- `Address` is no longer used directly - replaced by nested structure
- Prevents confusion about which address schema to use
- `PaymentBillingDetails` now provides the person + address structure

---

### CHANGE 3: Update TokenisedPaymentDetails Schema

**Location:** Lines 936-971 (TokenisedPaymentDetails schema)

**Current Code:**
```yaml
    TokenisedPaymentDetails:
      type: object
      description: |
        Tokenised payment details. This is a subset of the TokenAuthoriseRequest
        from the Payments API, containing the essential fields needed for checkout.

        **Bill To**: Billing address information.
      required:
        - merchantId
        - paymentToken
        - tokenType
        - billTo
      properties:
        merchantId:
          type: string
          example: "YOUR_MID"
          description: Unique merchant identifier assigned by the PSP.
        paymentToken:
          type: string
          example: "tkn_abc123xyz"
          description: Payment token for processing.
        tokenType:
          type: string
          enum: [TRANSIENT, STORED]
          example: "TRANSIENT"
          description: Token type ('TRANSIENT' for single-use, 'STORED' for saved tokens).
        setupRecurring:
          type: boolean
          example: false
          description: Flag indicating if payment should set up a subscription for future recurring charges (only valid with transient tokens).
        billTo:
          $ref: "#/components/schemas/Address"
        threeDSData:
          type: object
          additionalProperties: true
          description: 3DS authentication data from Payments API setup.
```

**New Code:**
```yaml
    TokenisedPaymentDetails:
      type: object
      description: |
        Tokenised payment details aligned with Payment API v0.2.0 TokenAuthoriseRequest.
        This schema contains the essential fields needed for checkout payment processing.

        **Alignment with Payment API**: This schema is a subset of the Payment API's
        TokenAuthoriseRequest, using the same structure for billTo and threeDSData to
        ensure seamless integration with payment processing.

        **Bill To**: Billing contact information with nested ISO 19160-compliant address.

        **3DS Data**: Phase-based 3D Secure authentication data structure.
      required:
        - merchantId
        - paymentToken
        - tokenType
        - billTo
      properties:
        merchantId:
          type: string
          example: "YOUR_MID"
          description: Unique merchant identifier assigned by the PSP.
        paymentToken:
          type: string
          example: "tkn_abc123xyz"
          description: Payment token for processing.
        tokenType:
          type: string
          enum: [transient, stored]  # ← CHANGED: lowercase
          example: "transient"        # ← CHANGED: lowercase
          description: Token type ('transient' for single-use, 'stored' for saved tokens).
        setupRecurring:
          type: boolean
          example: false
          description: Flag indicating if payment should set up a subscription for future recurring charges (only valid with transient tokens).
        billTo:
          $ref: "#/components/schemas/PaymentBillingDetails"  # ← CHANGED: reference Payment API
        threeDSData:
          $ref: "#/components/schemas/PaymentThreeDSData"     # ← CHANGED: structured model
```

**Key Changes:**
1. `tokenType` enum: `TRANSIENT, STORED` → `transient, stored`
2. `tokenType` example: `"TRANSIENT"` → `"transient"`
3. `billTo` ref: `Address` → `PaymentBillingDetails`
4. `threeDSData`: unstructured object → `PaymentThreeDSData` reference
5. Updated description to emphasize Payment API alignment

---

### CHANGE 4: Update Request Examples - /me/token/capture

**Location:** Lines 269-321 (request examples)

**Change:** Update the `single-tokenised-payment` example

**Current Example:**
```yaml
              single-tokenised-payment:
                summary: Single credit card payment
                value:
                  cartId: "3169811e-fa0a-789"
                  version: 1
                  payments:
                    - type: "tokenised"
                      amount:
                        amount: 49.99
                        currencyCode: "GBP"
                      tokenisedPayment:
                        merchantId: "YOUR_MID"
                        paymentToken: "tkn_abc123xyz"
                        tokenType: "TRANSIENT"  # ← OLD
                        billTo:
                          firstName: "John"
                          lastName: "Doe"
                          address1: "123 Main Street"
                          city: "London"       # ← OLD STRUCTURE
                          postalCode: "SW1A 1AA"
                          country: "GB"
                          email: "customer@example.com"
```

**New Example:**
```yaml
              single-tokenised-payment:
                summary: Single credit card payment
                value:
                  cartId: "3169811e-fa0a-789"
                  version: 1
                  payments:
                    - type: "tokenised"
                      amount:
                        amount: 49.99
                        currencyCode: "GBP"
                      tokenisedPayment:
                        merchantId: "YOUR_MID"
                        paymentToken: "tkn_abc123xyz"
                        tokenType: "transient"  # ← NEW: lowercase
                        billTo:                  # ← NEW: nested structure
                          firstName: "John"
                          lastName: "Doe"
                          email: "customer@example.com"
                          address:
                            address1: "123 Main Street"
                            locality: "London"  # ← NEW: ISO 19160 term
                            postalCode: "SW1A 1AA"
                            country: "GB"
```

**Similar Updates Required For:**
- Line 291-321: `mixed-payment-methods` example (update both payments)
- Lines 581-602: `/in-brand/{brandkey}/token/capture` examples
- Lines 603-633: Additional in-brand examples

**Template for Updates:**
```yaml
billTo:
  firstName: "{firstName}"
  lastName: "{lastName}"
  email: "{email}"
  phone: "{phone}"        # optional
  address:
    address1: "{street}"
    address2: "{apt}"     # optional
    locality: "{city}"    # ← was "city"
    administrativeArea: "{state}"  # optional
    postalCode: "{postal}"
    country: "{CC}"
```

---

### CHANGE 5: Add 3DS Example (Optional Enhancement)

**Location:** Add new example after `mixed-payment-methods`

**Action:** Add comprehensive 3DS example showing phase-based structure

**New Example:**
```yaml
              payment-with-3ds-setup:
                summary: Credit card payment with 3DS setup data
                value:
                  cartId: "3169811e-fa0a-789"
                  version: 1
                  payments:
                    - type: "tokenised"
                      amount:
                        amount: 75.50
                        currencyCode: "EUR"
                      tokenisedPayment:
                        merchantId: "YOUR_MID"
                        paymentToken: "tkn_xyz789def"
                        tokenType: "transient"
                        setupRecurring: false
                        billTo:
                          firstName: "Jane"
                          lastName: "Smith"
                          email: "jane.smith@example.com"
                          address:
                            address1: "456 High Street"
                            locality: "Manchester"
                            postalCode: "M1 1AA"
                            country: "GB"
                        threeDSData:
                          phase: "setup"
                          setup:
                            referenceId: "d5180465-bae3-4df7-940d-3b029b7de81a"
                            authenticationInformation:
                              deviceCollectionAccessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                              deviceDataCollectionUrl: "https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect"
```

---

### CHANGE 6: Update API Description (Optional)

**Location:** Lines 12-17 (info.description section)

**Enhancement:** Add note about Payment API alignment

**Current:**
```yaml
  description: |
    This is the API specification for the Digital Commerce Checkout API. It provides operations for:
    - Order capture with tokenised payment methods (credit cards, Apple Pay, Google Pay)
    - Order capture with stored payment methods (gift vouchers)
    - Cart validation and order creation
    - 3DS authentication flow support
```

**Enhanced:**
```yaml
  description: |
    This is the API specification for the Digital Commerce Checkout API. It provides operations for:
    - Order capture with tokenised payment methods (credit cards, Apple Pay, Google Pay)
    - Order capture with stored payment methods (gift vouchers)
    - Cart validation and order creation
    - 3DS authentication flow support

    **Payment API Integration**: This API is aligned with Payment API v0.2.0 for payment
    processing schemas, ensuring consistency in address structures (ISO 19160), 3DS flows,
    and payment token handling.
```

---

### CHANGE 7: Update CHANGELOG

**Location:** Create/update `CHANGELOG.md` in project root

**Add Entry:**
```markdown
# Changelog

## [0.4.0] - 2025-10-20

### Changed - BREAKING CHANGES

#### Payment API v0.2.0 Alignment

This release aligns the Checkout API with Payment API v0.2.0 schemas using SwaggerHub references.
All changes are breaking changes as we're in alpha stage.

**Address Structure** (BREAKING)
- Changed from flat `Address` schema to nested `BillingDetails` → `Address` structure
- Field rename: `city` → `locality` (ISO 19160 standard)
- Billing information now separates person details from address

Before:
```json
{
  "billTo": {
    "firstName": "John",
    "city": "London",
    ...
  }
}
```

After:
```json
{
  "billTo": {
    "firstName": "John",
    "address": {
      "locality": "London",
      ...
    }
  }
}
```

**3DS Data Structure** (BREAKING)
- Changed from unstructured `additionalProperties: true` to phase-based model
- Requires `phase` discriminator: `"setup"` or `"completion"`

**Token Type Enum** (BREAKING)
- Changed from uppercase (`TRANSIENT`, `STORED`) to lowercase (`transient`, `stored`)

**Schema References**
- Added SwaggerHub references to Payment API v0.2.0 for:
  - `PaymentAddress`
  - `PaymentBillingDetails`
  - `PaymentThreeDSData`

### Migration Guide

Update your checkout requests to use the new nested address structure:
1. Move person details (firstName, lastName, email, phone) to outer `billTo` level
2. Move address fields into nested `billTo.address` object
3. Rename `city` to `locality`
4. Use lowercase for tokenType values

For 3DS flows, provide structured data:
```json
{
  "threeDSData": {
    "phase": "setup",
    "setup": {
      "referenceId": "...",
      "authenticationInformation": { ... }
    }
  }
}
```
```

---

## Testing Plan

### 1. OpenAPI Validation

```bash
# Use openapi-editor skill to validate
# Should report no errors
```

### 2. CDK Synthesis Test

```bash
cd infra
npm run build
# Should successfully bundle OpenAPI spec with external references
```

### 3. Manual API Gateway Test

- Deploy to dev environment
- Test with valid request using new structure
- Verify API Gateway accepts and processes request
- Check error responses for invalid structures

### 4. Documentation Generation

- Generate API documentation from OpenAPI spec
- Verify all references resolve correctly
- Check that examples display properly

---

## Rollback Plan

If issues are discovered:

1. **Git Revert**:
   ```bash
   git revert HEAD
   git push
   ```

2. **Restore from Backup**:
   ```bash
   cp openapi/checkout-openapi-unresolved.yaml.backup openapi/checkout-openapi-unresolved.yaml
   ```

3. **Identify Issue**:
   - Check CDK build logs
   - Verify SwaggerHub URLs are accessible
   - Test spec validation separately

---

## Post-Implementation Checklist

- [ ] All changes implemented as documented
- [ ] OpenAPI spec validates successfully
- [ ] CDK synthesizes without errors
- [ ] Examples updated and tested
- [ ] CHANGELOG updated
- [ ] Git commit with clear message
- [ ] PR created (if using PR workflow)
- [ ] Lambda implementation plan reviewed

---

## Next Steps

After OpenAPI changes are complete:

1. Review Lambda Implementation Rework Plan
2. Update Lambda code to handle new request structure
3. Update unit tests
4. Deploy to dev and test end-to-end
5. Update any documentation or integration guides

---

**Document Status**: Ready for implementation with openapi-editor skill

**Estimated Time**: 2-3 hours for careful implementation and testing
