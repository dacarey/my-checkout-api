# AWS Lambda Integration HOWTO Guide

> **Note**: This is a HOWTO guide for specific AWS Lambda integration scenarios. For the main project documentation, setup instructions, and user guide, please refer to the [README.md](../README.md) in the repository root.

## Overview

This guide provides step-by-step instructions for integrating AWS Lambda with the `@dw-digital-commerce/payments-sdk` package from GitHub Packages.

## 1. Configure GitHub Packages Registry

Create `.npmrc` file in your project root:

```
@dw-digital-commerce:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## 2. Install the Package

```bash
# Set your GitHub token (with packages:read permission)
export GITHUB_TOKEN=your_github_token_here

# Install the package
npm install @dw-digital-commerce/payments-sdk
```

## 3. Lambda Function Code

```typescript
import { PaymentService } from '@dw-digital-commerce/payments-sdk';

export const handler = async (event: any) => {
  try {
    // Create payment service with hardcoded credentials
    const paymentService = new PaymentService('cybersource', {
      merchantID: 'laithwaites_ecomm',
      merchantKeyId: '14267d9e-bada-4d3e-a6bb-3c97dc1ba652',
      merchantsecretKey: 'uLmJE+T5MHgRoxwyQkWzDnjDSi7RPbJByDLv2iyRaJ4='
    });

    // Hardcoded payment request
    const paymentRequest = {
      orderId: `ORD-${Date.now()}`,
      amount: '49.99',
      currency: 'GBP',
      paymentToken: 'transient_token_from_cybersource_flex',
      tokenType: 'transient',
      billTo: {
        firstName: 'John',
        lastName: 'Doe',
        street: '123 Main St',
        city: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB',
        email: 'customer@example.com'
      }
    };

    // Process payment
    const result = await paymentService.paymentAuthorisation(paymentRequest);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        result: result
      })
    };
    
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
```

## 4. CDK Stack Configuration

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';

// In your CDK stack
const paymentLambda = new lambdaNodejs.NodejsFunction(this, 'PaymentFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: 'src/payment-handler.ts',
  timeout: cdk.Duration.seconds(30),
  memorySize: 256,
  bundling: {
    externalModules: [],
    nodeModules: ['@dw-digital-commerce/payments-sdk'],
    // Ensure bundler can access GitHub Packages
    commandHooks: {
      beforeBundling: (inputDir: string, outputDir: string): string[] => [
        `cp ${inputDir}/.npmrc ${outputDir}/.npmrc`
      ]
    }
  }
});
```

**Note**: Make sure your `.npmrc` file is in the CDK project root and your `GITHUB_TOKEN` environment variable is set when running `cdk deploy`.

## 5. Package.json Dependencies

```json
{
  "dependencies": {
    "@dw-digital-commerce/payments-sdk": "^2.4.1"
  }
}
```

## 6. Deployment

Make sure you have the GitHub token set before deploying:

```bash
export GITHUB_TOKEN=your_github_token_here
cdk deploy
```

That's it! The Lambda will execute the basic payment authorization flow using the hardcoded credentials and payment data.