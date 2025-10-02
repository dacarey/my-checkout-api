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
}

export function getServiceConfig(app: cdk.App): ServiceConfig {
  // Configuration priority: CDK context -> Environment variables -> Defaults
  const config: ServiceConfig = {
    region: app.node.tryGetContext('region') || process.env.AWS_REGION || 'eu-west-1',
    environment: app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev',
    stageName: app.node.tryGetContext('stageName') || process.env.STAGE_NAME ||
               app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev',
    apiAccountId: app.node.tryGetContext('apiAccountId') || process.env.API_ACCOUNT_ID ||
                  process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT_PLACEHOLDER',
    serviceAccountId: app.node.tryGetContext('serviceAccountId') || process.env.SERVICE_ACCOUNT_ID ||
                     process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT_PLACEHOLDER',
    functionNamePrefix: app.node.tryGetContext('functionNamePrefix') || process.env.FUNCTION_NAME_PREFIX || 'checkout'
  };

  // Validation
  if (config.apiAccountId === 'ACCOUNT_PLACEHOLDER' || config.serviceAccountId === 'ACCOUNT_PLACEHOLDER') {
    throw new Error('Account IDs must be provided via CDK context or environment variables');
  }

  return config;
}
