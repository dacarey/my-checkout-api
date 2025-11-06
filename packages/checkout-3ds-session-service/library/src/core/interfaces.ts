import { AuthenticationSession, CreateSessionRequest } from './types.js';

/**
 * Authentication session storage service
 *
 * Implementations must:
 * - Enforce 30-minute TTL on all sessions
 * - Prevent reuse of consumed sessions
 * - Support concurrent access patterns
 * - Encrypt payment tokens at rest
 */
export interface IAuthenticationService {
  /**
   * Create a new authentication session
   *
   * @param request - Session creation parameters
   * @returns Created session with generated ID and timestamps
   * @throws {ServiceError} If session creation fails
   *
   * @example
   * const session = await service.createSession({
   *   cartId: 'cart-123',
   *   cartVersion: 1,
   *   paymentToken: 'tok_visa_4242',
   *   tokenType: 'transient',
   *   billTo: { ... },
   *   threeDSSetupData: { referenceId: '3ds-ref-456' }
   * });
   */
  createSession(request: CreateSessionRequest): Promise<AuthenticationSession>;

  /**
   * Retrieve an authentication session by ID
   *
   * @param threeDSSessionId - Session identifier
   * @returns Session if found and not expired, null otherwise
   * @throws {ServiceError} If retrieval fails due to service error
   *
   * @example
   * const session = await service.getSession('auth_abc123');
   * if (!session) {
   *   throw new ConflictError('Session not found or expired');
   * }
   */
  getSession(threeDSSessionId: string): Promise<AuthenticationSession | null>;

  /**
   * Mark a session as used (single-use enforcement)
   *
   * @param threeDSSessionId - Session identifier
   * @throws {SessionAlreadyUsedError} If session is already used
   * @throws {SessionNotFoundError} If session doesn't exist
   * @throws {ServiceError} If update fails due to service error
   *
   * @example
   * await service.markSessionUsed('auth_abc123');
   */
  markSessionUsed(threeDSSessionId: string): Promise<void>;

  /**
   * Delete a session (cleanup after order creation)
   *
   * @param threeDSSessionId - Session identifier
   * @returns true if deleted, false if not found
   * @throws {ServiceError} If deletion fails due to service error
   *
   * @example
   * await service.deleteSession('auth_abc123');
   */
  deleteSession(threeDSSessionId: string): Promise<boolean>;

  /**
   * Health check for the storage provider
   *
   * @returns true if service is operational
   *
   * @example
   * const isHealthy = await service.healthCheck();
   */
  healthCheck(): Promise<boolean>;
}
