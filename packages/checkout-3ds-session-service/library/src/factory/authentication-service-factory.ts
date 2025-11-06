import { IAuthenticationService } from '../core/index.js';
import { DynamoDBAuthenticationService } from '../providers/dynamodb/index.js';
import { MockAuthenticationService } from '../providers/mock/index.js';

/**
 * Factory function to create authentication service based on environment
 *
 * @example
 * // Production usage
 * const service = createAuthenticationService({
 *   type: 'dynamodb',
 *   tableName: process.env.AUTH_SESSION_TABLE_NAME!,
 *   region: process.env.AWS_REGION || 'eu-west-1'
 * });
 *
 * @example
 * // Testing usage
 * const service = createAuthenticationService({
 *   type: 'mock',
 *   enableAutomaticCleanup: true
 * });
 */
export function createAuthenticationService(
  config: AuthenticationServiceConfig
): IAuthenticationService {
  if (config.type === 'mock') {
    return new MockAuthenticationService({
      enableAutomaticCleanup: config.enableAutomaticCleanup
    });
  }

  if (config.type === 'dynamodb') {
    if (!config.tableName) {
      throw new Error('tableName is required for DynamoDB provider');
    }
    if (!config.region) {
      throw new Error('region is required for DynamoDB provider');
    }

    return new DynamoDBAuthenticationService({
      tableName: config.tableName,
      region: config.region,
      endpoint: config.endpoint,
      dynamoDBClient: config.dynamoDBClient
    });
  }

  throw new Error(`Unknown authentication service type: ${(config as any).type}`);
}

/**
 * Create authentication service from environment variables
 *
 * Environment variables:
 * - ENVIRONMENT: Deployment environment (dev, sit, uat, prod)
 * - USE_MOCK_AUTH: Force mock provider (overrides environment detection)
 * - AUTH_SESSION_TABLE_NAME: DynamoDB table name
 * - AWS_REGION: AWS region (default: eu-west-1)
 *
 * @example
 * const service = createAuthenticationServiceFromEnv();
 */
export function createAuthenticationServiceFromEnv(): IAuthenticationService {
  const environment = process.env.ENVIRONMENT || 'dev';
  const useMock = process.env.USE_MOCK_AUTH === 'true';

  if (environment === 'test' || useMock) {
    console.log('Using MockAuthenticationService');
    return new MockAuthenticationService();
  }

  const tableName = process.env.AUTH_SESSION_TABLE_NAME;
  const region = process.env.AWS_REGION || 'eu-west-1';

  if (!tableName) {
    throw new Error('Missing required environment variable: AUTH_SESSION_TABLE_NAME');
  }

  console.log(`Using DynamoDBAuthenticationService (table: ${tableName})`);
  return new DynamoDBAuthenticationService({
    tableName,
    region
  });
}

/**
 * Singleton instance for Lambda container reuse
 */
let authenticationService: IAuthenticationService | null = null;

/**
 * Get or create the authentication service singleton
 *
 * This function is designed for Lambda container reuse. The service instance
 * is created once and reused across invocations within the same container.
 *
 * @example
 * export const handler = async (event: APIGatewayProxyEvent) => {
 *   const authService = getAuthenticationService();
 *   const session = await authService.getSession(threeDSSessionId);
 *   // ... rest of handler
 * };
 */
export function getAuthenticationService(): IAuthenticationService {
  if (!authenticationService) {
    authenticationService = createAuthenticationServiceFromEnv();
  }
  return authenticationService;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetAuthenticationService(): void {
  authenticationService = null;
}

// Type definitions for factory configuration

export type AuthenticationServiceConfig =
  | MockAuthenticationServiceConfig
  | DynamoDBAuthenticationServiceConfig;

export interface MockAuthenticationServiceConfig {
  type: 'mock';
  enableAutomaticCleanup?: boolean;
}

export interface DynamoDBAuthenticationServiceConfig {
  type: 'dynamodb';
  tableName: string;
  region: string;
  endpoint?: string;
  dynamoDBClient?: any; // Avoid importing DynamoDBClient to reduce dependencies
}
