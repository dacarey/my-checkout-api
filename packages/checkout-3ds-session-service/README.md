# Checkout Authentication Service

3DS authentication session management library and infrastructure for Direct Wines Checkout API.

## Overview

This mono-repo contains:

- **Library** (`library/`) - NPM package for authentication session management
- **Infrastructure** (`infra/`) - CDK code to deploy DynamoDB table and monitoring

The library manages temporary session state for 3DS authentication workflows. When the Checkout API returns HTTP 202 (authentication required), it creates a server-side session that preserves cart context, payment tokens, and 3DS setup data.

## Project Structure

```
checkout-authentication-service/
├── library/                    # NPM library
│   ├── src/
│   │   ├── core/              # Core types, interfaces, errors
│   │   ├── providers/         # DynamoDB and Mock implementations
│   │   └── factory/           # Service factory functions
│   ├── test/                  # Unit tests
│   └── package.json
├── infra/                     # CDK infrastructure
│   ├── src/
│   │   ├── bin/              # CDK app entry point
│   │   └── lib/              # Stack definitions
│   ├── test/                 # Infrastructure tests
│   └── package.json
├── scripts/                   # Deployment scripts
│   ├── deploy.sh
│   ├── diff.sh
│   └── destroy.sh
└── package.json              # Mono-repo root
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Deploy Infrastructure

```bash
# Deploy to dev environment
npm run deploy:dev

# Or with custom settings
./scripts/deploy.sh --profile dw-sandbox --environment dev --region eu-west-1
```

### 3. Use the Library

```typescript
import { DynamoDBAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/dynamodb';

const service = new DynamoDBAuthenticationService({
  tableName: process.env.AUTH_SESSION_TABLE_NAME!,
  region: process.env.AWS_REGION || 'eu-west-1'
});

// Create session
const session = await service.createSession({
  cartId: 'cart-123',
  cartVersion: 1,
  paymentToken: 'tok_visa_4242',
  tokenType: 'transient',
  billTo: { /* billing details */ },
  customerId: 'customer-123'
});
```

## Features

- **Abstraction**: Interface-based design enabling provider swapping
- **Security-First**: Encrypted storage, single-use sessions, time-limited validity
- **Testability**: Mock provider for fast, deterministic unit tests
- **Production-Ready**: DynamoDB provider with automatic TTL-based cleanup
- **Infrastructure as Code**: CDK stack with monitoring and alarms

## NPM Scripts

### Build

```bash
npm run build              # Build both library and infra
npm run build:library      # Build library only
npm run build:infra        # Build infra only
```

### Test

```bash
npm test                   # Run library tests in watch mode
npm run test:run           # Run library tests once
```

### Deploy

```bash
npm run deploy:dev         # Deploy to dev environment
npm run diff:dev           # Show infrastructure changes
npm run destroy:dev        # Destroy dev infrastructure
```

## Library Usage

### DynamoDB Provider (Production)

```typescript
import { DynamoDBAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/dynamodb';

const service = new DynamoDBAuthenticationService({
  tableName: process.env.AUTH_SESSION_TABLE_NAME!,
  region: process.env.AWS_REGION || 'eu-west-1'
});

// Create session
const session = await service.createSession({
  cartId: 'cart-123',
  cartVersion: 1,
  paymentToken: 'tok_visa_4242',
  tokenType: 'transient',
  billTo: { /* billing details */ }
});

// Retrieve session
const retrieved = await service.getSession(session.id);

// Mark as used (prevents replay attacks)
await service.markSessionUsed(session.id);

// Delete session
await service.deleteSession(session.id);
```

### Mock Provider (Testing)

```typescript
import { MockAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service/mock';

const service = new MockAuthenticationService({
  enableAutomaticCleanup: true
});

// Use same API as DynamoDB provider
const session = await service.createSession({ /* ... */ });
```

### Factory Pattern (Lambda)

```typescript
import { getAuthenticationService } from '@dw-digital-commerce/checkout-authentication-service';

// Automatically creates appropriate service based on environment
const service = getAuthenticationService();
```

## Documentation

- **Library**: [library/README.md](library/README.md)
- **Infrastructure**: [infra/README.md](infra/README.md)
- **Technical Specification**: [../../docs/validate-capture/SPEC-Authentication-Session-Library.md](../../docs/validate-capture/SPEC-Authentication-Session-Library.md)

## Future: Extracting to Separate Repository

This mono-repo structure makes it easy to extract into a standalone repository:

1. Copy the entire `checkout-authentication-service/` directory
2. Update repository references in `package.json` files
3. Set up GitHub Actions for CI/CD
4. Publish library to GitHub Packages or private npm registry

