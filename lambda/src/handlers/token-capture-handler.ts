/**
 * Token Capture Handler
 *
 * Handles the /checkout/me/token/capture endpoint.
 * Processes payment capture requests and manages 3DS authentication flow.
 *
 * Response scenarios:
 * - 201 Created: Payment authorized successfully
 * - 202 Accepted: 3DS authentication required (returns challengeInfo)
 * - 422 Unprocessable Entity: Payment declined
 * - 500 Internal Server Error: Processing error
 */

import { getAuthenticationService } from '@dw-digital-commerce/checkout-3ds-session-service';
import { getPaymentProvider } from '../providers/provider-factory';
import type { TokenCaptureRequest } from '../providers/types';

export interface TokenCaptureRequestBody {
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

export async function handleTokenCapture(
  body: TokenCaptureRequestBody | any,
  brandkey: string,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  console.log('🔄 Processing token capture request');

  // Extract data from CheckoutDraft format (if using OpenAPI schema validation)
  let cartId: string;
  let amount: number;
  let currency: string;
  let paymentToken: string;
  let tokenType: 'transient_token' | 'payment_instrument';
  let setupRecurring: boolean | undefined;
  let billTo: any;
  let threeDSData: any;
  let deviceFingerprintId: string | undefined;

  // Check if request is in CheckoutDraft format (has 'payments' array)
  if (body.payments && Array.isArray(body.payments)) {
    console.log('📦 Parsing CheckoutDraft format request');
    cartId = body.cartId;
    const payment = body.payments[0]; // Use first payment
    amount = payment.amount.value;
    currency = payment.amount.currencyCode;

    if (payment.tokenisedPayment) {
      paymentToken = payment.tokenisedPayment.paymentToken;
      // Map OpenAPI enum values to provider enum values
      const apiTokenType = payment.tokenisedPayment.tokenType || 'transient';
      tokenType = apiTokenType === 'transient' ? 'transient_token' : 'payment_instrument';
      setupRecurring = payment.tokenisedPayment.setupRecurring;
      billTo = payment.tokenisedPayment.billTo;
      threeDSData = payment.tokenisedPayment.threeDSData;
      deviceFingerprintId = payment.tokenisedPayment.deviceFingerprintId;
    } else {
      throw new Error('Only tokenised payments are supported');
    }
  } else {
    // Simplified format (direct TokenCaptureRequestBody)
    console.log('📦 Parsing simplified format request');
    cartId = body.cartId;
    amount = body.totalPrice.amount;
    currency = body.totalPrice.currencyCode;
    paymentToken = body.paymentToken;
    tokenType = body.tokenType || 'transient_token';
    setupRecurring = body.setupRecurring;
    billTo = body.billingAddress;
    threeDSData = body.threeDSData;
    deviceFingerprintId = body.deviceFingerprintId;
  }

  console.log('Cart ID:', cartId);
  console.log('Amount:', amount, currency);
  console.log('Brand:', brandkey);

  const provider = getPaymentProvider();
  const authService = getAuthenticationService(); // Singleton from session service

  // Map to provider request
  const tokenCaptureRequest: TokenCaptureRequest = {
    orderId: cartId,
    amount,
    currency,
    paymentToken,
    tokenType,
    setupRecurring,
    billTo,
    threeDSData,
    deviceFingerprintId,
    clientIp: headers['x-forwarded-for'] || headers['x-real-ip'],
    userAgent: headers['user-agent']
  };

  try {
    // Call payment provider (which uses payments-sdk or mock)
    const result = await provider.processTokenCapture(tokenCaptureRequest, brandkey);

    // Handle 3DS authentication required
    if (result.status === 'REQUIRES_3DS_VALIDATION') {
      if (!result.challengeInfo) {
        console.error('❌ 3DS validation required but challengeInfo is missing');
        throw new Error('3DS validation required but challenge information is unavailable');
      }

      console.log(`📝 Creating 3DS session for 3DS flow`);

      // NOTE: This is a reference implementation for demonstrating the OpenAPI spec.
      // In production, customerId/anonymousId should be extracted from the OAuth token
      // to prevent session hijacking. For demo purposes, we use a fixed value.
      const demoCustomerId = 'demo-customer-123';

      // Map tokenType from provider format to core format
      const coreTokenType: 'transient' | 'stored' =
        tokenType === 'transient_token' ? 'transient' : 'stored';

      // Store session using checkout-3ds-session-service
      const session = await authService.createSession({
        cartId: cartId,
        cartVersion: body.cartVersion || 1,
        paymentToken: paymentToken,
        tokenType: coreTokenType,
        billTo: billTo,
        threeDSSetupData: result.threeDSSetupData,
        customerId: demoCustomerId
      });

      console.log(`✅ 3DS session created successfully: ${session.id}`);

      // Map to Checkout API ThreeDSAuthenticationRequired response (aligned with Payment API v0.3.0)
      return {
        statusCode: 202,
        body: JSON.stringify({
          threeDSSessionId: session.id,
          cartId: cartId,
          transactionId: result.transactionId,
          status: 'requires3DSAuthentication',
          timestamp: new Date().toISOString(),
          challengeInfo: {
            stepUpUrl: result.challengeInfo.stepUpUrl,
            stepUpToken: result.challengeInfo.stepUpToken,
            acsUrl: result.challengeInfo.acsUrl,
            authenticationTransactionId: result.challengeInfo.authenticationTransactionId,
            threeDSServerTransactionId: result.challengeInfo.threeDSServerTransactionId,
            directoryServerTransactionId: result.challengeInfo.directoryServerTransactionId
          },
          paymentContext: {
            amount: {
              amount: amount,
              currencyCode: currency
            },
            paymentMethod: 'tokenised'
          }
        })
      };
    }

    // Handle successful authorization (no 3DS required)
    if (result.status === 'AUTHORIZED') {
      console.log(`✅ Payment authorized: ${result.transactionId}`);
      return {
        statusCode: 201,
        body: JSON.stringify({
          orderId: cartId,
          status: 'completed',
          transactionId: result.transactionId,
          authorizationCode: result.authorizationCode,
          timestamp: result.timestamp,
          provider: result.provider
        })
      };
    }

    // Handle decline
    console.log(`❌ Payment declined: ${result.declineReason || 'Unknown reason'}`);
    return {
      statusCode: 422,
      body: JSON.stringify({
        error: 'payment_declined',
        message: result.declineReason || 'Payment was declined by the payment provider',
        transactionId: result.transactionId,
        timestamp: result.timestamp
      })
    };

  } catch (error) {
    console.error('❌ Token capture handler error:', error);

    // Determine error type and return appropriate response
    const errorMessage = error instanceof Error ? error.message : 'Payment processing failed';

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'internal_error',
        message: errorMessage,
        timestamp: new Date().toISOString()
      })
    };
  }
}
