# Lambda Implementation Specification: 3DS Validate-Capture Endpoints

**Version:** 1.0
**Status:** Implementation Ready
**Target:** Checkout API v0.5.0
**Last Updated:** 2025-11-04
**For:** Lambda Developers, Backend Engineers

---

## Executive Summary

This specification defines the Lambda handler implementation for the 3D Secure validate-capture endpoints that complete order creation after successful customer authentication. The implementation uses the `@dw-digital-commerce/checkout-authentication-service` library for session management and the `@dw-digital-commerce/payments-sdk` for payment processing.

### Implementation Scope

**Endpoints to Implement:**
- `POST /me/3ds/validate-capture` - Complete order for authenticated customer
- `POST /in-brand/{brandkey}/3ds/validate-capture` - Complete order within specified brand

**Key Integration Points:**
- Authentication Session Service (session retrieval, validation, lifecycle management)
- Payments SDK (3DS validation with payment processor)
- Cart Service (cart version validation)
- Order Service (order creation)

**Error Handling:**
- HTTP 403: Session ownership violations
- HTTP 409: Session conflicts (not found, used, expired, cart modified)
- HTTP 422: Business validation failures (3DS validation failed, payment declined)

---

## Table of Contents

1. [Lambda Handler Architecture](#1-lambda-handler-architecture)
2. [Authentication Session Integration](#2-authentication-session-integration)
3. [Implementation Flow](#3-implementation-flow)
4. [Error Handling Specification](#4-error-handling-specification)
5. [Payments-SDK Integration](#5-payments-sdk-integration)
6. [Security Requirements](#6-security-requirements)
7. [Code Examples](#7-code-examples)
8. [Testing Requirements](#8-testing-requirements)
9. [Environment Configuration](#9-environment-configuration)
10. [Deployment Checklist](#10-deployment-checklist)

---

## 1. Lambda Handler Architecture

### 1.1 Handler Entry Point

The Lambda function must handle both `/me` and `/in-brand/{brandkey}` endpoint variants. Use the API Gateway event's path to determine the execution context.

```typescript
// lambda/src/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Route based on path
    const path = event.resource; // e.g., "/me/3ds/validate-capture" or "/in-brand/{brandkey}/3ds/validate-capture"

    if (path === '/me/3ds/validate-capture') {
      return await handleMeValidateCapture(event);
    } else if (path === '/in-brand/{brandkey}/3ds/validate-capture') {
      return await handleInBrandValidateCapture(event);
    } else {
      throw new Error(`Unhandled path: ${path}`);
    }
  } catch (error) {
    return handleError(error, event);
  }
};
```

### 1.2 Request Routing Strategy

**Option 1: Path-Based Routing (Recommended)**
- Single Lambda handler with internal routing based on `event.resource`
- Shared code for common logic (session validation, payment processing)
- Brand-specific logic isolated in `handleInBrandValidateCapture`

**Option 2: Separate Handler Functions**
- Define separate exported handlers: `handleMeValidateCapture` and `handleInBrandValidateCapture`
- Configure API Gateway integration to route to specific handler
- More deployment complexity, but clearer separation

**Recommendation:** Use **Option 1** for simpler deployment and code reuse.

### 1.3 Handler Function Signatures

```typescript
/**
 * Handle /me/3ds/validate-capture endpoint
 * Completes order for authenticated customer after 3DS challenge
 */
async function handleMeValidateCapture(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult>;

/**
 * Handle /in-brand/{brandkey}/3ds/validate-capture endpoint
 * Completes order within specified brand (for agents/backend services)
 */
async function handleInBrandValidateCapture(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult>;

/**
 * Shared core logic for both endpoints
 */
async function processValidateCapture(
  request: ThreeDSValidateCaptureRequest,
  authContext: AuthenticationContext,
  brandKey?: string
): Promise<Order>;
```

### 1.4 Middleware Requirements

**Pre-Handler Middleware:**
- ✅ Authentication: Handled by API Gateway Global Authorizer (OAuth token validation)
- ✅ CORS: Handled by API Gateway OPTIONS responses
- Request parsing: Parse JSON body, validate structure
- Idempotency key extraction: Extract from `Idempotency-Key` header

**Post-Handler Middleware:**
- Response formatting: Ensure consistent error structure
- Logging: Audit trail for authentication session usage
- Metrics: Track success/failure rates, latency

---

## 2. Authentication Session Integration

### 2.1 Service Factory Pattern

Use a factory function to create the authentication service with environment-based provider selection.

```typescript
// lambda/src/services/authentication-service-factory.ts
import { IAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service';
import { DynamoDBAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/dynamodb';
import { MockAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/mock';

/**
 * Factory function to create authentication service based on environment
 */
function createAuthenticationService(): IAuthenticationService {
  const environment = process.env.ENVIRONMENT || 'dev';

  // Use mock provider for testing
  if (environment === 'test' || process.env.USE_MOCK_AUTH === 'true') {
    console.log('Using MockAuthenticationService');
    return new MockAuthenticationService();
  }

  // Use DynamoDB provider for production
  const tableName = process.env.AUTH_SESSION_TABLE_NAME;
  const region = process.env.AWS_REGION || 'eu-west-1';

  if (!tableName) {
    throw new Error('Missing required environment variable: AUTH_SESSION_TABLE_NAME');
  }

  console.log(`Using DynamoDBAuthenticationService (table: ${tableName})`);
  return new DynamoDBAuthenticationService({
    tableName,
    region
  });
}

// Global instance for Lambda container reuse
let authenticationService: IAuthenticationService | null = null;

export function getAuthenticationService(): IAuthenticationService {
  if (!authenticationService) {
    authenticationService = createAuthenticationService();
  }
  return authenticationService;
}
```

### 2.2 Environment-Based Provider Selection

| Environment | Provider | Configuration |
|-------------|----------|---------------|
| `test` | Mock | In-memory, no AWS dependencies |
| `dev` | DynamoDB | Dev environment table |
| `sit`, `uat`, `prod` | DynamoDB | Environment-specific tables |

**Environment Variable Override:**
- Set `USE_MOCK_AUTH=true` to force mock provider (useful for local testing)

### 2.3 Session Retrieval Pattern

```typescript
import { getAuthenticationService } from './services/authentication-service-factory';
import { SessionNotFoundError } from '@dw-digital-commerce/checkout-authentication-service';

async function retrieveSession(authenticationId: string): Promise<AuthenticationSession> {
  const authService = getAuthenticationService();

  const session = await authService.getSession(authenticationId);

  if (!session) {
    throw new SessionNotFoundError(authenticationId);
  }

  return session;
}
```

**Note:** The `getSession` method automatically:
- Checks session expiration (returns `null` if expired)
- Filters out used sessions (returns `null` if `status !== 'pending'`)
- See [SPEC-Authentication-Session-Library.md](./SPEC-Authentication-Session-Library.md) Section 2.2 for full interface

---

## 3. Implementation Flow

### 3.1 Complete Processing Sequence

Based on [INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md) Section 5.1, the complete flow is:

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Retrieve and Validate Session                          │
├─────────────────────────────────────────────────────────────────┤
│ 1.1 Extract authenticationId from request                      │
│ 1.2 Call authService.getSession(authenticationId)              │
│ 1.3 Validate session exists (not null)                         │
│ 1.4 Validate session status === 'pending'                      │
│ 1.5 Validate session not expired (expiresAt > now)             │
│ 1.6 Validate session ownership (customerId/anonymousId match)  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Validate Cart State                                    │
├─────────────────────────────────────────────────────────────────┤
│ 2.1 Call cartService.getCart(session.cartId)                   │
│ 2.2 Validate cart.version === session.cartVersion              │
│ 2.3 Validate cart is still valid for checkout                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Retrieve Merchant Configuration                        │
├─────────────────────────────────────────────────────────────────┤
│ 3.1 Determine brand context (from session or path parameter)   │
│ 3.2 Call getMerchantConfig(brandKey)                           │
│ 3.3 Initialize PaymentService with merchant credentials        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Build Payment Authorization Request                    │
├─────────────────────────────────────────────────────────────────┤
│ 4.1 Generate orderId                                            │
│ 4.2 Extract payment details from session                       │
│ 4.3 Map billing details (ISO 19160 → Payments SDK format)      │
│ 4.4 Merge 3DS completion data from request                     │
│ 4.5 Construct paymentAuthorisation request                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Execute Payment Authorization                          │
├─────────────────────────────────────────────────────────────────┤
│ 5.1 Call paymentService.paymentAuthorisation(request)          │
│ 5.2 Handle transient vs stored token differences               │
│ 5.3 Catch and transform payment processor errors               │
│ 5.4 Validate payment result status === 'authorized'            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Mark Session as Used                                   │
├─────────────────────────────────────────────────────────────────┤
│ 6.1 Call authService.markSessionUsed(authenticationId)         │
│ 6.2 Prevents duplicate completion attempts (single-use)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 7: Create Order                                           │
├─────────────────────────────────────────────────────────────────┤
│ 7.1 Call orderService.createOrder(...)                         │
│ 7.2 Include cart reference, payment result, customer ID        │
│ 7.3 Return created order object                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 8: Clean Up Session (Background Task)                     │
├─────────────────────────────────────────────────────────────────┤
│ 8.1 Call authService.deleteSession(authenticationId)           │
│ 8.2 Optional: Fire-and-forget, don't block response            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Return HTTP 201 Created                                        │
│ Location: /orders/{orderId}                                    │
│ Body: Order object                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Core Implementation Function

```typescript
/**
 * Process 3DS validate-capture request
 *
 * @param request - 3DS validation request with authenticationId and 3DS completion data
 * @param authContext - OAuth authentication context from API Gateway
 * @param brandKey - Optional brand key for /in-brand/ endpoints
 * @returns Created order
 * @throws {ForbiddenError} If session ownership validation fails
 * @throws {ConflictError} If session state is invalid
 * @throws {UnprocessableEntityError} If business validation fails
 */
async function processValidateCapture(
  request: ThreeDSValidateCaptureRequest,
  authContext: AuthenticationContext,
  brandKey?: string
): Promise<Order> {

  // STEP 1: Retrieve and Validate Session
  const session = await retrieveAndValidateSession(
    request.authenticationId,
    authContext,
    brandKey
  );

  // STEP 2: Validate Cart State
  await validateCartState(session);

  // STEP 3: Retrieve Merchant Configuration
  const merchantConfig = await getMerchantConfig(
    brandKey || extractBrandFromSession(session)
  );

  // STEP 4: Build Payment Authorization Request
  const paymentRequest = buildPaymentAuthorizationRequest(
    session,
    request.threeDSData,
    merchantConfig
  );

  // STEP 5: Execute Payment Authorization
  const paymentResult = await executePaymentAuthorization(
    paymentRequest,
    merchantConfig
  );

  // STEP 6: Mark Session as Used
  await markSessionAsUsed(request.authenticationId);

  // STEP 7: Create Order
  const order = await createOrder(session, paymentResult);

  // STEP 8: Clean Up Session (fire-and-forget)
  cleanupSession(request.authenticationId).catch(error => {
    console.error('Session cleanup failed (non-critical):', error);
  });

  return order;
}
```

### 3.3 Step-by-Step Implementation Details

#### STEP 1: Retrieve and Validate Session

```typescript
async function retrieveAndValidateSession(
  authenticationId: string,
  authContext: AuthenticationContext,
  brandKey?: string
): Promise<AuthenticationSession> {
  const authService = getAuthenticationService();

  // 1.1-1.5: Retrieve session (handles existence, expiry, status checks)
  const session = await authService.getSession(authenticationId);

  if (!session) {
    throw new ConflictError({
      code: 'SessionNotFound',
      message: 'Authentication session not found or expired'
    });
  }

  // 1.6: Validate session ownership
  const { customerId, anonymousId } = extractPrincipalIds(authContext);

  if (session.customerId && session.customerId !== customerId) {
    // Log security event
    logSecurityEvent({
      eventType: 'SESSION_OWNERSHIP_VIOLATION',
      severity: 'HIGH',
      sessionId: session.id,
      sessionOwner: session.customerId,
      attemptedBy: customerId,
      ipAddress: authContext.sourceIp,
      userAgent: authContext.userAgent
    });

    throw new ForbiddenError({
      code: 'SessionOwnershipViolation',
      message: 'Authentication session belongs to a different customer'
    });
  }

  if (session.anonymousId && session.anonymousId !== anonymousId) {
    logSecurityEvent({
      eventType: 'SESSION_OWNERSHIP_VIOLATION',
      severity: 'HIGH',
      sessionId: session.id,
      sessionOwner: session.anonymousId,
      attemptedBy: anonymousId,
      ipAddress: authContext.sourceIp
    });

    throw new ForbiddenError({
      code: 'SessionOwnershipViolation',
      message: 'Authentication session belongs to a different user'
    });
  }

  // Validate brand context for /in-brand/ endpoints
  if (brandKey && session.brandKey && session.brandKey !== brandKey) {
    throw new ForbiddenError({
      code: 'SessionBrandMismatch',
      message: 'Authentication session brand context mismatch'
    });
  }

  return session;
}
```

#### STEP 2: Validate Cart State

```typescript
async function validateCartState(session: AuthenticationSession): Promise<void> {
  const cartService = getCartService();

  const currentCart = await cartService.getCart(session.cartId);

  if (!currentCart) {
    throw new UnprocessableEntityError({
      code: 'CartNotFound',
      message: 'Cart no longer exists'
    });
  }

  // Critical: Cart version must not have changed
  if (currentCart.version !== session.cartVersion) {
    throw new UnprocessableEntityError({
      code: 'CartModified',
      message: 'Cart has been modified since authentication started',
      details: {
        sessionCartVersion: session.cartVersion,
        currentCartVersion: currentCart.version
      }
    });
  }

  // Additional cart state validations
  if (currentCart.lineItems.length === 0) {
    throw new UnprocessableEntityError({
      code: 'CartEmpty',
      message: 'Cart is empty'
    });
  }
}
```

#### STEP 3: Retrieve Merchant Configuration

```typescript
/**
 * Merchant configuration for payment processing
 */
interface MerchantConfig {
  brandKey: string;
  processor: 'cybersource' | 'adyen' | 'stripe';
  merchantID: string;
  merchantKeyId: string;
  merchantsecretKey: string;
}

async function getMerchantConfig(brandKey: string): Promise<MerchantConfig> {
  // Option 1: Environment variables (single merchant)
  if (process.env.CYBERSOURCE_MERCHANT_ID) {
    return {
      brandKey,
      processor: 'cybersource',
      merchantID: process.env.CYBERSOURCE_MERCHANT_ID!,
      merchantKeyId: process.env.CYBERSOURCE_KEY_ID!,
      merchantsecretKey: process.env.CYBERSOURCE_SECRET_KEY!
    };
  }

  // Option 2: Configuration service (multi-brand)
  const configService = getConfigurationService();
  const config = await configService.getMerchantConfig(brandKey);

  if (!config) {
    throw new Error(`Merchant configuration not found for brand: ${brandKey}`);
  }

  return config;
}
```

#### STEP 4: Build Payment Authorization Request

```typescript
function buildPaymentAuthorizationRequest(
  session: AuthenticationSession,
  threeDSData: ThreeDSCompletionData,
  merchantConfig: MerchantConfig
): PaymentAuthorizationRequest {
  return {
    orderId: generateOrderId(),
    amount: session.totalAmount.amount.toString(),
    currency: session.totalAmount.currencyCode,
    paymentToken: session.paymentToken,
    tokenType: session.tokenType,
    customerId: session.customerId, // Required for stored tokens
    billTo: mapBillingDetails(session.billTo),
    threeDSData: {
      phase: 'completion',
      completion: {
        authenticationTransactionId: threeDSData.completion.authenticationTransactionId,
        cavv: threeDSData.completion.cavv,
        eciIndicator: threeDSData.completion.eciIndicator,
        xid: threeDSData.completion.xid // Optional for 3DS v1
      }
    }
  };
}

/**
 * Map ISO 19160-1 address structure to Payments SDK format
 */
function mapBillingDetails(billTo: BillingDetails) {
  return {
    firstName: billTo.firstName,
    lastName: billTo.lastName,
    street: billTo.address.address1,
    city: billTo.address.locality,  // ISO 19160 locality → city
    postalCode: billTo.address.postalCode,
    country: billTo.address.country,
    email: billTo.email,
    phone: billTo.phone
  };
}
```

#### STEP 5: Execute Payment Authorization

```typescript
async function executePaymentAuthorization(
  paymentRequest: PaymentAuthorizationRequest,
  merchantConfig: MerchantConfig
): Promise<PaymentResult> {
  const paymentService = new PaymentService(merchantConfig.processor, {
    merchantID: merchantConfig.merchantID,
    merchantKeyId: merchantConfig.merchantKeyId,
    merchantsecretKey: merchantConfig.merchantsecretKey
  });

  let paymentResult: PaymentResult;

  try {
    paymentResult = await paymentService.paymentAuthorisation(paymentRequest);
  } catch (error) {
    console.error('Payment authorization failed:', error);
    throw new UnprocessableEntityError({
      code: 'PaymentAuthorizationFailed',
      message: '3DS validation failed with payment processor',
      cause: error
    });
  }

  // Validate payment was authorized
  if (paymentResult.status !== 'authorized') {
    throw new UnprocessableEntityError({
      code: 'PaymentDeclined',
      message: `Payment declined: ${paymentResult.declineReason || 'Unknown reason'}`
    });
  }

  return paymentResult;
}
```

#### STEP 6: Mark Session as Used

```typescript
async function markSessionAsUsed(authenticationId: string): Promise<void> {
  const authService = getAuthenticationService();

  try {
    await authService.markSessionUsed(authenticationId);
  } catch (error) {
    if (error instanceof SessionAlreadyUsedError) {
      throw new ConflictError({
        code: 'SessionAlreadyUsed',
        message: 'Authentication session has already been used'
      });
    }
    throw error;
  }
}
```

#### STEP 7: Create Order

```typescript
async function createOrder(
  session: AuthenticationSession,
  paymentResult: PaymentResult
): Promise<Order> {
  const orderService = getOrderService();

  const order = await orderService.createOrder({
    cartId: session.cartId,
    cartVersion: session.cartVersion,
    customerId: session.customerId,
    anonymousId: session.anonymousId,
    paymentResult: {
      transactionId: paymentResult.transactionId,
      authorisationCode: paymentResult.authorisationCode,
      amount: session.totalAmount,
      status: 'authorized'
    }
  });

  return order;
}
```

#### STEP 8: Clean Up Session

```typescript
async function cleanupSession(authenticationId: string): Promise<void> {
  const authService = getAuthenticationService();
  await authService.deleteSession(authenticationId);
}
```

---

## 4. Error Handling Specification

### 4.1 Payment Decline Handling

**Design Decision:** Payment declines return **HTTP 422**, not HTTP 200.

**Why?** Checkout API creates orders. Payment decline = no order created = HTTP 422.

**Differs from Payment API:** Payment API returns HTTP 200 (transaction attempted successfully).

See OpenAPI specification lines 154-207 for complete documentation.

### 4.2 Error Response Mapping

| Error Type | HTTP Status | Error Code | When to Use |
|------------|-------------|------------|-------------|
| `ForbiddenError` | 403 | `SessionOwnershipViolation` | Session belongs to different customer/user |
| `ForbiddenError` | 403 | `SessionBrandMismatch` | Session brand doesn't match request path |
| `ConflictError` | 409 | `SessionNotFound` | Session doesn't exist or expired |
| `ConflictError` | 409 | `SessionAlreadyUsed` | Session already consumed |
| `UnprocessableEntityError` | 422 | `CartModified` | Cart version changed during 3DS |
| `UnprocessableEntityError` | 422 | `PaymentDeclined` | Generic payment decline from processor |
| `UnprocessableEntityError` | 422 | `CardDeclined` | Credit/debit card declined by issuer |
| `UnprocessableEntityError` | 422 | `CardExpired` | Payment card has expired |
| `UnprocessableEntityError` | 422 | `InsufficientFunds` | Gift voucher insufficient balance |
| `UnprocessableEntityError` | 422 | `InvalidCardDetails` | Card details invalid |
| `UnprocessableEntityError` | 422 | `PaymentProcessorError` | Processor error during transaction |
| `UnprocessableEntityError` | 422 | `FraudSuspected` | Payment blocked for fraud |
| `UnprocessableEntityError` | 422 | `PaymentMethodNotSupported` | Payment method not supported |
| `UnprocessableEntityError` | 422 | `ThreeDSValidationFailed` | 3DS completion data invalid |

### 4.3 Payment Decline Implementation Guidance

When processing payment authorization results from the Payments SDK, map specific decline reasons to appropriate validation codes:

```typescript
/**
 * Map payment-sdk error code to Checkout API validation code
 *
 * The @dw-digital-commerce/payments-sdk returns structured error codes
 * that we map 1:1 to our validation codes.
 */
function mapPaymentErrorToValidationCode(paymentError: PaymentError): string {
  // Direct 1:1 mapping from SDK error codes to API validation codes
  const errorCodeMap: Record<string, string> = {
    'BUSINESS_PAYMENT_DECLINED': 'PaymentDeclined',
    'BUSINESS_INSUFFICIENT_FUNDS': 'InsufficientFunds',
    'BUSINESS_CARD_EXPIRED': 'CardExpired'
  };

  return errorCodeMap[paymentError.code] || 'PaymentDeclined';
}
```

**Example Usage in Payment Capture/Validation:**
```typescript
import { PaymentService, PaymentError, ErrorCodes } from '@dw-digital-commerce/payments-sdk';

async function executePaymentCapture(
  paymentRequest: PaymentCapturePayload,
  merchantConfig: MerchantConfig
): Promise<PaymentCaptureResponse> {
  const paymentService = new PaymentService(merchantConfig.processor, {
    merchantID: merchantConfig.merchantID,
    merchantKeyId: merchantConfig.merchantKeyId,
    merchantsecretKey: merchantConfig.merchantsecretKey
  });

  try {
    const result = await paymentService.paymentCapture(paymentRequest);

    if (result.status === 'DECLINED' && result.error) {
      // Map SDK error code to API validation code
      const validationCode = mapPaymentErrorToValidationCode(result.error);

      throw new UnprocessableEntityError(
        validationCode,
        result.error.message
      );
    }

    if (result.status === 'ERROR' && result.error) {
      // Technical/system errors should throw 500, not 422
      throw new Error(`Payment processing error: ${result.error.message}`);
    }

    return result;
  } catch (error) {
    if (error instanceof PaymentError) {
      // PaymentError from SDK - map to validation code
      if (error.isBusinessError()) {
        const validationCode = mapPaymentErrorToValidationCode(error);
        throw new UnprocessableEntityError(validationCode, error.message);
      }
      // Non-business errors (network, provider, system) throw 500
      throw new Error(`Payment system error: ${error.message}`);
    }

    if (error instanceof UnprocessableEntityError) {
      throw error; // Re-throw validation errors
    }

    // Unexpected errors
    throw error;
  }
}
```

### 4.4 Error Handler Implementation

```typescript
function handleError(
  error: Error,
  event: APIGatewayProxyEvent
): APIGatewayProxyResult {

  // Log error with context
  console.error('Error processing validate-capture:', {
    error: error.message,
    stack: error.stack,
    authenticationId: JSON.parse(event.body || '{}').authenticationId,
    requestId: event.requestContext.requestId
  });

  // Map domain errors to HTTP responses
  if (error instanceof ForbiddenError) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        errors: [{
          code: error.code,
          message: error.message,
          type: 'Forbidden'
        }],
        statusCode: 403,
        message: error.message
      })
    };
  }

  if (error instanceof ConflictError) {
    return {
      statusCode: 409,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        errors: [{
          code: error.code,
          message: error.message,
          type: 'Conflict'
        }],
        statusCode: 409,
        message: error.message
      })
    };
  }

  if (error instanceof UnprocessableEntityError) {
    return {
      statusCode: 422,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        orderLevel: [{
          code: error.code,
          message: error.message
        }],
        lineItemLevel: []
      })
    };
  }

  // Generic server error
  return {
    statusCode: 500,
    headers: getCorsHeaders(),
    body: JSON.stringify({
      errors: [{
        code: 'InternalError',
        message: 'An unexpected error occurred',
        type: 'Internal'
      }],
      statusCode: 500,
      message: 'An unexpected error occurred'
    })
  };
}
```

### 4.5 Custom Error Classes

```typescript
// lambda/src/errors/domain-errors.ts

export class ForbiddenError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class UnprocessableEntityError extends Error {
  constructor(
    public code: string,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'UnprocessableEntityError';
  }
}
```

---

## 5. Payments-SDK Integration

### 5.1 PaymentService Initialization

```typescript
import { PaymentService } from '@dw-digital-commerce/payments-sdk';

function initializePaymentService(merchantConfig: MerchantConfig): PaymentService {
  return new PaymentService(merchantConfig.processor, {
    merchantID: merchantConfig.merchantID,
    merchantKeyId: merchantConfig.merchantKeyId,
    merchantsecretKey: merchantConfig.merchantsecretKey
  });
}
```

### 5.2 Transient vs Stored Token Handling

```typescript
function buildPaymentRequest(
  session: AuthenticationSession,
  threeDSData: ThreeDSCompletionData
) {
  const baseRequest = {
    orderId: generateOrderId(),
    amount: session.totalAmount.amount.toString(),
    currency: session.totalAmount.currencyCode,
    billTo: mapBillingDetails(session.billTo),
    threeDSData: {
      phase: 'completion',
      completion: threeDSData.completion
    }
  };

  // Transient token (single-use)
  if (session.tokenType === 'transient') {
    return {
      ...baseRequest,
      paymentToken: session.paymentToken,
      tokenType: 'transient'
    };
  }

  // Stored token (saved payment method)
  if (session.tokenType === 'stored') {
    if (!session.customerId) {
      throw new Error('CustomerId required for stored tokens');
    }

    return {
      ...baseRequest,
      paymentToken: session.paymentToken,
      tokenType: 'stored',
      customerId: session.customerId // REQUIRED for stored tokens
    };
  }

  throw new Error(`Unknown token type: ${session.tokenType}`);
}
```

### 5.3 Digital Wallet Token Processing

Digital wallet tokens (Google Pay, Apple Pay) are treated as **transient tokens** with no special handling required:

```typescript
// No explicit walletProvider field at this stage
// Google Pay/Apple Pay tokens processed as transient
const googlePayRequest = {
  paymentToken: session.paymentToken,  // Google Pay cryptogram
  tokenType: 'transient',
  // ... rest of request
};
```

**Note:** Future enhancement may add explicit `walletProvider` field for analytics and wallet-specific processing. See [INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md) Section 3.2 for details.

---

## 6. Security Requirements

### 6.1 OAuth Token Extraction

Extract principal identifiers (customerId/anonymousId) from API Gateway authorizer claims:

```typescript
interface AuthenticationContext {
  customerId?: string;
  anonymousId?: string;
  sourceIp: string;
  userAgent: string;
}

function extractPrincipalIds(event: APIGatewayProxyEvent): {
  customerId?: string;
  anonymousId?: string;
} {
  const claims = event.requestContext.authorizer?.claims;

  if (!claims) {
    throw new UnauthorizedError('Missing authorization claims');
  }

  // Determine if user is authenticated or anonymous
  // Adjust based on your OAuth token structure
  const isAuthenticated = claims.userType === 'customer' || claims.customerId;

  return {
    customerId: isAuthenticated ? claims.sub : undefined,
    anonymousId: !isAuthenticated ? claims.sub : undefined
  };
}

function buildAuthenticationContext(event: APIGatewayProxyEvent): AuthenticationContext {
  const { customerId, anonymousId } = extractPrincipalIds(event);

  return {
    customerId,
    anonymousId,
    sourceIp: event.requestContext.identity.sourceIp,
    userAgent: event.requestContext.identity.userAgent
  };
}
```

### 6.2 Session Ownership Validation Implementation

Session ownership validation is **critical** and must be implemented exactly as specified in [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md) Section 6.

**Key Requirements:**
1. Sessions store `customerId` (authenticated) OR `anonymousId` (guest) at creation
2. Completion requests must have matching principal identifier
3. Violations throw `ForbiddenError` with HTTP 403
4. All violations logged with HIGH severity

```typescript
async function validateSessionOwnership(
  session: AuthenticationSession,
  authContext: AuthenticationContext
): Promise<void> {

  // Authenticated customer validation
  if (session.customerId) {
    if (session.customerId !== authContext.customerId) {
      await logSecurityEvent({
        eventType: 'SESSION_OWNERSHIP_VIOLATION',
        severity: 'HIGH',
        sessionId: session.id,
        sessionOwner: session.customerId,
        attemptedBy: authContext.customerId,
        timestamp: new Date(),
        ipAddress: authContext.sourceIp,
        userAgent: authContext.userAgent
      });

      throw new ForbiddenError(
        'SessionOwnershipViolation',
        'Authentication session belongs to a different customer'
      );
    }
  }

  // Anonymous user validation
  if (session.anonymousId) {
    if (session.anonymousId !== authContext.anonymousId) {
      await logSecurityEvent({
        eventType: 'SESSION_OWNERSHIP_VIOLATION',
        severity: 'HIGH',
        sessionId: session.id,
        sessionOwner: session.anonymousId,
        attemptedBy: authContext.anonymousId,
        timestamp: new Date(),
        ipAddress: authContext.sourceIp,
        userAgent: authContext.userAgent
      });

      throw new ForbiddenError(
        'SessionOwnershipViolation',
        'Authentication session belongs to a different anonymous user'
      );
    }
  }
}
```

### 6.3 Audit Logging Requirements

Log all authentication session operations for security audit trails:

```typescript
interface SecurityEvent {
  eventType: 'SESSION_OWNERSHIP_VIOLATION' | 'SESSION_RETRIEVED' | 'SESSION_COMPLETED';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sessionId: string;
  sessionOwner: string;
  attemptedBy?: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  additionalContext?: Record<string, any>;
}

async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  console.log(JSON.stringify({
    ...event,
    logType: 'SECURITY_EVENT'
  }));

  // Optional: Send to dedicated security monitoring system
  // await securityMonitor.log(event);
}
```

**Required Events to Log:**
- `SESSION_OWNERSHIP_VIOLATION` - Always log with HIGH severity
- `SESSION_RETRIEVED` - Log for audit trail (INFO level)
- `SESSION_COMPLETED` - Log successful completions (INFO level)

---

## 7. Code Examples

### 7.1 Complete Lambda Handler Skeleton

```typescript
// lambda/src/index.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthenticationService } from './services/authentication-service-factory';
import { ForbiddenError, ConflictError, UnprocessableEntityError } from './errors/domain-errors';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parse request
    const request = JSON.parse(event.body || '{}') as ThreeDSValidateCaptureRequest;
    const authContext = buildAuthenticationContext(event);

    // Route to appropriate handler
    let order: Order;

    if (event.resource === '/me/3ds/validate-capture') {
      order = await processValidateCapture(request, authContext);
    } else if (event.resource === '/in-brand/{brandkey}/3ds/validate-capture') {
      const brandKey = event.pathParameters?.brandkey;
      if (!brandKey) {
        throw new Error('Missing brandkey path parameter');
      }
      order = await processValidateCapture(request, authContext, brandKey);
    } else {
      throw new Error(`Unhandled resource: ${event.resource}`);
    }

    // Return success response
    return {
      statusCode: 201,
      headers: {
        ...getCorsHeaders(),
        Location: `/orders/${order.id}`
      },
      body: JSON.stringify(order)
    };

  } catch (error) {
    return handleError(error, event);
  }
};

async function processValidateCapture(
  request: ThreeDSValidateCaptureRequest,
  authContext: AuthenticationContext,
  brandKey?: string
): Promise<Order> {
  // Implementation from Section 3.2
  // ... (see complete implementation above)
}
```

### 7.2 Session Validation Pattern

```typescript
async function retrieveAndValidateSession(
  authenticationId: string,
  authContext: AuthenticationContext,
  brandKey?: string
): Promise<AuthenticationSession> {
  const authService = getAuthenticationService();

  // Retrieve session (handles expiry, status)
  const session = await authService.getSession(authenticationId);

  if (!session) {
    throw new ConflictError('SessionNotFound', 'Authentication session not found or expired');
  }

  // Validate ownership
  await validateSessionOwnership(session, authContext);

  // Validate brand context
  if (brandKey && session.brandKey && session.brandKey !== brandKey) {
    throw new ForbiddenError('SessionBrandMismatch', 'Session brand context mismatch');
  }

  return session;
}
```

### 7.3 Payments-SDK Call Pattern

```typescript
async function executePaymentAuthorization(
  session: AuthenticationSession,
  threeDSData: ThreeDSCompletionData,
  merchantConfig: MerchantConfig
): Promise<PaymentResult> {
  const paymentService = new PaymentService(merchantConfig.processor, {
    merchantID: merchantConfig.merchantID,
    merchantKeyId: merchantConfig.merchantKeyId,
    merchantsecretKey: merchantConfig.merchantsecretKey
  });

  const paymentRequest = {
    orderId: generateOrderId(),
    amount: session.totalAmount.amount.toString(),
    currency: session.totalAmount.currencyCode,
    paymentToken: session.paymentToken,
    tokenType: session.tokenType,
    customerId: session.customerId,
    billTo: mapBillingDetails(session.billTo),
    threeDSData: {
      phase: 'completion',
      completion: threeDSData.completion
    }
  };

  try {
    const result = await paymentService.paymentAuthorisation(paymentRequest);

    if (result.status !== 'authorized') {
      throw new UnprocessableEntityError(
        'PaymentDeclined',
        `Payment declined: ${result.declineReason || 'Unknown'}`
      );
    }

    return result;
  } catch (error) {
    console.error('Payment authorization failed:', error);
    throw new UnprocessableEntityError(
      'PaymentAuthorizationFailed',
      '3DS validation failed with payment processor',
      error
    );
  }
}
```

---

## 8. Testing Requirements

### 8.1 Unit Testing with Mock Provider

```typescript
// lambda/test/validate-capture.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { handler } from '../src/index';
import { MockAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/mock';

describe('Validate-Capture Handler', () => {
  let mockAuthService: MockAuthenticationService;

  beforeEach(() => {
    // Use mock provider for testing
    process.env.USE_MOCK_AUTH = 'true';
    mockAuthService = new MockAuthenticationService();
  });

  it('should complete order with valid session and 3DS data', async () => {
    // Setup: Create authentication session
    const session = await mockAuthService.createSession({
      cartId: 'cart-123',
      cartVersion: 1,
      paymentToken: 'tok_test',
      tokenType: 'transient',
      billTo: { /* ... */ },
      customerId: 'customer-123'
    });

    // Test: Call validate-capture
    const event = createMockEvent({
      body: JSON.stringify({
        authenticationId: session.id,
        threeDSData: {
          phase: 'completion',
          completion: {
            authenticationTransactionId: 'txn_test',
            cavv: 'AAABCZ...',
            eciIndicator: '05'
          }
        }
      }),
      claims: { sub: 'customer-123', userType: 'customer' }
    });

    const response = await handler(event);

    // Assert
    expect(response.statusCode).toBe(201);
    expect(response.headers.Location).toMatch(/^\/orders\/.+/);
    expect(JSON.parse(response.body).status).toBe('completed');
  });

  it('should return 403 for session ownership violation', async () => {
    // Setup: Customer A creates session
    const session = await mockAuthService.createSession({
      cartId: 'cart-456',
      cartVersion: 1,
      paymentToken: 'tok_test',
      tokenType: 'transient',
      billTo: { /* ... */ },
      customerId: 'customer-A'
    });

    // Test: Customer B attempts completion
    const event = createMockEvent({
      body: JSON.stringify({
        authenticationId: session.id,
        threeDSData: { phase: 'completion', completion: { /* ... */ } }
      }),
      claims: { sub: 'customer-B', userType: 'customer' }
    });

    const response = await handler(event);

    // Assert
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).errors[0].code).toBe('SessionOwnershipViolation');
  });

  it('should return 409 for expired session', async () => {
    // Setup: Create session and advance time
    const mockService = new DeterministicMockAuthenticationService(new Date());
    const session = await mockService.createSession({ /* ... */ });

    // Advance time by 31 minutes
    mockService.advanceTime(31 * 60 * 1000);

    // Test: Attempt completion
    const event = createMockEvent({
      body: JSON.stringify({
        authenticationId: session.id,
        threeDSData: { phase: 'completion', completion: { /* ... */ } }
      })
    });

    const response = await handler(event);

    // Assert
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).errors[0].code).toBe('SessionNotFound');
  });
});
```

### 8.2 Integration Testing Patterns

```typescript
describe('Validate-Capture Integration Tests', () => {
  it('should handle full 3DS flow end-to-end', async () => {
    // 1. Initial capture (returns 202)
    const captureResponse = await POST('/me/token/capture', {
      cartId: 'cart-789',
      version: 1,
      payments: [{
        type: 'tokenised',
        amount: { amount: 100, currencyCode: 'GBP' },
        tokenisedPayment: {
          paymentToken: 'tok_test',
          tokenType: 'transient',
          billTo: { /* ... */ },
          threeDSData: { phase: 'setup', setup: { /* ... */ } }
        }
      }]
    });

    expect(captureResponse.status).toBe(202);
    const authenticationId = captureResponse.body.authenticationId;

    // 2. Simulate customer completing 3DS challenge
    // (In real flow, customer redirected to 3DS URL and completes)

    // 3. Validate-capture (returns 201)
    const validateResponse = await POST('/me/3ds/validate-capture', {
      authenticationId,
      threeDSData: {
        phase: 'completion',
        completion: {
          authenticationTransactionId: 'txn_3ds_test',
          cavv: 'AAABCZIhcQAAAABZlyFxAAAAAAA=',
          eciIndicator: '05'
        }
      }
    });

    expect(validateResponse.status).toBe(201);
    expect(validateResponse.body.status).toBe('completed');
    expect(validateResponse.body.paymentDetails[0].status).toBe('authorized');
  });
});
```

### 8.3 Test Scenarios Checklist

- [ ] **Success Path**: Valid session, successful 3DS validation, order created
- [ ] **Session Ownership**: Cross-customer violation returns 403
- [ ] **Session Ownership**: Guest to authenticated violation returns 403
- [ ] **Session Ownership**: Brand context mismatch returns 403
- [ ] **Session Expiry**: Expired session returns 409
- [ ] **Session Reuse**: Already-used session returns 409
- [ ] **Session Not Found**: Non-existent session returns 409
- [ ] **Cart Modified**: Cart version changed returns 422
- [ ] **Payment Declined**: Payment processor declines returns 422
- [ ] **3DS Validation Failed**: Invalid 3DS data returns 422
- [ ] **Transient Token**: Single-use token processed correctly
- [ ] **Stored Token**: Saved payment method processed correctly
- [ ] **Digital Wallet**: Google Pay/Apple Pay as transient token

---

## 9. Environment Configuration

### 9.1 Required Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ENVIRONMENT` | Yes | Deployment environment | `dev`, `sit`, `uat`, `prod` |
| `AWS_REGION` | Yes | AWS region | `eu-west-1` |
| `AUTH_SESSION_TABLE_NAME` | Yes (prod) | DynamoDB table for authentication sessions | `dev-checkout-authentication-sessions` |
| `USE_MOCK_AUTH` | No | Force mock provider (testing only) | `true` |
| `CYBERSOURCE_MERCHANT_ID` | Yes* | CyberSource merchant ID | `YOUR_MID` |
| `CYBERSOURCE_KEY_ID` | Yes* | CyberSource API key ID | `abc123...` |
| `CYBERSOURCE_SECRET_KEY` | Yes* | CyberSource secret key | `xyz789...` |

*Required if using single-merchant configuration. Alternative: Use configuration service for multi-brand.

### 9.2 CDK Environment Configuration

Update `infra/src/lib/lambda-stack.ts` to add environment variables:

```typescript
const lambdaFunction = new NodejsFunction(this, 'CheckoutLambda', {
  // ... existing config
  environment: {
    ENVIRONMENT: props.environment,
    AWS_REGION: this.region,
    AUTH_SESSION_TABLE_NAME: authSessionTable.tableName,
    CYBERSOURCE_MERCHANT_ID: process.env.CYBERSOURCE_MERCHANT_ID || '',
    CYBERSOURCE_KEY_ID: process.env.CYBERSOURCE_KEY_ID || '',
    CYBERSOURCE_SECRET_KEY: process.env.CYBERSOURCE_SECRET_KEY || ''
  }
});
```

### 9.3 IAM Permissions Required

Lambda execution role needs:

```typescript
// DynamoDB permissions
authSessionTable.grantReadWriteData(lambdaFunction);

// Equivalent policy statement:
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem"
  ],
  "Resource": "arn:aws:dynamodb:${region}:${account}:table/${tableName}"
}
```

---

## 10. Deployment Checklist

### 10.1 Pre-Deployment

- [ ] **DynamoDB Table Created**: Authentication session table deployed via CDK
- [ ] **TTL Enabled**: Table has TTL attribute configured on `ttl` field
- [ ] **Lambda Environment Variables**: All required variables configured
- [ ] **IAM Permissions**: Lambda role has DynamoDB read/write permissions
- [ ] **Merchant Credentials**: CyberSource credentials stored securely (Secrets Manager or env vars)
- [ ] **Tests Passing**: All unit and integration tests pass
- [ ] **OpenAPI Spec Updated**: 403 response added to both endpoints

### 10.2 Deployment Steps

```bash
# 1. Install dependencies
npm ci

# 2. Build project
npm run build

# 3. Deploy DynamoDB table (if not already deployed)
# Add AuthenticationSessionStack to CDK app

# 4. Deploy Lambda with updated environment variables
npm run deploy:single:auth

# 5. Verify deployment
./verify-deployment.sh --profile dw-sandbox --environment dev
```

### 10.3 Post-Deployment Validation

- [ ] **Endpoint Accessible**: Both validate-capture endpoints respond to OPTIONS
- [ ] **Authentication Works**: Requests with valid OAuth tokens accepted
- [ ] **Session Creation**: Initial capture returns 202 with authenticationId
- [ ] **Session Retrieval**: Validate-capture can retrieve session from DynamoDB
- [ ] **Session Ownership**: 403 returned for ownership violations
- [ ] **Payments-SDK Integration**: Payment authorization succeeds with test data
- [ ] **Order Creation**: 201 response with valid order object
- [ ] **CloudWatch Logs**: Lambda logs show successful execution
- [ ] **DynamoDB Metrics**: Table shows read/write activity
- [ ] **TTL Cleanup**: Expired sessions automatically deleted (monitor over 30+ minutes)

### 10.4 Monitoring and Alerting

**CloudWatch Metrics to Monitor:**
- Lambda invocation count
- Lambda error rate
- Lambda duration (p50, p95, p99)
- DynamoDB consumed read/write capacity
- DynamoDB throttled requests
- DynamoDB item count (should not grow unbounded)

**CloudWatch Alarms to Create:**
- High error rate (>5% of requests)
- High duration (>2 seconds p95)
- DynamoDB throttling
- DynamoDB item count exceeds threshold

**Log Insights Queries:**

```sql
-- Session ownership violations (security monitoring)
fields @timestamp, @message
| filter logType = "SECURITY_EVENT" and eventType = "SESSION_OWNERSHIP_VIOLATION"
| sort @timestamp desc

-- Payment authorization failures
fields @timestamp, @message
| filter @message like /Payment authorization failed/
| stats count() by bin(5m)
```

---

## Appendix: Type Definitions

### Request/Response Types

```typescript
// From OpenAPI specification
interface ThreeDSValidateCaptureRequest {
  authenticationId: string;
  threeDSData: {
    phase: 'completion';
    completion: {
      authenticationTransactionId: string;
      cavv: string;
      eciIndicator: string;
      xid?: string;
    };
  };
}

interface Order {
  id: string;
  version: number;
  status: 'completed';
  paymentDetails: OrderPaymentDetail[];
  // ... all Cart fields inherited
}
```

### Authentication Session Types

```typescript
// From @dw-digital-commerce/checkout-authentication-service
interface AuthenticationSession {
  readonly id: string;
  readonly cartId: string;
  readonly cartVersion: number;
  readonly paymentToken: string;
  readonly tokenType: 'transient' | 'stored';
  readonly billTo: BillingDetails;
  readonly shipTo?: ShippingDetails;
  readonly threeDSSetupData?: ThreeDSSetupData;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: SessionStatus;
  readonly customerId?: string;
  readonly anonymousId?: string;
}

type SessionStatus = 'pending' | 'used' | 'expired';
```

### Payments-SDK Types

```typescript
// From @dw-digital-commerce/payments-sdk
interface PaymentAuthorizationRequest {
  orderId: string;
  amount: string;
  currency: string;
  paymentToken: string;
  tokenType: 'transient' | 'stored';
  customerId?: string;
  billTo: PaymentBillingDetails;
  threeDSData: {
    phase: 'completion';
    completion: ThreeDSCompletionData;
  };
}

interface PaymentResult {
  status: 'authorized' | 'declined';
  transactionId: string;
  authorisationCode?: string;
  declineReason?: string;
}
```

---

## Related Documents

- [ARCHITECTURE-3DS-Stateful-Design-Decision.md](./ARCHITECTURE-3DS-Stateful-Design-Decision.md) - Architectural research validating stateful design
- [SPEC-Authentication-Session-Library.md](./SPEC-Authentication-Session-Library.md) - Authentication session library specification
- [SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md](./SPEC-OpenAPI-3DS-Validate-Capture-Endpoints.md) - OpenAPI endpoint specification
- [INTEGRATION-Payments-SDK-Mapping.md](./INTEGRATION-Payments-SDK-Mapping.md) - Payments SDK integration guide
- [README.md](./README.md) - Documentation overview and navigation

---

**Version History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-04 | Checkout API Team | Initial Lambda implementation specification |

---

**Contact:** Checkout API Team
**Questions:** Refer to README.md for documentation navigation
