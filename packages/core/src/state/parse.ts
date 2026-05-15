import type { ZodType } from "zod";
import { ZodError } from "zod";

function formatPath(path: Array<string | number>): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path.map(String).join(".");
}

export function formatSchemaError(fileName: string, error: ZodError): Error {
  const issues = error.issues.map((issue) => {
    return `${formatPath(issue.path)}: ${issue.message}`;
  });

  return new Error(`Invalid ${fileName}: ${issues.join("; ")}`);
}

export function parseStateFile<T>(
  fileName: string,
  schema: ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw formatSchemaError(fileName, result.error);
  }

  return result.data;
}
