# Payment API v0.2.0 Schema Alignment - Alpha Iteration Assessment
## Checkout API v0.4.0

**Document Version:** 1.0
**Date:** 2025-10-20
**Status:** Alpha - Breaking Changes Accepted
**Objective:** Align Checkout API with Payment API v0.2.0 using SwaggerHub references

---

## Executive Summary

This document assesses the schema alignment requirements for integrating Payment API v0.2.0 into Checkout API v0.4.0 during the alpha iteration phase. Since we're in alpha, **breaking changes are acceptable and expected** as we refine the API design.

### Key Points

1. **Alpha Stage Freedom**: No backward compatibility required - we can make breaking changes freely
2. **Reference Pattern**: Use SwaggerHub URL references following existing patterns in the codebase
3. **Target Schemas**: Adopt Payment API's ISO 19160-compliant address structure and structured 3DS model
4. **Implementation**: Mock/demonstration Lambda - focus on showing proper patterns

### Immediate Actions Required

1. Update `Address` schema to reference Payment API's `BillingDetails` structure
2. Replace unstructured `threeDSData` with Payment API's phase-based model
3. Align enum casing (`TRANSIENT`/`STORED` → `transient`/`stored`)
4. Update Lambda implementation to work with new structures

---

## Current State Analysis

### Existing SwaggerHub Reference Pattern

The Checkout API already uses SwaggerHub references for shared schemas:

```yaml
# Common error responses (line 1418)
StructureError:
  $ref: "https://api.swaggerhub.com/apis/Direct_Wines/CommonModelDefinitionSuite/1.0.0#/components/responses/StructureError"

# Cart/Order schemas (lines 930, 1057-1067, 1146, etc.)
amount:
  $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/cart-order-schemas/0.4.0#/components/schemas/Money'

lineItems:
  items:
    oneOf:
      - $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/cart-order-schemas/0.4.0#/components/schemas/LineItem'
      - $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/cart-order-schemas/0.4.0#/components/schemas/GiftVoucherLineItem'
```

**Pattern**: `https://api.swaggerhub.com/apis/Direct_Wines/{api-name}/{version}#/components/schemas/{SchemaName}`

### Expected Payment API SwaggerHub URL

Based on the existing pattern, the Payment API v0.2.0 schemas should be available at:

```
https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0
```

---

## Schema Alignment Requirements

### 1. Address → BillingDetails (HIGH PRIORITY - BREAKING)

**Current Checkout API (`Address` schema - lines 825-861):**
```yaml
Address:
  type: object
  properties:
    firstName:
      type: string
    lastName:
      type: string
    address1:
      type: string
    city:              # ← ISO 19160 violation
      type: string
    postalCode:
      type: string
    country:
      type: string
      pattern: "^[A-Z]{2}$"
    email:
      type: string
    phone:
      type: string
```

**Payment API v0.2.0 Structure:**
```yaml
BillingDetails:
  required:
    - firstName
    - lastName
    - address
  properties:
    firstName:
      type: string
    lastName:
      type: string
    email:
      type: string
    phone:
      type: string
    address:           # ← Nested ISO 19160 address
      $ref: "#/components/schemas/Address"

Address:
  required:
    - address1
    - locality        # ← ISO 19160 standard term
    - postalCode
    - country
  properties:
    address1:
      type: string
    address2:
      type: string
    locality:          # ← Replaces "city"
      type: string
    administrativeArea:
      type: string
    postalCode:
      type: string
    country:
      type: string
      pattern: "^[A-Z]{2}$"
```

**Change Impact:**
- **Breaking**: Structure change from flat to nested
- **Breaking**: Field rename `city` → `locality`
- **Benefit**: ISO 19160 compliance, matches Payment API exactly

**Action Required:**
```yaml
# Replace current Address schema with Payment API reference
components:
  schemas:
    # Reference Payment API schemas
    PaymentAddress:
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/Address'

    PaymentBillingDetails:
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/BillingDetails'

    # Update TokenisedPaymentDetails to use BillingDetails
    TokenisedPaymentDetails:
      required:
        - paymentToken
        - tokenType
        - billTo
      properties:
        # ... other fields
        billTo:
          $ref: '#/components/schemas/PaymentBillingDetails'  # ← Changed
```

---

### 2. ThreeDSData Structure (HIGH PRIORITY - BREAKING)

**Current Checkout API (line 968-971):**
```yaml
threeDSData:
  type: object
  additionalProperties: true  # ← Unstructured!
  description: 3DS authentication data from Payments API setup.
```

**Payment API v0.2.0:**
```yaml
ThreeDSData:
  type: object
  properties:
    phase:
      type: string
      enum: [setup, completion]
      description: Phase indicator
    setup:
      $ref: "#/components/schemas/ThreeDSSetupData"
    completion:
      $ref: "#/components/schemas/ThreeDSCompletionData"
```

**Change Impact:**
- **Breaking**: From unstructured to structured schema
- **Breaking**: Phase-based discriminator required
- **Benefit**: Proper validation, clear setup vs completion phases

**Action Required:**
```yaml
components:
  schemas:
    PaymentThreeDSData:
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/ThreeDSData'

    TokenisedPaymentDetails:
      properties:
        # ... other fields
        threeDSData:
          $ref: '#/components/schemas/PaymentThreeDSData'  # ← Changed
```

---

### 3. Token Type Enum Casing (MEDIUM PRIORITY - BREAKING)

**Current Checkout API (lines 957-960):**
```yaml
tokenType:
  type: string
  enum: [TRANSIENT, STORED]  # ← Uppercase
  example: "TRANSIENT"
```

**Payment API v0.2.0:**
```yaml
tokenType:
  type: string
  enum: [transient, stored]  # ← Lowercase
  example: transient
```

**Change Impact:**
- **Breaking**: Enum values change case
- **Benefit**: Consistency with Payment API, lowercase is more RESTful

**Action Required:**
- Update enum in `TokenisedPaymentDetails.tokenType`
- Update all examples to use lowercase
- Update Lambda code to accept lowercase

---

### 4. Money Schema (LOW PRIORITY - NON-BREAKING)

**Current Checkout API:**
Already references cart-order-schemas Money, which may need validation pattern updates.

**Payment API v0.2.0:**
```yaml
Money:
  required:
    - amount
    - currencyCode
  properties:
    amount:
      type: number
    currencyCode:
      type: string
      pattern: "^[A-Z]{3}$"  # ← ISO 4217 validation
```

**Action:**
- Verify cart-order-schemas Money includes ISO 4217 pattern
- If not, consider referencing Payment API Money schema instead

---

## SwaggerHub Reference Strategy

### Proposed Schema References

Add these to `components/schemas`:

```yaml
components:
  schemas:
    # ========================================
    # Payment API v0.2.0 Schema References
    # ========================================

    PaymentAddress:
      description: "ISO 19160-compliant address structure from Payment API"
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/Address'

    PaymentBillingDetails:
      description: "Billing contact information with nested address from Payment API"
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/BillingDetails'

    PaymentThreeDSData:
      description: "Phase-based 3DS authentication data structure from Payment API"
      $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/ThreeDSData'

    # Optionally reference Money if cart-order-schemas doesn't have pattern validation
    # PaymentMoney:
    #   $ref: 'https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0#/components/schemas/Money'
```

### Benefits of SwaggerHub References

1. **Single Source of Truth**: Payment API definitions are authoritative
2. **Automatic Updates**: When Payment API v0.2.0 is updated on SwaggerHub, changes propagate
3. **No Duplication**: Zero maintenance burden for keeping schemas in sync
4. **Clear Dependencies**: Explicit dependency on Payment API version
5. **Validation**: SwaggerHub validates references at specification time

---

## Example Transformation

### Before (Current v0.4.0)

```json
{
  "payments": [
    {
      "type": "tokenised",
      "amount": {
        "amount": 49.99,
        "currencyCode": "GBP"
      },
      "tokenisedPayment": {
        "paymentToken": "tkn_abc123",
        "tokenType": "TRANSIENT",  // ← Uppercase
        "billTo": {
          "firstName": "John",
          "lastName": "Doe",
          "address1": "123 Main St",
          "city": "London",  // ← Flat structure, "city"
          "postalCode": "SW1A 1AA",
          "country": "GB",
          "email": "john@example.com"
        },
        "threeDSData": {
          // ← Unstructured - anything goes!
          "someField": "someValue"
        }
      }
    }
  ]
}
```

### After (Aligned with Payment API v0.2.0)

```json
{
  "payments": [
    {
      "type": "tokenised",
      "amount": {
        "amount": 49.99,
        "currencyCode": "GBP"
      },
      "tokenisedPayment": {
        "paymentToken": "tkn_abc123",
        "tokenType": "transient",  // ← Lowercase
        "billTo": {
          "firstName": "John",
          "lastName": "Doe",
          "email": "john@example.com",
          "address": {  // ← Nested structure
            "address1": "123 Main St",
            "locality": "London",  // ← ISO 19160 term
            "postalCode": "SW1A 1AA",
            "country": "GB"
          }
        },
        "threeDSData": {  // ← Structured
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
    }
  ]
}
```

---

## Risks & Mitigations

### Risk: SwaggerHub API May Not Be Published Yet

**Probability**: Medium
**Impact**: High - Blocks implementation

**Mitigation Options:**
1. **Verify**: Check if `https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.2.0` exists
2. **Publish**: If not published, upload Payment API v0.2.0 to SwaggerHub first
3. **Temporary Local**: Use local Payment API schemas initially, migrate to SwaggerHub refs later

### Risk: Breaking Changes Impact Mock/Demo Clients

**Probability**: High
**Impact**: Low - This is alpha, we expect to update clients

**Mitigation:**
- Document all breaking changes in CHANGELOG
- Update all request/response examples in OpenAPI spec
- Update any demo clients/tests to use new structure

### Risk: 3DS Implementation Complexity

**Probability**: Medium
**Impact**: Medium - Lambda code needs updating

**Mitigation:**
- Lambda is mock/demo - can use simplified 3DS handling
- Focus on accepting correct structure, not full 3DS flow
- Document that full 3DS requires Payment API integration

---

## Success Criteria

### OpenAPI Specification

- [ ] All Payment API schemas referenced via SwaggerHub URLs
- [ ] TokenisedPaymentDetails uses BillingDetails reference
- [ ] ThreeDSData uses Payment API structured model
- [ ] All examples updated to show new structure
- [ ] Enum casing aligned (lowercase `transient`/`stored`)
- [ ] OpenAPI spec validates successfully

### Lambda Implementation

- [ ] Accepts nested `billTo.address.locality` structure
- [ ] Handles structured `threeDSData` with phase discriminator
- [ ] Case-insensitive token type handling (accepts both cases during transition)
- [ ] Mock responses use Payment API aligned structure
- [ ] Unit tests pass with new request format

### Documentation

- [ ] CHANGELOG documents all breaking changes
- [ ] Request/response examples updated throughout spec
- [ ] Migration notes for any existing alpha users
- [ ] OpenAPI description sections reference Payment API alignment

---

## Timeline Estimate

**Total Duration**: 1-2 weeks for alpha iteration

### Week 1: OpenAPI Specification Updates
- **Day 1-2**: Verify Payment API v0.2.0 is on SwaggerHub (or publish it)
- **Day 2-3**: Update Checkout API spec with SwaggerHub references
- **Day 3-4**: Update all request/response examples
- **Day 4-5**: Validate spec, test with SwaggerHub/AWS API Gateway

### Week 2: Lambda Implementation
- **Day 6-7**: Update Lambda to handle new billTo structure
- **Day 7-8**: Update Lambda to handle structured threeDSData
- **Day 8-9**: Update unit tests
- **Day 9-10**: Deploy to dev, manual testing, documentation updates

---

## Dependencies

### External
- Payment API v0.2.0 must be published to SwaggerHub at expected URL
- Access to SwaggerHub for Direct_Wines organization
- Ability to reference external SwaggerHub APIs

### Internal
- OpenAPI editor skill for making spec changes
- CDK infrastructure must support SwaggerHub references (should work - existing refs prove it)
- Lambda TypeScript implementation updates

---

## Next Steps

1. **Immediate**: Verify Payment API v0.2.0 SwaggerHub publication
2. **Immediate**: Create detailed OpenAPI specification change plan (next document)
3. **Next**: Create Lambda implementation rework plan
4. **Then**: Execute changes according to plans

---

## Appendix: Full Schema Mapping

| Checkout API Current | Payment API v0.2.0 | Change Type | Priority |
|---------------------|--------------------|-----------  |----------|
| `Address` (flat) | `BillingDetails` → `Address` | Breaking | HIGH |
| `threeDSData` (unstructured) | `ThreeDSData` (phase-based) | Breaking | HIGH |
| `tokenType: TRANSIENT` | `tokenType: transient` | Breaking | MEDIUM |
| `Money` (via cart-order-schemas) | `Money` (with pattern) | Enhancement | LOW |
| `TokenisedPaymentDetails` | `TokenAuthoriseRequest` (subset) | Alignment | MEDIUM |
| `TokenisedPaymentResult` | `PaymentAuthorizedResponse` (subset) | Enhancement | LOW |

---

**Document Status**: Ready for review and OpenAPI implementation planning

**Author**: Claude Code Analysis
**Review Required**: Technical Lead, API Architect
