import * as cdk from 'aws-cdk-lib';

export interface ServiceConfig {
  /** AWS region for deployment */
  region: string;
  /** Environment name (dev, sit, uat, prod) */
  environment: string;
  /** API Gateway stage name */
  stageName: string;
  /** Account ID for API Gateway deployment */
  apiAccountId: string;
  /** Account ID for Lambda deployment */
  serviceAccountId: string;
  /** Function name prefix for resource naming */
  functionNamePrefix: string;
  /** Default brand key for payment processing */
  brandKey: string;
  /** Use mock 3DS session service instead of DynamoDB (defaults to true for dev, false for production) */
  useMock3dsSessionService: boolean;
}

export function getServiceConfig(app: cdk.App): ServiceConfig {
  // Configuration priority: CDK context -> Environment variables -> Defaults
  const environment = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';

  // Default useMock3dsSessionService based on environment: true for dev/sit, false for uat/prod
  const defaultUseMock3ds = ['dev', 'sit'].includes(environment);

  // Support both --use-mock-3ds-session-service and --use-3ds-session-service flags
  // useMock3ds is the normalized internal flag
  let useMock3ds: boolean;

  // Check for useMock3ds context (normalized from deployment scripts)
  if (app.node.tryGetContext('useMock3ds') !== undefined) {
    useMock3ds = app.node.tryGetContext('useMock3ds') === 'true' || app.node.tryGetContext('useMock3ds') === true;
  }
  // Fallback to environment variable
  else if (process.env.USE_MOCK_3DS !== undefined) {
    useMock3ds = process.env.USE_MOCK_3DS === 'true';
  }
  // Legacy environment variable support
  else if (process.env.USE_MOCK_AUTH !== undefined) {
    useMock3ds = process.env.USE_MOCK_AUTH === 'true';
  }
  // Default based on environment
  else {
    useMock3ds = defaultUseMock3ds;
  }

  const config: ServiceConfig = {
    region: app.node.tryGetContext('region') || process.env.AWS_REGION || 'eu-west-1',
    environment: environment,
    stageName: app.node.tryGetContext('stageName') || process.env.STAGE_NAME || environment,
    apiAccountId: app.node.tryGetContext('apiAccountId') || process.env.API_ACCOUNT_ID ||
                  process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT_PLACEHOLDER',
    serviceAccountId: app.node.tryGetContext('serviceAccountId') || process.env.SERVICE_ACCOUNT_ID ||
                     process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT_PLACEHOLDER',
    functionNamePrefix: app.node.tryGetContext('functionNamePrefix') || process.env.FUNCTION_NAME_PREFIX || 'checkout',
    brandKey: app.node.tryGetContext('brandKey') || process.env.BRAND_KEY || 'uklait',
    useMock3dsSessionService: useMock3ds
  };

  // Validation
  if (config.apiAccountId === 'ACCOUNT_PLACEHOLDER' || config.serviceAccountId === 'ACCOUNT_PLACEHOLDER') {
    throw new Error('Account IDs must be provided via CDK context or environment variables');
  }

  return config;
}
