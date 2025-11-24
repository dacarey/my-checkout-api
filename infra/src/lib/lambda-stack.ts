import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ServiceConfig } from './config';

export interface LambdaStackProps extends StackProps {
  config: ServiceConfig;
}

export class LambdaStack extends Stack {
  public readonly liveAlias: lambda.Alias;
  public readonly serviceFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.serviceAccountId, region: props.config.region }
    });

    // Generate function name to match OpenAPI spec naming convention
    const functionName = `dwaws-${props.config.environment}-checkout-order-capture-lambda`;

    // Create log group with explicit retention policy
    const logGroup = new logs.LogGroup(this, 'ServiceLambdaLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const fn = new NodejsFunction(this, 'ServiceLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: '../lambda/src/index.ts',
      handler: 'handler',
      functionName: functionName,
      timeout: Duration.seconds(10),
      bundling: {
        minify: true,
        target: 'node22',
        externalModules: []
      },
      logGroup: logGroup,
      environment: {
        USE_REAL_PAYMENT_PROVIDER: process.env.USE_REAL_PAYMENT_PROVIDER || 'false',
        PAYMENT_CREDENTIALS_SECRET: process.env.PAYMENT_CREDENTIALS_SECRET || `dwaws-${props.config.environment}-payments-credentials`,
        DEFAULT_BRANDKEY: props.config.brandKey || 'uklait',
        NODE_ENV: props.config.environment,
        ENVIRONMENT: props.config.environment, // Required by checkout-3ds-session-service
        AUTH_SESSION_TABLE_NAME: `checkout-api-${props.config.environment}-3ds-sessions`,
        USE_MOCK_AUTH: props.config.useMock3dsSessionService.toString() // Configured via CDK context (checkout-3ds-session-service)
      }
    });

    this.serviceFunction = fn;

    // Add IAM permissions for Secrets Manager access
    // This allows Lambda to retrieve Cybersource credentials from AWS Secrets Manager
    // Reuses the same secret as my-payments-api: dwaws-{environment}-payments-credentials
    fn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret'
      ],
      resources: [
        `arn:aws:secretsmanager:${props.config.region}:${props.config.serviceAccountId}:secret:dwaws-${props.config.environment}-payments-credentials-*`
      ]
    }));

    // Add IAM permissions for DynamoDB access (3DS session storage)
    // This allows Lambda to read/write 3DS authentication sessions
    // Note: Permissions are always added, but only used when useMock3dsSessionService=false
    const tableName = `checkout-api-${props.config.environment}-3ds-sessions`;
    fn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [
        `arn:aws:dynamodb:${props.config.region}:${props.config.serviceAccountId}:table/${tableName}`,
        `arn:aws:dynamodb:${props.config.region}:${props.config.serviceAccountId}:table/${tableName}/index/*`
      ]
    }));

    const version = fn.currentVersion;
    this.liveAlias = new lambda.Alias(this, 'LiveAlias', {
      aliasName: 'live',
      version
    });

    // Add cross-account API Gateway invoke permissions
    // Only add permission to the alias since API Gateway integration uses the alias ARN
    const sourceArn = `arn:aws:execute-api:${props.config.region}:${props.config.apiAccountId}:*/*/*`;

    // Permission for live alias (blue-green deployments)
    this.liveAlias.addPermission('ApiGatewayInvokePermission', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceAccount: props.config.apiAccountId,
      action: 'lambda:InvokeFunction',
      sourceArn: sourceArn
    });

    // Outputs
    new CfnOutput(this, 'FunctionName', {
      value: this.serviceFunction.functionName,
      description: 'Lambda function name'
    });

    new CfnOutput(this, 'LiveAliasArn', {
      value: this.liveAlias.functionArn,
      description: 'Lambda live alias ARN'
    });
  }
}
