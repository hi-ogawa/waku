/**
 * E2E Test Utilities for Waku
 * 
 * Main entry point for all test utilities.
 * Re-exports from specialized modules for backward compatibility.
 */

// Setup utilities
export {
  prepareNormalSetup,
  prepareStandaloneSetup,
  makeTempDir,
  type StartAppResult,
  type StandaloneStartAppResult,
} from './setup.js';

// Process utilities
export {
  findWakuPort,
  terminate,
  debugChildProcess,
} from './process.js';

// Browser utilities
export {
  test,
  waitForHydration,
  assertions,
  type TestOptions,
} from './browser.js';

/**
 * Fetch error messages by browser
 * Used for testing network error handling
 */
export const FETCH_ERROR_MESSAGES = {
  chromium: 'Failed to fetch',
  firefox: 'NetworkError when attempting to fetch resource.',
  webkit: 'Load failed',
};
