import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

interface CheckoutRequest {
  orderId: string;
  amount: string;
  currency: string;
  paymentToken?: string;
  customerEmail?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received checkout request:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    const body: CheckoutRequest = event.body ? JSON.parse(event.body) : {};

    // Validate required fields
    if (!body.orderId || !body.amount || !body.currency) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: orderId, amount, currency'
        })
      };
    }

    // Generate transaction ID
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Simulate checkout processing
    console.log(`Processing checkout for order ${body.orderId}, amount ${body.amount} ${body.currency}`);

    // Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        orderId: body.orderId,
        transactionId: transactionId,
        message: 'Checkout processed successfully'
      })
    };

  } catch (error) {
    console.error('Error processing checkout:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error processing checkout'
      })
    };
  }
};
