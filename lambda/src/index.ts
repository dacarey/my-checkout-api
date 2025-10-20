import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// ========================================
// Type Definitions Aligned with Payment API v0.2.0
// ========================================

interface Money {
  amount: number;
  currencyCode: string;
}

/**
 * ISO 19160-compliant address structure from Payment API v0.2.0
 */
interface PaymentAddress {
  address1: string;
  address2?: string;
  locality: string;  // ISO 19160 term for city
  administrativeArea?: string;  // State/province
  postalCode: string;
  country: string;  // ISO 3166-1 alpha-2
}

/**
 * Billing contact information with nested address from Payment API v0.2.0
 */
interface BillingDetails {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address: PaymentAddress;
}

/**
 * 3DS Setup phase data
 */
interface ThreeDSSetupData {
  referenceId: string;
  authenticationInformation?: Record<string, any>;
}

/**
 * 3DS Completion phase data
 */
interface ThreeDSCompletionData {
  authenticationResult: 'Y' | 'N' | 'A' | 'U' | 'R';
  cavv?: string;
  eci?: string;
  xid?: string;
  paSpecificationVersion?: string;
  directoryServerTransactionId?: string;
  acsOperatorID?: string;
}

/**
 * Phase-based 3DS data structure from Payment API v0.2.0
 */
interface ThreeDSData {
  phase: 'setup' | 'completion';
  setup?: ThreeDSSetupData;
  completion?: ThreeDSCompletionData;
}

/**
 * Tokenised payment details aligned with Payment API v0.2.0
 */
interface TokenisedPaymentDetails {
  merchantId: string;
  paymentToken: string;
  tokenType: 'transient' | 'stored' | 'TRANSIENT' | 'STORED';  // Support both during alpha
  setupRecurring?: boolean;
  billTo: BillingDetails;  // NEW: nested structure
  threeDSData?: ThreeDSData;  // NEW: structured
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
  id: string;
  version: number;
  status: 'COMPLETED' | 'FAILED' | 'REQUIRES_3DS_VALIDATION';
  totalLineItems: number;
  totalItemQuantity: number;
  numberOfBottles: number;
  totalListPrice: Money;
  totalPrice: Money;
  customerId?: string;
  anonymousId?: string;
  responseCode?: string;
  paymentDetails: OrderPaymentDetail[];
  createdAt: string;
  lastModifiedAt: string;
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
// ========================================

/**
 * Detects which address structure is being used
 * Alpha-phase helper to support both old and new formats
 */
function detectAddressFormat(billTo: any): 'v0.4-nested' | 'v0.3-flat' | 'unknown' {
  if (billTo.address && billTo.address.locality) {
    return 'v0.4-nested';  // New Payment API aligned format
  } else if (billTo.city) {
    return 'v0.3-flat';  // Old flat format
  }
  return 'unknown';
}

/**
 * Extracts customer email from either old or new billTo structure
 * Demonstrates how to handle both formats gracefully
 */
function extractCustomerEmail(billTo: any): string | undefined {
  const format = detectAddressFormat(billTo);

  if (format === 'v0.4-nested') {
    // New format: email is at billTo.email
    return billTo.email;
  } else if (format === 'v0.3-flat') {
    // Old format: email is at billTo.email (same location!)
    return billTo.email;
  }
  return undefined;
}

/**
 * Extracts locality/city from either format
 * Demonstrates field name mapping
 */
function extractLocality(billTo: any): string | undefined {
  const format = detectAddressFormat(billTo);

  if (format === 'v0.4-nested') {
    // New format: nested address.locality
    return billTo.address?.locality;
  } else if (format === 'v0.3-flat') {
    // Old format: flat billTo.city
    return billTo.city;
  }
  return undefined;
}

/**
 * Normalizes tokenType to lowercase for internal processing
 * Accepts both uppercase (old) and lowercase (new) formats
 */
function normalizeTokenType(tokenType: string): 'transient' | 'stored' {
  return tokenType.toLowerCase() as 'transient' | 'stored';
}

/**
 * Checks if 3DS data is provided and structured correctly
 */
function hasStructuredThreeDSData(threeDSData: any): boolean {
  return threeDSData &&
         typeof threeDSData === 'object' &&
         'phase' in threeDSData &&
         (threeDSData.phase === 'setup' || threeDSData.phase === 'completion');
}

function createMockOrder(request: CheckoutDraft): Order {
  const timestamp = getCurrentTimestamp();
  const orderId = generateOrderId();

  // Check if this should be a 3DS scenario
  const totalAmount = request.payments.reduce((sum, p) => sum + p.amount.amount, 0);

  // NEW: Also check if structured 3DS data is present (indicates 3DS flow)
  const firstTokenisedPayment = request.payments.find(p => p.type === 'tokenised');
  const hasThreeDSSetup = firstTokenisedPayment?.tokenisedPayment?.threeDSData &&
                          hasStructuredThreeDSData(firstTokenisedPayment.tokenisedPayment.threeDSData);

  const requires3DS = totalAmount > 150 || hasThreeDSSetup;

  console.log('3DS Detection:', {
    totalAmount,
    hasThreeDSSetup,
    requires3DS,
    threeDSPhase: firstTokenisedPayment?.tokenisedPayment?.threeDSData?.phase
  });

  // Build payment details based on request
  const paymentDetails: OrderPaymentDetail[] = request.payments.map(payment => {
    if (payment.type === 'tokenised') {
      if (requires3DS) {
        // If 3DS setup data is provided with phase 'setup', return 3DS challenge required
        if (hasThreeDSSetup && firstTokenisedPayment?.tokenisedPayment?.threeDSData?.phase === 'setup') {
          console.log('Returning 3DS challenge required for setup phase');
          return {
            type: 'tokenised',
            amount: payment.amount,
            status: 'requires_3ds',
            tokenisedPaymentResult: {
              transactionId: generateTransactionId('auth'),
              threeDSUrl: 'https://3ds.psp.com/challenge/abc123',
              merchantReference: payment.tokenisedPayment?.merchantId || 'YOUR_MID'
            }
          };
        }
      }

      // Default: completed payment
      return {
        type: 'tokenised',
        amount: payment.amount,
        status: 'completed',
        tokenisedPaymentResult: {
          transactionId: generateTransactionId('auth'),
          authorisationCode: Math.floor(Math.random() * 900000 + 100000).toString(),
          merchantReference: payment.tokenisedPayment?.merchantId || 'YOUR_MID'
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

  const status = requires3DS ? 'REQUIRES_3DS_VALIDATION' : 'COMPLETED';

  return {
    id: orderId,
    version: 1,
    status,
    totalLineItems: 2,
    totalItemQuantity: 3,
    numberOfBottles: 36,
    totalListPrice: {
      amount: totalAmount + 10,
      currencyCode: request.payments[0].amount.currencyCode
    },
    totalPrice: {
      amount: totalAmount,
      currencyCode: request.payments[0].amount.currencyCode
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

    const request: CheckoutDraft = JSON.parse(event.body);

    // Basic validation
    if (!request.cartId || !request.version || !request.payments || request.payments.length === 0) {
      const error = createErrorResponse(400, 'BadRequest', 'Missing required fields: cartId, version, payments');
      return {
        statusCode: 400,
        headers: getCorsHeaders(),
        body: JSON.stringify(error)
      };
    }

    // NEW: Log request structure for debugging
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

      // Validation: Warn if using old format (in alpha, still accept it)
      if (format === 'v0.3-flat') {
        console.warn('ALPHA WARNING: Client using deprecated flat address structure. Expected nested BillingDetails format.');
      }

      // Validation: Warn if using uppercase token type
      if (firstTokenisedPayment.tokenisedPayment.tokenType === 'TRANSIENT' ||
          firstTokenisedPayment.tokenisedPayment.tokenType === 'STORED') {
        console.warn('ALPHA WARNING: Client using uppercase tokenType. Expected lowercase: transient, stored');
      }

      // Validation: Warn if 3DS data is unstructured
      if (firstTokenisedPayment.tokenisedPayment.threeDSData &&
          !hasStructuredThreeDSData(firstTokenisedPayment.tokenisedPayment.threeDSData)) {
        console.warn('ALPHA WARNING: Client using unstructured threeDSData. Expected phase-based structure.');
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

    // Generate mock order
    const order = createMockOrder(request);

    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: JSON.stringify(order)
    };

  } catch (error) {
    console.error('Error processing checkout:', error);

    const errorResponse = createErrorResponse(
      500,
      'InternalError',
      'Internal server error processing checkout'
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
