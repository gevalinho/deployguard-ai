const MAX_ENVIRONMENT_VARIABLES = 50;

const MAX_ENVIRONMENT_VALUE_LENGTH =
  16 * 1024;

const ENVIRONMENT_VARIABLE_NAME =
  /^[A-Za-z_][A-Za-z0-9_]*$/;

export type RepositoryEnvironment =
  Readonly<Record<string, string>>;

export type RepositoryEnvironmentParseResult =
  | {
      ok: true;
      environment: RepositoryEnvironment;
    }
  | {
      ok: false;
      error: string;
    };

export function parseRepositoryEnvironment(
  value: unknown
): RepositoryEnvironmentParseResult {
  if (value === undefined) {
    return {
      ok: true,
      environment: {},
    };
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return {
      ok: false,
      error:
        "Environment must be an object containing string values.",
    };
  }

  const entries =
    Object.entries(
      value as Record<string, unknown>
    );

  if (
    entries.length >
    MAX_ENVIRONMENT_VARIABLES
  ) {
    return {
      ok: false,
      error:
        `Environment may contain at most ${MAX_ENVIRONMENT_VARIABLES} variables.`,
    };
  }

  const environment:
    Record<string, string> = {};

  for (const [name, rawValue] of entries) {
    if (
      !ENVIRONMENT_VARIABLE_NAME.test(name)
    ) {
      return {
        ok: false,
        error:
          `Invalid environment variable name: ${name}.`,
      };
    }

    if (typeof rawValue !== "string") {
      return {
        ok: false,
        error:
          `Environment variable ${name} must contain a string value.`,
      };
    }

    if (
      rawValue.length >
      MAX_ENVIRONMENT_VALUE_LENGTH
    ) {
      return {
        ok: false,
        error:
          `Environment variable ${name} exceeds the maximum allowed value length.`,
      };
    }

    environment[name] = rawValue;
  }

  return {
    ok: true,
    environment,
  };
}
