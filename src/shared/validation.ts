// OWASP Input Validation: check both syntax and semantic ranges before using input.
// https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value)) return false;
  try {
    // ECMA-402 validates named IANA zones, including UTC and supported aliases.
    // https://tc39.es/ecma402/#sec-intl.datetimeformat
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch { return false; }
}
