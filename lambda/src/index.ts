import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// ========================================
// Type Definitions Aligned with Payment API v0.2.0
// ========================================

interface Money {
  readonly amount: number;
  readonly currencyCode: string;
}

/**
 * ISO 19160-compliant address structure from Payment API v0.2.0
 *
 * ISO 19160 is the international addressing standard that provides globally
 * consistent terminology. Key differences from informal structures:
 * - Uses 'locality' instead of 'city' (more precise for international addresses)
 * - 'administrativeArea' instead of 'state/province' (country-agnostic)
 * - 'country' uses ISO 3166-1 alpha-2 codes (e.g., 'GB', 'US')
 */
interface PaymentAddress {
  readonly address1: string;
  readonly address2?: string;
  readonly locality: string;  // ISO 19160 term for city
  readonly administrativeArea?: string;  // State/province
  readonly postalCode: string;
  readonly country: string;  // ISO 3166-1 alpha-2
}

/**
 * Legacy flat address structure from v0.3.x (DEPRECATED)
 *
 * @deprecated This format will be removed in v0.5.0 (target: Q1 2026)
 * Use PaymentAddress with nested BillingDetails instead
 */
interface LegacyAddress {
  readonly firstName: string;
  readonly lastName: string;
  readonly address1: string;
  readonly city: string;  // Old format - use 'locality' in new format
  readonly postalCode: string;
  readonly country: string;
  readonly email?: string;
  readonly phone?: string;
}

/**
 * Billing contact information with nested address from Payment API v0.2.0
 */
interface BillingDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address: PaymentAddress;
}

/**
 * 3DS Setup phase data
 */
interface ThreeDSSetupData {
  readonly referenceId: string;
  readonly authenticationInformation?: Record<string, any>;
}

/**
 * 3DS Completion phase data
 */
interface ThreeDSCompletionData {
  readonly authenticationResult: 'Y' | 'N' | 'A' | 'U' | 'R';
  readonly cavv?: string;
  readonly eci?: string;
  readonly xid?: string;
  readonly paSpecificationVersion?: string;
  readonly directoryServerTransactionId?: string;
  readonly acsOperatorID?: string;
}

/**
 * Phase-based 3DS data structure from Payment API v0.2.0
 *
 * Uses discriminated union to make illegal states unrepresentable:
 * - If phase is 'setup', setup data MUST be present
 * - If phase is 'completion', completion data MUST be present
 * - Cannot have both setup and completion simultaneously
 */
type ThreeDSData =
  | { readonly phase: 'setup'; readonly setup: ThreeDSSetupData }
  | { readonly phase: 'completion'; readonly completion: ThreeDSCompletionData };

/**
 * 3DS Authentication Required response for HTTP 202
 */
interface ThreeDSAuthenticationRequired {
  readonly authenticationId: string;
  readonly cartId: string;
  readonly threeDSUrl: string;
  readonly transactionId: string;
  readonly paymentContext: {
    readonly amount: Money;
    readonly merchantId: string;
  };
  readonly nextAction: 'complete_3ds_authentication';
}

/**
 * Tokenised payment details aligned with Payment API v0.2.0
 *
 * @param tokenType - Token type (lowercase 'transient' or 'stored')
 * Note: During alpha, uppercase values are normalized to lowercase for backward compatibility
 * TODO(v0.5.0): Remove uppercase support after alpha sunset (target: Q1 2026)
 */
interface TokenisedPaymentDetails {
  readonly merchantId: string;
  readonly paymentToken: string;
  readonly tokenType: 'transient' | 'stored';  // Normalized to lowercase only
  readonly setupRecurring?: boolean;
  readonly billTo: BillingDetails;
  readonly threeDSData?: ThreeDSData;
}

interface GiftVoucherPaymentDetails {
  voucherCode: string;
  pin?: string;
}

interface StoredPaymentDetails {
  paymentMethod: 'giftvoucher';
  giftVoucherDetails?: GiftVoucherPaymentDetails;
}

interface Payment {
  type: 'tokenised' | 'stored';
  amount: Money;
  tokenisedPayment?: TokenisedPaymentDetails;
  storedPayment?: StoredPaymentDetails;
}

interface CheckoutDraft {
  cartId: string;
  version: number;
  payments: Payment[];
}

interface TokenisedPaymentResult {
  transactionId: string;
  authorisationCode?: string;
  threeDSUrl?: string;
  merchantReference?: string;
}

interface StoredPaymentResult {
  paymentMethod: 'giftvoucher';
  transactionId: string;
  remainingBalance?: Money;
}

interface OrderPaymentDetail {
  type: 'tokenised' | 'stored';
  amount: Money;
  status: 'completed' | 'failed' | 'requires_3ds';
  tokenisedPaymentResult?: TokenisedPaymentResult;
  storedPaymentResult?: StoredPaymentResult;
}

interface Order {
  readonly id: string;
  readonly version: number;
  readonly status: 'COMPLETED' | 'FAILED';  // 3DS scenarios return 202 with ThreeDSAuthenticationRequired
  readonly totalLineItems: number;
  readonly totalItemQuantity: number;
  readonly numberOfBottles: number;
  readonly totalListPrice: Money;
  readonly totalPrice: Money;
  readonly customerId?: string;
  readonly anonymousId?: string;
  readonly responseCode?: string;
  readonly paymentDetails: OrderPaymentDetail[];
  readonly createdAt: string;
  readonly lastModifiedAt: string;
}

interface CheckoutValidationMessage {
  code: string;
  message: string;
}

interface LineItemCheckoutValidation extends CheckoutValidationMessage {
  lineItemId: string;
}

interface CheckoutValidations {
  orderLevel: CheckoutValidationMessage[];
  lineItemLevel: LineItemCheckoutValidation[];
}

interface ErrorMessage {
  code: string;
  message: string;
  type?: string;
  id?: string;
}

interface ErrorMessageResponse {
  statusCode: number;
  message: string;
  errors: ErrorMessage[];
}

// ========================================
// Mock Response Generators
// ========================================

function generateOrderId(): string {
  return `order-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateTransactionId(prefix: string = 'txn'): string {
  return `${prefix}_${Date.now()}${Math.random().toString(36).substring(2, 9)}`;
}

function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

// ========================================
// Structure Detection and Normalization
// TODO(v0.5.0): Remove backward compatibility helpers after alpha sunset (target: Q1 2026)
// ========================================

/**
 * Detects which address structure format is being used in a billTo object.
 *
 * This is a temporary alpha-phase helper function to support graceful degradation
 * during the v0.3.x to v0.4.x migration period.
 *
 * @param billTo - The billing details object from TokenisedPaymentDetails
 * @returns 'v0.4-nested' if using new PaymentBillingDetails structure with address.locality,
 *          'v0.3-flat' if using deprecated flat structure with city field,
 *          'unknown' if structure doesn't match either format
 *
 * @deprecated Target removal: v0.5.0 (after alpha sunset, Q1 2026)
 */
function detectAddressFormat(billTo: BillingDetails | LegacyAddress | any): 'v0.4-nested' | 'v0.3-flat' | 'unknown' {
  if (!billTo || typeof billTo !== 'object') {
    console.error('Invalid billTo parameter: expected object, received:', typeof billTo);
    return 'unknown';
  }

  if ('address' in billTo && billTo.address && typeof billTo.address === 'object' && 'locality' in billTo.address) {
    return 'v0.4-nested';  // New Payment API aligned format
  } else if ('city' in billTo) {
    return 'v0.3-flat';  // Old flat format (deprecated)
  }
  return 'unknown';
}

/**
 * Extracts customer email from either v0.4 nested or v0.3 flat billTo structure.
 *
 * @param billTo - The billing details object
 * @returns Email address if present, undefined otherwise
 *
 * @deprecated Target removal: v0.5.0 (after alpha sunset, Q1 2026)
 */
function extractCustomerEmail(billTo: BillingDetails | LegacyAddress | any): string | undefined {
  if (!billTo || typeof billTo !== 'object') {
    console.error('Cannot extract email: invalid billTo parameter', { billTo });
    return undefined;
  }

  const format = detectAddressFormat(billTo);

  if (format === 'v0.4-nested' || format === 'v0.3-flat') {
    const email = billTo.email;
    if (email && typeof email === 'string') {
      return email;
    }
    if (email !== undefined) {
      console.warn('Email field exists but is not a valid string', { emailType: typeof email });
    }
    return undefined;
  }

  console.warn('Cannot extract email: unknown address format', { billTo });
  return undefined;
}

/**
 * Extracts locality/city from either v0.4 nested or v0.3 flat format.
 * Maps 'city' (v0.3) to 'locality' (v0.4) for consistent processing.
 *
 * @param billTo - The billing details object
 * @returns Locality/city string if present, undefined otherwise
 *
 * @deprecated Target removal: v0.5.0 (after alpha sunset, Q1 2026)
 */
function extractLocality(billTo: BillingDetails | LegacyAddress | any): string | undefined {
  if (!billTo || typeof billTo !== 'object') {
    console.error('Cannot extract locality: invalid billTo parameter', { billTo });
    return undefined;
  }

  const format = detectAddressFormat(billTo);

  if (format === 'v0.4-nested') {
    const locality = billTo.address?.locality;
    if (!locality) {
      console.warn('v0.4 format detected but address.locality is missing', { address: billTo.address });
    }
    return typeof locality === 'string' ? locality : undefined;
  } else if (format === 'v0.3-flat') {
    const city = billTo.city;
    if (!city) {
      console.warn('v0.3 format detected but city is missing');
    }
    return typeof city === 'string' ? city : undefined;
  }

  console.warn('Cannot extract locality: unknown address format', { billTo });
  return undefined;
}

/**
 * Normalizes tokenType to lowercase for internal processing.
 * Accepts both uppercase (v0.3 deprecated) and lowercase (v0.4 standard) formats.
 *
 * @param tokenType - Token type string (case-insensitive)
 * @returns Normalized lowercase token type
 * @throws Error if tokenType is invalid
 *
 * @deprecated Target removal: v0.5.0 - After alpha, only lowercase will be accepted
 */
function normalizeTokenType(tokenType: string): 'transient' | 'stored' {
  if (!tokenType || typeof tokenType !== 'string') {
    console.error('Invalid tokenType: expected string, received:', typeof tokenType);
    throw new Error(`Invalid tokenType: expected string, received ${typeof tokenType}`);
  }

  const normalized = tokenType.toLowerCase();

  if (normalized !== 'transient' && normalized !== 'stored') {
    console.error('Invalid tokenType value:', tokenType);
    throw new Error(`Invalid tokenType: expected 'transient' or 'stored', received '${tokenType}'`);
  }

  return normalized;
}

/**
 * Validates that 3DS data is properly structured with required phase and corresponding data.
 * Now checks for complete structure based on discriminated union type.
 *
 * @param threeDSData - The 3DS data to validate
 * @returns true if valid structured 3DS data, false otherwise
 */
function hasStructuredThreeDSData(threeDSData: any): threeDSData is ThreeDSData {
  if (!threeDSData || typeof threeDSData !== 'object') {
    return false;
  }

  if (!('phase' in threeDSData)) {
    return false;
  }

  if (threeDSData.phase === 'setup') {
    if (!threeDSData.setup || typeof threeDSData.setup !== 'object') {
      console.warn('3DS phase is "setup" but setup data is missing or invalid', { threeDSData });
      return false;
    }
    if (!threeDSData.setup.referenceId) {
      console.warn('3DS setup data missing required referenceId', { setup: threeDSData.setup });
      return false;
    }
    return true;
  }

  if (threeDSData.phase === 'completion') {
    if (!threeDSData.completion || typeof threeDSData.completion !== 'object') {
      console.warn('3DS phase is "completion" but completion data is missing or invalid', { threeDSData });
      return false;
    }
    if (!threeDSData.completion.authenticationResult) {
      console.warn('3DS completion data missing required authenticationResult', { completion: threeDSData.completion });
      return false;
    }
    return true;
  }

  console.warn('3DS phase is invalid (expected "setup" or "completion")', { phase: threeDSData.phase });
  return false;
}

/**
 * Checks if any tokenised payment requires 3DS authentication.
 * Scans ALL tokenised payments, not just the first one.
 *
 * 3DS is required if:
 * 1. Total amount exceeds 150 (SCA requirement simulation), OR
 * 2. Any tokenised payment includes structured 3DS setup data
 *
 * @param request - The checkout request
 * @returns Object containing 3DS requirement status and the first payment needing 3DS
 */
function check3DSRequirement(request: CheckoutDraft): {
  requires3DS: boolean;
  threeDSPayment?: Payment;
  totalAmount: number;
} {
  const totalAmount = request.payments.reduce((sum, p) => sum + p.amount.amount, 0);

  // Check ALL tokenised payments for 3DS setup data
  const threeDSPayment = request.payments.find(p =>
    p.type === 'tokenised' &&
    p.tokenisedPayment?.threeDSData &&
    hasStructuredThreeDSData(p.tokenisedPayment.threeDSData) &&
    p.tokenisedPayment.threeDSData.phase === 'setup'
  );

  const requires3DS = totalAmount > 150 || threeDSPayment !== undefined;

  console.log('3DS Detection:', {
    totalAmount,
    has3DSSetupData: threeDSPayment !== undefined,
    requires3DS,
    threeDSPhase: threeDSPayment?.tokenisedPayment?.threeDSData?.phase
  });

  return { requires3DS, threeDSPayment, totalAmount };
}

/**
 * Creates a 3DS authentication required response (HTTP 202)
 */
function create3DSAuthenticationResponse(request: CheckoutDraft, payment: Payment): ThreeDSAuthenticationRequired {
  const transactionId = generateTransactionId('auth');
  const authenticationId = generateTransactionId('3ds');

  return {
    authenticationId,
    cartId: request.cartId,
    threeDSUrl: 'https://3ds.psp.com/challenge/abc123',
    transactionId,
    paymentContext: {
      amount: payment.amount,
      paymentMethod: 'tokenised'
    },
    nextAction: 'redirect_to_url',
    redirectToUrl: {
      url: 'https://3ds.psp.com/challenge/abc123',
      method: 'POST',
      returnUrl: 'https://merchant.example.com/checkout/3ds-return'
    }
  };
}

/**
 * Creates a completed order (HTTP 201)
 */
function createCompletedOrder(request: CheckoutDraft): Order {
  const timestamp = getCurrentTimestamp();
  const orderId = generateOrderId();
  const totalAmount = request.payments.reduce((sum, p) => sum + p.amount.amount, 0);

  // Defensive check: ensure payments array exists and is not empty
  if (!request.payments || request.payments.length === 0) {
    console.error('createCompletedOrder called with empty payments array');
    throw new Error('Cannot create order: payments array is empty');
  }

  // Build payment details - all completed successfully
  const paymentDetails: OrderPaymentDetail[] = request.payments.map(payment => {
    if (payment.type === 'tokenised') {
      return {
        type: 'tokenised',
        amount: payment.amount,
        status: 'completed',
        tokenisedPaymentResult: {
          transactionId: generateTransactionId('auth'),
          authorisationCode: Math.floor(Math.random() * 900000 + 100000).toString(),
          merchantReference: 'YOUR_MID'  // Mock value - real implementation would use actual merchant config
        }
      };
    } else {
      // stored payment (gift voucher)
      return {
        type: 'stored',
        amount: payment.amount,
        status: 'completed',
        storedPaymentResult: {
          paymentMethod: 'giftvoucher',
          transactionId: generateTransactionId('gv'),
          remainingBalance: {
            amount: Math.max(0, 50 - payment.amount.amount),
            currencyCode: payment.amount.currencyCode
          }
        }
      };
    }
  });

  // Safe array access with validation
  const firstPayment = request.payments[0];
  if (!firstPayment?.amount?.currencyCode) {
    console.error('First payment missing currency code');
    throw new Error('Cannot create order: first payment missing currency information');
  }

  const currencyCode = firstPayment.amount.currencyCode;

  return {
    id: orderId,
    version: 1,
    status: 'COMPLETED',
    totalLineItems: 2,
    totalItemQuantity: 3,
    numberOfBottles: 36,
    totalListPrice: {
      amount: totalAmount + 10,
      currencyCode
    },
    totalPrice: {
      amount: totalAmount,
      currencyCode
    },
    customerId: 'c1e2d3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f',
    responseCode: 'VAJ1C',
    paymentDetails,
    createdAt: timestamp,
    lastModifiedAt: timestamp
  };
}

function createValidationError(scenario: string = 'default'): CheckoutValidations {
  if (scenario === 'version-mismatch') {
    return {
      orderLevel: [
        {
          code: 'CartVersionMismatch',
          message: 'Cart version 1 expected, but current version is 2. Cart was modified after checkout initiated.'
        }
      ],
      lineItemLevel: []
    };
  } else if (scenario === 'out-of-stock') {
    return {
      orderLevel: [],
      lineItemLevel: [
        {
          code: 'ItemOutOfStock',
          message: "Only 15 units of 'The Black Stump Durif Shiraz 2021' are available, but 24 were requested.",
          lineItemId: 'e64c4dc9-ec1a-4d63-b96f-9ab1ac99f1a1'
        }
      ]
    };
  } else {
    return {
      orderLevel: [
        {
          code: 'PaymentAmountMismatch',
          message: 'Payment total does not match cart total.'
        }
      ],
      lineItemLevel: []
    };
  }
}

function createErrorResponse(statusCode: number, code: string, message: string): ErrorMessageResponse {
  return {
    statusCode,
    message,
    errors: [
      {
        code,
        message,
        type: 'checkout',
        id: generateTransactionId('err')
      }
    ]
  };
}

// ========================================
// Route Handlers
// ========================================

function handleCaptureOrder(event: APIGatewayProxyEvent, brandkey?: string): APIGatewayProxyResult {
  console.log('Processing order capture:', {
    path: event.path,
    method: event.httpMethod,
    brandkey,
    body: event.body
  });

  try {
    // Parse and validate request
    if (!event.body) {
      const error = createErrorResponse(400, 'BadRequest', 'Request body is required');
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify(error)
      };
    }

    // Parse JSON with better error handling
    let request: CheckoutDraft;
    try {
      request = JSON.parse(event.body);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      const error = createErrorResponse(400, 'BadRequest', 'Invalid JSON in request body');
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify(error)
      };
    }

    // Basic validation
    if (!request.cartId || !request.version || !request.payments || request.payments.length === 0) {
      const error = createErrorResponse(400, 'BadRequest', 'Missing required fields: cartId, version, payments');
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify(error)
      };
    }

    // Validate and normalize tokenised payments
    // TEMPORARY: Support both old (v0.3) and new (v0.4) formats during alpha migration
    // SUNSET: Q1 2026 - Remove backward compatibility after all clients migrate to v0.4
    const firstTokenisedPayment = request.payments.find(p => p.type === 'tokenised');
    if (firstTokenisedPayment?.tokenisedPayment) {
      const billTo = firstTokenisedPayment.tokenisedPayment.billTo;
      const format = detectAddressFormat(billTo);

      console.log('Request structure detected:', {
        addressFormat: format,
        tokenType: firstTokenisedPayment.tokenisedPayment.tokenType,
        hasStructuredThreeDS: hasStructuredThreeDSData(firstTokenisedPayment.tokenisedPayment.threeDSData),
        locality: extractLocality(billTo),
        email: extractCustomerEmail(billTo)
      });

      // Reject unknown address formats with 400 error (Priority 2)
      if (format === 'unknown') {
        console.error('Invalid address structure: neither v0.4 nested nor v0.3 flat format');
        const error = createErrorResponse(
          400,
          'InvalidAddressFormat',
          'Invalid address structure. Expected nested BillingDetails with address object (v0.4) or flat address structure (v0.3 deprecated).'
        );
        return {
          statusCode: 400,
          headers: getCorsHeaders(),
          body: JSON.stringify(error)
        };
      }

      // Warn if using old format (in alpha, still accept it)
      if (format === 'v0.3-flat') {
        console.warn('ALPHA WARNING: Client using deprecated flat address structure. Expected nested BillingDetails format. Support ends Q1 2026.');
      }

      // Validate tokenType (Priority 2)
      // TEMPORARY: Accept both uppercase (v0.3) and lowercase (v0.4) during alpha
      // SUNSET: Q1 2026 - Only accept lowercase after migration period
      const tokenType = firstTokenisedPayment.tokenisedPayment.tokenType;
      try {
        // Validate tokenType - normalizeTokenType will throw if invalid
        const normalizedTokenType = normalizeTokenType(tokenType);

        // Log warning if client is using deprecated uppercase format
        if (tokenType !== normalizedTokenType) {
          console.warn(`ALPHA WARNING: Client using uppercase tokenType '${tokenType}'. Please update to lowercase '${normalizedTokenType}'. Support for uppercase ends Q1 2026.`);
        }
      } catch (normalizationError) {
        console.error('TokenType validation failed:', normalizationError);
        const error = createErrorResponse(
          400,
          'InvalidTokenType',
          `Invalid tokenType: ${normalizationError instanceof Error ? normalizationError.message : 'Unknown error'}`
        );
        return {
          statusCode: 400,
          headers: getCorsHeaders(),
          body: JSON.stringify(error)
        };
      }

      // Validate 3DS data structure if present
      if (firstTokenisedPayment.tokenisedPayment.threeDSData &&
          !hasStructuredThreeDSData(firstTokenisedPayment.tokenisedPayment.threeDSData)) {
        console.warn('ALPHA WARNING: Client using unstructured threeDSData. Expected phase-based structure with discriminator. Support for unstructured data ends Q1 2026.');
      }
    }

    // Check for version mismatch scenario (if version is 999, trigger validation error)
    if (request.version === 999) {
      const validations = createValidationError('version-mismatch');
      return {
        statusCode: 422,
        headers: getCorsHeaders(),
        body: JSON.stringify(validations)
      };
    }

    // Check for out-of-stock scenario (if cartId contains 'outofstock')
    if (request.cartId.toLowerCase().includes('outofstock')) {
      const validations = createValidationError('out-of-stock');
      return {
        statusCode: 422,
        headers: getCorsHeaders(),
        body: JSON.stringify(validations)
      };
    }

    // Check if 3DS authentication is required (Priority 1)
    // Checks ALL tokenised payments for structured 3DS setup data
    const threeDSCheck = check3DSRequirement(request);

    console.log('3DS Detection:', {
      totalAmount: threeDSCheck.totalAmount,
      hasThreeDSSetup: threeDSCheck.threeDSPayment !== undefined,
      requires3DS: threeDSCheck.requires3DS,
      threeDSPhase: threeDSCheck.threeDSPayment?.tokenisedPayment?.threeDSData?.phase
    });

    // Priority 1: Return 202 Accepted for 3DS authentication flow
    if (threeDSCheck.requires3DS && threeDSCheck.threeDSPayment) {
      console.log('Returning 3DS challenge required for setup phase');
      const authResponse = create3DSAuthenticationResponse(request, threeDSCheck.threeDSPayment);

      return {
        statusCode: 202, // HTTP 202 Accepted - authentication required
        headers: getCorsHeaders(),
        body: JSON.stringify(authResponse)
      };
    }

    // Priority 1: Return 201 Created with Location header for successful order
    const order = createCompletedOrder(request);
    const orderId = order.id;
    const locationPath = brandkey
      ? `/checkout/in-brand/${brandkey}/orders/${orderId}`
      : `/checkout/me/orders/${orderId}`;

    return {
      statusCode: 201, // HTTP 201 Created
      headers: {
        ...getCorsHeaders(),
        'Location': locationPath // REST-compliant Location header
      },
      body: JSON.stringify(order)
    };

  } catch (error) {
    console.error('Error processing checkout:', error);

    const errorResponse = createErrorResponse(
      500,
      'InternalError',
      `Internal server error processing checkout: ${error instanceof Error ? error.message : 'Unknown error'}`
    );

    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify(errorResponse)
    };
  }
}

function handleOptions(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      ...getCorsHeaders(),
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key'
    },
    body: ''
  };
}

function getCorsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key',
    'Strict-Transport-Security': 'max-age=63072000; includeSubdomains'
  };
}

// ========================================
// Main Handler
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Checkout API Lambda invoked:', {
    method: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters,
    resource: event.resource
  });

  const method = event.httpMethod;
  const path = event.path;

  // Handle OPTIONS for CORS preflight
  if (method === 'OPTIONS') {
    return handleOptions();
  }

  // Handle POST requests
  if (method === 'POST') {
    // Check if this is a /me endpoint or /in-brand endpoint
    if (path.includes('/me/token/capture')) {
      return handleCaptureOrder(event);
    } else if (path.match(/\/in-brand\/[^/]+\/token\/capture/)) {
      const brandkey = event.pathParameters?.brandkey;
      return handleCaptureOrder(event, brandkey);
    }
  }

  // Unknown route
  const error = createErrorResponse(404, 'NotFound', 'Endpoint not found');
  return {
    statusCode: 404,
    headers: getCorsHeaders(),
    body: JSON.stringify(error)
  };
};
