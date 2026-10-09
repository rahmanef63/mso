import { chromium } from "@playwright/test";
import { expect, it } from "vitest";
import { cookiePrefix, rewriteSetCookie, upstreamCookieHeader } from "../../lib/managed-apps/proxy-headers";

it("the browser rejects sibling Domain/path shadows in either insertion order", async () => {
  const browser = await chromium.launch({headless: true});
  const hermes = "https://hermes.mso-cookie.test", sibling = "https://openclaw.mso-cookie.test";
  try {
    for (const shadowFirst of [true, false]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let received: string | null = null;
      await page.route("https://*.mso-cookie.test/**", async route => {
        const request = route.request();
        if (request.url() === `${hermes}/echo`) received = (await request.allHeaders()).cookie ?? null;
        const headers: Record<string, string> = request.url() === `${hermes}/login`
          ? {"set-cookie": rewriteSetCookie("session=real; HttpOnly", "hermes", true, "")!} : {};
        await route.fulfill({status: 200, contentType: "text/html", headers, body: "<title>Cookie fixture</title>fixture"});
      });
      const inject = async () => {
        await page.goto(sibling);
        await page.evaluate(() => {
          document.cookie = "__Host-mapp_hermes_session=forged; Domain=.mso-cookie.test; Path=/; Secure";
          document.cookie = "__Host-mapp_hermes_session=path-shadow; Path=/echo; Secure";
          document.cookie = "mapp_hermes_session=legacy-forged; Domain=.mso-cookie.test; Path=/; Secure";
        });
      };
      if (shadowFirst) await inject();
      await page.goto(`${hermes}/login`);
      if (!shadowFirst) await inject();
      await page.goto(`${hermes}/echo`);
      expect(received).toContain("legacy-forged"); // The adversary's parent-domain cookie actually arrived.
      expect(received).not.toContain("path-shadow");
      expect(upstreamCookieHeader(received, cookiePrefix("hermes"))).toBe("session=real");
      await context.close();
    }
  } finally {await browser.close();}
});
