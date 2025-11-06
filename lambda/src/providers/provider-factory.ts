/**
 * Provider Factory - Singleton pattern for payment provider
 *
 * Creates and caches the appropriate payment provider based on environment configuration.
 * Supports both real Cybersource integration (via payments-sdk) and mock provider for testing.
 *
 * Usage:
 *   const provider = getPaymentProvider();
 *   const result = await provider.processTokenCapture(request, brandkey);
 *
 * Environment Variables:
 *   USE_REAL_PAYMENT_PROVIDER=true  - Use real Cybersource via payments-sdk
 *   USE_REAL_PAYMENT_PROVIDER=false - Use mock provider (default)
 */

import { PaymentProvider } from './types';
import { RealPaymentProvider } from './real/real-payment-provider';
import { MockPaymentProvider } from './mock/mock-payment-provider';

// Singleton instance (persists across Lambda warm starts)
let providerInstance: PaymentProvider | null = null;

/**
 * Get the payment provider instance (singleton)
 *
 * The provider is determined by the USE_REAL_PAYMENT_PROVIDER environment variable.
 * Once created, the same instance is reused for all subsequent invocations in the
 * same Lambda container (warm start optimization).
 */
export function getPaymentProvider(): PaymentProvider {
  if (providerInstance) {
    return providerInstance;
  }

  const useRealProvider = process.env.USE_REAL_PAYMENT_PROVIDER === 'true';

  if (useRealProvider) {
    console.log('✅ Using REAL payment provider (Cybersource via payments-sdk)');
    providerInstance = new RealPaymentProvider();
  } else {
    console.log('🧪 Using MOCK payment provider (test mode)');
    providerInstance = new MockPaymentProvider();
  }

  return providerInstance;
}

/**
 * Reset provider instance (for testing only)
 * @internal
 */
export function resetProviderInstance(): void {
  providerInstance = null;
}
