/**
 * Real Payment Provider - Cybersource integration via payments-sdk
 *
 * This provider integrates with Cybersource payment gateway using the payments-sdk library.
 * It handles real payment processing including 3DS authentication flows.
 *
 * Based on the implementation pattern from my-payments-api/lambda/src/providers/real/real-payment-provider.ts
 */

import { PaymentService } from '@dw-digital-commerce/payments-sdk';
import PaymentError from '@dw-digital-commerce/payments-sdk/src/utils/PaymentError';
import {
  PaymentProvider,
  TokenCaptureRequest,
  TokenCaptureResult,
  ValidateCaptureRequest,
  ValidateCaptureResult,
  ChallengeInfo
} from '../types';
import { loadCredentialsForBrand } from '../../utils/credentials-loader';

export class RealPaymentProvider implements PaymentProvider {
  async processTokenCapture(request: TokenCaptureRequest, brandkey: string): Promise<TokenCaptureResult> {
    console.log('🔄 Executing REAL token capture for brand:', brandkey);
    console.log('Environment variables:', {
      NODE_ENV: process.env.NODE_ENV || 'undefined',
      AWS_REGION: process.env.AWS_REGION || 'undefined',
      LAMBDA_RUNTIME_DIR: process.env.LAMBDA_RUNTIME_DIR || 'undefined',
      LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT || 'undefined',
      cwd: process.cwd()
    });

    console.log('Creating PaymentService instance...');

    // Load credentials from Secrets Manager or environment variables
    // Fail fast on credential errors - these should propagate immediately
    const credentials = await loadCredentialsForBrand(brandkey);
    console.log(`Using Cybersource credentials: merchantID=${credentials.merchantID}, keyId=${credentials.merchantKeyId.substring(0, 8)}...`);

    const paymentService = new PaymentService('cybersource', {
      merchantID: credentials.merchantID,
      merchantKeyId: credentials.merchantKeyId,
      merchantsecretKey: credentials.merchantsecretKey
    });
    console.log('PaymentService instance created');

    const sdkPayload = this.mapTokenCaptureToSdkPayload(request);
    console.log('SDK payload:', JSON.stringify(sdkPayload, null, 2));

    try {
      console.log('Calling paymentCapture...');
      const result = await paymentService.paymentCapture(sdkPayload);
      console.log('Payment SDK response:', JSON.stringify(result, null, 2));

      const captureResult: TokenCaptureResult = {
        status: result.status || 'AUTHORIZED',
        transactionId: result.transactionId || `sdk_${Date.now()}`,
        authorizationCode: result.authorizationCode,
        provider: result.provider || 'CybersourceRestAPI',
        timestamp: result.timestamp || new Date().toISOString()
      };

      // Handle challengeInfo structure for 3DS validation
      if (result.status === 'REQUIRES_3DS_VALIDATION') {
        if (!result.challengeInfo) {
          console.error('❌ CRITICAL: SDK returned REQUIRES_3DS_VALIDATION but challengeInfo is missing:', result);
          throw new Error('Invalid SDK response: REQUIRES_3DS_VALIDATION status requires challengeInfo object');
        }

        // Validate all required challengeInfo fields
        const requiredFields = ['stepUpUrl', 'stepUpToken', 'acsUrl', 'authenticationTransactionId'];
        const missingFields = requiredFields.filter(field => !result.challengeInfo![field as keyof typeof result.challengeInfo]);

        if (missingFields.length > 0) {
          console.error('❌ CRITICAL: challengeInfo missing required fields:', {
            missingFields,
            receivedChallengeInfo: result.challengeInfo,
            transactionId: result.transactionId
          });
          throw new Error(`Invalid SDK response: challengeInfo missing required fields: ${missingFields.join(', ')}`);
        }

        // Map SDK challengeInfo to provider result
        captureResult.threeDSUrl = result.challengeInfo.stepUpUrl;
        captureResult.challengeInfo = {
          stepUpUrl: result.challengeInfo.stepUpUrl,
          stepUpToken: result.challengeInfo.stepUpToken,
          acsUrl: result.challengeInfo.acsUrl,
          authenticationTransactionId: result.challengeInfo.authenticationTransactionId,
          threeDSServerTransactionId: result.challengeInfo.threeDSServerTransactionId,
          directoryServerTransactionId: result.challengeInfo.directoryServerTransactionId
        };

        console.log(`✅ 3DS challenge required - challengeInfo mapped successfully`);
      }

      // Include card enrollment status if available
      if (result.providerDetails?.authentication?.cardEnrolled !== undefined) {
        captureResult.cardEnrolled = result.providerDetails.authentication.cardEnrolled;
        console.log(`ℹ️  Card enrollment status: ${result.providerDetails.authentication.cardEnrolled}`);
      } else {
        console.log(`ℹ️  Card enrollment status not available from SDK`);
      }

      return captureResult;

    } catch (error) {
      console.error('Token capture failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error?.constructor?.name,
        brandkey,
        orderId: request.orderId,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: request.tokenType,
        stack: error instanceof Error ? error.stack : undefined
      });

      // Handle PaymentError from SDK with full context
      if (error instanceof PaymentError) {
        console.error('PaymentError details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          context: error.context
        });
        throw error; // Re-throw with full context
      }

      // Handle network/timeout errors
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED'))) {
        console.error('Network timeout calling payment provider');
        throw new Error('Payment provider timeout. Please retry the request.');
      }

      // Handle authentication errors
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403') || error.message.includes('Unauthorized'))) {
        console.error('CRITICAL: Authentication failed with payment provider. Check merchant credentials.');
        throw new Error('Payment provider authentication failed. Contact system administrator.');
      }

      // Handle credential configuration errors (from loadCredentialsForBrand)
      if (error instanceof Error && error.message.includes('Credential configuration error')) {
        throw error; // Re-throw with clear message
      }

      // Unknown error - throw with context
      throw error;
    }
  }

  async processValidateCapture(request: ValidateCaptureRequest, brandkey: string): Promise<ValidateCaptureResult> {
    console.log('🔄 Executing REAL validate-capture for brand:', brandkey);
    console.log('Environment variables:', {
      NODE_ENV: process.env.NODE_ENV || 'undefined',
      AWS_REGION: process.env.AWS_REGION || 'undefined'
    });

    console.log('Creating PaymentService instance for validate-capture...');

    const credentials = await loadCredentialsForBrand(brandkey);
    console.log(`Using Cybersource credentials: merchantID=${credentials.merchantID}, keyId=${credentials.merchantKeyId.substring(0, 8)}...`);

    const paymentService = new PaymentService('cybersource', {
      merchantID: credentials.merchantID,
      merchantKeyId: credentials.merchantKeyId,
      merchantsecretKey: credentials.merchantsecretKey
    });
    console.log('PaymentService instance created for validate-capture');

    const sdkPayload = this.mapValidateCaptureToSdkPayload(request);
    console.log('Validate-capture SDK payload:', JSON.stringify(sdkPayload, null, 2));

    try {
      console.log('Calling paymentValidateCapture...');
      const result = await paymentService.paymentValidateCapture(sdkPayload);
      console.log('Validate-capture SDK response:', JSON.stringify(result, null, 2));

      return {
        status: result.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'DECLINED',
        transactionId: result.transactionId || request.transactionId,
        authorizationCode: result.authorizationCode,
        provider: result.provider || 'CybersourceRestAPI',
        timestamp: result.timestamp || new Date().toISOString(),
        declineReason: result.declineReason
      };

    } catch (error) {
      console.error('Validate-capture failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error?.constructor?.name,
        brandkey,
        transactionId: request.transactionId,
        orderId: request.orderId,
        stack: error instanceof Error ? error.stack : undefined
      });

      // Re-throw PaymentError with full context
      if (error instanceof PaymentError) {
        console.error('PaymentError details:', {
          code: error.code,
          message: error.message,
          details: error.details
        });
        throw error;
      }

      // Wrap and re-throw other errors
      throw error;
    }
  }

  /**
   * Map token capture request to payments-sdk payload format
   */
  private mapTokenCaptureToSdkPayload(request: TokenCaptureRequest): any {
    return {
      orderId: request.orderId,
      amount: request.amount.toString(),
      currency: request.currency,
      paymentToken: request.paymentToken,
      tokenType: request.tokenType.toLowerCase().replace('_', ''), // 'transient_token' -> 'transienttoken'
      setupRecurring: request.setupRecurring || false,
      billTo: {
        firstName: request.billTo.firstName,
        lastName: request.billTo.lastName,
        email: request.billTo.email,
        phone: request.billTo.phone,
        address: {
          address1: request.billTo.address.address1,
          address2: request.billTo.address.address2,
          locality: request.billTo.address.locality,
          administrativeArea: request.billTo.address.administrativeArea,
          postalCode: request.billTo.address.postalCode,
          country: request.billTo.address.country
        }
      },
      ...(request.threeDSData && { threeDSData: request.threeDSData }),
      ...(request.deviceFingerprintId && { deviceFingerprintId: request.deviceFingerprintId }),
      ...(request.clientIp && { clientIp: request.clientIp }),
      ...(request.userAgent && { userAgent: request.userAgent })
    };
  }

  /**
   * Map validate-capture request to payments-sdk payload format
   */
  private mapValidateCaptureToSdkPayload(request: ValidateCaptureRequest): any {
    return {
      transactionId: request.transactionId,
      orderId: request.orderId,
      paymentToken: request.paymentToken,
      threeDSData: request.threeDSData
    };
  }
}
