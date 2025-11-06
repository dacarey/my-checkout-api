import {
  AuthenticationSession,
  CreateSessionRequest,
  IAuthenticationService,
  SessionNotFoundError,
  SessionAlreadyUsedError
} from '../../core/index.js';

export interface MockAuthenticationServiceOptions {
  /** Enable automatic cleanup of expired sessions (default: false) */
  enableAutomaticCleanup?: boolean;
}

/**
 * Mock authentication service for testing
 *
 * WARNING: Not for production use
 * - No durability (data lost on restart)
 * - No encryption
 * - No distributed locking
 * - Single-process only
 */
export class MockAuthenticationService implements IAuthenticationService {
  private sessions: Map<string, AuthenticationSession> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options?: MockAuthenticationServiceOptions) {
    if (options?.enableAutomaticCleanup) {
      // Run cleanup every 5 seconds to simulate TTL deletion
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpiredSessions();
      }, 5000);
    }
  }

  async createSession(request: CreateSessionRequest): Promise<AuthenticationSession> {
    const threeDSSessionId = this.generateAuthenticationId();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const session: AuthenticationSession = {
      id: threeDSSessionId,
      cartId: request.cartId,
      cartVersion: request.cartVersion,
      paymentToken: request.paymentToken, // NOT encrypted in mock
      tokenType: request.tokenType,
      billTo: request.billTo,
      shipTo: request.shipTo,
      threeDSSetupData: request.threeDSSetupData,
      createdAt,
      expiresAt,
      status: 'pending',
      customerId: request.customerId,
      anonymousId: request.anonymousId
    };

    this.sessions.set(threeDSSessionId, session);
    return session;
  }

  async getSession(threeDSSessionId: string): Promise<AuthenticationSession | null> {
    const session = this.sessions.get(threeDSSessionId);

    if (!session) {
      return null;
    }

    // Check expiration
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(threeDSSessionId);
      return null;
    }

    // Check status
    if (session.status !== 'pending') {
      return null;
    }

    return session;
  }

  async markSessionUsed(threeDSSessionId: string): Promise<void> {
    const session = this.sessions.get(threeDSSessionId);

    if (!session) {
      throw new SessionNotFoundError(threeDSSessionId);
    }

    if (session.status === 'used') {
      throw new SessionAlreadyUsedError(threeDSSessionId);
    }

    // Create updated session (immutability)
    this.sessions.set(threeDSSessionId, {
      ...session,
      status: 'used'
    });
  }

  async deleteSession(threeDSSessionId: string): Promise<boolean> {
    return this.sessions.delete(threeDSSessionId);
  }

  async healthCheck(): Promise<boolean> {
    return true; // Always healthy
  }

  // Test utilities

  /**
   * Clear all sessions (test utility)
   */
  clearAll(): void {
    this.sessions.clear();
  }

  /**
   * Get all sessions (test utility)
   */
  getAllSessions(): AuthenticationSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Cleanup resources (timers)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [id, session] of this.sessions.entries()) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
      }
    }
  }

  private generateAuthenticationId(): string {
    return `auth_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
