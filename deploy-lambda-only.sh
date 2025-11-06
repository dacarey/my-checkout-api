#!/bin/bash
cd infra
AWS_PROFILE=dw-sandbox npx cdk deploy LambdaStack \
  -c environment=dev \
  -c apiAccountId=014409295792 \
  -c serviceAccountId=014409295792 \
  --require-approval never
