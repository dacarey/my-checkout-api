import { CheckoutApiClient } from '../client';
import { TokenCaptureRequest, ExampleResult, ExampleOptions, CardData } from '../types';
import { getCybersourceCredentials } from '../config';
import { TokenService } from '@dw-digital-commerce/payments-sdk/src/tokenService.js';

// Test card data for token generation (Cybersource test card)
const TEST_CARD_DATA: CardData = {
  number: '4111111111111111', // Visa test card
  expirationMonth: '12',
  expirationYear: '2031',
  securityCode: '123'
};

export async function tokenCaptureExample(options: ExampleOptions): Promise<ExampleResult> {
  const { config, verbose = false, timeout = 10000 } = options;
  const startTime = Date.now();

  const client = new CheckoutApiClient(config, { timeout, verbose });
  const endpoint = `/in-brand/${config.brandKey}/token/capture`;

  // Generate unique cart ID with timestamp
  const timestamp = Math.floor(Date.now() / 1000);
  const cartId = `cart-${timestamp}`;

  // Try to generate a real transient token using TokenService
  let paymentToken = 'tkn_test123'; // Fallback token
  let tokenGenerationNote = '';

  const credentials = getCybersourceCredentials();
  if (credentials) {
    try {
      if (verbose) {
        console.log('🔑 Generating transient token using TokenService...');
      }

      const tokenService = new TokenService('cybersource', credentials);
      paymentToken = await tokenService.generateTransientToken(TEST_CARD_DATA);

      if (verbose) {
        console.log('✅ Token generated successfully');
        console.log(`   Token (first 20 chars): ${paymentToken.substring(0, 20)}...`);
      }
      tokenGenerationNote = 'Real token generated via TokenService';
    } catch (tokenError) {
      if (verbose) {
        console.warn('⚠️  Token generation failed, using fallback token');
        console.warn(`   Error: ${tokenError instanceof Error ? tokenError.message : 'Unknown error'}`);
      }
      tokenGenerationNote = `Token generation failed: ${tokenError instanceof Error ? tokenError.message : 'Unknown error'}. Using fallback token.`;
    }
  } else {
    if (verbose) {
      console.warn('⚠️  Cybersource credentials not configured, using fallback token');
    }
    tokenGenerationNote = 'Cybersource credentials not configured. Using fallback token.';
  }

  // Match CheckoutDraft schema from OpenAPI spec
  const requestData: any = {
    cartId,
    version: 1,
    payments: [
      {
        type: 'tokenised',
        amount: {
          currencyCode: 'GBP',
          value: 159.99
        },
        tokenisedPayment: {
          paymentToken: paymentToken,
          tokenType: 'transient',
          setupRecurring: false,
          billTo: {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
            phone: '+442071234567',
            address: {
              address1: '123 Test Street',
              locality: 'London',
              postalCode: 'SW1A 1AA',
              country: 'GB'
            }
          },
          threeDSData: {
            phase: 'setup',
            setup: {
              referenceId: '3ds-ref-12345',
              deviceCollectionInfo: {
                browserAcceptHeader: 'text/html,application/xhtml+xml',
                browserLanguage: 'en-GB',
                browserScreenHeight: 1080,
                browserScreenWidth: 1920,
                browserTimeZone: 0,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            }
          },
          deviceFingerprintId: 'device-fp-' + timestamp
        }
      }
    ]
  };

  // Generate idempotency key with timestamp
  const idempotencyKey = `test-${timestamp}`;
  const headers = {
    'Idempotency-Key': idempotencyKey
  };

  try {
    const response = await client.post(endpoint, requestData, headers);

    const duration = Date.now() - startTime;
    const success = response.statusCode === 201 || response.statusCode === 202;

    const result: ExampleResult = {
      name: 'Token Capture',
      endpoint: `POST ${endpoint}`,
      success,
      statusCode: response.statusCode,
      response: response.data || response.error,
      duration,
      request: requestData,
      headers
    };

    if (!success && response.error) {
      result.error = response.error;
    }

    // Add token generation note if verbose or if there was an issue
    if (verbose && tokenGenerationNote) {
      console.log(`ℹ️  ${tokenGenerationNote}`);
    }

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      name: 'Token Capture',
      endpoint: `POST ${endpoint}`,
      success: false,
      statusCode: 0,
      response: null,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      duration,
      request: requestData,
      headers
    };
  }
}

/**
 * Example usage and documentation for the Token Capture endpoint
 *
 * This example demonstrates how to capture a payment using a payment token.
 * It includes TokenService integration to generate real transient tokens.
 *
 * Token Generation:
 * - If Cybersource credentials are configured, generates a real transient token using TokenService
 * - Credentials required: CYBS_MERCHANT_ID, CYBS_KEY_ID, CYBS_SECRET_KEY
 * - Falls back to test token 'tkn_test123' if credentials not available
 * - Uses Visa test card (4111111111111111) for token generation
 *
 * Expected behavior:
 * - 201 Created: Payment authorized successfully
 * - 202 Accepted: 3DS authentication required (returns challengeInfo)
 * - 400 Bad Request: Payment declined
 *
 * Request structure:
 * - cartId: Unique cart identifier
 * - totalPrice: Money object containing amount (number) and currencyCode (string)
 * - paymentToken: Token representing payment method (generated via TokenService or fallback)
 * - tokenType: Type of token ('transient_token' for one-time use)
 * - billingAddress: Customer billing information with nested address structure
 * - threeDSData: 3DS setup phase data with device collection info
 */
export const tokenCaptureDocumentation = {
  description: 'Capture a payment using a payment token (may trigger 3DS)',
  endpoint: 'POST /checkout/in-brand/{brandkey}/token/capture',
  authentication: 'Required (GlobalAuthoriser)',
  contentType: 'application/json',

  parameters: {
    path: {
      brandkey: 'Brand identifier (e.g., uklait, us4s, auwp)'
    },
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'Unique key to prevent duplicate requests'
    }
  },

  requestBody: {
    cartId: 'string - Unique cart identifier',
    totalPrice: {
      amount: 'number - Payment amount (e.g., 159.99)',
      currencyCode: 'string - ISO 4217 currency code (e.g., GBP, USD)'
    },
    paymentToken: 'string - Payment method token (real transient token from TokenService)',
    tokenType: 'string - Token type (transient_token, payment_instrument)',
    billingAddress: {
      firstName: 'string - Customer first name',
      lastName: 'string - Customer last name',
      email: 'string - Customer email address',
      phone: 'string - Customer phone number (optional)',
      address: {
        address1: 'string - Street address',
        address2: 'string - Address line 2 (optional)',
        locality: 'string - City name',
        administrativeArea: 'string - State/province (optional)',
        postalCode: 'string - Postal/ZIP code',
        country: 'string - ISO 3166-1 country code'
      }
    }
  },

  responses: {
    201: 'Created - Payment authorized successfully',
    202: 'Accepted - 3DS challenge required (includes challengeInfo)',
    400: 'Bad Request - Payment declined',
    500: 'Internal Server Error - Processing error'
  }
};
