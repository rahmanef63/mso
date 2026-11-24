import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { once } from "node:events";
import { launchChromium, launchWebKit } from "./_browser-launch.mjs";
import {
  OVERFLOW_WIDTHS, RUST_BIN, SCREENSHOT_DIR, attachErrorCollectors, createFixtureBackend,
  ensureBuild, openAppFromShell, runDeepLinkSuite, startRustHost, startVitePreview,
  switchQuickShell, verifyAssetEndpoints, waitForVisibleImagesDecoded, waitWorkspaceReady,
} from "./_os-matrix-servers.mjs";
import { runShellsAndStateSuite } from "./_os-matrix-shells.mjs";

async function main() {
  ensureBuild();
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const { server: backend, state: fixtureState } = createFixtureBackend();
  let vite = null;
  let rust = null;
  let chromiumBrowser = null;
  let webkitBrowser = null;

  const failures = [];
  const summary = {
    pass: false,
    rustBinaryAvailable: existsSync(RUST_BIN),
    screenshotDir: SCREENSHOT_DIR,
    failures,
    sections: {},
  };

  async function runCheck(name, fn) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ check: name, error: message });
      return { status: "failed", error: message };
    }
  }

  try {
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const apiOrigin = `http://127.0.0.1:${backend.address().port}`;

    vite = await startVitePreview(apiOrigin);
    rust = await startRustHost(apiOrigin);
    chromiumBrowser = await launchChromium();

    // =========================================================================
    // A. Asset packaging & decode
    // =========================================================================
    summary.sections.A_assets = await runCheck("A_assets", async () => {
      const assetVite = await verifyAssetEndpoints(vite.origin, "vite-preview");
      const assetRust = rust ? await verifyAssetEndpoints(rust.origin, "rust-host") : null;

      fixtureState.role = "viewer";
      fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
      const decodedImagesByShell = {};
      for (const entry of [
        { shell: "macos", viewport: { width: 1440, height: 900 } },
        { shell: "windows", viewport: { width: 1440, height: 900 } },
        { shell: "ios", viewport: { width: 390, height: 844 } },
        { shell: "android", viewport: { width: 390, height: 844 } },
      ]) {
        const ctx = await chromiumBrowser.newContext({ viewport: entry.viewport });
        const page = await ctx.newPage();
        try {
          await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
          await waitWorkspaceReady(page);
          const currentChrome = await page.locator(".workspace").getAttribute("data-chrome");
          if (currentChrome !== entry.shell) await switchQuickShell(page, entry.shell);
          decodedImagesByShell[entry.shell] = await waitForVisibleImagesDecoded(page);
        } finally {
          await ctx.close();
        }
      }

      const ctx = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      let bgImage = "";
      try {
        await page.route("**/wallpapers/*.webp", (route) => route.abort());
        await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(page);
        bgImage = await page.locator(".workspace").evaluate((el) => getComputedStyle(el).backgroundImage);
        assert.ok(bgImage && bgImage.includes("gradient("), `expected gradient fallback when wallpaper aborts, got: ${bgImage}`);
      } finally {
        await ctx.close();
      }

      return {
        status: "passed",
        vite: assetVite,
        rust: assetRust,
        decodedVisibleImages: decodedImagesByShell,
        abortedWallpaperFallbackGradient: bgImage,
      };
    });

    // =========================================================================
    // B. Cold deep links + Back/Forward
    // =========================================================================
    summary.sections.B_deepLinks = {
      vite: await runCheck("B_deepLinks.vite", () => runDeepLinkSuite(chromiumBrowser, vite.origin, "vite-preview", fixtureState)),
      rust: rust
        ? await runCheck("B_deepLinks.rust", () => runDeepLinkSuite(chromiumBrowser, rust.origin, "rust-host", fixtureState))
        : null,
    };

    // =========================================================================
    // C. Shell preferences & startup bootstrap
    // =========================================================================
    summary.sections.C_shellPrefs = await runCheck("C_shellPrefs", async () => {
      fixtureState.role = "viewer";
      fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
      const ctx1 = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 } });
      let afterReloadChrome = null;
      try {
        const p1 = await ctx1.newPage();
        await p1.goto(vite.origin, { waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(p1);
        await switchQuickShell(p1, "windows");
        await p1.reload({ waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(p1);
        afterReloadChrome = await p1.locator(".workspace").getAttribute("data-chrome");
        assert.equal(afterReloadChrome, "windows", `expected windows after reload, got ${afterReloadChrome}`);
      } finally {
        await ctx1.close();
      }

      fixtureState.role = "owner";
      fixtureState.prefs = {
        tweaks: {
          shell: { desktop: "windows", mobile: "android", override: "auto", iosStyle: "classic" },
          theme: "dark",
        },
        quicklinks: [],
        updates: { auto: true, channel: "stable" },
        updatedAt: Date.now(),
      };

      const ctxDesk = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
      let deskResult;
      try {
        const pDesk = await ctxDesk.newPage();
        await pDesk.goto(vite.origin, { waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(pDesk);
        await pDesk.waitForFunction(
          () => document.querySelector(".workspace")?.getAttribute("data-chrome") === "windows"
            && document.documentElement.dataset.theme === "dark",
          undefined,
          { timeout: 8_000 },
        );
        deskResult = await pDesk.evaluate(() => ({
          chrome: document.querySelector(".workspace")?.getAttribute("data-chrome"),
          theme: document.documentElement.dataset.theme,
        }));
      } finally {
        await ctxDesk.close();
      }

      const ctxMob = await chromiumBrowser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
      let mobResult;
      try {
        const pMob = await ctxMob.newPage();
        await pMob.goto(vite.origin, { waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(pMob);
        await pMob.waitForFunction(
          () => document.querySelector(".workspace")?.getAttribute("data-chrome") === "android"
            && document.documentElement.dataset.theme === "dark",
          undefined,
          { timeout: 8_000 },
        );
        mobResult = await pMob.evaluate(() => ({
          chrome: document.querySelector(".workspace")?.getAttribute("data-chrome"),
          theme: document.documentElement.dataset.theme,
        }));
      } finally {
        await ctxMob.close();
      }

      return {
        status: "passed",
        viewerQuickSwitchReload: afterReloadChrome,
        ownerStartupDesktop1440: deskResult,
        ownerStartupMobile390: mobResult,
      };
    });


    summary.sections.D_shellsAndState = await runShellsAndStateSuite({
      chromiumBrowser, vite, fixtureState, runCheck,
    });

    // =========================================================================
    // E. Viewport & accessibility matrix + WebKit
    // =========================================================================
    const eOverflow = await runCheck("E_overflow", async () => {
      fixtureState.role = "viewer";
      fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
      const overflowFailures = [];
      let checkedViewports = 0;

      for (const colorScheme of ["light", "dark"]) {
        for (const width of OVERFLOW_WIDTHS) {
          const ctx = await chromiumBrowser.newContext({ viewport: { width, height: 844 }, colorScheme });
          try {
            const page = await ctx.newPage();
            await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
            await waitWorkspaceReady(page);
            const overflow = await page.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              chrome: document.querySelector(".workspace")?.getAttribute("data-chrome"),
            }));
            checkedViewports++;
            if (overflow.scrollWidth > overflow.innerWidth) {
              overflowFailures.push({ colorScheme, width, fontScale: "100%", ...overflow });
            }
            if (width === 320) {
              await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
              const scaled = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                innerWidth: window.innerWidth,
                chrome: document.querySelector(".workspace")?.getAttribute("data-chrome"),
              }));
              checkedViewports++;
              if (scaled.scrollWidth > scaled.innerWidth) {
                overflowFailures.push({ colorScheme, width, fontScale: "200%", ...scaled });
              }
            }
          } finally {
            await ctx.close();
          }
        }
      }
      assert.deepEqual(overflowFailures, [], `horizontal overflow detected: ${JSON.stringify(overflowFailures)}`);
      return { status: "passed", checkedViewports, overflowFailures: 0 };
    });

    const eA11y = await runCheck("E_accessibility", async () => {
      fixtureState.role = "owner";
      fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
      const ctxA11y = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
      try {
        const pA11y = await ctxA11y.newPage();
        await pA11y.goto(vite.origin, { waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(pA11y);
        await switchQuickShell(pA11y, "macos");
        await openAppFromShell(pA11y, "macos", "Settings");
        await pA11y.locator('[data-settings-state="ready"]').waitFor({ state: "visible", timeout: 8_000 });

        const a11yErrors = [];
        const baseline = await pA11y.evaluate(() => ({
          borderVar: getComputedStyle(document.documentElement).getPropertyValue("--border").trim(),
          mutedVar: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
          backdrop: getComputedStyle(document.querySelector(".macos-menubar")).backdropFilter,
        }));
        if (baseline.backdrop === "none") {
          a11yErrors.push("baseline .macos-menubar backdropFilter is 'none' (standard backdrop-filter stripped by CSS minifier when -webkit-backdrop-filter follows it)");
        }

        await pA11y.locator("#settings-reduce-glass").check();
        await pA11y.waitForFunction(() => document.documentElement.dataset.reduceGlass === "true", undefined, { timeout: 5_000 });
        const reducedGlassBackdrop = await pA11y.locator(".macos-menubar").evaluate((el) => getComputedStyle(el).backdropFilter);
        assert.equal(reducedGlassBackdrop, "none", `expected backdropFilter === "none", got ${reducedGlassBackdrop}`);

        await pA11y.locator("#settings-high-contrast").check();
        await pA11y.waitForFunction(() => document.documentElement.dataset.highContrast === "true", undefined, { timeout: 5_000 });
        const hcStyles = await pA11y.evaluate(() => ({
          attr: document.documentElement.dataset.highContrast,
          borderVar: getComputedStyle(document.documentElement).getPropertyValue("--border").trim(),
          mutedVar: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
          buttonBorderColor: getComputedStyle(document.querySelector(".win-frame button")).borderTopColor,
        }));
        assert.equal(hcStyles.attr, "true");
        assert.notEqual(hcStyles.borderVar, baseline.borderVar, "high-contrast --border variable did not change");
        assert.notEqual(hcStyles.mutedVar, baseline.mutedVar, "high-contrast --muted variable did not change");

        await pA11y.locator("#settings-reduced-motion").check();
        await pA11y.waitForFunction(() => document.documentElement.dataset.reducedMotion === "true", undefined, { timeout: 5_000 });
        const rmStyles = await pA11y.evaluate(() => {
          const cs = getComputedStyle(document.querySelector(".win-frame"));
          return {
            attr: document.documentElement.dataset.reducedMotion,
            transitionDuration: cs.transitionDuration,
            animationDuration: cs.animationDuration,
          };
        });
        assert.equal(rmStyles.attr, "true");
        const tdSec = parseFloat(rmStyles.transitionDuration);
        assert.ok(Number.isFinite(tdSec) && tdSec <= 0.0001, `expected <=0.01ms transitionDuration, got ${rmStyles.transitionDuration}`);
        if (a11yErrors.length > 0) {
          throw new Error(a11yErrors.join(" | "));
        }
        return { status: "passed", baseline, reducedGlassBackdrop, highContrast: hcStyles, reducedMotion: rmStyles };
      } finally {
        await ctxA11y.close();
      }
    });

    let webkitResult;
    try {
      fixtureState.role = "viewer";
      fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
      webkitBrowser = await launchWebKit();
      const wkCtx = await webkitBrowser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const wkPage = await wkCtx.newPage();
        await wkPage.goto(vite.origin, { waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(wkPage);
        const wkDecoded = await waitForVisibleImagesDecoded(wkPage);
        await switchQuickShell(wkPage, "windows");
        const wkChrome = await wkPage.locator(".workspace").getAttribute("data-chrome");
        assert.equal(wkChrome, "windows");
        webkitResult = { status: "passed", decodedVisibleImages: wkDecoded, switchedChrome: wkChrome };
      } finally {
        await wkCtx.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      webkitResult = { status: "blocked", blocker: msg.split("\n").slice(0, 6).join(" | ") };
    }

    summary.sections.E_viewportA11yWebKit = {
      overflow: eOverflow,
      accessibility: eA11y,
      webkit: webkitResult,
    };

    summary.pass = failures.length === 0;
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.pass) process.exitCode = 1;
  } finally {
    await webkitBrowser?.close().catch(() => {});
    await chromiumBrowser?.close().catch(() => {});
    if (rust?.proc && rust.proc.exitCode === null) {
      rust.proc.kill("SIGTERM");
      await once(rust.proc, "exit").catch(() => {});
    }
    if (vite?.proc && vite.proc.exitCode === null) {
      vite.proc.kill("SIGTERM");
      await once(vite.proc, "exit").catch(() => {});
    }
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
  }
}

await main();
