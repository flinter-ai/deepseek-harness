import { writeFile } from 'node:fs/promises'
import { DescribeSecretCommand, GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'

const resultFile = process.env.DSH_AWS_RESULT_FILE
const home = process.env.DSH_HOME
if (resultFile === undefined || home === undefined) throw new Error('AWS loader fixture requires DSH_HOME and DSH_AWS_RESULT_FILE')

SecretsManagerClient.prototype.send = async function (command) {
  if (command instanceof GetSecretValueCommand) return { SecretString: '{"ARK_PLAN_API_KEY":"mock-aws-value"}' }
  if (command instanceof DescribeSecretCommand) return {}
  throw new Error(`unexpected Secrets Manager command: ${command.constructor.name}`)
} as typeof SecretsManagerClient.prototype.send

const environment = createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', AWS_REGION: 'us-east-1' },
}])
const { ctx, shutdown } = await runProfile({
  environment,
  profile: 'aws-worker',
  patchFiles: [],
  args: [],
})
try {
  const resolved = await ctx.credentials.resolve(credentialRef('ARK_PLAN_API_KEY'))
  const info = await ctx.credentials.describe(credentialRef('ARK_PLAN_API_KEY'))
  await writeFile(resultFile, JSON.stringify({ resolved, info }))
} finally {
  await shutdown.shutdown(0)
}
