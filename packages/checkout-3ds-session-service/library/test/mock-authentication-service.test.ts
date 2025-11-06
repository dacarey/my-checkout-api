import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAuthenticationService } from '../src/providers/mock/index.js';
import {
  SessionAlreadyUsedError,
  SessionNotFoundError,
  CreateSessionRequest
} from '../src/core/index.js';

describe('MockAuthenticationService', () => {
  let service: MockAuthenticationService;

  beforeEach(() => {
    service = new MockAuthenticationService();
  });

  afterEach(() => {
    service.destroy();
  });

  describe('createSession', () => {
    it('should create a valid session', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa_4242',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        },
        customerId: 'customer-123'
      };

      const session = await service.createSession(request);

      expect(session.id).toMatch(/^auth_/);
      expect(session.cartId).toBe('cart-123');
      expect(session.cartVersion).toBe(1);
      expect(session.paymentToken).toBe('tok_visa_4242');
      expect(session.tokenType).toBe('transient');
      expect(session.status).toBe('pending');
      expect(session.customerId).toBe('customer-123');
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(session.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should generate unique session IDs', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const session1 = await service.createSession(request);
      const session2 = await service.createSession(request);

      expect(session1.id).not.toBe(session2.id);
    });

    it('should create session with shipping details', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        },
        shipTo: {
          firstName: 'Jane',
          lastName: 'Smith',
          address: {
            address1: '456 Oak Ave',
            locality: 'Manchester',
            postalCode: 'M1 1AA',
            country: 'GB'
          }
        }
      };

      const session = await service.createSession(request);

      expect(session.shipTo).toBeDefined();
      expect(session.shipTo?.firstName).toBe('Jane');
      expect(session.shipTo?.address.locality).toBe('Manchester');
    });

    it('should create session with 3DS setup data', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        },
        threeDSSetupData: {
          referenceId: '3ds-ref-456',
          authenticationInformation: {
            challengeUrl: 'https://3ds.psp.com/challenge'
          }
        }
      };

      const session = await service.createSession(request);

      expect(session.threeDSSetupData).toBeDefined();
      expect(session.threeDSSetupData?.referenceId).toBe('3ds-ref-456');
    });

    it('should create session with anonymous ID', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'Guest',
          lastName: 'User',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        },
        anonymousId: 'anon-67890'
      };

      const session = await service.createSession(request);

      expect(session.anonymousId).toBe('anon-67890');
      expect(session.customerId).toBeUndefined();
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const created = await service.createSession(request);
      const retrieved = await service.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.cartId).toBe('cart-123');
      expect(retrieved!.paymentToken).toBe('tok_visa');
    });

    it('should return null for non-existent session', async () => {
      const session = await service.getSession('auth_nonexistent');
      expect(session).toBeNull();
    });

    it('should return null for used session', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const session = await service.createSession(request);
      await service.markSessionUsed(session.id);

      const retrieved = await service.getSession(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('markSessionUsed', () => {
    it('should mark a pending session as used', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const session = await service.createSession(request);
      await service.markSessionUsed(session.id);

      const retrieved = await service.getSession(session.id);
      expect(retrieved).toBeNull(); // Used sessions not returned by getSession
    });

    it('should throw when marking non-existent session as used', async () => {
      await expect(
        service.markSessionUsed('auth_nonexistent')
      ).rejects.toThrow(SessionNotFoundError);
    });

    it('should throw when marking already-used session as used', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const session = await service.createSession(request);
      await service.markSessionUsed(session.id);

      await expect(
        service.markSessionUsed(session.id)
      ).rejects.toThrow(SessionAlreadyUsedError);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const session = await service.createSession(request);
      const deleted = await service.deleteSession(session.id);

      expect(deleted).toBe(true);
      expect(await service.getSession(session.id)).toBeNull();
    });

    it('should return false for non-existent session', async () => {
      const deleted = await service.deleteSession('auth_nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('should return true for mock provider', async () => {
      const healthy = await service.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  describe('test utilities', () => {
    it('should clear all sessions with clearAll()', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      await service.createSession(request);
      await service.createSession(request);

      expect(service.getAllSessions()).toHaveLength(2);

      service.clearAll();

      expect(service.getAllSessions()).toHaveLength(0);
    });

    it('should return all sessions with getAllSessions()', async () => {
      const request: CreateSessionRequest = {
        cartId: 'cart-123',
        cartVersion: 1,
        paymentToken: 'tok_visa',
        tokenType: 'transient',
        billTo: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            address1: '123 Main St',
            locality: 'London',
            postalCode: 'SW1A 1AA',
            country: 'GB'
          }
        }
      };

      const session1 = await service.createSession(request);
      const session2 = await service.createSession(request);

      const allSessions = service.getAllSessions();

      expect(allSessions).toHaveLength(2);
      expect(allSessions.map(s => s.id)).toContain(session1.id);
      expect(allSessions.map(s => s.id)).toContain(session2.id);
    });
  });
});
