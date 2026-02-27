/**
 * Value type parsing for DOT attribute values.
 *
 * Supports: String, Integer, Float, Boolean, Duration.
 * Duration: integer + unit suffix (ms, s, m, h, d) -> milliseconds.
 */

const DURATION_RE = /^(-?\d+)(ms|s|m|h|d)$/;

const DURATION_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration string like "900s", "15m", "250ms" into milliseconds.
 * Returns undefined if the string is not a valid duration.
 */
export function parseDuration(value: string): number | undefined {
  const match = DURATION_RE.exec(value.trim());
  if (!match) return undefined;
  const amount = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multiplier = DURATION_MULTIPLIERS[unit];
  if (multiplier === undefined) return undefined;
  return amount * multiplier;
}

/**
 * Parse a raw string attribute value into a typed JavaScript value.
 *
 * Resolution order:
 * 1. Boolean ("true" / "false")
 * 2. Duration (integer + unit suffix)
 * 3. Float (contains decimal point)
 * 4. Integer (all digits, optional sign)
 * 5. String (fallback)
 */
export function parseAttributeValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Duration -> milliseconds as number
  const duration = parseDuration(trimmed);
  if (duration !== undefined) return duration;

  // Float
  if (/^-?\d*\.\d+$/.test(trimmed)) return parseFloat(trimmed);

  // Integer
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  // String fallback
  return trimmed;
}

/**
 * Parse a value specifically as an integer.
 * Returns the default if the value is not a valid integer.
 */
export function parseInteger(value: string, defaultValue: number = 0): number {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return defaultValue;
}

/**
 * Parse a value specifically as a boolean.
 * Returns the default if the value is not "true" or "false".
 */
export function parseBoolean(value: string, defaultValue: boolean = false): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return defaultValue;
}
