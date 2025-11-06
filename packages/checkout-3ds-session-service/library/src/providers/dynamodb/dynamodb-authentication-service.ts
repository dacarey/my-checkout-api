import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import {
  AuthenticationSession,
  CreateSessionRequest,
  IAuthenticationService,
  SessionNotFoundError,
  SessionAlreadyUsedError,
  StorageServiceError,
  BillingDetails,
  ShippingDetails,
  ThreeDSSetupData
} from '../../core/index.js';

export interface DynamoDBAuthenticationServiceConfig {
  /** DynamoDB table name */
  tableName: string;

  /** AWS region */
  region: string;

  /** Optional DynamoDB endpoint (for testing with DynamoDB Local) */
  endpoint?: string;

  /** Optional custom DynamoDB client */
  dynamoDBClient?: DynamoDBClient;
}

/**
 * DynamoDB-backed authentication service for production use
 *
 * Features:
 * - Automatic TTL-based cleanup
 * - Encryption at rest via DynamoDB table encryption
 * - High availability and scalability
 * - Single-digit millisecond latency
 */
export class DynamoDBAuthenticationService implements IAuthenticationService {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: DynamoDBAuthenticationServiceConfig) {
    this.tableName = config.tableName;

    const client = config.dynamoDBClient || new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint })
    });

    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
      }
    });
  }

  async createSession(request: CreateSessionRequest): Promise<AuthenticationSession> {
    const threeDSSessionId = this.generateAuthenticationId();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);

    const item = {
      threeDSSessionId,
      cartId: request.cartId,
      cartVersion: request.cartVersion,
      paymentToken: request.paymentToken, // Protected by DynamoDB table encryption
      tokenType: request.tokenType,
      billTo: JSON.stringify(request.billTo),
      shipTo: request.shipTo ? JSON.stringify(request.shipTo) : undefined,
      threeDSSetupData: request.threeDSSetupData ? JSON.stringify(request.threeDSSetupData) : undefined,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'pending' as const,
      customerId: request.customerId,
      anonymousId: request.anonymousId,
      ttl: Math.floor(expiresAt.getTime() / 1000) // TTL in seconds
    };

    try {
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: item
      }));

      return this.mapItemToSession(item);
    } catch (error) {
      throw new StorageServiceError('Failed to create session', error as Error);
    }
  }

  async getSession(threeDSSessionId: string): Promise<AuthenticationSession | null> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { threeDSSessionId }
      }));

      if (!result.Item) {
        return null;
      }

      // Check expiration explicitly (don't rely solely on TTL deletion)
      const expiresAt = new Date(result.Item.expiresAt as string);
      if (expiresAt < new Date()) {
        // Session expired - optionally delete immediately
        await this.deleteSession(threeDSSessionId);
        return null;
      }

      // Check status
      if (result.Item.status !== 'pending') {
        return null;
      }

      return this.mapItemToSession(result.Item);
    } catch (error) {
      throw new StorageServiceError('Failed to retrieve session', error as Error);
    }
  }

  async markSessionUsed(threeDSSessionId: string): Promise<void> {
    try {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { threeDSSessionId },
        UpdateExpression: 'SET #status = :used',
        ConditionExpression: '#status = :pending',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':used': 'used'
        }
      }));
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Check if session exists
        const session = await this.docClient.send(new GetCommand({
          TableName: this.tableName,
          Key: { threeDSSessionId }
        }));

        if (!session.Item) {
          throw new SessionNotFoundError(threeDSSessionId);
        }

        throw new SessionAlreadyUsedError(threeDSSessionId);
      }
      throw new StorageServiceError('Failed to mark session as used', error as Error);
    }
  }

  async deleteSession(threeDSSessionId: string): Promise<boolean> {
    try {
      const result = await this.docClient.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { threeDSSessionId },
        ReturnValues: 'ALL_OLD'
      }));

      return !!result.Attributes;
    } catch (error) {
      throw new StorageServiceError('Failed to delete session', error as Error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Try to read from the table (using a non-existent key)
      await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { threeDSSessionId: 'health-check' }
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  private mapItemToSession(item: any): AuthenticationSession {
    return {
      id: item.threeDSSessionId,
      cartId: item.cartId,
      cartVersion: item.cartVersion,
      paymentToken: item.paymentToken,
      tokenType: item.tokenType,
      billTo: JSON.parse(item.billTo) as BillingDetails,
      shipTo: item.shipTo ? JSON.parse(item.shipTo) as ShippingDetails : undefined,
      threeDSSetupData: item.threeDSSetupData ? JSON.parse(item.threeDSSetupData) as ThreeDSSetupData : undefined,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      status: item.status,
      customerId: item.customerId,
      anonymousId: item.anonymousId
    };
  }

  private generateAuthenticationId(): string {
    return `auth_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
