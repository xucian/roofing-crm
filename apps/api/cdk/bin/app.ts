import { App } from 'aws-cdk-lib';
import { readDeployInputs } from '../lib/deploy-inputs';
import { RoofingCrmStack, STACK_NAME } from '../lib/roofing-crm-stack';

const app = new App();

new RoofingCrmStack(app, STACK_NAME, {
  // The account comes from the operator's AWS profile at deploy; CI synthesizes without one.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-2' },
  ...readDeployInputs(app.node, process.cwd()),
});
