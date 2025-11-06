#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ThreeDSSessionStack } from '../lib/threeds-session-stack';
import { getThreeDSSessionConfig } from '../lib/config';

const app = new cdk.App();

// Get configuration from context and environment variables
const config = getThreeDSSessionConfig(app);

// Create the 3DS Session Stack
const threeDSSessionStack = new ThreeDSSessionStack(app, 'ThreeDSSessionStack', {
  config,
  env: {
    account: config.accountId,
    region: config.region
  },
  stackName: `${config.environment}-checkout-3ds-session-stack`,
  description: `3DS session management DynamoDB table for payment authentication (${config.environment})`
});

// Add tags to all resources in the stack
cdk.Tags.of(threeDSSessionStack).add('Environment', config.environment);
cdk.Tags.of(threeDSSessionStack).add('Service', 'checkout-3ds-sessions');
cdk.Tags.of(threeDSSessionStack).add('ManagedBy', 'CDK');
cdk.Tags.of(threeDSSessionStack).add('Repository', 'checkout-api');

app.synth();
