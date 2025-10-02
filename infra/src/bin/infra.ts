#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LambdaStack } from '../lib/lambda-stack';
import { ApiStack } from '../lib/api-stack';
import { getServiceConfig } from '../lib/config';

const app = new cdk.App();

// Get centralized configuration
const config = getServiceConfig(app);

// Display current configuration
console.log('🔧 Configuration:');
console.log(`   Environment: ${config.environment}`);
console.log(`   Region: ${config.region}`);
console.log(`   API Account: ${config.apiAccountId}`);
console.log(`   Service Account: ${config.serviceAccountId}`);
console.log('');

const lambdaLiveAliasArn = app.node.tryGetContext('lambdaLiveAliasArn') as string;

// Validation for ApiStack deployment
if (!lambdaLiveAliasArn && process.env.STACK === 'ApiStack') {
  throw new Error('Pass -c lambdaLiveAliasArn=<ARN> when deploying ApiStack');
}

// Deploy Lambda stack
const lambdaStack = new LambdaStack(app, 'LambdaStack', {
  config,
  env: { account: config.serviceAccountId, region: config.region }
});

// Deploy API stack (only if context is provided)
if (lambdaLiveAliasArn) {
  new ApiStack(app, 'ApiStack', {
    lambdaLiveAliasArn,
    config,
    env: { account: config.apiAccountId, region: config.region }
  });
}
