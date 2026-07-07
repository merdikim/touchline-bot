type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, message, ...fields }));
}
