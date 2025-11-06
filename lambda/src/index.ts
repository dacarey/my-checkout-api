/**
 * Checkout API Lambda Handler
 *
 * Main entry point for AWS Lambda function handling checkout API requests.
 * Routes requests to specialized handlers for token-capture and validate-capture.
 *
 * Endpoints:
 * - POST /checkout/me/token/capture - Capture payment with token (may trigger 3DS)
 * - POST /checkout/me/3ds/validate-capture - Complete payment after 3DS challenge
 * - POST /checkout/in-brand/{brandkey}/token/capture - Brand-specific token capture
 * - POST /checkout/in-brand/{brandkey}/3ds/validate-capture - Brand-specific validate capture
 *
 * Environment Variables:
 * - USE_REAL_PAYMENT_PROVIDER: 'true' for real Cybersource, 'false' for mock
 * - PAYMENT_CREDENTIALS_SECRET: AWS Secrets Manager secret name
 * - DEFAULT_BRANDKEY: Default brand if not specified in path (default: 'uklait')
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handleTokenCapture } from './handlers/token-capture-handler';
import { handleValidateCapture } from './handlers/validate-capture-handler';

/**
 * Main Lambda handler
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('🚀 Checkout API Lambda invoked:', {
    method: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters,
    resource: event.resource,
    requestId: event.requestContext.requestId
  });

  const path = event.path;
  const method = event.httpMethod;

  // Extract brandkey from path parameters or JWT authorizer context, or use default
  const brandkey = extractBrandKey(event);
  console.log(`📍 Brand key: ${brandkey}`);

  try {
    // Handle OPTIONS for CORS preflight
    if (method === 'OPTIONS') {
      return handleOptions();
    }

    // Parse request body
    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch (parseError) {
        console.error('❌ Failed to parse request body:', parseError);
        return {
          statusCode: 400,
          headers: getCorsHeaders(),
          body: JSON.stringify({
            error: 'invalid_request',
            message: 'Request body must be valid JSON',
            timestamp: new Date().toISOString()
          })
        };
      }
    }

    // Route to handlers based on path
    if (method === 'POST') {
      // Token capture endpoints
      if (path.includes('/token/capture')) {
        const result = await handleTokenCapture(body, brandkey, event.headers);
        return {
          statusCode: result.statusCode,
          headers: getCorsHeaders(),
          body: result.body
        };
      }

      // 3DS validate-capture endpoints
      if (path.includes('/3ds/validate-capture')) {
        const result = await handleValidateCapture(body, brandkey);
        return {
          statusCode: result.statusCode,
          headers: getCorsHeaders(),
          body: result.body
        };
      }
    }

    // Unknown endpoint
    console.log('❌ Endpoint not found:', { method, path });
    return {
      statusCode: 404,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        error: 'not_found',
        message: `Endpoint not found: ${method} ${path}`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('❌ Lambda handler error:', error);

    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        error: 'internal_error',
        message: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      })
    };
  }
};

/**
 * Extract brand key from event
 * Priority: Path parameter > Authorizer context > Environment variable default
 */
function extractBrandKey(event: APIGatewayProxyEvent): string {
  // Try path parameter first (for /in-brand/{brandkey} routes)
  if (event.pathParameters?.brandkey) {
    return event.pathParameters.brandkey;
  }

  // Try authorizer context (from JWT claims)
  if (event.requestContext.authorizer?.brandkey) {
    return event.requestContext.authorizer.brandkey as string;
  }

  // Fall back to environment variable
  return process.env.DEFAULT_BRANDKEY || 'uklait';
}

/**
 * Handle OPTIONS requests for CORS preflight
 */
function handleOptions(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      ...getCorsHeaders(),
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key,X-Idempotency-Key'
    },
    body: ''
  };
}

/**
 * Get CORS headers for responses
 */
function getCorsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key,X-Idempotency-Key',
    'Strict-Transport-Security': 'max-age=63072000; includeSubdomains'
  };
}
