# Technical Specification: Checkout Authentication Service

**Package Name:** `@dw-digital-commerce/checkout-authentication-service`
**Version:** 1.0.0
**Status:** Draft
**Target Release:** Aligned with Checkout API v0.5.0
**Last Updated:** 2025-11-03
**Related Documents:**
- [TECHNICAL-REPORT-3DS-Stateful-vs-Stateless-Design.md](./TECHNICAL-REPORT-3DS-Stateful-vs-Stateless-Design.md)

---

## Executive Summary

This specification defines an npm library for managing 3D Secure (3DS) authentication sessions in the Direct Wines Checkout API. The library provides an abstract interface for session storage with two concrete implementations:

1. **DynamoDB Provider** - Production-ready scalable storage with automatic TTL-based cleanup
2. **Mock Provider** - In-memory storage for testing without AWS dependencies

### Key Design Principles

- **Abstraction**: Interface-based design enabling provider swapping
- **Security-First**: Encrypted storage, single-use sessions, time-limited validity
- **Testability**: Mock provider for fast, deterministic unit tests
- **Industry-Aligned**: Follows patterns from Stripe, PayPal, Adyen, Checkout.com
- **Checkout-Specific**: Tailored for 3DS authentication workflows

---

## Table of Contents

1. [Library Overview](#1-library-overview)
2. [Core Abstractions](#2-core-abstractions)
3. [DynamoDB Provider Implementation](#3-dynamodb-provider-implementation)
4. [Mock Provider Implementation](#4-mock-provider-implementation)
5. [Lambda Integration Patterns](#5-lambda-integration-patterns)
6. [Infrastructure Requirements](#6-infrastructure-requirements)
7. [Testing Strategy](#7-testing-strategy)
8. [API Reference](#8-api-reference)
9. [Security Considerations](#9-security-considerations)
10. [Performance and Scalability](#10-performance-and-scalability)
11. [Migration Guide](#11-migration-guide)
12. [Appendices](#12-appendices)

---

## 1. Library Overview

### 1.1 Purpose

The Checkout Authentication Service library manages temporary session state for 3DS authentication workflows. When the Checkout API returns HTTP 202 (authentication required), it creates a server-side session that preserves:

- Cart context (ID, version)
- Payment token and billing details
- 3DS setup phase data
- Session metadata (creation time, expiration, status)

This stateful session approach is the industry standard (see Technical Report) and addresses critical requirements:

- **Security**: Payment tokens transmitted once, referenced by session ID
- **Data Integrity**: Cart frozen at authentication time, version-validated on completion
- **User Experience**: Client only tracks session ID during 3DS redirect flow
- **PCI Compliance**: Minimal exposure of sensitive payment data

### 1.2 Package Information

**Distribution:**
```bash
# .npmrc configuration required
@dw-digital-commerce:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}

# Installation
npm install @dw-digital-commerce/checkout-authentication-service
```

**GitHub Repository:** `dw-digital-commerce/checkout-authentication-service` (to be created)

**Versioning:** Semantic versioning (semver)
- 1.x.x: Checkout API v0.5.0 compatibility
- Breaking changes increment major version

**Dependencies:**
- `@aws-sdk/client-dynamodb` (^3.x) - DynamoDB provider only
- `@aws-sdk/lib-dynamodb` (^3.x) - DynamoDB provider only
- No runtime dependencies for mock provider

**Peer Dependencies:**
- TypeScript ^5.0.0 (for type definitions)

### 1.3 Out of Scope

This library is **NOT** intended for:
- General-purpose session management across multiple APIs
- Long-lived user sessions (use authentication tokens instead)
- Order or payment state management (those are domain entities)
- Client-side session handling

---

## 2. Core Abstractions

### 2.1 AuthenticationSession Type

The `AuthenticationSession` represents all data needed to complete a 3DS authentication flow:

```typescript
/**
 * 3DS Authentication Session
 *
 * Immutable once created. Sessions are single-use and expire after 30 minutes.
 * All monetary values use the cart's currency.
 */
interface AuthenticationSession {
  /** Unique session identifier (returned in HTTP 202 response) */
  readonly id: string;

  /** Original cart ID from CheckoutDraft */
  readonly cartId: string;

  /** Cart version at the time of authentication initiation */
  readonly cartVersion: number;

  /** Payment token (tokenization must happen before session creation, protected by DynamoDB encryption at rest) */
  readonly paymentToken: string;

  /** Token type: 'transient' (one-time) or 'stored' (saved payment method) */
  readonly tokenType: 'transient' | 'stored';

  /** Billing details from CheckoutDraft */
  readonly billTo: BillingDetails;

  /** Optional shipping details from CheckoutDraft */
  readonly shipTo?: ShippingDetails;

  /** 3DS setup phase data from Payment API response */
  readonly threeDSSetupData?: ThreeDSSetupData;

  /** Session creation timestamp (ISO 8601 UTC) */
  readonly createdAt: string;

  /** Session expiration timestamp (ISO 8601 UTC, createdAt + 30 minutes) */
  readonly expiresAt: string;

  /** Session status for single-use enforcement */
  readonly status: SessionStatus;

  /**
   * Customer identifier from OAuth token (authenticated users only)
   *
   * Used for session ownership validation. When present, the session can only
   * be completed by requests with a matching customerId in the OAuth token.
   *
   * Exactly one of customerId or anonymousId must be provided.
   *
   * @example "customer-12345"
   */
  readonly customerId?: string;

  /**
   * Anonymous session identifier from OAuth token (guest users only)
   *
   * Used for session ownership validation. When present, the session can only
   * be completed by requests with a matching anonymousId in the OAuth token.
   *
   * Exactly one of customerId or anonymousId must be provided.
   *
   * @example "anon-67890"
   */
  readonly anonymousId?: string;
}

/**
 * Session lifecycle status
 */
type SessionStatus = 'pending' | 'used' | 'expired';

/**
 * Billing contact information with ISO 19160-1 compliant address
 */
interface BillingDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address: PaymentAddress;
}

/**
 * ISO 19160-1 compliant address structure
 */
interface PaymentAddress {
  readonly address1: string;
  readonly address2?: string;
  readonly locality: string;        // City (ISO 19160 terminology)
  readonly administrativeArea?: string;  // State/province
  readonly postalCode: string;
  readonly country: string;         // ISO 3166-1 alpha-2
}

/**
 * Shipping details (optional for digital goods)
 */
interface ShippingDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly address: PaymentAddress;
  readonly phone?: string;
}

/**
 * 3DS setup phase data from Payment API
 */
interface ThreeDSSetupData {
  readonly referenceId: string;
  readonly authenticationInformation?: Record<string, any>;
}
```

### 2.2 IAuthenticationService Interface

The core abstraction defining session storage operations:

```typescript
/**
 * Authentication session storage service
 *
 * Implementations must:
 * - Enforce 30-minute TTL on all sessions
 * - Prevent reuse of consumed sessions
 * - Support concurrent access patterns
 * - Encrypt payment tokens at rest
 */
interface IAuthenticationService {
  /**
   * Create a new authentication session
   *
   * @param request - Session creation parameters
   * @returns Created session with generated ID and timestamps
   * @throws {ServiceError} If session creation fails
   *
   * @example
   * const session = await service.createSession({
   *   cartId: 'cart-123',
   *   cartVersion: 1,
   *   paymentToken: 'tok_visa_4242',
   *   tokenType: 'transient',
   *   billTo: { ... },
   *   threeDSSetupData: { referenceId: '3ds-ref-456' }
   * });
   */
  createSession(request: CreateSessionRequest): Promise<AuthenticationSession>;

  /**
   * Retrieve an authentication session by ID
   *
   * @param threeDSSessionId - Session identifier
   * @returns Session if found and not expired, null otherwise
   * @throws {ServiceError} If retrieval fails due to service error
   *
   * @example
   * const session = await service.getSession('auth_abc123');
   * if (!session) {
   *   throw new ConflictError('Session not found or expired');
   * }
   */
  getSession(threeDSSessionId: string): Promise<AuthenticationSession | null>;

  /**
   * Mark a session as used (single-use enforcement)
   *
   * @param threeDSSessionId - Session identifier
   * @throws {SessionAlreadyUsedError} If session is already used
   * @throws {SessionNotFoundError} If session doesn't exist
   * @throws {ServiceError} If update fails due to service error
   *
   * @example
   * await service.markSessionUsed('auth_abc123');
   */
  markSessionUsed(threeDSSessionId: string): Promise<void>;

  /**
   * Delete a session (cleanup after order creation)
   *
   * @param threeDSSessionId - Session identifier
   * @returns true if deleted, false if not found
   * @throws {ServiceError} If deletion fails due to service error
   *
   * @example
   * await service.deleteSession('auth_abc123');
   */
  deleteSession(threeDSSessionId: string): Promise<boolean>;

  /**
   * Health check for the storage provider
   *
   * @returns true if service is operational
   *
   * @example
   * const isHealthy = await service.healthCheck();
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Session creation request parameters
 *
 * @remarks
 * For session ownership validation, exactly one of customerId or anonymousId must be provided:
 * - Authenticated users: Provide customerId from OAuth token, leave anonymousId undefined
 * - Guest users: Provide anonymousId from OAuth token, leave customerId undefined
 *
 * @example Authenticated user
 * ```typescript
 * {
 *   cartId: "cart-123",
 *   cartVersion: 1,
 *   paymentToken: "tok_visa_4242",
 *   tokenType: "transient",
 *   billTo: { ... },
 *   customerId: "customer-12345",  // From OAuth token
 *   anonymousId: undefined
 * }
 * ```
 *
 * @example Guest user
 * ```typescript
 * {
 *   cartId: "cart-456",
 *   cartVersion: 1,
 *   paymentToken: "tok_mc_5555",
 *   tokenType: "transient",
 *   billTo: { ... },
 *   customerId: undefined,
 *   anonymousId: "anon-67890"  // From OAuth token
 * }
 * ```
 */
interface CreateSessionRequest {
  readonly cartId: string;
  readonly cartVersion: number;
  readonly paymentToken: string;
  readonly tokenType: 'transient' | 'stored';
  readonly billTo: BillingDetails;
  readonly shipTo?: ShippingDetails;
  readonly threeDSSetupData?: ThreeDSSetupData;
  /** Customer identifier for authenticated users (from OAuth token sub claim) */
  readonly customerId?: string;
  /** Anonymous identifier for guest users (from OAuth token sub claim) */
  readonly anonymousId?: string;
}
```

### 2.3 Error Types

Domain-specific errors for clear failure handling:

```typescript
/**
 * Base error class for authentication service errors
 */
class AuthenticationServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'AuthenticationServiceError';
  }
}

/**
 * Session not found or expired
 * Maps to HTTP 409 Conflict in API responses
 */
class SessionNotFoundError extends AuthenticationServiceError {
  constructor(threeDSSessionId: string, cause?: Error) {
    super(
      `Authentication session not found or expired: ${threeDSSessionId}`,
      'SESSION_NOT_FOUND',
      409,
      cause
    );
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Attempt to reuse a consumed session
 * Maps to HTTP 409 Conflict in API responses
 */
class SessionAlreadyUsedError extends AuthenticationServiceError {
  constructor(threeDSSessionId: string) {
    super(
      `Authentication session already used: ${threeDSSessionId}`,
      'SESSION_ALREADY_USED',
      409
    );
    this.name = 'SessionAlreadyUsedError';
  }
}

/**
 * Session has expired (>30 minutes old)
 * Maps to HTTP 409 Conflict in API responses
 */
class SessionExpiredError extends AuthenticationServiceError {
  constructor(threeDSSessionId: string, expiresAt: string) {
    super(
      `Authentication session expired at ${expiresAt}: ${threeDSSessionId}`,
      'SESSION_EXPIRED',
      409
    );
    this.name = 'SessionExpiredError';
  }
}

/**
 * Underlying storage service error
 * Maps to HTTP 500 Internal Server Error in API responses
 */
class StorageServiceError extends AuthenticationServiceError {
  constructor(message: string, cause?: Error) {
    super(
      `Storage service error: ${message}`,
      'STORAGE_ERROR',
      500,
      cause
    );
    this.name = 'StorageServiceError';
  }
}
```

---

## 3. DynamoDB Provider Implementation

### 3.1 Overview

The DynamoDB provider is the **primary production implementation**, chosen for:

- **Serverless Architecture**: No server management, scales automatically
- **Built-in TTL**: Native support for automatic item expiration
- **High Availability**: Multi-AZ replication by default
- **Performance**: Single-digit millisecond latency at scale
- **Cost-Effective**: Pay-per-request pricing for variable workloads

### 3.2 Table Schema

**Table Name:** `{environment}-checkout-authentication-sessions`

Example: `dev-checkout-authentication-sessions`, `prod-checkout-authentication-sessions`

**Primary Key:**
- **Partition Key:** `threeDSSessionId` (String)
  - Format: `auth_{timestamp}_{randomString}`
  - Example: `auth_1730649600_abc123xyz`
  - High cardinality ensures even distribution across partitions

**No Sort Key** - Simple key-value access pattern

**Attributes:**
```typescript
{
  // Primary Key
  threeDSSessionId: string;        // Partition key

  // Session Data (all required)
  cartId: string;
  cartVersion: number;
  paymentToken: string;            // Protected by DynamoDB table encryption
  tokenType: 'transient' | 'stored';
  billTo: string;                  // JSON-serialized BillingDetails
  shipTo?: string;                 // JSON-serialized ShippingDetails (optional)
  threeDSSetupData?: string;       // JSON-serialized ThreeDSSetupData (optional)

  // Metadata
  createdAt: string;               // ISO 8601 UTC
  expiresAt: string;               // ISO 8601 UTC
  status: 'pending' | 'used' | 'expired';
  customerId?: string;
  anonymousId?: string;

  // TTL Attribute (CRITICAL for automatic cleanup)
  ttl: number;                     // Unix timestamp (seconds), DynamoDB deletes expired items
}
```

### 3.3 TTL Configuration

**DynamoDB Time-to-Live (TTL)** is the **primary mechanism** for preventing unbounded table growth.

**Configuration:**
```typescript
{
  Enabled: true,
  AttributeName: 'ttl'
}
```

**TTL Attribute Calculation:**
```typescript
const TTL_DURATION_SECONDS = 30 * 60; // 30 minutes

function calculateTTL(createdAt: Date): number {
  return Math.floor(createdAt.getTime() / 1000) + TTL_DURATION_SECONDS;
}

// Example:
// Created: 2025-11-03T12:00:00Z (1730649600 Unix timestamp)
// TTL:     2025-11-03T12:30:00Z (1730651400 Unix timestamp)
```

**How TTL Prevents Growth:**

1. **Automatic Deletion**: DynamoDB background process deletes items where `ttl < current_time`
2. **No Manual Cleanup**: No Lambda functions or scheduled jobs needed
3. **Cost-Free**: TTL deletions are free (no write capacity consumed)
4. **Eventual Consistency**: Items deleted within 48 hours of expiration (typically minutes)
5. **Grace Period**: Application logic still checks `expiresAt` for immediate expiration

**Growth Prevention Example:**

| Scenario | Sessions/Day | Peak Storage | Cleanup |
|----------|--------------|--------------|---------|
| Low traffic | 1,000 | ~1,000 items (30-min window) | Automatic |
| High traffic | 100,000 | ~100,000 items (30-min window) | Automatic |
| Black Friday | 1,000,000 | ~1,000,000 items (30-min window) | Automatic |

**Monitoring Growth:**
```typescript
// CloudWatch metric: Consumed read/write capacity
// Alert if sustained high usage (may need on-demand mode)

// Custom metric: Items in table
AWS.DynamoDB.describeTable()
  .then(data => data.Table.ItemCount)
  .then(count => {
    if (count > THRESHOLD) {
      // Alert: TTL may not be configured or falling behind
    }
  });
```

### 3.4 Encryption

**Encryption at Rest:**
- **DynamoDB Table Encryption**: All session data (including payment tokens) is protected by DynamoDB's built-in table-level encryption using AWS-managed keys
- **No Additional KMS Encryption Required**: The authentication service operates in a controlled environment with existing security hardening, making additional KMS encryption unnecessary at this time
- **Future Consideration**: Customer-managed KMS encryption may be added in the future if recommended by a security review

### 3.5 Read/Write Operations

**Create Session:**
```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

async createSession(request: CreateSessionRequest): Promise<AuthenticationSession> {
  const threeDSSessionId = generateAuthenticationId();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);

  const item = {
    threeDSSessionId,
    cartId: request.cartId,
    cartVersion: request.cartVersion,
    paymentToken: request.paymentToken, // Stored directly, protected by DynamoDB table encryption
    tokenType: request.tokenType,
    billTo: JSON.stringify(request.billTo),
    shipTo: request.shipTo ? JSON.stringify(request.shipTo) : undefined,
    threeDSSetupData: request.threeDSSetupData ? JSON.stringify(request.threeDSSetupData) : undefined,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'pending',
    customerId: request.customerId,
    anonymousId: request.anonymousId,
    ttl: Math.floor(expiresAt.getTime() / 1000) // TTL in seconds
  };

  await this.docClient.send(new PutCommand({
    TableName: this.tableName,
    Item: item
  }));

  return this.mapItemToSession(item);
}
```

**Get Session (with expiration check):**
```typescript
import { GetCommand } from '@aws-sdk/lib-dynamodb';

async getSession(threeDSSessionId: string): Promise<AuthenticationSession | null> {
  const result = await this.docClient.send(new GetCommand({
    TableName: this.tableName,
    Key: { threeDSSessionId }
  }));

  if (!result.Item) {
    return null;
  }

  // Check expiration explicitly (don't rely solely on TTL deletion)
  const expiresAt = new Date(result.Item.expiresAt);
  if (expiresAt < new Date()) {
    // Session expired - optionally delete immediately
    await this.deleteSession(threeDSSessionId);
    return null;
  }

  // Check status
  if (result.Item.status !== 'pending') {
    return null;
  }

  return this.mapItemToSession(result.Item);
}
```

**Mark Session Used (conditional update):**
```typescript
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

async markSessionUsed(threeDSSessionId: string): Promise<void> {
  try {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { threeDSSessionId },
      UpdateExpression: 'SET #status = :used',
      ConditionExpression: '#status = :pending',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':pending': 'pending',
        ':used': 'used'
      }
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new SessionAlreadyUsedError(threeDSSessionId);
    }
    throw new StorageServiceError('Failed to mark session as used', error);
  }
}
```

### 3.6 Capacity Planning

**On-Demand Mode (Recommended for Variable Traffic):**
```typescript
{
  BillingMode: 'PAY_PER_REQUEST'
}
```

**Benefits:**
- No capacity planning required
- Scales automatically with traffic
- Cost-effective for unpredictable workloads
- No throttling during traffic spikes

**Provisioned Mode (For Predictable Traffic):**
```typescript
{
  BillingMode: 'PROVISIONED',
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,   // 5 reads/sec
    WriteCapacityUnits: 5   // 5 writes/sec
  }
}
```

**Auto-Scaling Configuration:**
```typescript
{
  MinCapacity: 5,
  MaxCapacity: 100,
  TargetUtilization: 70  // Scale when 70% utilized
}
```

**Cost Estimation (On-Demand):**
- Write: $1.25 per million requests
- Read: $0.25 per million requests
- Storage: $0.25 per GB-month

**Example:**
- 10,000 sessions/day = ~10,000 writes + ~10,000 reads
- Monthly cost: ~$0.015 (negligible)

---

## 4. Mock Provider Implementation

### 4.1 Overview

The Mock provider is designed for **testing environments** where:

- AWS credentials are unavailable (local development, CI/CD)
- Deterministic behavior is required (unit tests)
- Fast execution is critical (no network calls)
- No external dependencies are desired

**NOT for production use** - no durability, no encryption, in-memory only.

### 4.2 In-Memory Storage

```typescript
/**
 * Mock authentication service for testing
 *
 * WARNING: Not for production use
 * - No durability (data lost on restart)
 * - No encryption
 * - No distributed locking
 * - Single-process only
 */
class MockAuthenticationService implements IAuthenticationService {
  private sessions: Map<string, AuthenticationSession> = new Map();

  // Simulated TTL cleanup (optional, for testing TTL behavior)
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options?: MockAuthenticationServiceOptions) {
    if (options?.enableAutomaticCleanup) {
      // Run cleanup every 5 seconds to simulate TTL deletion
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpiredSessions();
      }, 5000);
    }
  }

  async createSession(request: CreateSessionRequest): Promise<AuthenticationSession> {
    const threeDSSessionId = this.generateAuthenticationId();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const session: AuthenticationSession = {
      id: threeDSSessionId,
      cartId: request.cartId,
      cartVersion: request.cartVersion,
      paymentToken: request.paymentToken, // NOT encrypted in mock
      tokenType: request.tokenType,
      billTo: request.billTo,
      shipTo: request.shipTo,
      threeDSSetupData: request.threeDSSetupData,
      createdAt,
      expiresAt,
      status: 'pending',
      customerId: request.customerId,
      anonymousId: request.anonymousId
    };

    this.sessions.set(threeDSSessionId, session);
    return session;
  }

  async getSession(threeDSSessionId: string): Promise<AuthenticationSession | null> {
    const session = this.sessions.get(threeDSSessionId);

    if (!session) {
      return null;
    }

    // Check expiration
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(threeDSSessionId);
      return null;
    }

    // Check status
    if (session.status !== 'pending') {
      return null;
    }

    return session;
  }

  async markSessionUsed(threeDSSessionId: string): Promise<void> {
    const session = this.sessions.get(threeDSSessionId);

    if (!session) {
      throw new SessionNotFoundError(threeDSSessionId);
    }

    if (session.status === 'used') {
      throw new SessionAlreadyUsedError(threeDSSessionId);
    }

    // Create updated session (immutability)
    this.sessions.set(threeDSSessionId, {
      ...session,
      status: 'used'
    });
  }

  async deleteSession(threeDSSessionId: string): Promise<boolean> {
    return this.sessions.delete(threeDSSessionId);
  }

  async healthCheck(): Promise<boolean> {
    return true; // Always healthy
  }

  // Test utilities
  clearAll(): void {
    this.sessions.clear();
  }

  getAllSessions(): AuthenticationSession[] {
    return Array.from(this.sessions.values());
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [id, session] of this.sessions.entries()) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
      }
    }
  }

  private generateAuthenticationId(): string {
    return `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

interface MockAuthenticationServiceOptions {
  enableAutomaticCleanup?: boolean; // Simulate TTL deletion
}
```

### 4.3 Deterministic Behavior for Tests

```typescript
/**
 * Mock with controlled time for deterministic tests
 */
class DeterministicMockAuthenticationService extends MockAuthenticationService {
  private mockNow: Date;

  constructor(mockNow: Date = new Date()) {
    super({ enableAutomaticCleanup: false });
    this.mockNow = mockNow;
  }

  setMockTime(date: Date): void {
    this.mockNow = date;
  }

  advanceTime(milliseconds: number): void {
    this.mockNow = new Date(this.mockNow.getTime() + milliseconds);
  }

  protected getCurrentTime(): Date {
    return this.mockNow;
  }

  // Override methods to use mock time instead of Date.now()
}
```

---

## 5. Lambda Integration Patterns

### 5.1 Service Instantiation

**Environment-Based Provider Selection:**

```typescript
import { IAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service';
import { DynamoDBAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/dynamodb';
import { MockAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/mock';

/**
 * Factory function to create authentication service based on environment
 */
function createAuthenticationService(): IAuthenticationService {
  const environment = process.env.ENVIRONMENT || 'dev';

  if (environment === 'test' || process.env.USE_MOCK_AUTH === 'true') {
    console.log('Using MockAuthenticationService');
    return new MockAuthenticationService();
  }

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

// Global instance (Lambda container reuse)
let authenticationService: IAuthenticationService | null = null;

export function getAuthenticationService(): IAuthenticationService {
  if (!authenticationService) {
    authenticationService = createAuthenticationService();
  }
  return authenticationService;
}
```

### 5.2 Lambda Handler Integration

**Example: `/me/token/capture` Endpoint**

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthenticationService } from './services/authentication-service-factory';
import { SessionNotFoundError, SessionAlreadyUsedError } from '@dw-digital-commerce/checkout-authentication-service';

/**
 * Extract customer and anonymous IDs from OAuth token
 */
function extractPrincipalIds(event: APIGatewayProxyEvent): {
  customerId?: string;
  anonymousId?: string;
} {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) {
    throw new UnauthorizedError('Missing authorization claims');
  }

  // Determine if user is authenticated or anonymous based on token structure
  // Adjust this logic based on your OAuth/JWT token claims
  const isAuthenticated = claims.userType === 'customer' || claims.customerId;

  return {
    customerId: isAuthenticated ? claims.sub : undefined,
    anonymousId: !isAuthenticated ? claims.sub : undefined
  };
}

async function handleCaptureOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const request: CheckoutDraft = JSON.parse(event.body!);
  const authService = getAuthenticationService();

  // Check if 3DS authentication is required
  const requires3DS = checkIfRequires3DS(request);

  if (requires3DS) {
    // Extract customer/anonymous ID from OAuth token for session ownership
    const { customerId, anonymousId } = extractPrincipalIds(event);

    // Create authentication session
    const session = await authService.createSession({
      cartId: request.cartId,
      cartVersion: request.version,
      paymentToken: request.payments[0].tokenisedPayment!.paymentToken,
      tokenType: request.payments[0].tokenisedPayment!.tokenType,
      billTo: request.payments[0].tokenisedPayment!.billTo,
      shipTo: request.payments[0].tokenisedPayment!.shipTo,
      threeDSSetupData: request.payments[0].tokenisedPayment!.threeDSData?.setup,
      customerId,      // For authenticated customers
      anonymousId      // For guest users
    });

    // Return 202 Accepted with authentication session ID
    return {
      statusCode: 202,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        threeDSSessionId: session.id,
        cartId: session.cartId,
        threeDSUrl: 'https://3ds.psp.com/challenge/...',
        nextAction: 'complete_3ds_authentication'
      })
    };
  }

  // No 3DS required - create order directly
  const order = await createOrder(request);
  return {
    statusCode: 201,
    headers: { ...getCorsHeaders(), Location: `/checkout/me/orders/${order.id}` },
    body: JSON.stringify(order)
  };
}
```

**Example: `/me/3ds/validate-capture` Endpoint**

```typescript
async function handle3DSValidateCapture(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const request: ThreeDSValidateCaptureRequest = JSON.parse(event.body!);
  const authService = getAuthenticationService();

  try {
    // Retrieve authentication session
    const session = await authService.getSession(request.threeDSSessionId);

    if (!session) {
      return {
        statusCode: 409,
        headers: getCorsHeaders(),
        body: JSON.stringify({
          code: 'SESSION_NOT_FOUND',
          message: 'Authentication session not found or expired'
        })
      };
    }

    // Validate cart version hasn't changed
    const currentCart = await getCart(session.cartId);
    if (currentCart.version !== session.cartVersion) {
      return {
        statusCode: 422,
        headers: getCorsHeaders(),
        body: JSON.stringify({
          code: 'CART_VERSION_MISMATCH',
          message: 'Cart was modified since authentication started'
        })
      };
    }

    // Mark session as used (prevents replay attacks)
    await authService.markSessionUsed(request.threeDSSessionId);

    // Create order using session data + 3DS completion data
    const order = await createOrderWithSession(session, request.threeDSData);

    // Clean up session after successful order creation
    await authService.deleteSession(request.threeDSSessionId);

    return {
      statusCode: 201,
      headers: { ...getCorsHeaders(), Location: `/checkout/me/orders/${order.id}` },
      body: JSON.stringify(order)
    };

  } catch (error) {
    if (error instanceof SessionAlreadyUsedError) {
      return {
        statusCode: 409,
        headers: getCorsHeaders(),
        body: JSON.stringify({
          code: 'SESSION_ALREADY_USED',
          message: 'Authentication session has already been used'
        })
      };
    }

    // Log and return 500
    console.error('3DS validation error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        code: 'INTERNAL_ERROR',
        message: 'Failed to complete 3DS authentication'
      })
    };
  }
}
```

### 5.3 Error Handling and Retries

```typescript
import { StorageServiceError } from '@dw-digital-commerce/checkout-authentication-service';

/**
 * Retry logic for transient DynamoDB errors
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  backoffMs: number = 100
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry domain errors (session not found, already used, etc.)
      if (error instanceof SessionNotFoundError ||
          error instanceof SessionAlreadyUsedError ||
          error instanceof SessionExpiredError) {
        throw error;
      }

      // Retry storage errors with exponential backoff
      if (error instanceof StorageServiceError && attempt < maxRetries) {
        const delayMs = backoffMs * Math.pow(2, attempt - 1);
        console.warn(`Retrying operation (attempt ${attempt}/${maxRetries}) after ${delayMs}ms:`, error);
        await sleep(delayMs);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Usage in Lambda
async function handleRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const authService = getAuthenticationService();

  const session = await withRetry(async () => {
    return await authService.getSession(threeDSSessionId);
  });

  // ... rest of handler
}
```

### 5.4 Environment Variables

**Required for DynamoDB Provider:**
```bash
# DynamoDB table name (format: {environment}-checkout-authentication-sessions)
AUTH_SESSION_TABLE_NAME=dev-checkout-authentication-sessions

# AWS region
AWS_REGION=eu-west-1

# Environment name (dev, sit, uat, prod)
ENVIRONMENT=dev
```

**Optional for Testing:**
```bash
# Force mock provider (overrides environment detection)
USE_MOCK_AUTH=true
```

---

## 6. Infrastructure Requirements

### 6.1 CDK Stack for DynamoDB Table

```typescript
import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';

export interface AuthenticationSessionStackProps extends StackProps {
  environment: string;
}

export class AuthenticationSessionStack extends Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AuthenticationSessionStackProps) {
    super(scope, id, props);

    // DynamoDB table
    const tableName = `${props.environment}-checkout-authentication-sessions`;

    this.table = new dynamodb.Table(this, 'AuthSessionTable', {
      tableName,
      partitionKey: {
        name: 'threeDSSessionId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl', // Enable TTL
      removalPolicy: props.environment === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      pointInTimeRecovery: props.environment === 'prod' // Backups for prod only
    });

    // CloudWatch alarms
    this.createAlarms(props.environment);

    // Outputs
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'Authentication session table name'
    });
  }

  private createAlarms(environment: string): void {
    // SNS topic for alarms
    const alarmTopic = new sns.Topic(this, 'AuthSessionAlarmTopic', {
      displayName: `Checkout Auth Session Alarms (${environment})`
    });

    // Alarm: High read/write throttling
    const throttleAlarm = new cloudwatch.Alarm(this, 'ThrottleAlarm', {
      metric: this.table.metricSystemErrorsForOperations({
        operations: [
          dynamodb.Operation.GET_ITEM,
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.UPDATE_ITEM
        ]
      }),
      threshold: 10,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Authentication session table experiencing throttling'
    });
    throttleAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    // Alarm: Unexpected table growth (may indicate TTL not working)
    // Note: ItemCount is updated every 6 hours, not real-time
    const itemCountAlarm = new cloudwatch.Alarm(this, 'ItemCountAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ItemCount',
        dimensionsMap: {
          TableName: this.table.tableName
        },
        statistic: 'Average',
        period: Duration.hours(6)
      }),
      threshold: 100000, // Alert if >100k sessions (adjust based on traffic)
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Authentication session table has unexpectedly high item count - check TTL configuration'
    });
    itemCountAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
  }
}
```

### 6.2 Lambda IAM Permissions

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';

// In LambdaStack
const lambdaFunction = new lambda.Function(this, 'CheckoutLambda', {
  // ... function config
});

// Grant DynamoDB permissions
authSessionTable.grantReadWriteData(lambdaFunction);

// Explicit policy statement (alternative to grants)
lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'dynamodb:GetItem',
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem'
  ],
  resources: [authSessionTable.tableArn]
}));
```

### 6.3 Environment Variable Configuration

```typescript
// In LambdaStack
lambdaFunction.addEnvironment('AUTH_SESSION_TABLE_NAME', authSessionTable.tableName);
lambdaFunction.addEnvironment('AWS_REGION', this.region);
lambdaFunction.addEnvironment('ENVIRONMENT', props.environment);
```

### 6.4 Cost Optimization

**On-Demand Pricing (Recommended):**
- No upfront costs
- Pay per request
- Automatically scales with traffic
- Best for unpredictable or spiky workloads

**Estimated Monthly Cost:**
```
Assumptions:
- 100,000 sessions per day
- 30-day month
- Each session: 1 write (create), 1 read (get), 1 update (mark used), 1 delete
- Average item size: 2 KB

Calculations:
- Writes: 3M/month * $1.25/million = $3.75
- Reads: 1M/month * $0.25/million = $0.25
- Storage: 2 KB * 100k items * $0.25/GB-month ≈ $0.05
- Total: ~$4/month
```

**Provisioned Mode (For Predictable Traffic):**
- Lower cost at high, consistent traffic
- Requires capacity planning
- Enable auto-scaling to handle bursts

---

## 7. Testing Strategy

### 7.1 Unit Tests with Mock Provider

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/mock';
import { SessionAlreadyUsedError, SessionNotFoundError } from '@dw-digital-commerce/checkout-authentication-service';

describe('AuthenticationService', () => {
  let service: MockAuthenticationService;

  beforeEach(() => {
    service = new MockAuthenticationService();
  });

  describe('createSession', () => {
    it('should create a valid session', async () => {
      const request = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa_4242',
        tokenType: 'transient' as const,
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const session = await service.createSession(request);

      expect(session.id).toMatch(/^auth_/);
      expect(session.cartId).toBe('cart-123');
      expect(session.status).toBe('pending');
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('should generate unique session IDs', async () => {
      const request = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient' as const,
        billTo: { /* ... */ }
      };

      const session1 = await service.createSession(request);
      const session2 = await service.createSession(request);

      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const created = await service.createSession({ /* ... */ });
      const retrieved = await service.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should return null for non-existent session', async () => {
      const session = await service.getSession('auth_nonexistent');
      expect(session).toBeNull();
    });

    it('should return null for expired session', async () => {
      const mockService = new DeterministicMockAuthenticationService(new Date());
      const session = await mockService.createSession({ /* ... */ });

      // Advance time by 31 minutes
      mockService.advanceTime(31 * 60 * 1000);

      const retrieved = await mockService.getSession(session.id);
      expect(retrieved).toBeNull();
    });

    it('should return null for used session', async () => {
      const session = await service.createSession({ /* ... */ });
      await service.markSessionUsed(session.id);

      const retrieved = await service.getSession(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('markSessionUsed', () => {
    it('should mark a pending session as used', async () => {
      const session = await service.createSession({ /* ... */ });
      await service.markSessionUsed(session.id);

      const retrieved = await service.getSession(session.id);
      expect(retrieved).toBeNull(); // Used sessions not returned by getSession
    });

    it('should throw when marking non-existent session as used', async () => {
      await expect(
        service.markSessionUsed('auth_nonexistent')
      ).rejects.toThrow(SessionNotFoundError);
    });

    it('should throw when marking already-used session as used', async () => {
      const session = await service.createSession({ /* ... */ });
      await service.markSessionUsed(session.id);

      await expect(
        service.markSessionUsed(session.id)
      ).rejects.toThrow(SessionAlreadyUsedError);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      const session = await service.createSession({ /* ... */ });
      const deleted = await service.deleteSession(session.id);

      expect(deleted).toBe(true);
      expect(await service.getSession(session.id)).toBeNull();
    });

    it('should return false for non-existent session', async () => {
      const deleted = await service.deleteSession('auth_nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('should return true for mock provider', async () => {
      const healthy = await service.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
```

### 7.2 Integration Tests with DynamoDB Local

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/dynamodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

describe('DynamoDBAuthenticationService (Integration)', () => {
  let container: StartedTestContainer;
  let service: DynamoDBAuthenticationService;

  beforeAll(async () => {
    // Start DynamoDB Local container
    container = await new GenericContainer('amazon/dynamodb-local')
      .withExposedPorts(8000)
      .start();

    const port = container.getMappedPort(8000);
    const endpoint = `http://localhost:${port}`;

    // Create table
    const client = new DynamoDBClient({
      endpoint,
      region: 'local',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
    });

    await createTestTable(client, 'test-auth-sessions');

    // Initialize service
    service = new DynamoDBAuthenticationService({
      tableName: 'test-auth-sessions',
      region: 'local',
      endpoint
    });
  }, 60000); // 60s timeout for container startup

  afterAll(async () => {
    await container.stop();
  });

  it('should create and retrieve session from DynamoDB', async () => {
    const session = await service.createSession({
      cartId: 'cart-integration-test',
      cartVersion: 1,
      paymentToken: 'tok_test',
      tokenType: 'transient',
      billTo: { /* ... */ }
    });

    const retrieved = await service.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.cartId).toBe('cart-integration-test');
  });

  // More integration tests...
});

async function createTestTable(client: DynamoDBClient, tableName: string): Promise<void> {
  // Create table with TTL enabled
  // Implementation details...
}
```

### 7.3 Performance Benchmarks

```typescript
import { describe, it } from 'vitest';
import { performance } from 'perf_hooks';

describe('Performance Benchmarks', () => {
  it('should create 1000 sessions in <2 seconds (mock)', async () => {
    const service = new MockAuthenticationService();
    const start = performance.now();

    const promises = Array.from({ length: 1000 }, (_, i) =>
      service.createSession({
        cartId: `cart-${i}`,
        cartVersion: 1,
        paymentToken: `tok-${i}`,
        tokenType: 'transient',
        billTo: { /* ... */ }
      })
    );

    await Promise.all(promises);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(2000);
    console.log(`Created 1000 sessions in ${duration.toFixed(2)}ms`);
  });

  it('should retrieve 1000 sessions in <3 seconds (DynamoDB)', async () => {
    // Assumes DynamoDB service is available
    const service = new DynamoDBAuthenticationService({ /* config */ });

    // Create sessions
    const sessionIds = await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        service.createSession({ /* ... */ }).then(s => s.id)
      )
    );

    // Benchmark retrieval
    const start = performance.now();
    await Promise.all(sessionIds.map(id => service.getSession(id)));
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(3000);
    console.log(`Retrieved 1000 sessions in ${duration.toFixed(2)}ms`);
  });
});
```

### 7.4 Test Utilities

```typescript
/**
 * Test data factories for consistent test data
 */
export const TestDataFactory = {
  createSessionRequest: (overrides?: Partial<CreateSessionRequest>): CreateSessionRequest => ({
    cartId: 'cart-test-123',
    cartVersion: 1,
    paymentToken: 'tok_visa_test',
    tokenType: 'transient',
    billTo: {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      address: {
        address1: '123 Test St',
        locality: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB'
      }
    },
    ...overrides
  }),

  createBillingDetails: (overrides?: Partial<BillingDetails>): BillingDetails => ({
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    address: {
      address1: '123 Main St',
      locality: 'London',
      postalCode: 'SW1A 1AA',
      country: 'GB'
    },
    ...overrides
  })
};
```

---

## 8. API Reference

### 8.1 IAuthenticationService Interface

See [Section 2.2](#22-iauthenticationservice-interface) for complete interface definition.

### 8.2 DynamoDBAuthenticationService

```typescript
class DynamoDBAuthenticationService implements IAuthenticationService {
  constructor(config: DynamoDBAuthenticationServiceConfig);
}

interface DynamoDBAuthenticationServiceConfig {
  /** DynamoDB table name */
  tableName: string;

  /** AWS region */
  region: string;

  /** Optional DynamoDB endpoint (for testing with DynamoDB Local) */
  endpoint?: string;

  /** Optional custom DynamoDB client */
  dynamoDBClient?: DynamoDBClient;
}
```

**Usage:**
```typescript
import { DynamoDBAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/dynamodb';

const service = new DynamoDBAuthenticationService({
  tableName: process.env.AUTH_SESSION_TABLE_NAME!,
  region: process.env.AWS_REGION || 'eu-west-1'
});
```

### 8.3 MockAuthenticationService

```typescript
class MockAuthenticationService implements IAuthenticationService {
  constructor(options?: MockAuthenticationServiceOptions);

  /** Clear all sessions (test utility) */
  clearAll(): void;

  /** Get all sessions (test utility) */
  getAllSessions(): AuthenticationSession[];

  /** Cleanup resources (timers) */
  destroy(): void;
}

interface MockAuthenticationServiceOptions {
  /** Enable automatic cleanup of expired sessions (default: false) */
  enableAutomaticCleanup?: boolean;
}
```

**Usage:**
```typescript
import { MockAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/mock';

const service = new MockAuthenticationService({
  enableAutomaticCleanup: true
});

// ... use in tests

// Cleanup after test
beforeEach(() => {
  service.clearAll();
});

afterAll(() => {
  service.destroy();
});
```

### 8.4 Error Classes

See [Section 2.3](#23-error-types) for complete error type definitions.

**Error Handling Example:**
```typescript
import {
  SessionNotFoundError,
  SessionAlreadyUsedError,
  SessionExpiredError,
  StorageServiceError
} from '@dw-digital-commerce/checkout-authentication-service';

try {
  await service.markSessionUsed(threeDSSessionId);
} catch (error) {
  if (error instanceof SessionNotFoundError) {
    // Return 409 Conflict
    return { statusCode: 409, body: { code: 'SESSION_NOT_FOUND' } };
  } else if (error instanceof SessionAlreadyUsedError) {
    // Return 409 Conflict
    return { statusCode: 409, body: { code: 'SESSION_ALREADY_USED' } };
  } else if (error instanceof StorageServiceError) {
    // Return 500 Internal Server Error
    console.error('Storage error:', error.cause);
    return { statusCode: 500, body: { code: 'INTERNAL_ERROR' } };
  }
  throw error;
}
```

---

## 9. Security Considerations

### 9.1 Payment Token Encryption

**At Rest:**
- DynamoDB provider: AWS-managed table-level encryption for all session data including payment tokens
- Mock provider: No encryption (not for production use)
- **Note**: The authentication service operates in a controlled environment with existing security hardening. Additional customer-managed KMS encryption may be considered in the future if recommended by a security review.

**In Transit:**
- TLS 1.2+ for all AWS API calls
- HTTPS-only for API Gateway endpoints

### 9.2 Session Ownership Validation

Session ownership validation ensures that only the principal (authenticated customer or anonymous user) who created the authentication session can complete it. This prevents session hijacking where an attacker obtains an `threeDSSessionId` but cannot complete the transaction without the original principal's OAuth token.

**Authenticated vs. Guest Users:**

- **Authenticated users**: OAuth token contains `customerId` in claims (e.g., `sub: "customer-12345"`)
- **Guest users**: OAuth token contains `anonymousId` in claims (e.g., `sub: "anon-67890"`)
- Exactly one of `customerId` or `anonymousId` is stored when creating the session
- Completion request must have matching principal identifier in OAuth token

**Implementation:**

```typescript
/**
 * Extract customer and anonymous IDs from OAuth token
 */
function extractPrincipalIds(event: APIGatewayProxyEvent): {
  customerId?: string;
  anonymousId?: string;
} {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) {
    throw new UnauthorizedError('Missing authorization claims');
  }

  // Determine if user is authenticated or anonymous based on token structure
  // Adjust this logic based on your OAuth/JWT token claims
  const isAuthenticated = claims.userType === 'customer' || claims.customerId;

  return {
    customerId: isAuthenticated ? claims.sub : undefined,
    anonymousId: !isAuthenticated ? claims.sub : undefined
  };
}

/**
 * Validate that the principal (customer or anonymous user) owns the session
 */
async function validateSessionOwnership(
  session: AuthenticationSession,
  event: APIGatewayProxyEvent
): Promise<void> {
  const { customerId, anonymousId } = extractPrincipalIds(event);

  // Validate authenticated customer ownership
  if (session.customerId) {
    if (session.customerId !== customerId) {
      // Log security event
      console.error('Session ownership violation', {
        sessionId: session.id,
        sessionOwner: session.customerId,
        attemptedBy: customerId,
        ipAddress: event.requestContext.identity.sourceIp
      });
      throw new ForbiddenError('Session does not belong to authenticated customer');
    }
  }

  // Validate anonymous user ownership
  if (session.anonymousId) {
    if (session.anonymousId !== anonymousId) {
      // Log security event
      console.error('Session ownership violation', {
        sessionId: session.id,
        sessionOwner: session.anonymousId,
        attemptedBy: anonymousId,
        ipAddress: event.requestContext.identity.sourceIp
      });
      throw new ForbiddenError('Session does not belong to anonymous user');
    }
  }
}
```

**Usage in 3DS Completion Handler:**

```typescript
async function handle3DSValidateCapture(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const request = JSON.parse(event.body!);
  const authService = getAuthenticationService();

  // Retrieve session
  const session = await authService.getSession(request.threeDSSessionId);
  if (!session) {
    return { statusCode: 409, body: JSON.stringify({ code: 'SESSION_NOT_FOUND' }) };
  }

  // Validate ownership (throws ForbiddenError if mismatch)
  await validateSessionOwnership(session, event);

  // Continue with session processing...
  await authService.markSessionUsed(request.threeDSSessionId);
  const order = await createOrder(session, request.threeDSData);

  return { statusCode: 201, body: JSON.stringify(order) };
}
```

### 9.3 Audit Logging

```typescript
/**
 * Log session lifecycle events for audit trail
 */
function logAuditEvent(
  event: 'SESSION_CREATED' | 'SESSION_RETRIEVED' | 'SESSION_USED' | 'SESSION_DELETED',
  session: AuthenticationSession,
  context: APIGatewayRequestContext
): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    threeDSSessionId: session.id,
    cartId: session.cartId,
    cartVersion: session.cartVersion,
    customerId: session.customerId,
    anonymousId: session.anonymousId,
    requestId: context.requestId,
    sourceIp: context.identity.sourceIp,
    userAgent: context.identity.userAgent
  }));
}
```

### 9.4 Secrets Management

**DO NOT hardcode:**
- Table names
- AWS credentials

**Use:**
- Environment variables (CDK-managed)
- AWS Secrets Manager for sensitive config
- IAM roles for AWS service access (never access keys)

---

## 10. Performance and Scalability

### 10.1 Latency Targets

| Operation | Target Latency (p50) | Target Latency (p99) |
|-----------|---------------------|---------------------|
| createSession | <50ms | <100ms |
| getSession | <30ms | <75ms |
| markSessionUsed | <40ms | <90ms |
| deleteSession | <35ms | <80ms |

### 10.2 Throughput Capacity

**DynamoDB On-Demand:**
- Theoretically unlimited throughput
- Auto-scales to handle any traffic level
- No throttling under normal conditions

**Expected Load:**
| Scenario | Sessions/Day | Peak RPS | DynamoDB Capacity |
|----------|-------------|----------|-------------------|
| Low traffic | 1,000 | ~1 | On-demand handles easily |
| Medium traffic | 10,000 | ~10 | On-demand handles easily |
| High traffic | 100,000 | ~100 | On-demand handles easily |
| Black Friday | 1,000,000 | ~1,000 | On-demand handles, monitor costs |

### 10.3 Lambda Cold Start Mitigation

**Strategies:**
1. **Provisioned Concurrency**: Keep Lambda warm for critical endpoints
2. **Global Service Instance**: Reuse service across invocations (container reuse)
3. **Lazy Initialization**: Only create AWS SDK clients when needed
4. **Bundle Optimization**: Use esbuild tree-shaking to minimize bundle size

```typescript
// Global instance for container reuse
let authService: IAuthenticationService | null = null;

export function getAuthenticationService(): IAuthenticationService {
  if (!authService) {
    authService = createAuthenticationService(); // Lazy init
  }
  return authService;
}
```

### 10.4 Connection Pooling

**AWS SDK v3 Connection Pooling:**
- Reuse HTTP connections across requests
- Default pool size: 50 connections
- Configure via `AWS_NODEJS_CONNECTION_REUSE_ENABLED=1`

```bash
# Lambda environment variable
AWS_NODEJS_CONNECTION_REUSE_ENABLED=1
```

### 10.5 Caching (Optional)

**NOT recommended for authentication sessions** due to:
- Short TTL (30 minutes) - caching provides minimal benefit
- High data volatility (status changes: pending → used)
- Security risk (cached expired sessions)
- Complexity increase

**If caching is absolutely necessary:**
```typescript
// Simple in-memory cache with TTL (Lambda container lifetime)
class CachedAuthenticationService implements IAuthenticationService {
  private cache = new Map<string, { session: AuthenticationSession; expiresAt: number }>();

  constructor(private delegate: IAuthenticationService) {}

  async getSession(id: string): Promise<AuthenticationSession | null> {
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.session;
    }

    const session = await this.delegate.getSession(id);
    if (session) {
      // Cache for 1 minute only (session state can change)
      this.cache.set(id, {
        session,
        expiresAt: Date.now() + 60 * 1000
      });
    }

    return session;
  }

  // Other methods delegate directly (no caching)
}
```

---

## 11. Migration Guide

### 11.1 Migration Path

**Current State (Hypothetical Inline Implementation):**
```typescript
// Checkout API currently has no session management
// 3DS sessions would be handled inline or not at all
```

**Target State (With Library):**
```typescript
import { getAuthenticationService } from './services/authentication-service-factory';

const authService = getAuthenticationService();
const session = await authService.createSession({ /* ... */ });
```

### 11.2 Step-by-Step Migration

**Phase 1: Infrastructure Setup**
1. Deploy DynamoDB table via CDK (AuthenticationSessionStack)
2. Deploy KMS key for encryption
3. Update Lambda IAM roles with required permissions
4. Configure environment variables

**Phase 2: Library Integration**
1. Add library to package.json dependencies
2. Configure .npmrc for GitHub Packages access
3. Create service factory function
4. Update Lambda handlers to use service

**Phase 3: Testing**
1. Test with mock provider in unit tests
2. Test with DynamoDB Local in integration tests
3. Deploy to dev environment with DynamoDB
4. Verify session lifecycle with manual testing

**Phase 4: Production Rollout**
1. Deploy to UAT environment
2. Monitor metrics and alarms
3. Gradual rollout to production (if using feature flags)
4. Full production deployment

### 11.3 Backward Compatibility

**Not Applicable** - This is a new feature (3DS authentication sessions).

No existing session management to maintain compatibility with.

### 11.4 Rollback Plan

If issues arise in production:

1. **Immediate**: Revert Lambda deployment to previous version without library
2. **Temporary**: Disable 3DS flow (return 422 for all transactions)
3. **Investigate**: Analyze CloudWatch logs and DynamoDB metrics
4. **Fix**: Address root cause and redeploy

**Rollback Safety:**
- DynamoDB table can remain (no schema changes needed)
- KMS key can remain (no impact)
- Removing library code is safe (no persistent state corruption)

---

## 12. Appendices

### 12.1 Glossary

| Term | Definition |
|------|------------|
| **3DS** | 3D Secure - Authentication protocol for card payments |
| **Authentication Session** | Temporary server-side storage of cart/payment data during 3DS flow |
| **TTL** | Time-to-Live - Automatic item expiration in DynamoDB |
| **Single-Use Session** | Session can only be consumed once (prevents replay attacks) |
| **Session Status** | Lifecycle state: pending, used, expired |
| **Provider** | Concrete implementation of IAuthenticationService (DynamoDB or Mock) |
| **KMS** | AWS Key Management Service - Encryption key management |
| **CMK** | Customer-Managed Key - KMS key controlled by customer |

### 12.2 Related RFCs and Standards

- **ISO 19160-1** - International address standard (used in BillingDetails)
- **ISO 3166-1 alpha-2** - Two-letter country codes (e.g., GB, US)
- **ISO 8601** - Date and time format (used for timestamps)
- **PCI DSS** - Payment Card Industry Data Security Standard
- **EMV 3-D Secure** - Specification for 3DS protocol

### 12.3 References

1. [TECHNICAL-REPORT-3DS-Stateful-vs-Stateless-Design.md](./TECHNICAL-REPORT-3DS-Stateful-vs-Stateless-Design.md)
2. [AWS DynamoDB Time to Live (TTL) Documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
3. [AWS KMS Encryption Best Practices](https://docs.aws.amazon.com/kms/latest/developerguide/best-practices.html)
4. [Stripe PaymentIntent API](https://docs.stripe.com/payments/paymentintents)
5. [PayPal Orders API v2](https://developer.paypal.com/docs/api/orders/v2/)

### 12.4 Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-03 | [Author] | Initial specification |

### 12.5 Future Enhancements

**Not in v1.0.0 scope:**

1. **Multi-Region Replication**: Global DynamoDB tables for multi-region deployments
2. **Session Analytics**: Aggregate metrics on session success/failure rates
3. **Advanced Monitoring**: Custom CloudWatch dashboards for session insights
4. **Session Recovery**: Ability to extend session TTL if 3DS challenge takes >30 minutes
5. **Alternative Providers**: Redis provider, S3 provider (for extreme cost optimization)

### 12.6 Contact Information

For questions about this specification:
- **Repository**: https://github.com/dw-digital-commerce/checkout-authentication-service (to be created)
- **Issues**: https://github.com/dw-digital-commerce/checkout-authentication-service/issues
- **Team**: Checkout API Team

---

**END OF SPECIFICATION**
