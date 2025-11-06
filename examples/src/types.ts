/**
 * Type definitions for Checkout API examples
 */

export interface ApiConfig {
  apiId: string;
  brandKey: string;
  baseUrl: string;
  region: string;
  lockData?: DeploymentLock;
}

export interface DeploymentLock {
  apiId: string;
  region: string;
  stage: string;
  timestamp: string;
  lambdaFunctionName?: string;
}

export interface RunnerOptions {
  apiId?: string;
  brandKey?: string;
  region?: string;
  example?: string;
  timeout?: number;
  verbose?: boolean;
}

export interface ExampleOptions {
  config: ApiConfig;
  verbose?: boolean;
  timeout?: number;
}

export interface ExampleResult {
  name: string;
  endpoint: string;
  success: boolean;
  statusCode: number;
  response: any;
  error?: string;
  duration: number;
  request?: any;
  headers?: Record<string, string>;
}

export interface ApiResponse<T = any> {
  statusCode: number;
  data?: T;
  error?: string;
  timestamp: string;
}

// Cybersource credentials for TokenService
export interface CybersourceCredentials {
  merchantID: string;
  merchantKeyId: string;
  merchantsecretKey: string;
}

// Test card data structure for TokenService
export interface CardData {
  number: string;
  expirationMonth: string;
  expirationYear: string;
  securityCode: string;
}

// Checkout API request types
export interface TokenCaptureRequest {
  cartId: string;
  cartVersion?: number;
  totalPrice: {
    amount: number;
    currencyCode: string;
  };
  paymentToken: string;
  tokenType?: 'transient_token' | 'payment_instrument';
  setupRecurring?: boolean;
  billingAddress: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    address: {
      address1: string;
      address2?: string;
      locality: string;
      administrativeArea?: string;
      postalCode: string;
      country: string;
    };
  };
  threeDSData?: any;
  deviceFingerprintId?: string;
}

export interface ValidateCaptureRequest {
  threeDSSessionId: string;
  threeDSData: {
    phase: 'completion';
    completion: {
      authenticationResult: string;
      cavv?: string;
      eci?: string;
      xid?: string;
    };
  };
}
