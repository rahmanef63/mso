import { describe, expect, it } from "vitest";
import { temperatureUnit } from "./ios-lock-format";

describe("lock weather temperature locale boundaries", () => {
  it.each(["en-US", "en-LR", "my-MM", "EN-us", "MY-mm", "en-US-u-hc-h12"])(
    "uses Fahrenheit for %s",
    (language) => expect(temperatureUnit(language)).toBe("fahrenheit"),
  );

  it.each(["en-GB", "en", "", "x-my-MM", "notmy-MM", "my-MMjunk", "en-USA", "en-LRjunk", "en-USfoo", "en-US\n", "prefix-en-US"])(
    "does not accept an embedded or partial locale in %j",
    (language) => expect(temperatureUnit(language)).toBe("celsius"),
  );
});
