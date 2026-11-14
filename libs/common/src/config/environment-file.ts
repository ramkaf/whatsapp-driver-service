export function getEnvironmentFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.DOTENV_CONFIG_PATH ??
    (env.NODE_ENV === 'production' ? '.env.prod' : '.env.local')
  );
}
