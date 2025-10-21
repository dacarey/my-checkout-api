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

/**
 * Replaces all template variables in a string using a variable mapping.
 * Uses global regex replacement to handle multiple occurrences.
 */
function replaceTemplateVariables(content: string, variableMap: Record<string, string>): string {
  let result = content;
  for (const [variable, value] of Object.entries(variableMap)) {
    const pattern = new RegExp(escapeRegExp(variable), 'g');
    result = result.replace(pattern, value);
  }
  return result;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    // Replace template variables in OpenAPI spec using centralized mapping
    const variableMap: Record<string, string> = {
      '${LambdaIntegrationUri}': lambdaIntegrationUri,
      '${AWSRegion}': props.config.region,
      '${ServiceAccountID}': serviceAccountId,
      '${Environment}': props.config.environment,
      '${CIDMAccountID}': props.config.apiAccountId,
      '${ApiAccountID}': props.config.apiAccountId,
      '${CIDMEnvironment}': props.config.environment
    };

    openApiSpec = replaceTemplateVariables(openApiSpec, variableMap);

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
