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

    // Replace Lambda integration URI with actual ARN
    const lambdaIntegrationUri = `arn:aws:apigateway:${props.config.region}:lambda:path/2015-03-31/functions/${props.lambdaLiveAliasArn}/invocations`;

    // Extract ServiceAccountID from the Lambda ARN
    // Lambda ARN format: arn:aws:lambda:region:account-id:function:function-name:alias
    const serviceAccountId = props.lambdaLiveAliasArn.split(':')[4];

    // Replace template variables in OpenAPI spec
    // First replace the entire integration URI pattern with our live alias ARN
    const uriPattern = /arn:aws:apigateway:\$\{AWSRegion\}:lambda:path\/2015-03-31\/functions\/arn:aws:lambda:\$\{AWSRegion\}:\$\{ServiceAccountID\}:function:dwaws-\$\{Environment\}-checkout-order-capture-lambda\/invocations/g;
    openApiSpec = openApiSpec.replace(uriPattern, lambdaIntegrationUri);

    // Then replace any remaining standalone variables
    openApiSpec = openApiSpec.replace(/\$\{LambdaIntegrationUri\}/g, lambdaIntegrationUri);
    openApiSpec = openApiSpec.replace(/\$\{AWSRegion\}/g, props.config.region);
    openApiSpec = openApiSpec.replace(/\$\{ServiceAccountID\}/g, serviceAccountId);
    openApiSpec = openApiSpec.replace(/\$\{Environment\}/g, props.config.environment);

    // Replace CIDM-related variables for GlobalAuthorizer
    // In single-account deployments, these use the same account as the API
    openApiSpec = openApiSpec.replace(/\$\{CIDMAccountID\}/g, props.config.apiAccountId);
    openApiSpec = openApiSpec.replace(/\$\{ApiAccountID\}/g, props.config.apiAccountId);
    openApiSpec = openApiSpec.replace(/\$\{CIDMEnvironment\}/g, props.config.environment);

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
