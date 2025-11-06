/**
 * Mock Payment Provider - Simulated payment processing for testing
 *
 * This provider returns simulated responses without calling real payment gateways.
 * Useful for development, testing, and demonstrations.
 *
 * Simulated scenarios:
 * - Cart amounts ending in .99 trigger 3DS authentication
 * - Cart amounts ending in .00 are authorized immediately
 * - Cart amounts ending in .50 are declined
 */

import {
  PaymentProvider,
  TokenCaptureRequest,
  TokenCaptureResult,
  ValidateCaptureRequest,
  ValidateCaptureResult
} from '../types';

export class MockPaymentProvider implements PaymentProvider {
  async processTokenCapture(request: TokenCaptureRequest, brandkey: string): Promise<TokenCaptureResult> {
    console.log('🧪 Executing MOCK token capture for brand:', brandkey);
    console.log('Mock request:', JSON.stringify(request, null, 2));

    // Simulate processing delay
    await this.delay(100);

    const transactionId = `mock_tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Determine mock behavior based on amount
    const amountStr = request.amount.toString();
    const cents = amountStr.split('.')[1] || '00';

    // Amounts ending in .99 trigger 3DS
    if (cents === '99') {
      console.log('🧪 Mock: Simulating 3DS authentication required');
      return {
        status: 'REQUIRES_3DS_VALIDATION',
        transactionId,
        provider: 'MockPaymentProvider',
        timestamp: new Date().toISOString(),
        threeDSUrl: 'https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp',
        challengeInfo: {
          stepUpUrl: 'https://centinelapi.cardinalcommerce.com/V2/Cruise/StepUp',
          stepUpToken: `mock_jwt_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
          acsUrl: 'https://acs.issuer.com/3ds/acs/challenge',
          authenticationTransactionId: `mock_auth_${Date.now()}`,
          threeDSServerTransactionId: `mock_3ds_server_${Date.now()}`,
          directoryServerTransactionId: `mock_ds_${Date.now()}`
        },
        cardEnrolled: true
      };
    }

    // Amounts ending in .50 are declined
    if (cents === '50') {
      console.log('🧪 Mock: Simulating payment decline');
      return {
        status: 'DECLINED',
        transactionId,
        provider: 'MockPaymentProvider',
        timestamp: new Date().toISOString(),
        declineReason: 'INSUFFICIENT_FUNDS',
        cardEnrolled: false
      };
    }

    // All other amounts are authorized
    console.log('🧪 Mock: Simulating successful authorization');
    return {
      status: 'AUTHORIZED',
      transactionId,
      authorizationCode: `mock_auth_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      provider: 'MockPaymentProvider',
      timestamp: new Date().toISOString(),
      cardEnrolled: false
    };
  }

  async processValidateCapture(request: ValidateCaptureRequest, brandkey: string): Promise<ValidateCaptureResult> {
    console.log('🧪 Executing MOCK validate-capture for brand:', brandkey);
    console.log('Mock validate-capture request:', JSON.stringify(request, null, 2));

    // Simulate processing delay
    await this.delay(100);

    // Check authenticationResult from threeDSData
    const authResult = request.threeDSData.completion?.authenticationResult;

    // Simulate authentication success/failure based on authenticationResult
    if (authResult === 'N' || authResult === 'U') {
      console.log('🧪 Mock: Simulating 3DS authentication failure');
      return {
        status: 'DECLINED',
        transactionId: request.transactionId,
        provider: 'MockPaymentProvider',
        timestamp: new Date().toISOString(),
        declineReason: 'AUTHENTICATION_FAILED'
      };
    }

    // Successful authentication (Y, A, or any other value)
    console.log('🧪 Mock: Simulating successful 3DS validation and authorization');
    return {
      status: 'AUTHORIZED',
      transactionId: request.transactionId,
      authorizationCode: `mock_auth_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      provider: 'MockPaymentProvider',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Simulate async processing delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
