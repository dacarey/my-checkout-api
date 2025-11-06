import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LambdaStack } from '../src/lib/lambda-stack';
import { ApiStack } from '../src/lib/api-stack';

describe('LambdaStack', () => {
  it('creates Lambda function with correct runtime', () => {
    const app = new cdk.App();

    const config = {
      environment: 'test',
      region: 'eu-west-1',
      apiAccountId: '123456789012',
      serviceAccountId: '123456789012',
      functionNamePrefix: 'checkout',
      stageName: 'test',
      brandKey: 'uklait'
    };

    const stack = new LambdaStack(app, 'TestStack', { config });
    const template = Template.fromStack(stack);

    // Assert Lambda function exists with Node.js 22 runtime
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      FunctionName: 'dwaws-test-checkout-order-capture-lambda'
    });

    // Assert Lambda alias exists
    template.hasResourceProperties('AWS::Lambda::Alias', {
      Name: 'live'
    });
  });

  it('creates cross-account invoke permissions', () => {
    const app = new cdk.App();

    const config = {
      environment: 'test',
      region: 'eu-west-1',
      apiAccountId: '123456789012',
      serviceAccountId: '210987654321',
      functionNamePrefix: 'checkout',
      stageName: 'test',
      brandKey: 'uklait'
    };

    const stack = new LambdaStack(app, 'TestStack', { config });
    const template = Template.fromStack(stack);

    // Assert Lambda permission exists for API Gateway
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com'
    });
  });
});

describe('ApiStack', () => {
  it('creates API Gateway with correct configuration', () => {
    const app = new cdk.App();

    const config = {
      environment: 'test',
      region: 'eu-west-1',
      apiAccountId: '123456789012',
      serviceAccountId: '123456789012',
      functionNamePrefix: 'checkout',
      stageName: 'test',
      brandKey: 'uklait'
    };

    const lambdaArn = 'arn:aws:lambda:eu-west-1:123456789012:function:dwaws-test-checkout-order-capture-lambda:live';

    const stack = new ApiStack(app, 'TestApiStack', {
      config,
      lambdaLiveAliasArn: lambdaArn
    });

    const template = Template.fromStack(stack);

    // Assert API Gateway exists
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'CheckoutApi'
    });
  });
});
