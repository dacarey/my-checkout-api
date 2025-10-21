import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ServiceConfig } from './config';

export interface ApiStackProps extends StackProps {
  lambdaLiveAliasArn: string;
  config: ServiceConfig;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.apiAccountId, region: props.config.region }
    });

    // 1. Import the live alias
    const importedFn = lambda.Function.fromFunctionArn(
      this, 'ImportedLiveAlias', props.lambdaLiveAliasArn
    );

    // 2. Process OpenAPI spec with variable substitution
    const openApiSpecPath = path.join(__dirname, '../../../openapi/checkout-openapi.yaml');
    let openApiSpec = fs.readFileSync(openApiSpecPath, 'utf8');

    // Extract ServiceAccountID from the Lambda ARN
    // Lambda ARN format: arn:aws:lambda:region:account-id:function:function-name:alias
    const serviceAccountId = props.lambdaLiveAliasArn.split(':')[4];

    // Use configuration values for substitution (Direct Wines standard pattern)
    const region = props.config.region;
    const environment = props.config.environment;
    const apiAccountId = props.config.apiAccountId;

    // First, replace variable placeholders so we can match the function name pattern
    openApiSpec = openApiSpec.replace(/\$\{AWSRegion\}/g, region);
    openApiSpec = openApiSpec.replace(/\$\{ServiceAccountID\}/g, serviceAccountId);
    openApiSpec = openApiSpec.replace(/\$\{Environment\}/g, environment);
    openApiSpec = openApiSpec.replace(/\$\{ApiAccountID\}/g, apiAccountId);
    openApiSpec = openApiSpec.replace(/\$\{CIDMAccountID\}/g, apiAccountId);
    openApiSpec = openApiSpec.replace(/\$\{CIDMEnvironment\}/g, environment);

    // Now replace the Lambda ARN template with the actual alias ARN
    // This follows the Direct Wines standard pattern from Payments API
    const lambdaIntegrationUri = `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${props.lambdaLiveAliasArn}/invocations`;

    // Replace all Lambda integration URIs (now that variables are resolved)
    const expectedFunctionName = `dwaws-${environment}-checkout-order-capture-lambda`;
    const lambdaArnPattern = new RegExp(
      `arn:aws:apigateway:${region}:lambda:path\\/2015-03-31\\/functions\\/arn:aws:lambda:${region}:${serviceAccountId}:function:${expectedFunctionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/invocations`,
      'g'
    );
    openApiSpec = openApiSpec.replace(lambdaArnPattern, lambdaIntegrationUri);

    // Optional: Development-only authorizer bypass
    const isDevelopment = props.config.environment === 'dev';
    const bypassAuthorizer = process.env.BYPASS_AUTHORIZER === 'true' && isDevelopment;

    if (bypassAuthorizer) {
      console.warn('🔓 BYPASS_AUTHORIZER enabled - removing security requirements (dev only)');
      // Remove security requirements from POST endpoints
      openApiSpec = openApiSpec.replace(/security:\s*-\s*GlobalAuthoriser:\s*\[\]/g, '');
    }

    // Parse processed YAML into JavaScript object
    const openApiObject = yaml.load(openApiSpec) as any;

    // Remove authorizer definition when bypassing (after parsing YAML)
    if (bypassAuthorizer && openApiObject.components?.securitySchemes) {
      delete openApiObject.components.securitySchemes.GlobalAuthoriser;
      if (Object.keys(openApiObject.components.securitySchemes).length === 0) {
        delete openApiObject.components.securitySchemes;
      }
    }

    // 3. Create API with processed spec
    const api = new apigw.SpecRestApi(this, 'CheckoutApi', {
      apiDefinition: apigw.ApiDefinition.fromInline(openApiObject),
      endpointTypes: [apigw.EndpointType.REGIONAL],
      deployOptions: { stageName: props.config.environment }
    });

    // 4. Add CloudFormation outputs
    new CfnOutput(this, 'ApiGatewayId', {
      value: api.restApiId,
      description: 'API Gateway REST API ID'
    });

    new CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL'
    });

    // Note: Lambda permissions are handled in the Lambda stack
    console.log('✅ Lambda permissions handled in Lambda stack');
  }
}
