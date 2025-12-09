/**
 * Process Management Utilities
 * 
 * Functions for managing child processes, finding ports, and terminating servers.
 */

import type { ChildProcess } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { error, info } from '@actions/core';
import { expect } from '@playwright/test';
import fkill from 'fkill';

/**
 * Finds the port that Waku server started on by listening to stdout
 * 
 * @param cp - Child process running the Waku server
 * @returns Promise resolving to the port number
 * @throws Error if port is not found within 10 seconds
 */
export async function findWakuPort(cp: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    function listener(data: unknown) {
      const str = stripVTControlCharacters(`${data}`);
      const match = str.match(/http:\/\/localhost:(\d+)|on port (\d+)/);
      if (match) {
        clearTimeout(timer);
        cp.stdout?.off('data', listener);
        const port = match[1] || match[2]!;
        info(`Waku server started at port ${port}`);
        resolve(parseInt(port, 10));
      }
    }
    cp.stdout?.on('data', listener);
    const timer = setTimeout(() => {
      cp.stdout?.off('data', listener);
      reject(new Error('Timeout while waiting for port'));
    }, 10_000);
  });
}

/**
 * Terminates a process running on a specific port
 * 
 * @param port - Port number to kill processes on
 */
export const terminate = async (port: number) => {
  await fkill(`:${port}`, {
    force: true,
  });
};

/**
 * Error patterns that should fail tests if found
 */
const unexpectedErrors: RegExp[] = [
  /^You did not run Node.js with the `--conditions react-server` flag/,
  /^\(node:14372\)/,
  /^Warning: Expected server HTML to contain a matching/,
];

/**
 * Error patterns that are expected and should be ignored
 */
const ignoreErrors: RegExp[] = [
  /ExperimentalWarning: Custom ESM Loaders is an experimental feature and might change at any time/,
  /^Error: Unexpected error\s+at ThrowsComponent/,
  /^Error: Something unexpected happened\s+at ErrorRender/,
  /^Error: 401 Unauthorized\s+at CheckIfAccessDenied/,
  /^Error: Not Found\s+at SyncPage/,
  /^Error: Not Found\s+at AsyncPage/,
  /^Error: Redirect\s+at createCustomError/,
  // FIXME Is this too general and miss meaningful errors?
  /^\[Error: An error occurred in the Server Components render./,
];

/**
 * Monitors child process output and validates against known error patterns
 * 
 * @param cp - Child process to monitor
 * @param sourceFile - File path for context in error messages
 */
export function debugChildProcess(cp: ChildProcess, sourceFile: string) {
  cp.stdout?.on('data', (data) => {
    const str = data.toString();
    expect(unexpectedErrors.some((re) => re.test(str))).toBeFalsy();
    if (ignoreErrors?.some((re) => re.test(str))) {
      return;
    }
    info(`(${sourceFile}) stdout: ${str}`);
  });

  cp.stderr?.on('data', (data) => {
    const str = data.toString();
    expect(unexpectedErrors.some((re) => re.test(str))).toBeFalsy();
    if (ignoreErrors?.some((re) => re.test(str))) {
      return;
    }
    error(`stderr: ${str}`, {
      title: 'Child Process Error',
      file: sourceFile,
    });
  });
}
