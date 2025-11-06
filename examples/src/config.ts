import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ApiConfig, RunnerOptions, DeploymentLock, CybersourceCredentials } from './types';

// Load environment variables
dotenvConfig();

function readLockFile(): DeploymentLock | null {
  try {
    // Look for lock file in parent directory (project root)
    const lockPath = join(__dirname, '..', '..', '.api-deployment.lock');

    if (!existsSync(lockPath)) {
      return null;
    }

    const lockContent = readFileSync(lockPath, 'utf-8');
    const lockData = JSON.parse(lockContent) as DeploymentLock;

    return lockData;
  } catch (error) {
    // Silently fail if lock file can't be read/parsed
    return null;
  }
}

export function getConfig(options: RunnerOptions = {}): ApiConfig {
  // Try to load from lock file if no CLI or env options provided
  const lockData = readLockFile();

  // Priority: CLI options > Environment variables > Lock file > Defaults
  const apiId = options.apiId
    || process.env.API_ID
    || process.env.CHECKOUT_API_ID
    || lockData?.apiId;

  const brandKey = options.brandKey
    || process.env.BRAND_KEY
    || process.env.CHECKOUT_BRAND_KEY
    || 'uklait';

  const region = options.region
    || process.env.AWS_REGION
    || process.env.CHECKOUT_REGION
    || lockData?.region
    || 'eu-west-1';

  if (!apiId) {
    throw new Error(
      'API ID is required. Provide it via:\n' +
      '  - CLI argument: --api-id <id>\n' +
      '  - Environment variable: API_ID or CHECKOUT_API_ID\n' +
      '  - .env file: API_ID=<id>\n' +
      '  - Deploy the API to create .api-deployment.lock'
    );
  }

  const stage = lockData?.stage || 'dev';
  const baseUrl = `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`;

  const apiConfig: ApiConfig = {
    apiId,
    brandKey,
    baseUrl,
    region
  };

  if (lockData) {
    apiConfig.lockData = lockData;
  }

  return apiConfig;
}

export function validateConfig(config: ApiConfig): void {
  const errors: string[] = [];

  if (!config.apiId || config.apiId.trim() === '') {
    errors.push('API ID cannot be empty');
  }

  if (!config.brandKey || config.brandKey.trim() === '') {
    errors.push('Brand key cannot be empty');
  }

  if (!config.region || config.region.trim() === '') {
    errors.push('Region cannot be empty');
  }

  // Basic API ID format validation (AWS API Gateway format)
  if (config.apiId && !/^[a-z0-9]{10}$/.test(config.apiId)) {
    console.warn(`Warning: API ID "${config.apiId}" doesn't match expected AWS API Gateway format (10 lowercase alphanumeric characters)`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
}

export function parseCliArgs(args: string[]): RunnerOptions {
  const options: RunnerOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--api-id':
      case '-a':
        if (!nextArg || nextArg.startsWith('-')) {
          throw new Error(`${arg} requires a value`);
        }
        options.apiId = nextArg;
        i++;
        break;

      case '--brand-key':
      case '--brand':
      case '-b':
        if (!nextArg || nextArg.startsWith('-')) {
          throw new Error(`${arg} requires a value`);
        }
        options.brandKey = nextArg;
        i++;
        break;

      case '--region':
      case '-r':
        if (!nextArg || nextArg.startsWith('-')) {
          throw new Error(`${arg} requires a value`);
        }
        options.region = nextArg;
        i++;
        break;

      case '--example':
      case '-e':
        if (!nextArg || nextArg.startsWith('-')) {
          throw new Error(`${arg} requires a value`);
        }
        options.example = nextArg;
        i++;
        break;

      case '--timeout':
      case '-t':
        if (!nextArg || nextArg.startsWith('-')) {
          throw new Error(`${arg} requires a value`);
        }
        const timeout = parseInt(nextArg, 10);
        if (isNaN(timeout) || timeout <= 0) {
          throw new Error(`Invalid timeout value: ${nextArg}`);
        }
        options.timeout = timeout;
        i++;
        break;

      case '--verbose':
      case '-v':
        options.verbose = true;
        break;

      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;

      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        // Treat first non-option argument as API ID for backwards compatibility
        if (!options.apiId && !arg.includes('=')) {
          options.apiId = arg;
        }
        break;
    }
  }

  return options;
}

export function printUsage(): void {
  console.log(`
Usage: npm run dev [options] [api-id]

Options:
  -a, --api-id <id>       API Gateway ID (auto-loaded from .api-deployment.lock if available)
  -b, --brand-key <key>   Brand key (default: uklait)
  -r, --region <region>   AWS region (default: eu-west-1)
  -e, --example <name>    Run specific example (token-capture|validate-capture)
  -t, --timeout <ms>      Request timeout in milliseconds (default: 10000)
  -v, --verbose           Verbose output
  -h, --help              Show this help message

Environment Variables:
  API_ID                  API Gateway ID
  CHECKOUT_API_ID         Alternative API Gateway ID
  BRAND_KEY               Brand key
  CHECKOUT_BRAND_KEY      Alternative brand key
  AWS_REGION              AWS region
  CHECKOUT_REGION         Alternative AWS region
  CYBS_MERCHANT_ID        Cybersource merchant ID (for real token generation)
  CYBS_KEY_ID             Cybersource key ID (for real token generation)
  CYBS_SECRET_KEY         Cybersource secret key (for real token generation)

Deployment Lock File:
  .api-deployment.lock    Automatically created by deploy-single-account.sh
                          Contains API ID, region, and stage information

Examples:
  npm run dev                                         # Uses .api-deployment.lock
  npm run dev abc123xyz9                              # Override with API ID
  npm run dev --api-id abc123xyz9 --brand-key us4s    # Full options
  npm run dev --api-id abc123xyz9 --example token-capture
  API_ID=abc123xyz9 npm run dev                       # Environment variable
`);
}

export function getCybersourceCredentials(): CybersourceCredentials | null {
  const merchantID = process.env.CYBS_MERCHANT_ID;
  const merchantKeyId = process.env.CYBS_KEY_ID;
  const merchantsecretKey = process.env.CYBS_SECRET_KEY;

  if (!merchantID || !merchantKeyId || !merchantsecretKey) {
    return null;
  }

  return {
    merchantID,
    merchantKeyId,
    merchantsecretKey
  };
}

export function validateCybersourceCredentials(credentials: CybersourceCredentials | null): void {
  if (!credentials) {
    console.warn('⚠️  Warning: Cybersource credentials not configured.');
    console.warn('   TokenService features will not be available.');
    console.warn('   To enable real transient token generation, set the following environment variables:');
    console.warn('     - CYBS_MERCHANT_ID');
    console.warn('     - CYBS_KEY_ID');
    console.warn('     - CYBS_SECRET_KEY');
    console.warn('   Or copy .env.example to .env and update with your credentials.\n');
  }
}
