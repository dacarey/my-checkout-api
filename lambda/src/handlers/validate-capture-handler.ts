/**
 * Validate Capture Handler
 *
 * Handles the /checkout/me/3ds/validate-capture endpoint.
 * Completes payment after customer successfully completes 3DS authentication challenge.
 *
 * Response scenarios:
 * - 201 Created: Payment authorized after 3DS validation
 * - 400 Bad Request: Payment declined after 3DS validation
 * - 404 Not Found: 3DS session not found or expired
 * - 409 Conflict: 3DS session already used
 * - 500 Internal Server Error: Processing error
 */

import { getAuthenticationService } from '@dw-digital-commerce/checkout-3ds-session-service';
import { getPaymentProvider } from '../providers/provider-factory';
import type { ValidateCaptureRequest } from '../providers/types';

export interface ValidateCaptureRequestBody {
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

export async function handleValidateCapture(
  body: ValidateCaptureRequestBody,
  brandkey: string
): Promise<{ statusCode: number; body: string }> {
  console.log('🔄 Processing 3DS validate-capture request');
  console.log('Session ID:', body.threeDSSessionId);
  console.log('Brand:', brandkey);
  console.log('Authentication result:', body.threeDSData.completion?.authenticationResult);

  const provider = getPaymentProvider();
  const authService = getAuthenticationService();

  try {
    // Retrieve 3DS session
    console.log(`📋 Retrieving 3DS session: ${body.threeDSSessionId}`);
    const session = await authService.getSession(body.threeDSSessionId);

    if (!session) {
      console.log(`❌ 3DS session not found: ${body.threeDSSessionId}`);
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'session_not_found',
          message: '3DS authentication session not found or has expired',
          timestamp: new Date().toISOString()
        })
      };
    }

    if (session.used) {
      console.log(`❌ 3DS session already used: ${body.threeDSSessionId}`);
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: 'session_already_used',
          message: '3DS authentication session has already been used to complete payment',
          timestamp: new Date().toISOString()
        })
      };
    }

    console.log(`✅ 3DS session retrieved successfully`);
    console.log(`📝 Session details - Cart ID: ${session.cartId}, Transaction ID: ${session.transactionId}`);

    // Map to provider request
    const validateRequest: ValidateCaptureRequest = {
      transactionId: session.transactionId,
      orderId: session.cartId,
      paymentToken: session.paymentToken,
      threeDSData: body.threeDSData
    };

    // Call payment provider for validation
    console.log('🔄 Calling payment provider for 3DS validation');
    const result = await provider.processValidateCapture(validateRequest, brandkey);

    // Mark session as used (regardless of outcome to prevent replay)
    console.log('📝 Marking 3DS session as used');
    await authService.markSessionUsed(body.threeDSSessionId);

    if (result.status === 'AUTHORIZED') {
      console.log(`✅ Payment authorized after 3DS validation: ${result.transactionId}`);
      return {
        statusCode: 201,
        body: JSON.stringify({
          orderId: session.cartId,
          status: 'completed',
          transactionId: result.transactionId,
          authorizationCode: result.authorizationCode,
          timestamp: result.timestamp,
          provider: result.provider
        })
      };
    }

    // Handle decline after 3DS authentication
    console.log(`❌ Payment declined after 3DS validation: ${result.declineReason || 'Unknown reason'}`);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'payment_declined',
        message: result.declineReason || 'Payment was declined after 3DS authentication',
        transactionId: result.transactionId,
        timestamp: result.timestamp
      })
    };

  } catch (error) {
    console.error('❌ Validate-capture handler error:', error);

    // Determine error type and return appropriate response
    const errorMessage = error instanceof Error ? error.message : 'Validation processing failed';

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
