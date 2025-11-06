# Authentication Session Infrastructure

CDK infrastructure for deploying the DynamoDB table and monitoring resources for authentication session management.

## Prerequisites

- Node.js 22+
- AWS CLI configured with appropriate credentials
- AWS CDK CLI v2

## Quick Start

### Deploy to Development

```bash
# From the mono-repo root
npm run deploy:dev

# Or directly
./scripts/deploy.sh --profile dw-sandbox --environment dev
```

### Show Infrastructure Changes

```bash
# From the mono-repo root
npm run diff:dev

# Or directly
./scripts/diff.sh --profile dw-sandbox --environment dev
```

### Destroy Infrastructure

```bash
# From the mono-repo root
npm run destroy:dev

# Or directly
./scripts/destroy.sh --profile dw-sandbox --environment dev
```

## Configuration

Configuration is provided via CDK context parameters:

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `environment` | Yes | `dev` | Deployment environment (dev, sit, uat, prod) |
| `region` | No | `eu-west-1` | AWS region |
| `accountId` | Yes | Auto-detected | AWS account ID |
| `tableNamePrefix` | No | - | Custom table name prefix |
| `pointInTimeRecovery` | No | `true` for prod | Enable PITR backups |

## What Gets Deployed

### DynamoDB Table

- **Name**: `{environment}-checkout-authentication-sessions`
- **Partition Key**: `authenticationId` (String)
- **Billing Mode**: On-demand (PAY_PER_REQUEST)
- **TTL**: Enabled on `ttl` attribute (30-minute sessions)
- **Encryption**: AWS-managed encryption at rest
- **Backups**: Point-in-time recovery (enabled for prod)

### CloudWatch Alarms

- **Throttle Alarm**: Triggers when table experiences throttling
- **Item Count Alarm**: Triggers if table grows unexpectedly (>100k items)
- **User Error Alarm**: Triggers on high rate of 4xx errors
- **Read Capacity Alarm**: Triggers on high read capacity consumption

### SNS Topic

- **Name**: `{environment}-checkout-auth-session-alarms`
- **Purpose**: Receives alarm notifications

## CloudFormation Outputs

| Output | Description |
|--------|-------------|
| `TableName` | DynamoDB table name |
| `TableArn` | DynamoDB table ARN |
| `AlarmTopicArn` | SNS topic ARN for alarms |

## Usage in Lambda Functions

After deployment, configure your Lambda functions:

### Environment Variables

```bash
AUTH_SESSION_TABLE_NAME=dev-checkout-authentication-sessions
AWS_REGION=eu-west-1
```

### IAM Permissions

Grant Lambda execution role access to the table:

```typescript
table.grantReadWriteData(lambdaFunction);
```

Or explicit policy:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem"
  ],
  "Resource": "arn:aws:dynamodb:eu-west-1:123456789012:table/dev-checkout-authentication-sessions"
}
```

## Development

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test           # Watch mode
npm run test:run   # Single run
```

### CDK Commands

```bash
# Synthesize CloudFormation template
npx cdk synth -c environment=dev -c accountId=123456789012

# List stacks
npx cdk list -c environment=dev -c accountId=123456789012

# Show diff
npx cdk diff -c environment=dev -c accountId=123456789012

# Deploy
npx cdk deploy -c environment=dev -c accountId=123456789012
```

## Cost Estimation

Based on on-demand pricing:

| Traffic Level | Sessions/Day | Monthly Cost |
|--------------|--------------|--------------|
| Low | 1,000 | ~$0.02 |
| Medium | 10,000 | ~$0.20 |
| High | 100,000 | ~$2.00 |
| Very High | 1,000,000 | ~$20.00 |

Costs include:
- Write requests (create, update, delete)
- Read requests (get)
- Storage (minimal, sessions auto-delete after 30 minutes)

## Monitoring

Subscribe to the SNS alarm topic to receive notifications:

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-west-1:123456789012:dev-checkout-auth-session-alarms \
  --protocol email \
  --notification-endpoint your-email@example.com
```

## Troubleshooting

### Table Not Found

Ensure the stack is deployed and the table name environment variable matches the deployed table name.

### High Item Count Alarm

Check if TTL is enabled and configured correctly. Sessions should automatically expire after 30 minutes.

### Throttling Errors

Consider switching to provisioned capacity mode with auto-scaling if traffic patterns are predictable.

## Related Documentation

- [Library README](../library/README.md)
- [Technical Specification](../../../docs/validate-capture/SPEC-Authentication-Session-Library.md)
- [AWS DynamoDB TTL Documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
