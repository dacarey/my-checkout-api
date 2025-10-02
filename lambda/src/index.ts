import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// ========================================
// Type Definitions from OpenAPI Spec
// ========================================

interface Money {
  amount: number;
  currencyCode: string;
}

interface Address {
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  postalCode: string;
  country: string;
  email: string;
  phone?: string;
}

interface TokenisedPaymentDetails {
  merchantId: string;
  paymentToken: string;
  tokenType: 'TRANSIENT' | 'STORED';
  setupRecurring?: boolean;
  billTo: Address;
  threeDSData?: Record<string, any>;
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
  billingAddress?: Address;
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

function createMockOrder(request: CheckoutDraft): Order {
  const timestamp = getCurrentTimestamp();
  const orderId = generateOrderId();

  // Check if this should be a 3DS scenario (e.g., if amount > 150)
  const totalAmount = request.payments.reduce((sum, p) => sum + p.amount.amount, 0);
  const requires3DS = totalAmount > 150;

  // Build payment details based on request
  const paymentDetails: OrderPaymentDetail[] = request.payments.map(payment => {
    if (payment.type === 'tokenised') {
      if (requires3DS) {
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
      } else {
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
      }
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
