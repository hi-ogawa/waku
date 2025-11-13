/**
 * Browser and Page Utilities
 * 
 * Helper functions for common browser interactions and waits.
 */

import type { ConsoleMessage, Page } from '@playwright/test';
import { expect, test as basicTest } from '@playwright/test';

/**
 * Test options for Waku e2e tests
 */
export type TestOptions = {
  mode: 'DEV' | 'PRD';
  page: Page;
};

/**
 * Extended Playwright test with Waku-specific options
 * - Adds mode option (DEV or PRD) at worker scope
 * - Adds console message logging and validation
 */
export const test = basicTest.extend<
  Omit<TestOptions, 'mode'>,
  Pick<TestOptions, 'mode'>
>({
  mode: ['DEV', { option: true, scope: 'worker' }],
  page: async ({ page }, pageUse, testInfo) => {
    const callback = (msg: ConsoleMessage) => {
      // Define unexpected errors inline or import from process.ts
      const unexpectedErrors = [
        /^You did not run Node.js with the `--conditions react-server` flag/,
        /^\(node:14372\)/,
        /^Warning: Expected server HTML to contain a matching/,
      ];
      if (unexpectedErrors.some((re) => re.test(msg.text()))) {
        throw new Error(msg.text());
      }
      console.log(`(${testInfo.title}) ${msg.type()}: ${msg.text()}`);
    };
    page.on('console', callback);
    await pageUse(page);
    page.off('console', callback);
  },
});

/**
 * Waits for React hydration to complete
 * 
 * Checks for React Fiber keys on the body element which indicate
 * that React has hydrated the page.
 * 
 * @param page - Playwright page instance
 * @throws TimeoutError if hydration doesn't complete within 3 seconds
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('body');
      if (el) {
        const keys = Object.keys(el);
        return keys.some((key) => key.startsWith('__reactFiber'));
      }
    },
    null,
    { timeout: 3000 },
  );
}

/**
 * Custom assertions for common Waku test scenarios
 */
export const assertions = {
  /**
   * Assert that hydration completed successfully
   */
  async expectHydrated(page: Page) {
    await waitForHydration(page);
    // Could add additional hydration checks here
  },

  /**
   * Assert no hydration mismatch errors occurred
   */
  async expectNoHydrationMismatch(page: Page) {
    const messages: string[] = [];
    page.on('console', (msg) => messages.push(msg.text()));
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    
    // Give time for any errors to appear
    await page.waitForTimeout(500);
    
    expect(messages.join('\n')).not.toContain('hydration-mismatch');
    expect(errors.join('\n')).not.toContain('Minified React error #418');
  },
};
