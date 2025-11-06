/**
 * Credentials Loader - AWS Secrets Manager integration
 *
 * Loads Cybersource payment credentials from AWS Secrets Manager or environment variables.
 * Implements caching to reduce Secrets Manager API calls (Lambda warm start optimization).
 *
 * Secret Structure in AWS Secrets Manager:
 * {
 *   "europe": {
 *     "uklait": { "merchantID": "...", "merchantKeyId": "...", "merchantsecretKey": "..." },
 *     "itwm": { ... }
 *   },
 *   "americas": {
 *     "us4s": { ... },
 *     "cawd": { ... }
 *   },
 *   "apac": {
 *     "auwp": { ... }
 *   }
 * }
 *
 * Environment Variables:
 *   PAYMENT_CREDENTIALS_SECRET - AWS Secrets Manager secret name (e.g., "checkout-api/dev/cybersource-credentials")
 *   CYBS_MERCHANT_ID           - Fallback: Direct Cybersource merchant ID
 *   CYBS_KEY_ID                - Fallback: Direct Cybersource key ID
 *   CYBS_SECRET_KEY            - Fallback: Direct Cybersource secret key
 *
 * Usage:
 *   const credentials = await loadCredentialsForBrand('uklait');
 *   const paymentService = new PaymentService('cybersource', credentials);
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface CybersourceCredentials {
  merchantID: string;
  merchantKeyId: string;
  merchantsecretKey: string;
}

export interface PaymentCredentials {
  europe?: { [brandkey: string]: CybersourceCredentials };
  americas?: { [brandkey: string]: CybersourceCredentials };
  apac?: { [brandkey: string]: CybersourceCredentials };
}

// In-memory cache for credentials (Lambda warm start optimization)
let credentialsCache: PaymentCredentials | null = null;
let cacheTimestamp: number | null = null;
const CACHE_TTL_MS = 300000; // 5 minutes

/**
 * Load payment credentials for a specific brand
 *
 * @param brandkey Brand identifier (e.g., 'uklait', 'us4s', 'auwp')
 * @returns Cybersource credentials for the specified brand
 * @throws Error if credentials cannot be loaded or brand not found
 */
export async function loadCredentialsForBrand(brandkey: string): Promise<CybersourceCredentials> {
  const secretName = process.env.PAYMENT_CREDENTIALS_SECRET;

  if (secretName) {
    console.log(`🔐 Loading credentials from AWS Secrets Manager: ${secretName}`);
    return await loadFromSecretsManager(brandkey, secretName);
  } else {
    console.warn('⚠️  WARNING: PAYMENT_CREDENTIALS_SECRET not set. Falling back to environment variables (CYBS_MERCHANT_ID, CYBS_KEY_ID, CYBS_SECRET_KEY).');
    console.warn('⚠️  This fallback is for backward compatibility only. Production deployments should use AWS Secrets Manager.');
    return loadFromEnvironmentVariables();
  }
}

/**
 * Load credentials from AWS Secrets Manager with caching
 */
async function loadFromSecretsManager(brandkey: string, secretName: string): Promise<CybersourceCredentials> {
  const now = Date.now();

  // Return cached credentials if still valid
  if (credentialsCache && cacheTimestamp && (now - cacheTimestamp < CACHE_TTL_MS)) {
    console.log(`✅ Using cached credentials (age: ${Math.floor((now - cacheTimestamp) / 1000)}s)`);
    return extractBrandCredentials(credentialsCache, brandkey);
  }

  console.log(`🔄 Loading credentials from Secrets Manager: ${secretName}`);

  // AWS_REGION is automatically set by Lambda runtime
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-west-1'
  });

  const command = new GetSecretValueCommand({
    SecretId: secretName
  });

  try {
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} exists but has no SecretString value`);
    }

    let parsedCredentials: PaymentCredentials;
    try {
      parsedCredentials = JSON.parse(response.SecretString) as PaymentCredentials;
    } catch (parseError) {
      console.error('❌ Failed to parse secret JSON:', parseError);
      throw new Error(`Secret ${secretName} contains invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
    }

    credentialsCache = parsedCredentials;
    cacheTimestamp = now;

    console.log(`✅ Credentials loaded and cached successfully`);
    return extractBrandCredentials(credentialsCache, brandkey);

  } catch (error: any) {
    // Handle specific AWS SDK errors with actionable messages
    if (error.name === 'ResourceNotFoundException') {
      console.error(`❌ Secret not found: ${secretName}`);
      throw new Error(`Secret '${secretName}' does not exist in AWS Secrets Manager. Please create the secret or check PAYMENT_CREDENTIALS_SECRET environment variable.`);
    }

    if (error.name === 'AccessDeniedException') {
      console.error(`❌ Access denied to secret: ${secretName}`);
      throw new Error(`Lambda execution role lacks permission to access secret '${secretName}'. Add secretsmanager:GetSecretValue permission for ARN: arn:aws:secretsmanager:${process.env.AWS_REGION}:*:secret:${secretName}*`);
    }

    if (error.name === 'InvalidParameterException' || error.name === 'InvalidRequestException') {
      console.error(`❌ Invalid request to Secrets Manager:`, error);
      throw new Error(`Invalid secret name or request: ${error.message}`);
    }

    if (error.name === 'InternalServiceException') {
      console.error(`❌ AWS Secrets Manager service error:`, error);
      throw new Error(`AWS Secrets Manager is experiencing issues. Please retry later. (${error.message})`);
    }

    if (error.name === 'ThrottlingException') {
      console.error(`❌ Secrets Manager rate limit exceeded:`, error);
      throw new Error(`Too many requests to Secrets Manager. Lambda may need reserved concurrency or caching improvements. (${error.message})`);
    }

    if (error.name === 'DecryptionFailure') {
      console.error(`❌ Failed to decrypt secret:`, error);
      throw new Error(`Unable to decrypt secret '${secretName}'. Check KMS key permissions and key status. (${error.message})`);
    }

    // Re-throw errors from extractBrandCredentials (contains useful brand info)
    if (error.message?.includes('No credentials found for brand')) {
      throw error;
    }

    // Re-throw JSON parsing errors (already logged above)
    if (error.message?.includes('contains invalid JSON')) {
      throw error;
    }

    // Unknown error - log full details and throw with context
    console.error('❌ Unexpected error loading credentials from Secrets Manager:', {
      errorName: error.name,
      errorMessage: error.message,
      secretName,
      brandkey
    });
    throw new Error(`Failed to load payment credentials: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Extract credentials for a specific brand from the full credentials object
 */
function extractBrandCredentials(credentials: PaymentCredentials, brandkey: string): CybersourceCredentials {
  // Search through all regions for the brand
  for (const region of ['europe', 'americas', 'apac'] as const) {
    const regionCreds = credentials[region];
    if (regionCreds && regionCreds[brandkey]) {
      console.log(`✅ Found credentials for brand '${brandkey}' in region '${region}'`);
      return regionCreds[brandkey];
    }
  }

  throw new Error(`No credentials found for brand: ${brandkey}. Available brands: ${getAvailableBrands(credentials).join(', ')}`);
}

/**
 * Get list of available brands for error reporting
 */
function getAvailableBrands(credentials: PaymentCredentials): string[] {
  const brands: string[] = [];

  for (const region of ['europe', 'americas', 'apac'] as const) {
    const regionCreds = credentials[region];
    if (regionCreds) {
      brands.push(...Object.keys(regionCreds));
    }
  }

  return brands;
}

/**
 * Load credentials from environment variables (backward compatibility)
 */
function loadFromEnvironmentVariables(): CybersourceCredentials {
  const merchantID = process.env.CYBS_MERCHANT_ID;
  const merchantKeyId = process.env.CYBS_KEY_ID;
  const merchantsecretKey = process.env.CYBS_SECRET_KEY;

  if (!merchantID || !merchantKeyId || !merchantsecretKey) {
    throw new Error('Cybersource credentials not configured. Required environment variables: CYBS_MERCHANT_ID, CYBS_KEY_ID, CYBS_SECRET_KEY');
  }

  // Log with safe masking to avoid exposing sensitive data
  const maskedId = merchantID.length > 8
    ? `${merchantID.substring(0, 4)}...${merchantID.substring(merchantID.length - 4)}`
    : '****';
  console.log(`✅ Loaded credentials from environment variables (merchantID: ${maskedId})`);
  console.log(`ℹ️  Credential source: Environment variables (not Secrets Manager)`);

  return {
    merchantID,
    merchantKeyId,
    merchantsecretKey
  };
}

/**
 * Clear the credentials cache (for testing only)
 * @internal
 */
export function clearCredentialsCache(): void {
  credentialsCache = null;
  cacheTimestamp = null;
}
