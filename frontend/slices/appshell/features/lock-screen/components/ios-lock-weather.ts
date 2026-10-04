import { temperatureUnit, weatherCondition } from "./ios-lock-format";

export type LockWeather =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "ready"; city: string | null; temp: string; condition: string };

type GeoLike = { getCurrentPosition: Geolocation["getCurrentPosition"] };

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const PLACE = "https://api.bigdatacloud.net/data/reverse-geocode-client";

function position(geo: GeoLike): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  });
}

async function cityName(fetchImpl: typeof fetch, latitude: number, longitude: number, language: string, signal?: AbortSignal): Promise<string | null> {
  const url = `${PLACE}?latitude=${latitude}&longitude=${longitude}&localityLanguage=${encodeURIComponent(language)}`;
  const res = await fetchImpl(url, { signal, referrerPolicy: "no-referrer" });
  if (!res.ok) return null;
  const body = await res.json() as { city?: string; locality?: string };
  const name = body.city || body.locality || "";
  return name.trim() || null;
}

/** Location permission, then a browser weather request. Denial skips the network. */
export async function loadDeviceWeather(input: {
  geolocation: GeoLike | null;
  fetchImpl: typeof fetch;
  language: string;
  signal?: AbortSignal;
}): Promise<Exclude<LockWeather, { status: "pending" }>> {
  if (!input.geolocation) return { status: "unavailable" };
  const coords = await position(input.geolocation);
  if (!coords) return { status: "unavailable" };
  const unit = temperatureUnit(input.language);
  const forecastUrl = `${FORECAST}?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,weather_code&temperature_unit=${unit}`;
  try {
    const [forecastRes, city] = await Promise.all([
      input.fetchImpl(forecastUrl, { signal: input.signal, referrerPolicy: "no-referrer" }),
      cityName(input.fetchImpl, coords.latitude, coords.longitude, input.language, input.signal).catch(() => null),
    ]);
    if (!forecastRes.ok) return { status: "unavailable" };
    const body = await forecastRes.json() as { current?: { temperature_2m?: number; weather_code?: number } };
    const tempC = body.current?.temperature_2m;
    const code = body.current?.weather_code;
    if (typeof tempC !== "number" || typeof code !== "number") return { status: "unavailable" };
    const suffix = unit === "fahrenheit" ? "°F" : "°C";
    return { status: "ready", city, temp: `${Math.round(tempC)}${suffix}`, condition: weatherCondition(code) };
  } catch {
    return { status: "unavailable" };
  }
}
