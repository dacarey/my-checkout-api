import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ThreeDSSessionStack } from '../src/lib/threeds-session-stack';

describe('ThreeDSSessionStack', () => {
  it('should create DynamoDB table with correct configuration', () => {
    const app = new cdk.App();
    const stack = new ThreeDSSessionStack(app, 'TestStack', {
      config: {
        environment: 'test',
        region: 'eu-west-1',
        accountId: '123456789012',
        pointInTimeRecovery: false,
        removalPolicy: 'DESTROY'
      },
      env: {
        account: '123456789012',
        region: 'eu-west-1'
      }
    });

    const template = Template.fromStack(stack);

    // Assert DynamoDB table exists with correct properties
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'test-checkout-3ds-sessions',
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        {
          AttributeName: 'threeDSSessionId',
          AttributeType: 'S'
        }
      ],
      KeySchema: [
        {
          AttributeName: 'threeDSSessionId',
          KeyType: 'HASH'
        }
      ],
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true
      }
    });
  });

  it('should create SNS topic for alarms', () => {
    const app = new cdk.App();
    const stack = new ThreeDSSessionStack(app, 'TestStack', {
      config: {
        environment: 'test',
        region: 'eu-west-1',
        accountId: '123456789012',
        removalPolicy: 'DESTROY'
      },
      env: {
        account: '123456789012',
        region: 'eu-west-1'
      }
    });

    const template = Template.fromStack(stack);

    // Assert SNS topic exists
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'Checkout 3DS Session Alarms (test)',
      TopicName: 'test-checkout-3ds-session-alarms'
    });
  });

  it('should create CloudWatch alarms', () => {
    const app = new cdk.App();
    const stack = new ThreeDSSessionStack(app, 'TestStack', {
      config: {
        environment: 'test',
        region: 'eu-west-1',
        accountId: '123456789012',
        removalPolicy: 'DESTROY'
      },
      env: {
        account: '123456789012',
        region: 'eu-west-1'
      }
    });

    const template = Template.fromStack(stack);

    // Should have multiple CloudWatch alarms
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThan(0);
  });

  it('should enable point-in-time recovery for production', () => {
    const app = new cdk.App();
    const stack = new ThreeDSSessionStack(app, 'TestStack', {
      config: {
        environment: 'prod',
        region: 'eu-west-1',
        accountId: '123456789012',
        pointInTimeRecovery: true,
        removalPolicy: 'RETAIN'
      },
      env: {
        account: '123456789012',
        region: 'eu-west-1'
      }
    });

    const template = Template.fromStack(stack);

    // Assert point-in-time recovery is enabled
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true
      }
    });
  });

  it('should create CloudFormation outputs', () => {
    const app = new cdk.App();
    const stack = new ThreeDSSessionStack(app, 'TestStack', {
      config: {
        environment: 'test',
        region: 'eu-west-1',
        accountId: '123456789012',
        removalPolicy: 'DESTROY'
      },
      env: {
        account: '123456789012',
        region: 'eu-west-1'
      }
    });

    const template = Template.fromStack(stack);

    // Assert outputs exist
    template.hasOutput('TableName', {});
    template.hasOutput('TableArn', {});
    template.hasOutput('AlarmTopicArn', {});
  });
});
