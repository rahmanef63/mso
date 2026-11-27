import assert from "node:assert/strict";
import path from "node:path";
import {
  SCREENSHOT_DIR, SHELL_MATRIX, attachErrorCollectors,
  openAppFromShell, switchQuickShell, waitForVisibleImagesDecoded, waitWorkspaceReady,
} from "./_os-matrix-servers.mjs";

export async function runShellsAndStateSuite({ chromiumBrowser, vite, fixtureState, runCheck }) {
    // =========================================================================
    // D. Settings & Files across all 5 explicit shells + multi-window/editor persistence
    // =========================================================================
    const shellResults = {};
    const screenshots = [];

    for (const spec of SHELL_MATRIX) {
      shellResults[spec.shell] = await runCheck(`D_shell.${spec.shell}`, async () => {
        fixtureState.role = "viewer";
        fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
        const ctx = await chromiumBrowser.newContext({ viewport: spec.viewport, colorScheme: "light" });
        const page = await ctx.newPage();
        const errors = attachErrorCollectors(page);
        try {
          await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
          await waitWorkspaceReady(page);
          await switchQuickShell(page, spec.shell);
          await waitForVisibleImagesDecoded(page);

          const homeShot = path.join(SCREENSHOT_DIR, `${spec.shell}-home.png`);
          await page.screenshot({ path: homeShot });
          screenshots.push(homeShot);

          // Open Settings
          await openAppFromShell(page, spec.shell, "Settings");
          await page.locator(`[data-settings-variant="${spec.settingsVariant}"]`).waitFor({ state: "visible", timeout: 8_000 });
          await page.locator('[data-settings-state="ready"]').waitFor({ state: "visible", timeout: 8_000 });

          const settingsShot = path.join(SCREENSHOT_DIR, `${spec.shell}-settings.png`);
          await page.screenshot({ path: settingsShot });
          screenshots.push(settingsShot);

          let mobileDrillDown = null;
          let settingsDrillError = null;
          if (spec.mobile) {
            const mobileBar = page.locator(".mobile-app-bar");
            await mobileBar.waitFor({ state: "visible", timeout: 5_000 });
            const winBarCount = await page.locator(".win-bar").count();
            assert.equal(winBarCount, 0, `${spec.shell}: expected 0 .win-bar elements on phone, got ${winBarCount}`);

            await page.locator('button[data-settings-section="appearance"]').click();
            try {
              await mobileBar.locator(".mab-title").waitFor({ state: "visible", timeout: 5_000 });
              const titleAfterTap = (await mobileBar.locator(".mab-title").innerText({ timeout: 5_000 })).trim();
              assert.equal(titleAfterTap, "Appearance & Shell", `${spec.shell}: expected drill-down title in .mobile-app-bar`);
              await mobileBar.locator(".mab-back").click({ timeout: 5_000 });
              await page.locator('button[data-settings-section="appearance"]').waitFor({ state: "visible", timeout: 5_000 });
              mobileDrillDown = { winBarCount, drillDownTitle: titleAfterTap, backReturnedToIndex: true };
              await mobileBar.locator('button[aria-label="Close Settings"]').click({ timeout: 5_000 });
            } catch (e) {
              settingsDrillError = `${spec.shell} settings drill-down failed (${errors.join("; ") || e.message})`;
              // Recover page to also test Files on this mobile shell for complete diagnostics
              errors.length = 0;
              await page.goto(vite.origin, { waitUntil: "domcontentloaded" });
              await waitWorkspaceReady(page);
              await switchQuickShell(page, spec.shell);
            }
          } else {
            await page.getByRole("button", { name: "Close Settings", exact: true }).first().click({ timeout: 5_000 });
          }

          // Open Files on /home/demo
          let filesError = null;
          try {
            await openAppFromShell(page, spec.shell, "Open Files");
            await page.locator(`[data-files-variant="${spec.filesVariant}"]`).waitFor({ state: "visible", timeout: 8_000 });
            await page.locator('[data-files-state="ready"]').waitFor({ state: "visible", timeout: 8_000 });
            await page.locator('button[data-entry-open="projects"]').waitFor({ state: "visible", timeout: 8_000 });

            const filesShot = path.join(SCREENSHOT_DIR, `${spec.shell}-files.png`);
            await page.screenshot({ path: filesShot });
            screenshots.push(filesShot);

            // Navigate into projects subfolder -> verify app.ts -> navigate back to parent
            await page.locator('button[data-entry-open="projects"]').click({ timeout: 5_000 });
            await page.locator('button[data-entry-open="app.ts"]').waitFor({ state: "visible", timeout: 8_000 });

            if (spec.filesVariant === "finder") {
              await page.locator('button[aria-label="Go to parent folder"]').click({ timeout: 5_000 });
            } else if (spec.filesVariant === "explorer") {
              await page.locator('button[aria-label="Up one level"]').click({ timeout: 5_000 });
            } else if (spec.mobile) {
              await page.locator(".mobile-app-bar .mab-back").click({ timeout: 5_000 });
            } else {
              await page.locator(".dash-files-head").getByRole("button", { name: "Up", exact: true }).click({ timeout: 5_000 });
            }
            await page.locator('button[data-entry-open="notes.txt"]').waitFor({ state: "visible", timeout: 8_000 });
          } catch (e) {
            filesError = `${spec.shell} Files failed (${errors.join("; ") || e.message})`;
          }

          if (settingsDrillError || filesError) {
            throw new Error([settingsDrillError, filesError].filter(Boolean).join(" | "));
          }
          assert.deepEqual(errors, [], `${spec.shell} runtime errors: ${errors.join("; ")}`);
          return {
            status: "passed",
            settingsVariant: spec.settingsVariant,
            filesVariant: spec.filesVariant,
            subfolderRoundTrip: true,
            mobileDrillDown,
          };
        } finally {
          await ctx.close();
        }
      });
    }

    const multiWindowResult = await runCheck("D_multiWindowAndEditorGuard", async () => {
      fixtureState.role = "viewer";
      fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
      const ctxMulti = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
      const pMulti = await ctxMulti.newPage();
      const multiErrors = attachErrorCollectors(pMulti);
      try {
        await pMulti.goto(vite.origin, { waitUntil: "domcontentloaded" });
        await waitWorkspaceReady(pMulti);
        await switchQuickShell(pMulti, "macos");

        // Window 1 at /home/demo
        const filesDockBtn = pMulti.locator(".app-dock").getByRole("button", { name: "Open Files", exact: true });
        await filesDockBtn.click();
        await pMulti.locator('article[data-win-app="files"]').first().locator('button[data-entry-open="notes.txt"]').waitFor({ state: "visible", timeout: 8_000 });

        // Window 2 at /home/demo/projects (via Dock context menu -> New Files Window, since left-clicking running macOS dock icon focuses existing window)
        await filesDockBtn.click({ button: "right" });
        await pMulti.getByRole("menuitem", { name: "New Files Window" }).click();
        assert.equal(await pMulti.locator('article[data-win-app="files"]').count(), 2, "expected 2 simultaneous Files windows");
        const filesWin2 = pMulti.locator('article[data-win-app="files"]').nth(1);
        await filesWin2.locator('button[data-entry-open="projects"]').click();
        await filesWin2.locator('button[data-entry-open="app.ts"]').waitFor({ state: "visible", timeout: 8_000 });

        // Open Code Editor with unsaved draft
        await pMulti.locator(".app-dock").getByRole("button", { name: "Open Editor", exact: true }).click();
        const editorWin = pMulti.locator('article[data-win-app="editor"]');
        await editorWin.waitFor({ state: "visible", timeout: 8_000 });
        await editorWin.locator("#editor-path-input").fill("/home/demo/notes.txt");
        await editorWin.getByRole("button", { name: "Open", exact: true }).click();
        await editorWin.locator('[data-editor-state="ready"]').waitFor({ state: "visible", timeout: 8_000 });
        const draftText = "unsaved draft surviving macOS -> Windows -> macOS";
        await editorWin.locator("#editor-textarea").fill(draftText);
        await editorWin.locator('[data-editor-dirty="true"]').waitFor({ state: "visible", timeout: 5_000 });

        // Switch macOS -> Windows -> macOS
        await switchQuickShell(pMulti, "windows");
        await switchQuickShell(pMulti, "macos");

        // Verify both Files windows preserved independent folders
        assert.equal(await pMulti.locator('article[data-win-app="files"]').count(), 2, "expected 2 Files windows after shell round-trip");
        const win1HasNotes = await pMulti.locator('article[data-win-app="files"]').nth(0).locator('button[data-entry-open="notes.txt"]').count();
        const win2HasAppTs = await pMulti.locator('article[data-win-app="files"]').nth(1).locator('button[data-entry-open="app.ts"]').count();
        assert.equal(win1HasNotes, 1, "Files window 1 lost /home/demo folder after shell switch");
        assert.equal(win2HasAppTs, 1, "Files window 2 lost /home/demo/projects folder after shell switch");

        // Verify Code Editor preserved unsaved draft & close guard
        const editorAfter = pMulti.locator('article[data-win-app="editor"]');
        assert.equal(await editorAfter.locator("#editor-textarea").inputValue(), draftText, "Code Editor lost unsaved draft");
        assert.equal(await editorAfter.locator('[data-editor-dirty="true"]').count(), 1, "Code Editor lost dirty flag");

        // Integrated terminal drawer stays inside the window at this height. The old drawer
        // was a fixed 24rem and pushed its own prompt past the window bottom.
        await editorAfter.getByRole("button", { name: "Terminal", exact: true }).click();
        const drawer = editorAfter.locator(".editor-terminal");
        await drawer.waitFor({ state: "visible", timeout: 8_000 });
        const drawerLayout = await drawer.evaluate((el) => {
          const root = el.closest(".ide-root")?.getBoundingClientRect();
          const own = el.getBoundingClientRect();
          const prompt = el.querySelector(".input-row")?.getBoundingClientRect();
          const viewport = el.closest(".win-body")?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
          return {
            insideWindow: Boolean(root) && own.bottom <= root.bottom + 1,
            insideBody: own.bottom <= viewport.bottom + 1,
            promptVisible: Boolean(prompt) && prompt.bottom <= own.bottom + 1,
            height: Math.round(own.height),
          };
        });
        assert.equal(drawerLayout.insideWindow, true, `terminal drawer escapes the editor window: ${JSON.stringify(drawerLayout)}`);
        assert.equal(drawerLayout.insideBody, true, `terminal drawer escapes the window body: ${JSON.stringify(drawerLayout)}`);
        assert.equal(drawerLayout.promptVisible, true, `terminal prompt is clipped by the drawer: ${JSON.stringify(drawerLayout)}`);
        assert.ok(drawerLayout.height >= 120, `terminal drawer collapsed to ${drawerLayout.height}px`);
        await editorAfter.getByRole("button", { name: "Close terminal" }).click();
        await drawer.waitFor({ state: "detached", timeout: 5_000 });

        await editorAfter.locator('button[aria-label="Close Code Editor"]').click();
        await pMulti.getByText("Unsaved changes in Code Editor").waitFor({ state: "visible", timeout: 5_000 });
        assert.equal(await pMulti.locator('article[data-win-app="editor"]').count(), 1, "Close guard did not keep dirty Code Editor open");

        await editorAfter.locator('button[aria-label="Close Code Editor"]').click();
        assert.equal(await pMulti.locator('article[data-win-app="editor"]').count(), 0, "Second close did not dismiss Code Editor");

        assert.deepEqual(multiErrors, [], `multi-window errors: ${multiErrors.join("; ")}`);
        return {
          status: "passed",
          filesWin1Preserved: true,
          filesWin2Preserved: true,
          editorDraftPreserved: true,
          closeGuardVerified: true,
        };
      } finally {
        await ctxMulti.close();
      }
    });

  const iosModernAndDemo = await runCheck("D_iosModernAndDemo", async () => {
    // 1. iOS Modern glass presentation + solid fallback verification
    fixtureState.role = "viewer";
    fixtureState.prefs = { tweaks: {}, quicklinks: [], updates: { auto: true, channel: "stable" }, updatedAt: Date.now() };
    const ctxMod = await chromiumBrowser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
    try {
      await ctxMod.addInitScript(() => {
        localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios", override: "ios", iosStyle: "modern" }));
      });
      const pMod = await ctxMod.newPage();
      await pMod.goto(vite.origin, { waitUntil: "domcontentloaded" });
      await waitWorkspaceReady(pMod);
      assert.equal(await pMod.locator(".workspace").getAttribute("data-ios-style"), "modern");
      await waitForVisibleImagesDecoded(pMod);
      const modernShot = path.join(SCREENSHOT_DIR, "ios-modern-home.png");
      await pMod.screenshot({ path: modernShot });
      screenshots.push(modernShot);
    } finally {
      await ctxMod.close();
    }

    // 2. Standalone offline demo mode (/?demo=1) works without touching live backend API
    const apiHits = [];
    const ctxDemo = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    try {
      const pDemo = await ctxDemo.newPage();
      pDemo.on("request", (req) => {
        if (new URL(req.url()).pathname.startsWith("/api/")) apiHits.push(req.url());
      });
      await pDemo.goto(`${vite.origin}/?demo=1`, { waitUntil: "domcontentloaded" });
      await waitWorkspaceReady(pDemo);
      assert.equal(await pDemo.locator(".workspace").getAttribute("data-build-mode"), "demo");
      await pDemo.locator(".demo-banner").waitFor({ state: "visible", timeout: 5_000 });
      await pDemo.locator(".demo-viewport-controls").getByRole("button", { name: /Phone/ }).click();
      assert.equal(await pDemo.locator(".demo-banner").getAttribute("data-preview-device"), "phone");
      assert.equal(apiHits.length, 0, `demo mode leaked API calls: ${apiHits.join(", ")}`);
    } finally {
      await ctxDemo.close();
    }
    return { status: "passed", iosModernVerified: true, demoOfflineZeroApiCalls: true };
  });

  return {
    shells: shellResults,
    screenshotsCount: screenshots.length,
    multiWindowAndEditorGuard: multiWindowResult,
    iosModernAndDemo,
  };
}
