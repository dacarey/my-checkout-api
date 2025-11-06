/**
 * Provider interface types for payment processing
 *
 * This module defines the contract between the Checkout API Lambda handlers
 * and the underlying payment providers (real Cybersource via payments-sdk or mock).
 */

/**
 * Address structure following ISO 19160 standard (aligned with Payment API)
 */
export interface Address {
  address1: string;
  address2?: string;
  locality: string;
  administrativeArea?: string;
  postalCode: string;
  country: string;
}

/**
 * Addressable party (billing details) aligned with Payment API v0.3.0
 */
export interface AddressableParty {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address: Address;
}

/**
 * ThreeDSData structure aligned with Payment API v0.3.0
 * Uses discriminated union for setup and completion phases
 */
export interface ThreeDSData {
  phase: 'setup' | 'completion';
  setup?: {
    referenceId: string;
    deviceCollectionInfo?: {
      browserAcceptHeader?: string;
      browserLanguage?: string;
      browserScreenHeight?: number;
      browserScreenWidth?: number;
      browserTimeZone?: number;
      userAgent?: string;
    };
  };
  completion?: {
    authenticationResult: string;
    cavv?: string;
    eci?: string;
    xid?: string;
  };
}

/**
 * Request for token/capture operation
 */
export interface TokenCaptureRequest {
  orderId: string;
  amount: number;
  currency: string;
  paymentToken: string;
  tokenType: 'transient_token' | 'payment_instrument';
  setupRecurring?: boolean;
  billTo: AddressableParty;
  threeDSData?: ThreeDSData;
  deviceFingerprintId?: string;
  clientIp?: string;
  userAgent?: string;
}

/**
 * Challenge information from Payment API v0.3.0
 */
export interface ChallengeInfo {
  stepUpUrl: string;
  stepUpToken: string;
  acsUrl: string;
  authenticationTransactionId: string;
  threeDSServerTransactionId?: string;
  directoryServerTransactionId?: string;
}

/**
 * Result from token capture operation
 */
export interface TokenCaptureResult {
  status: 'AUTHORIZED' | 'REQUIRES_3DS_VALIDATION' | 'DECLINED';
  transactionId: string;
  authorizationCode?: string;
  provider: string;
  timestamp: string;
  threeDSUrl?: string;
  challengeInfo?: ChallengeInfo;
  cardEnrolled?: boolean;
  declineReason?: string;
}

/**
 * Request for 3DS validate-capture operation
 */
export interface ValidateCaptureRequest {
  transactionId: string;
  orderId: string;
  paymentToken: string;
  threeDSData: ThreeDSData;
}

/**
 * Result from validate-capture operation
 */
export interface ValidateCaptureResult {
  status: 'AUTHORIZED' | 'DECLINED';
  transactionId: string;
  authorizationCode?: string;
  provider: string;
  timestamp: string;
  declineReason?: string;
}

/**
 * Payment provider interface
 *
 * Implementations:
 * - RealPaymentProvider: Uses payments-sdk with Cybersource
 * - MockPaymentProvider: Returns simulated responses for testing
 */
export interface PaymentProvider {
  /**
   * Process a token capture request (initial payment attempt)
   * May return REQUIRES_3DS_VALIDATION if 3DS challenge is needed
   */
  processTokenCapture(request: TokenCaptureRequest, brandkey: string): Promise<TokenCaptureResult>;

  /**
   * Process a 3DS validate-capture request (after customer completes 3DS challenge)
   */
  processValidateCapture(request: ValidateCaptureRequest, brandkey: string): Promise<ValidateCaptureResult>;
}
