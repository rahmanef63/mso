/** Device-local lock clock. Callers pass a browser `Date`; nothing here reads the host clock. */

export function lockTime(now: Date): string {
  const hour = now.getHours() % 12 || 12;
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

/** Short device date, for the small line tight above the lock time. */
export function lockShortDate(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function lockZone(now: Date): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

export function temperatureUnit(language: string): "fahrenheit" | "celsius" {
  const [code, region] = language.toLowerCase().split("-", 3);
  const fahrenheit = (code === "en" && (region === "us" || region === "lr"))
    || (code === "my" && region === "mm");
  return fahrenheit ? "fahrenheit" : "celsius";
}

/** WMO weather interpretation codes, shortened for the complication. */
export function weatherCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  if (code >= 95) return "Storm";
  return "Weather";
}
