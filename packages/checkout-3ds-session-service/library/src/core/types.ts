/**
 * Session lifecycle status
 */
export type SessionStatus = 'pending' | 'used' | 'expired';

/**
 * Token type for payment methods
 */
export type TokenType = 'transient' | 'stored';

/**
 * ISO 19160-1 compliant address structure
 */
export interface PaymentAddress {
  readonly address1: string;
  readonly address2?: string;
  readonly locality: string;        // City (ISO 19160 terminology)
  readonly administrativeArea?: string;  // State/province
  readonly postalCode: string;
  readonly country: string;         // ISO 3166-1 alpha-2
}

/**
 * Billing contact information with ISO 19160-1 compliant address
 */
export interface BillingDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address: PaymentAddress;
}

/**
 * Shipping details (optional for digital goods)
 */
export interface ShippingDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly address: PaymentAddress;
  readonly phone?: string;
}

/**
 * 3DS setup phase data from Payment API
 */
export interface ThreeDSSetupData {
  readonly referenceId: string;
  readonly authenticationInformation?: Record<string, any>;
}

/**
 * 3DS Authentication Session
 *
 * Immutable once created. Sessions are single-use and expire after 30 minutes.
 * All monetary values use the cart's currency.
 */
export interface AuthenticationSession {
  /** Unique session identifier (returned in HTTP 202 response) */
  readonly id: string;

  /** Original cart ID from CheckoutDraft */
  readonly cartId: string;

  /** Cart version at the time of authentication initiation */
  readonly cartVersion: number;

  /** Payment token (tokenization must happen before session creation, protected by DynamoDB encryption at rest) */
  readonly paymentToken: string;

  /** Token type: 'transient' (one-time) or 'stored' (saved payment method) */
  readonly tokenType: TokenType;

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
export interface CreateSessionRequest {
  readonly cartId: string;
  readonly cartVersion: number;
  readonly paymentToken: string;
  readonly tokenType: TokenType;
  readonly billTo: BillingDetails;
  readonly shipTo?: ShippingDetails;
  readonly threeDSSetupData?: ThreeDSSetupData;
  /** Customer identifier for authenticated users (from OAuth token sub claim) */
  readonly customerId?: string;
  /** Anonymous identifier for guest users (from OAuth token sub claim) */
  readonly anonymousId?: string;
}
