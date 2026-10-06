import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { lockShortDate, lockTime, lockZone, temperatureUnit, weatherCondition } from "./ios-lock-format";
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
    expect(html).not.toContain('data-slot="ios-lock-camera"');
    expect(html).toContain("Weather unavailable");
    expect(html).toContain("min-h-11");
    expect(html).toContain('data-slot="ios-lock-home-indicator"');
    expect(html).toContain(">3:07<");
    expect(html).toContain("text-[92px] font-semibold");
    expect(html).not.toContain("font-light");
    expect(html).not.toContain("text-[96px]");
    expect(html).toContain("text-[13px]");
    expect(html).not.toContain("text-[20px]");
    expect(html).not.toContain('data-slot="ios-lock-city"');
    expect(html).not.toContain("9:41");
    expect(html).not.toContain("April 1");
    expect(html).not.toContain("San Francisco");
    expect(html).not.toContain("backdrop-blur");
  });
});
