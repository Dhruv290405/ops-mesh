/**
 * Validates presence of required environment variables.
 * Throws a descriptive error listing every missing variable.
 */
export function validateEnvironmentVariables(
  required: string[],
  source: NodeJS.ProcessEnv = process.env
): void {
  const missing = required.filter((key) => !source[key] || source[key] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      `Copy .env.example to .env and fill in the values.`
    );
  }
}