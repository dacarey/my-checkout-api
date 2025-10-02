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

    // Generate function name based on configuration
    const functionName = `${props.config.functionNamePrefix}-${props.config.environment}-service-lambda`;

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
      logGroup: logGroup
    });

    this.serviceFunction = fn;

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
