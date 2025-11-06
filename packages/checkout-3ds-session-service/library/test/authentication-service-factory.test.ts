import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAuthenticationService,
  createAuthenticationServiceFromEnv,
  getAuthenticationService,
  resetAuthenticationService
} from '../src/factory/index.js';
import { MockAuthenticationService } from '../src/providers/mock/index.js';
import { DynamoDBAuthenticationService } from '../src/providers/dynamodb/index.js';

describe('AuthenticationServiceFactory', () => {
  afterEach(() => {
    resetAuthenticationService();
  });

  describe('createAuthenticationService', () => {
    it('should create MockAuthenticationService', () => {
      const service = createAuthenticationService({
        type: 'mock',
        enableAutomaticCleanup: false
      });

      expect(service).toBeInstanceOf(MockAuthenticationService);
    });

    it('should create DynamoDBAuthenticationService with valid config', () => {
      const service = createAuthenticationService({
        type: 'dynamodb',
        tableName: 'test-auth-sessions',
        region: 'eu-west-1'
      });

      expect(service).toBeInstanceOf(DynamoDBAuthenticationService);
    });

    it('should throw error for missing tableName in DynamoDB config', () => {
      expect(() => {
        createAuthenticationService({
          type: 'dynamodb',
          tableName: '',
          region: 'eu-west-1'
        });
      }).toThrow('tableName is required');
    });

    it('should throw error for missing region in DynamoDB config', () => {
      expect(() => {
        createAuthenticationService({
          type: 'dynamodb',
          tableName: 'test-table',
          region: ''
        });
      }).toThrow('region is required');
    });

    it('should throw error for unknown service type', () => {
      expect(() => {
        createAuthenticationService({
          type: 'unknown'
        } as any);
      }).toThrow('Unknown authentication service type');
    });
  });

  describe('createAuthenticationServiceFromEnv', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create MockAuthenticationService when ENVIRONMENT is test', () => {
      process.env.ENVIRONMENT = 'test';

      const service = createAuthenticationServiceFromEnv();

      expect(service).toBeInstanceOf(MockAuthenticationService);
    });

    it('should create MockAuthenticationService when USE_MOCK_AUTH is true', () => {
      process.env.ENVIRONMENT = 'dev';
      process.env.USE_MOCK_AUTH = 'true';

      const service = createAuthenticationServiceFromEnv();

      expect(service).toBeInstanceOf(MockAuthenticationService);
    });

    it('should create DynamoDBAuthenticationService with valid env vars', () => {
      process.env.ENVIRONMENT = 'dev';
      process.env.AUTH_SESSION_TABLE_NAME = 'dev-auth-sessions';
      process.env.AWS_REGION = 'eu-west-1';
      delete process.env.USE_MOCK_AUTH;

      const service = createAuthenticationServiceFromEnv();

      expect(service).toBeInstanceOf(DynamoDBAuthenticationService);
    });

    it('should throw error when AUTH_SESSION_TABLE_NAME is missing', () => {
      process.env.ENVIRONMENT = 'dev';
      delete process.env.AUTH_SESSION_TABLE_NAME;
      delete process.env.USE_MOCK_AUTH;

      expect(() => {
        createAuthenticationServiceFromEnv();
      }).toThrow('Missing required environment variable: AUTH_SESSION_TABLE_NAME');
    });

    it('should use default region when AWS_REGION is not set', () => {
      process.env.ENVIRONMENT = 'dev';
      process.env.AUTH_SESSION_TABLE_NAME = 'dev-auth-sessions';
      delete process.env.AWS_REGION;
      delete process.env.USE_MOCK_AUTH;

      const service = createAuthenticationServiceFromEnv();

      expect(service).toBeInstanceOf(DynamoDBAuthenticationService);
    });
  });

  describe('getAuthenticationService', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      resetAuthenticationService();
    });

    afterEach(() => {
      process.env = originalEnv;
      resetAuthenticationService();
    });

    it('should return singleton instance', () => {
      process.env.ENVIRONMENT = 'test';

      const service1 = getAuthenticationService();
      const service2 = getAuthenticationService();

      expect(service1).toBe(service2);
    });

    it('should create new instance after reset', () => {
      process.env.ENVIRONMENT = 'test';

      const service1 = getAuthenticationService();
      resetAuthenticationService();
      const service2 = getAuthenticationService();

      expect(service1).not.toBe(service2);
    });
  });
});
