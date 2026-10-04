import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { lockShortDate, lockTime, lockZone, temperatureUnit, weatherCondition } from "./ios-lock-format";
import { loadDeviceWeather } from "./ios-lock-weather";
import { IosLockFace } from "./ios-lock-screen";

describe("iOS lock clock", () => {
  const now = new Date(2026, 9, 4, 15, 7);

  it("formats the device date and a 12-hour time from the given Date", () => {
    expect(lockTime(now)).toBe("3:07");
    expect(lockShortDate(now)).toContain("Oct");
    expect(lockShortDate(now)).toContain("4");
    expect(lockShortDate(now)).not.toContain("October");
    expect(lockShortDate(now)).not.toContain("April");
    expect(lockZone(now).length).toBeGreaterThan(0);
    expect(temperatureUnit("en-US")).toBe("fahrenheit");
    expect(temperatureUnit("en-GB")).toBe("celsius");
    expect(weatherCondition(0)).toBe("Clear");
  });

  it("renders that clock on the lock face without a fixed sample time", () => {
    const html = renderToStaticMarkup(<IosLockFace now={now} />);
    expect(html).toContain('data-slot="ios-lock"');
    expect(html).toContain('data-slot="ios-lock-status"');
    expect(html).toContain('data-slot="ios-lock-complications"');
    expect(html).toContain('data-slot="ios-lock-weather"');
    expect(html).toContain('data-slot="ios-lock-rings"');
    expect(html).toContain('data-slot="ios-lock-analog"');
    expect(html).toContain('data-slot="ios-lock-flashlight"');
    expect(html).toContain('data-slot="ios-lock-camera"');
    expect(html).toContain('data-slot="ios-lock-home-indicator"');
    expect(html).toContain(">3:07<");
    expect(html).toContain("font-light");
    expect(html).toContain("text-[13px]");
    expect(html).not.toContain("text-[20px]");
    expect(html).not.toContain('data-slot="ios-lock-city"');
    expect(html).not.toContain("9:41");
    expect(html).not.toContain("April 1");
    expect(html).not.toContain("San Francisco");
    expect(html).not.toContain("backdrop-blur");
  });
});

describe("device weather", () => {
  it("does not call the network when location permission is denied", async () => {
    const fetchImpl = vi.fn();
    const result = await loadDeviceWeather({
      geolocation: {
        getCurrentPosition: (_ok, error) => error?.({ code: 1 } as GeolocationPositionError),
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      language: "en-US",
    });
    expect(result).toEqual({ status: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the client response for city and temperature", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("open-meteo")) {
        return new Response(JSON.stringify({ current: { temperature_2m: 11.2, weather_code: 0 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ city: "Bergen" }), { status: 200 });
    });
    const result = await loadDeviceWeather({
      geolocation: {
        getCurrentPosition: (ok) => ok({ coords: { latitude: 60.39, longitude: 5.32 } } as GeolocationPosition),
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      language: "en-GB",
    });
    expect(result).toEqual({ status: "ready", city: "Bergen", temp: "11°C", condition: "Clear" });
  });
});
