import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
      }
    });

    this.serviceFunction = fn;

    const version = fn.currentVersion;
    this.liveAlias = new lambda.Alias(this, 'LiveAlias', {
      aliasName: 'live',
      version
    });

    // Add cross-account API Gateway invoke permissions
    const sourceArn = `arn:aws:execute-api:${props.config.region}:${props.config.apiAccountId}:*/*/*`;

    // Permission for base function (backwards compatibility)
    this.serviceFunction.addPermission('ApiGatewayInvokePermissionBase', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceAccount: props.config.apiAccountId,
      action: 'lambda:InvokeFunction',
      sourceArn: sourceArn
    });

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
