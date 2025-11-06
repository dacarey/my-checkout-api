/**
 * Configuration for 3DS Session Service Infrastructure
 */

export interface ThreeDSSessionConfig {
  /** Deployment environment (dev, sit, uat, prod) */
  environment: string;

  /** AWS region for deployment */
  region: string;

  /** AWS account ID */
  accountId: string;

  /** Table name prefix (will be formatted as {environment}-checkout-3ds-sessions) */
  tableNamePrefix?: string;

  /** Enable point-in-time recovery (recommended for production) */
  pointInTimeRecovery?: boolean;

  /** Stack removal policy (RETAIN for prod, DESTROY for dev) */
  removalPolicy?: 'RETAIN' | 'DESTROY';
}

/**
 * Get configuration from CDK context and environment variables
 */
export function getThreeDSSessionConfig(app: any): ThreeDSSessionConfig {
  // Environment (required)
  const environment = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';

  // Region (default: eu-west-1)
  const region = app.node.tryGetContext('region') || process.env.AWS_REGION || 'eu-west-1';

  // Account ID (required)
  const accountId = app.node.tryGetContext('accountId') || process.env.AWS_ACCOUNT_ID;
  if (!accountId) {
    throw new Error('AWS account ID is required. Provide via -c accountId=<id> or AWS_ACCOUNT_ID env var');
  }

  // Table name prefix (optional, defaults to standard naming)
  const tableNamePrefix = app.node.tryGetContext('tableNamePrefix');

  // Point-in-time recovery (enabled for prod by default)
  const pointInTimeRecovery =
    app.node.tryGetContext('pointInTimeRecovery') === 'true' ||
    environment === 'prod';

  // Removal policy (RETAIN for prod, DESTROY for others)
  const removalPolicy = environment === 'prod' ? 'RETAIN' : 'DESTROY';

  console.log('3DS Session Service Infrastructure Configuration:');
  console.log(`  Environment: ${environment}`);
  console.log(`  Region: ${region}`);
  console.log(`  Account ID: ${accountId}`);
  console.log(`  Point-in-time Recovery: ${pointInTimeRecovery}`);
  console.log(`  Removal Policy: ${removalPolicy}`);

  return {
    environment,
    region,
    accountId,
    tableNamePrefix,
    pointInTimeRecovery,
    removalPolicy
  };
}
