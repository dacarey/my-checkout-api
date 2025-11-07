# Getting Started with Payment Integration

This comprehensive guide walks you through integrating the Checkout API with `@dw-digital-commerce/payments-sdk` for payment processing in AWS Lambda.

> **Quick Links**: [3DS Authentication](./advanced-3ds-integration.md) | [Multi-Account Setup](./multi-account-deployment.md) | [Architecture](../architecture/)

## 📋 Prerequisites

- Node.js 20.x or 22.x
- AWS Account with Lambda and API Gateway access
- GitHub account with packages:read permission
- Basic knowledge of TypeScript and AWS CDK
- Access to payment processor credentials (Cybersource/Adyen/Stripe)

## 🎯 What You'll Learn

1. Configure GitHub Packages for `@dw-digital-commerce/payments-sdk`
2. Implement secure payment processing in Lambda
3. Handle different payment scenarios (simple, 3DS, stored tokens)
4. Properly manage credentials with AWS Secrets Manager
5. Test and deploy your payment integration

## 🔧 Part 1: Configure GitHub Packages Registry

### Create `.npmrc` Configuration

Create a `.npmrc` file in your project root:

```bash
# .npmrc
@dw-digital-commerce:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### Generate GitHub Token

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a classic token with `packages:read` permission
3. Store it securely (we'll use it in deployment)

### Install the SDK

```bash
# Set your GitHub token (temporary for local development)
export GITHUB_TOKEN=your_github_token_here

# Install the payments SDK
npm install @dw-digital-commerce/payments-sdk

# Also install AWS SDK for Secrets Manager
npm install @aws-sdk/client-secrets-manager
```

## 🔐 Part 2: Secure Credential Management

### ⚠️ NEVER Hardcode Credentials

The original example showed hardcoded credentials - **this is for demonstration only**. In production, always use AWS Secrets Manager.

### Store Credentials in AWS Secrets Manager

```bash
# Create secret for payment credentials
aws secretsmanager create-secret \
  --name "checkout-api/payment-credentials" \
  --secret-string '{
    "cybersource": {
      "merchantID": "your_merchant_id",
      "merchantKeyId": "your_key_id",
      "merchantsecretKey": "your_secret_key"
    }
  }'
```

### Retrieve Credentials in Lambda

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: 'eu-west-1' });

async function getPaymentCredentials(processor: string) {
  const command = new GetSecretValueCommand({
    SecretId: 'checkout-api/payment-credentials'
  });

  const response = await secretsClient.send(command);
  const credentials = JSON.parse(response.SecretString!);

  return credentials[processor];
}
```

## 💻 Part 3: Lambda Function Implementation

### Complete Payment Handler

```typescript
// lambda/src/handlers/payment-handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PaymentService } from '@dw-digital-commerce/payments-sdk';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

/**
 * Main payment handler for token capture endpoint
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Processing payment request', {
    path: event.path,
    method: event.httpMethod
  });

  try {
    // Parse and validate request
    const request = JSON.parse(event.body || '{}');
    validatePaymentRequest(request);

    // Get credentials from Secrets Manager
    const credentials = await getPaymentCredentials(request.processor || 'cybersource');

    // Initialize payment service
    const paymentService = new PaymentService(request.processor || 'cybersource', credentials);

    // Build payment request
    const paymentRequest = buildPaymentRequest(request);

    // Process payment
    const result = await paymentService.paymentAuthorisation(paymentRequest);

    // Handle different response scenarios
    return handlePaymentResponse(result, request);

  } catch (error) {
    console.error('Payment processing failed:', error);
    return handleError(error);
  }
};

/**
 * Validate incoming payment request
 */
function validatePaymentRequest(request: any): void {
  if (!request.cartId) {
    throw new ValidationError('cartId is required');
  }

  if (!request.payments || request.payments.length === 0) {
    throw new ValidationError('At least one payment is required');
  }

  const payment = request.payments[0];

  if (payment.type !== 'tokenised') {
    throw new ValidationError('Only tokenised payments are supported');
  }

  if (!payment.tokenisedPayment?.paymentToken) {
    throw new ValidationError('paymentToken is required');
  }

  if (!payment.tokenisedPayment?.billTo) {
    throw new ValidationError('Billing details are required');
  }
}

/**
 * Build payment request for payments-sdk
 */
function buildPaymentRequest(request: any): any {
  const payment = request.payments[0];
  const tokenisedPayment = payment.tokenisedPayment;

  return {
    orderId: generateOrderId(request.cartId),
    amount: payment.amount.amount.toString(),
    currency: payment.amount.currencyCode,
    paymentToken: tokenisedPayment.paymentToken,
    tokenType: tokenisedPayment.tokenType || 'transient',
    customerId: request.customerId,
    billTo: mapBillingDetails(tokenisedPayment.billTo),
    shipTo: tokenisedPayment.shipTo ? mapShippingDetails(tokenisedPayment.shipTo) : undefined,
    threeDSData: tokenisedPayment.threeDSData,
    metadata: {
      cartId: request.cartId,
      cartVersion: request.version,
      brandKey: extractBrandKey(request)
    }
  };
}

/**
 * Map billing details to payments-sdk format
 */
function mapBillingDetails(billTo: any) {
  return {
    firstName: billTo.firstName,
    lastName: billTo.lastName,
    street: billTo.address.address1,
    city: billTo.address.locality,
    postalCode: billTo.address.postalCode,
    country: billTo.address.country,
    email: billTo.email,
    phone: billTo.phone
  };
}

/**
 * Handle payment response based on status
 */
function handlePaymentResponse(result: any, request: any): APIGatewayProxyResult {
  // Case 1: Payment authorized successfully
  if (result.status === 'authorized') {
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Location': `/checkout/me/orders/${result.orderId}`
      },
      body: JSON.stringify({
        id: result.orderId,
        status: 'completed',
        cartId: request.cartId,
        paymentDetails: [{
          status: 'authorized',
          transactionId: result.transactionId,
          authorizationCode: result.authorizationCode,
          amount: result.amount
        }]
      })
    };
  }

  // Case 2: 3DS authentication required
  if (result.status === 'requiresThreeDsValidation') {
    return handle3DSRequired(result, request);
  }

  // Case 3: Payment declined
  if (result.status === 'declined') {
    return {
      statusCode: 422,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errors: [{
          code: 'PaymentDeclined',
          message: result.declineReason || 'Payment was declined by the processor',
          field: 'payments[0]'
        }]
      })
    };
  }

  // Case 4: Unknown status
  throw new Error(`Unknown payment status: ${result.status}`);
}

/**
 * Handle 3DS authentication required response
 */
async function handle3DSRequired(result: any, request: any): Promise<APIGatewayProxyResult> {
  // Store session for later validation
  const sessionId = generateSessionId();

  await storeAuthenticationSession({
    threeDSSessionId: sessionId,
    cartId: request.cartId,
    cartVersion: request.version,
    transactionId: result.transactionId,
    paymentToken: request.payments[0].tokenisedPayment.paymentToken,
    tokenType: request.payments[0].tokenisedPayment.tokenType,
    billTo: request.payments[0].tokenisedPayment.billTo,
    amount: request.payments[0].amount,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
  });

  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threeDSSessionId: sessionId,
      cartId: request.cartId,
      transactionId: result.transactionId,
      status: 'requires3DSAuthentication',
      timestamp: new Date().toISOString(),
      challengeInfo: result.challengeInfo, // From Payment API v0.3.0
      paymentContext: {
        amount: request.payments[0].amount,
        paymentMethod: 'tokenised'
      }
    })
  };
}

/**
 * Error handling with proper status codes
 */
function handleError(error: any): APIGatewayProxyResult {
  console.error('Error details:', error);

  if (error instanceof ValidationError) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errors: [{
          code: 'ValidationError',
          message: error.message,
          field: error.field
        }]
      })
    };
  }

  if (error.code === 'SecretsManagerError') {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errors: [{
          code: 'ServiceUnavailable',
          message: 'Payment service temporarily unavailable'
        }]
      })
    };
  }

  // Generic error
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      errors: [{
        code: 'InternalServerError',
        message: 'An unexpected error occurred'
      }]
    })
  };
}

// Helper functions
function generateOrderId(cartId: string): string {
  return `ORD-${cartId}-${Date.now()}`;
}

function generateSessionId(): string {
  return `auth-${crypto.randomUUID()}`;
}

function extractBrandKey(request: any): string {
  // Extract from path parameter or use default
  return request.pathParameters?.brandkey || process.env.DEFAULT_BRANDKEY || 'uklait';
}

class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

## 🏗️ Part 4: CDK Infrastructure

### Complete CDK Stack with Security Best Practices

```typescript
// infra/src/lib/payment-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class PaymentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create DynamoDB table for 3DS sessions
    const sessionsTable = new dynamodb.Table(this, 'AuthenticationSessions', {
      tableName: `checkout-3ds-sessions-${props?.env?.account}`,
      partitionKey: {
        name: 'threeDSSessionId',
        type: dynamodb.AttributeType.STRING
      },
      timeToLiveAttribute: 'expiresAt',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY // For dev only
    });

    // Reference existing secret (created separately)
    const paymentCredentialsSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'PaymentCredentials',
      'checkout-api/payment-credentials'
    );

    // Create Lambda function
    const paymentLambda = new lambdaNodejs.NodejsFunction(this, 'PaymentFunction', {
      functionName: `checkout-payment-handler-${props?.env?.account}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: 'lambda/src/handlers/payment-handler.ts',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        SESSIONS_TABLE_NAME: sessionsTable.tableName,
        DEFAULT_BRANDKEY: 'uklait',
        NODE_ENV: 'production'
      },
      bundling: {
        externalModules: ['@aws-sdk/*'], // Excluded, provided by Lambda runtime
        nodeModules: ['@dw-digital-commerce/payments-sdk'],
        minify: true,
        sourceMap: true,
        target: 'node22',
        // Copy .npmrc for GitHub Packages access during build
        commandHooks: {
          beforeBundling: (inputDir: string, outputDir: string): string[] => [
            `if [ -f ${inputDir}/.npmrc ]; then cp ${inputDir}/.npmrc ${outputDir}/.npmrc; fi`
          ],
          afterBundling: (): string[] => []
        }
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: 7 // Days
    });

    // Grant permissions
    sessionsTable.grantReadWriteData(paymentLambda);
    paymentCredentialsSecret.grantRead(paymentLambda);

    // Add additional IAM permissions if needed
    paymentLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'], // Scope this down to specific KMS keys in production
      conditions: {
        StringEquals: {
          'kms:ViaService': `secretsmanager.${props?.env?.region}.amazonaws.com`
        }
      }
    }));

    // Create Lambda alias for blue-green deployments
    const liveAlias = paymentLambda.currentVersion.addAlias('live', {
      description: 'Live production traffic'
    });

    // Outputs
    new cdk.CfnOutput(this, 'FunctionName', {
      value: paymentLambda.functionName,
      description: 'Payment Lambda function name'
    });

    new cdk.CfnOutput(this, 'LiveAliasArn', {
      value: liveAlias.aliasArn,
      description: 'ARN of the live alias for API Gateway integration'
    });

    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: sessionsTable.tableName,
      description: 'DynamoDB table for 3DS sessions'
    });
  }
}
```

## 🧪 Part 5: Testing Your Integration

### Unit Tests

```typescript
// lambda/test/payment-handler.test.ts
import { handler } from '../src/handlers/payment-handler';
import { mockClient } from 'aws-sdk-client-mock';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secretsMock = mockClient(SecretsManagerClient);

describe('Payment Handler', () => {
  beforeEach(() => {
    secretsMock.reset();

    // Mock secrets response
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        cybersource: {
          merchantID: 'test_merchant',
          merchantKeyId: 'test_key',
          merchantsecretKey: 'test_secret'
        }
      })
    });
  });

  test('should process simple payment successfully', async () => {
    const event = {
      body: JSON.stringify({
        cartId: 'cart-123',
        version: 1,
        payments: [{
          type: 'tokenised',
          amount: { amount: 49.99, currencyCode: 'GBP' },
          tokenisedPayment: {
            paymentToken: 'tkn_test_123',
            tokenType: 'transient',
            billTo: {
              firstName: 'John',
              lastName: 'Doe',
              email: 'john@example.com',
              address: {
                address1: '123 Main St',
                locality: 'London',
                postalCode: 'SW1A 1AA',
                country: 'GB'
              }
            }
          }
        }]
      })
    };

    const response = await handler(event as any);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('completed');
  });

  test('should handle 3DS required response', async () => {
    const event = {
      body: JSON.stringify({
        cartId: 'cart-456',
        version: 1,
        payments: [{
          type: 'tokenised',
          amount: { amount: 159.99, currencyCode: 'GBP' }, // Over £150
          tokenisedPayment: {
            paymentToken: 'tkn_test_3ds',
            tokenType: 'transient',
            billTo: { /* ... */ }
          }
        }]
      })
    };

    const response = await handler(event as any);

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('requires3DSAuthentication');
    expect(body.threeDSSessionId).toBeDefined();
    expect(body.challengeInfo).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// examples/src/test-payment-flow.ts
import axios from 'axios';

const API_URL = process.env.API_URL || 'https://api.example.com';

async function testSimplePayment() {
  const response = await axios.post(`${API_URL}/checkout/me/token/capture`, {
    cartId: 'test-cart-001',
    version: 1,
    payments: [{
      type: 'tokenised',
      amount: { amount: 49.99, currencyCode: 'GBP' },
      tokenisedPayment: {
        paymentToken: await getTestToken(),
        tokenType: 'transient',
        billTo: getTestBillingDetails()
      }
    }]
  });

  console.assert(response.status === 201, 'Payment should be authorized');
  console.log('✅ Simple payment test passed');
}

async function test3DSFlow() {
  // Step 1: Initiate payment over £150
  const captureResponse = await axios.post(`${API_URL}/checkout/me/token/capture`, {
    cartId: 'test-cart-002',
    version: 1,
    payments: [{
      type: 'tokenised',
      amount: { amount: 159.99, currencyCode: 'GBP' },
      tokenisedPayment: {
        paymentToken: await getTestToken(),
        tokenType: 'transient',
        billTo: getTestBillingDetails()
      }
    }]
  });

  console.assert(captureResponse.status === 202, '3DS should be required');

  const { threeDSSessionId, challengeInfo } = captureResponse.data;

  // Step 2: Simulate 3DS completion
  // In real scenario, customer would complete 3DS challenge

  // Step 3: Validate capture
  const validateResponse = await axios.post(`${API_URL}/checkout/me/3ds/validate-capture`, {
    threeDSSessionId,
    threeDSData: {
      phase: 'completion',
      completion: {
        authenticationTransactionId: 'test-auth-123',
        cavv: 'AAABCZIhcQAAAABZlyFxAAAAAAA=',
        eciIndicator: '05'
      }
    }
  });

  console.assert(validateResponse.status === 201, 'Order should be created');
  console.log('✅ 3DS flow test passed');
}

// Run tests
async function runTests() {
  try {
    await testSimplePayment();
    await test3DSFlow();
    console.log('✨ All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();
```

## 🚀 Part 6: Deployment

### Local Development

```bash
# Install dependencies
npm ci

# Run unit tests
npm test

# Build the Lambda function locally
npm run build

# Test locally with SAM CLI (optional)
sam local start-api
```

### Deploy to AWS

```bash
# Set GitHub token for package access
export GITHUB_TOKEN=your_github_token_here

# Deploy with CDK
npm run cdk deploy -- \
  --context environment=dev \
  --context apiAccountId=123456789012 \
  --context serviceAccountId=123456789012

# Or use the deployment script
./deploy-single-account.sh --profile dw-sandbox --environment dev
```

### Verify Deployment

```bash
# Test the deployed function
aws lambda invoke \
  --function-name checkout-payment-handler-123456789012 \
  --payload '{"body": "{\"cartId\": \"test-123\"}"}' \
  response.json

# Check logs
aws logs tail /aws/lambda/checkout-payment-handler-123456789012 --follow
```

## 🔍 Common Issues and Solutions

### Issue 1: GitHub Package Access Denied

**Error**: `npm ERR! 401 Unauthorized - GET https://npm.pkg.github.com/`

**Solution**:
```bash
# Ensure token is set
export GITHUB_TOKEN=your_token

# Verify token has packages:read permission
gh auth status

# Clear npm cache if needed
npm cache clean --force
```

### Issue 2: Lambda Timeout

**Error**: Task timed out after 30.00 seconds

**Solution**:
- Increase Lambda timeout in CDK (up to 15 minutes)
- Optimize payment service initialization (reuse connections)
- Consider using Lambda provisioned concurrency

### Issue 3: Secrets Manager Access Denied

**Error**: User is not authorized to perform: secretsmanager:GetSecretValue

**Solution**:
```typescript
// Ensure Lambda has correct IAM permissions
paymentCredentialsSecret.grantRead(paymentLambda);
```

### Issue 4: 3DS Session Expired

**Error**: 409 Conflict - Authentication session expired

**Solution**:
- Sessions expire after 30 minutes by default
- Adjust TTL in DynamoDB if needed
- Ensure client completes 3DS promptly

## 📚 Next Steps

1. **Implement 3DS Authentication**: See [Advanced 3DS Integration](./advanced-3ds-integration.md)
2. **Multi-Account Deployment**: Follow [Multi-Account Setup](./multi-account-deployment.md)
3. **Review Architecture**: Understand [design decisions](../architecture/3ds-stateful-design/)
4. **Production Checklist**:
   - [ ] Use Secrets Manager for all credentials
   - [ ] Enable CloudWatch alarms
   - [ ] Implement retry logic
   - [ ] Add circuit breakers
   - [ ] Enable X-Ray tracing
   - [ ] Set up monitoring dashboards

## 🔗 Additional Resources

- [Payment API v0.3.0 Spec](https://api.swaggerhub.com/apis/Direct_Wines/payments-api/0.3.0)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [CDK API Reference](https://docs.aws.amazon.com/cdk/api/v2/)
- [Example Implementations](../../examples/)

---

**Last Updated:** 2025-11-07
**Guide Version:** 2.0
**API Version:** v0.5.0
**SDK Version:** 2.4.1+