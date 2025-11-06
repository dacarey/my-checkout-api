import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { ThreeDSSessionConfig } from './config';

export interface ThreeDSSessionStackProps extends StackProps {
  config: ThreeDSSessionConfig;
}

/**
 * CDK Stack for 3DS Session Management DynamoDB Table
 *
 * Creates:
 * - DynamoDB table with TTL enabled
 * - CloudWatch alarms for monitoring
 * - SNS topic for alarm notifications
 *
 * Based on SPEC-Authentication-Session-Library.md Section 6.1
 */
export class ThreeDSSessionStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ThreeDSSessionStackProps) {
    super(scope, id, props);

    const { config } = props;

    // DynamoDB table name: {environment}-checkout-3ds-sessions
    const tableName = config.tableNamePrefix
      ? `${config.tableNamePrefix}-${config.environment}-3ds-sessions`
      : `${config.environment}-checkout-3ds-sessions`;

    // DynamoDB table
    this.table = new dynamodb.Table(this, 'ThreeDSSessionTable', {
      tableName,
      partitionKey: {
        name: 'threeDSSessionId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand scaling
      encryption: dynamodb.TableEncryption.AWS_MANAGED,   // AWS-managed encryption at rest
      timeToLiveAttribute: 'ttl',                         // Enable TTL for automatic cleanup
      removalPolicy: config.removalPolicy === 'RETAIN'
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {                 // Backups (enabled for prod)
        pointInTimeRecoveryEnabled: config.pointInTimeRecovery ?? false
      }
    });

    // SNS topic for alarms
    this.alarmTopic = new sns.Topic(this, 'ThreeDSSessionAlarmTopic', {
      displayName: `Checkout 3DS Session Alarms (${config.environment})`,
      topicName: `${config.environment}-checkout-3ds-session-alarms`
    });

    // Create CloudWatch alarms
    this.createAlarms(config.environment);

    // CloudFormation outputs
    new CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: '3DS session table name',
      exportName: `${config.environment}-3ds-session-table-name`
    });

    new CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: '3DS session table ARN',
      exportName: `${config.environment}-3ds-session-table-arn`
    });

    new CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS topic ARN for 3DS session alarms',
      exportName: `${config.environment}-3ds-session-alarm-topic-arn`
    });
  }

  /**
   * Create CloudWatch alarms for monitoring DynamoDB table health
   */
  private createAlarms(environment: string): void {
    // Alarm: High read/write throttling
    const throttleAlarm = new cloudwatch.Alarm(this, 'ThrottleAlarm', {
      alarmName: `${environment}-3ds-session-throttle`,
      alarmDescription: '3DS session table experiencing throttling',
      metric: this.table.metricSystemErrorsForOperations({
        operations: [
          dynamodb.Operation.GET_ITEM,
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.UPDATE_ITEM
        ],
        period: Duration.minutes(5)
      }),
      threshold: 10,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    throttleAlarm.addAlarmAction(new actions.SnsAction(this.alarmTopic));

    // Alarm: Unexpected table growth (may indicate TTL not working)
    // Note: ItemCount is updated every 6 hours, not real-time
    const itemCountAlarm = new cloudwatch.Alarm(this, 'ItemCountAlarm', {
      alarmName: `${environment}-3ds-session-item-count`,
      alarmDescription: '3DS session table has unexpectedly high item count - check TTL configuration',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ItemCount',
        dimensionsMap: {
          TableName: this.table.tableName
        },
        statistic: cloudwatch.Stats.AVERAGE,
        period: Duration.hours(6)
      }),
      threshold: 100000, // Alert if >100k sessions (adjust based on expected traffic)
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    itemCountAlarm.addAlarmAction(new actions.SnsAction(this.alarmTopic));

    // Alarm: High user errors (4xx responses)
    const userErrorAlarm = new cloudwatch.Alarm(this, 'UserErrorAlarm', {
      alarmName: `${environment}-3ds-session-user-errors`,
      alarmDescription: 'High rate of user errors on 3DS session table',
      metric: this.table.metricUserErrors({
        period: Duration.minutes(5)
      }),
      threshold: 50,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    userErrorAlarm.addAlarmAction(new actions.SnsAction(this.alarmTopic));

    // Alarm: High consumed read/write capacity (approaching limits)
    // This alarm is most useful if you switch from on-demand to provisioned mode
    const readCapacityAlarm = new cloudwatch.Alarm(this, 'ReadCapacityAlarm', {
      alarmName: `${environment}-3ds-session-read-capacity`,
      alarmDescription: 'High read capacity consumption on 3DS session table',
      metric: this.table.metricConsumedReadCapacityUnits({
        period: Duration.minutes(5)
      }),
      threshold: 1000, // Adjust based on expected traffic
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    readCapacityAlarm.addAlarmAction(new actions.SnsAction(this.alarmTopic));
  }
}
