# User Story: Align Checkout API with Payment API v0.2.0 Schema Standards

## Story ID
CHECKOUT-001

## Title
As a Direct Wines microservice developer, I need to align the Checkout API with Payment API v0.2.0 schema standards so that billing address structures, 3DS flows, and payment token handling are consistent across our payment processing ecosystem.

## User Story

**As a** Direct Wines microservice developer
**I want to** update the Checkout API to align with Payment API v0.2.0 schemas
**So that** we have consistent address structures (ISO 19160), 3DS authentication flows, and payment token handling across all payment-related APIs in our ecosystem

## Business Context

The Payment API has been updated to v0.2.0 with improved address handling (ISO 19160 compliance), structured 3DS flows, and standardized payment token types. To ensure consistency and maintainability across our microservices architecture, the Checkout API must align with these new schemas.

**Benefits:**
- Consistent address handling across all payment APIs (Cart, Checkout, Payment)
- ISO 19160-compliant address structure for global expansion
- Improved 3DS authentication flow clarity with phase-based discriminator model
- Better developer experience with standardized schemas
- Reduced integration complexity for consuming applications

**Impact:**
- **Breaking changes** for current Checkout API consumers (alpha release - acceptable)
- Requires client updates (web, mobile, backend services)
- Enables future Payment API features and enhancements

## Technical Context

- **Current Version:** v0.3.0 (alpha)
- **Target Version:** v0.4.0 (alpha)
- **Deployment:** AWS Lambda + API Gateway (multi-account deployment)
- **Infrastructure:** CDK TypeScript
- **Dependencies:** Payment API v0.2.0, SwaggerHub schema references

## Acceptance Criteria

### AC1: Address Structure Compliance
```gherkin
Given I am submitting a checkout request with a tokenised payment
When I provide billing details in the Payment API v0.2.0 format
Then the address should be nested under billTo.address
And the locality field should be used instead of city
And the request should be validated against Payment API v0.2.0 schema

Examples:
  | Field (v0.3.0)     | Field (v0.4.0)                  |
  |--------------------|----------------------------------|
  | billTo.city        | billTo.address.locality         |
  | billTo.address1    | billTo.address.address1         |
  | billTo.postalCode  | billTo.address.postalCode       |

Scenario: Submit checkout with v0.4.0 address structure
  Given I have a valid cart with ID "cart-123" and version 1
  And I have a payment token "tkn_abc123" with type "transient"
  When I submit a checkout request with billing details:
    """
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
    """
  Then the request should be accepted
  And the order should be created with status "COMPLETED"
  And the response should return HTTP 201 Created

Scenario: Reject checkout with v0.3.0 address structure
  Given I have a valid cart with ID "cart-456" and version 1
  And I have a payment token "tkn_xyz789" with type "transient"
  When I submit a checkout request with old billing details format:
    """
    {
      "billTo": {
        "firstName": "Jane",
        "lastName": "Smith",
        "address1": "456 High Street",
        "city": "Manchester",
        "postalCode": "M1 1AA",
        "country": "GB",
        "email": "jane@example.com"
      }
    }
    """
  Then the request should be rejected
  And the response should return HTTP 400 Bad Request
  And the error should indicate schema validation failure
```

### AC2: Phase-Based 3DS Authentication Flow
```gherkin
Given I am implementing 3D Secure authentication
When I provide 3DS data in the request
Then the data should use a phase-based discriminator model
And the phase should be either "setup" or "completion"
And the phase-specific data should be nested under the appropriate phase property

Scenario: Submit 3DS setup request
  Given I have a valid cart with ID "cart-3ds-123" and version 1
  And I have obtained 3DS device collection details from the Payment API
  When I submit a checkout request with 3DS setup data:
    """
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
    """
  Then the request should be accepted
  And the response should return HTTP 202 Accepted
  And the response should include authentication challenge details
  And the authenticationDetails.challengeUrl should be present

Scenario: Complete 3DS authentication
  Given I have completed the 3DS customer challenge
  And I have received the authentication transaction ID "txn_3ds_67890"
  When I submit a checkout request with 3DS completion data:
    """
    {
      "threeDSData": {
        "phase": "completion",
        "completion": {
          "authenticationTransactionId": "txn_3ds_67890",
          "cavv": "AAABCZIhcQAAAABZlyFxAAAAAAA=",
          "eciIndicator": "05"
        }
      }
    }
    """
  Then the request should be accepted
  And the Payment API 3DS validation endpoint should be called
  And the order should be created with status "COMPLETED"
  And the response should return HTTP 201 Created

Scenario: Reject unstructured 3DS data
  Given I have a valid cart with ID "cart-3ds-old" and version 1
  When I submit a checkout request with old unstructured 3DS data:
    """
    {
      "threeDSData": {
        "referenceId": "ref_123",
        "deviceCollectionAccessToken": "token_xyz"
      }
    }
    """
  Then the request should be rejected
  And the response should return HTTP 400 Bad Request
  And the error should indicate missing required field "phase"
```

### AC3: Lowercase Token Type Enum Values
```gherkin
Given I am submitting a checkout request with a payment token
When I specify the token type
Then the value should be lowercase ("transient" or "stored")
And uppercase values ("TRANSIENT" or "STORED") should be rejected

Scenario: Accept lowercase token types
  Given I have a valid cart with ID "cart-token-123" and version 1
  And I have a payment token "tkn_lowercase_123"
  When I submit a checkout request with tokenType "transient"
  Then the request should be accepted
  And the order should be created successfully

Scenario: Accept stored token type
  Given I have a valid cart with ID "cart-stored-456" and version 1
  And I have a stored payment token "tkn_stored_456"
  When I submit a checkout request with tokenType "stored"
  Then the request should be accepted
  And the order should be created successfully

Scenario: Reject uppercase token types
  Given I have a valid cart with ID "cart-upper-789" and version 1
  And I have a payment token "tkn_upper_789"
  When I submit a checkout request with tokenType "TRANSIENT"
  Then the request should be rejected
  And the response should return HTTP 400 Bad Request
  And the error should indicate invalid enum value
  And the error message should suggest using "transient" instead
```

## Technical Implementation Notes

### OpenAPI Specification Changes
- Update `checkout-openapi.yaml` to reference Payment API v0.2.0 SwaggerHub schemas
- Add `$ref` references for:
  - `PaymentAddress` (ISO 19160-compliant address)
  - `PaymentBillingDetails` (billing contact with nested address)
  - `PaymentThreeDSData` (phase-based 3DS authentication)
- Remove legacy flat `Address` schema
- Update `TokenType` enum to lowercase values
- Remove top-level `billingAddress` field from `CheckoutDraft` schema

### Lambda Implementation Changes
- Update TypeScript interfaces in `lambda/src/index.ts`
- Implement address structure validation (nested `address` property)
- Implement 3DS phase discriminator validation
- Update token type enum validation (lowercase only)
- Update Payment API integration to use v0.2.0 endpoints
- Update response status codes (201 for completed, 202 for 3DS required)

### API Gateway Configuration
- Update API Gateway integration in `infra/src/lib/api-stack.ts`
- Ensure OpenAPI spec variable substitution works with new schema references
- Test authorizer bypass in dev environment
- Verify CORS configuration with new response codes

### Testing Requirements
- Unit tests for schema validation (address, 3DS, token types)
- Integration tests with Payment API v0.2.0
- Contract tests against OpenAPI specification
- End-to-end tests for complete checkout flows
- Backward compatibility tests (should reject v0.3.0 requests)
- 3DS flow tests (setup phase, completion phase)

### Deployment Considerations
- Deploy to dev environment first with `BYPASS_AUTHORIZER=true`
- Validate all test scenarios in dev
- Deploy to SIT with full authentication enabled
- Coordinate with consuming teams for client updates
- Monitor CloudWatch logs for validation errors
- Prepare rollback plan (revert to v0.3.0 if critical issues)

## Definition of Done

- [ ] OpenAPI specification updated to v0.4.0 with Payment API v0.2.0 references
- [ ] Lambda function implements all v0.4.0 schema validations
- [ ] All three acceptance criteria pass with Gherkin scenarios
- [ ] Unit tests achieve >80% code coverage
- [ ] Integration tests pass against Payment API v0.2.0
- [ ] Contract tests validate OpenAPI spec compliance
- [ ] CDK infrastructure deploys successfully to dev environment
- [ ] API Gateway integration works with new schemas
- [ ] Documentation updated (README, CLAUDE.md, OpenAPI description)
- [ ] CHANGELOG.md updated with v0.4.0 release notes
- [ ] Migration guide created and reviewed (see attachment)
- [ ] Code review completed by team lead
- [ ] Security review completed (no new vulnerabilities)
- [ ] Performance testing shows no regression
- [ ] Deployed to SIT environment and verified
- [ ] Consuming teams notified of breaking changes
- [ ] Migration guide distributed to API consumers

## Dependencies

- Payment API v0.2.0 schemas available on SwaggerHub
- Payment API v0.2.0 deployed and accessible
- SwaggerHub account access for schema references
- AWS CDK infrastructure updated to support schema references
- Test environment with Payment API v0.2.0 integration

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking changes affect existing clients | High | High | Provide comprehensive migration guide, coordinate rollout |
| Payment API v0.2.0 not stable | High | Low | Verify Payment API stability before starting, maintain v0.3.0 fallback |
| 3DS flow integration issues | Medium | Medium | Thorough integration testing, work with Payment API team |
| SwaggerHub schema reference failures | Medium | Low | Cache schemas locally, implement fallback validation |
| Performance degradation | Medium | Low | Load testing, optimize validation logic |

## Estimation

**Story Points:** 13 (Large)

**Effort Breakdown:**
- OpenAPI specification updates: 2 points
- Lambda implementation: 5 points
- Testing (unit, integration, contract): 3 points
- Documentation and migration guide: 2 points
- Deployment and verification: 1 point

**Timeline:** 2-3 sprints (4-6 weeks)

## Attachments

1. **Migration Guide:** `MIGRATION-v0.3.0-to-v0.4.0.md` - Comprehensive developer migration guide with code examples, testing strategies, and field mapping references
2. **Payment API v0.2.0 Alignment Docs:** See `docs/payment-api-alignment/` directory for detailed implementation plans
3. **Test Payloads:** `docs/payment-api-alignment/test-payloads.json` - Sample request/response payloads for all scenarios

## Related Stories

- PAYMENT-042: Payment API v0.2.0 Release
- CART-023: Cart API Address Structure Alignment
- AUTH-015: Global Authoriser OAuth 2.0 Integration

## Team Contacts

- **Product Owner:** [Name]
- **Tech Lead:** [Name]
- **Payment API Team:** [Team Contact]
- **QA Lead:** [Name]

---

**Created:** 2025-10-21
**Last Updated:** 2025-10-21
**Status:** Ready for Refinement
**Epic:** Payment Platform Modernization
**Sprint:** TBD
