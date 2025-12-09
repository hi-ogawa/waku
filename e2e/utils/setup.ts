/**
 * Test Setup Utilities
 * 
 * Provides functions to start and manage Waku applications for testing.
 */

import { exec, execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debugChildProcess, findWakuPort, terminate } from './process.js';

export type StartAppResult = {
  port: number;
  stopApp: () => Promise<void>;
  fixtureDir: string;
};

export type StandaloneStartAppResult = {
  port: number;
  stopApp: () => Promise<void>;
  standaloneDir: string;
};

/**
 * Setup for testing with monorepo packages (most common use case)
 * 
 * @param fixtureName - Name of the fixture directory in e2e/fixtures/
 * @returns Function to start the app in DEV, PRD, or STATIC mode
 * 
 * @example
 * ```typescript
 * const startApp = prepareNormalSetup('ssr-basic');
 * const { port, stopApp } = await startApp('DEV');
 * // ... run tests
 * await stopApp();
 * ```
 */
export const prepareNormalSetup = (fixtureName: string) => {
  const waku = fileURLToPath(
    new URL('../../packages/waku/dist/cli.js', import.meta.url),
  );
  const fixtureDir = fileURLToPath(
    new URL('../fixtures/' + fixtureName, import.meta.url),
  );
  let built = false;

  const startApp = async (
    mode: 'DEV' | 'PRD' | 'STATIC',
    options?: { cmd?: string | undefined },
  ): Promise<StartAppResult> => {
    if (mode !== 'DEV' && !built) {
      rmSync(`${fixtureDir}/dist`, { recursive: true, force: true });
      execSync(`node ${waku} build`, { cwd: fixtureDir });
      built = true;
    }

    let cmd: string;
    switch (mode) {
      case 'DEV':
        cmd = `node ${waku} dev`;
        break;
      case 'PRD':
        cmd = `node ${waku} start`;
        break;
      case 'STATIC':
        cmd = `pnpm serve dist/public`;
        break;
    }
    if (options?.cmd) {
      cmd = options.cmd;
    }

    const cp = exec(cmd, { cwd: fixtureDir });
    debugChildProcess(cp, fileURLToPath(import.meta.url));
    const port = await findWakuPort(cp);

    const stopApp = async () => {
      await terminate(port);
    };

    return { port, stopApp, fixtureDir };
  };

  return startApp;
};

const PACKAGE_INSTALL = {
  npm: `npm install --force`,
  pnpm: `pnpm install`,
  yarn: `yarn install`,
} as const;

const patchMonorepoPackageJson = (standaloneDir: string) => {
  const packagesDir = join(standaloneDir, 'packages');
  if (!existsSync(packagesDir)) {
    return;
  }
  const rootPackageJson = JSON.parse(
    readFileSync(join(standaloneDir, 'package.json'), 'utf8'),
  );
  const reactVersion = rootPackageJson.dependencies.react;
  if (!reactVersion) {
    return;
  }
  for (const dir of readdirSync(packagesDir)) {
    const packageJsonFile = join(packagesDir, dir, 'package.json');
    if (!existsSync(packageJsonFile)) {
      continue;
    }
    let modified = false;
    const packageJson = JSON.parse(readFileSync(packageJsonFile, 'utf8'));
    for (const key of Object.keys(packageJson.dependencies || {})) {
      if (key.startsWith('react')) {
        if (packageJson.dependencies[key] !== reactVersion) {
          packageJson.dependencies[key] = reactVersion;
          modified = true;
        }
      }
    }
    if (modified) {
      writeFileSync(packageJsonFile, JSON.stringify(packageJson), 'utf8');
    }
  }
};

export const makeTempDir = (prefix: string): string => {
  // GitHub Action on Windows doesn't support mkdtemp on global temp dir,
  // Which will cause files in `src` folder to be empty. I don't know why
  const tmpDir = process.env.TEMP_DIR || tmpdir();
  return mkdtempSync(join(tmpDir, prefix));
};

/**
 * Setup for testing standalone installations (simulates user experience)
 * 
 * Creates a temporary directory, copies the fixture, packs waku, and installs dependencies
 * as a user would. Use for testing installation, monorepo scenarios, or with different
 * package managers.
 * 
 * @param fixtureName - Name of the fixture directory in e2e/fixtures/
 * @returns Function to start the app with specified package manager
 * 
 * @example
 * ```typescript
 * const startApp = prepareStandaloneSetup('monorepo');
 * const { port, stopApp, standaloneDir } = await startApp('PRD', 'pnpm');
 * // ... run tests
 * await stopApp();
 * ```
 */
export const prepareStandaloneSetup = (fixtureName: string) => {
  const wakuDir = fileURLToPath(
    new URL('../../packages/waku', import.meta.url),
  );
  const { version } = createRequire(import.meta.url)(
    join(wakuDir, 'package.json'),
  );
  const fixtureDir = fileURLToPath(
    new URL('../fixtures/' + fixtureName, import.meta.url),
  );
  const standaloneDirMap = new Map<'npm' | 'pnpm' | 'yarn', string>();
  const builtModeMap = new Map<'npm' | 'pnpm' | 'yarn', 'PRD' | 'STATIC'>();

  const startApp = async (
    mode: 'DEV' | 'PRD' | 'STATIC',
    packageManager: 'npm' | 'pnpm' | 'yarn' = 'pnpm',
    packageDir = '',
  ): Promise<StandaloneStartAppResult> => {
    const wakuPackageDir = (): string => {
      if (!standaloneDir) {
        throw new Error('standaloneDir is not set');
      }
      return packageManager !== 'pnpm'
        ? standaloneDir
        : join(standaloneDir, packageDir);
    };

    let standaloneDir = standaloneDirMap.get(packageManager);
    if (!standaloneDir) {
      standaloneDir = makeTempDir(fixtureName);
      standaloneDirMap.set(packageManager, standaloneDir);
      cpSync(fixtureDir, standaloneDir, {
        filter: (src) => {
          return !src.includes('node_modules') && !src.includes('dist');
        },
        recursive: true,
      });
      execSync(`pnpm pack --pack-destination ${standaloneDir}`, {
        cwd: wakuDir,
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      const wakuPackageTgz = join(standaloneDir, `waku-${version}.tgz`);
      const rootPkg = JSON.parse(
        readFileSync(
          fileURLToPath(new URL('../../package.json', import.meta.url)),
          'utf8',
        ),
      );
      const pnpmOverrides = {
        ...rootPkg.pnpm?.overrides,
        ...rootPkg.pnpmOverrides, // Do we need this?
        waku: `file:${wakuPackageTgz}`,
      };
      for (const file of readdirSync(standaloneDir, {
        encoding: 'utf8',
        recursive: true,
      })) {
        if (file.endsWith('package.json')) {
          const f = join(standaloneDir, file);
          const pkg = JSON.parse(readFileSync(f, 'utf8'));
          for (const deps of [pkg.dependencies, pkg.devDependencies]) {
            Object.keys(deps || {}).forEach((key) => {
              if (pnpmOverrides[key]) {
                deps[key] = pnpmOverrides[key];
              }
            });
          }
          if (file === 'package.json') {
            switch (packageManager) {
              case 'npm': {
                pkg.overrides = pnpmOverrides;
                break;
              }
              case 'pnpm': {
                pkg.pnpm = { overrides: pnpmOverrides };
                break;
              }
              case 'yarn': {
                pkg.resolutions = pnpmOverrides;
                break;
              }
            }
            if (packageManager === 'pnpm') {
              pkg.packageManager = rootPkg.packageManager;
            }
          }
          writeFileSync(f, JSON.stringify(pkg, null, 2), 'utf8');
        }
      }
      if (packageManager !== 'pnpm') {
        patchMonorepoPackageJson(standaloneDir);
      }
      execSync(PACKAGE_INSTALL[packageManager], {
        cwd: standaloneDir,
        stdio: 'inherit',
      });
    }

    const waku = join(wakuPackageDir(), './node_modules/waku/dist/cli.js');
    if (mode !== 'DEV' && builtModeMap.get(packageManager) !== mode) {
      rmSync(`${join(standaloneDir, packageDir, 'dist')}`, {
        recursive: true,
        force: true,
      });
      execSync(`node ${waku} build`, { cwd: join(standaloneDir, packageDir) });
      builtModeMap.set(packageManager, mode);
    }

    let cmd: string;
    switch (mode) {
      case 'DEV':
        cmd = `node ${waku} dev`;
        break;
      case 'PRD':
        cmd = `node ${waku} start`;
        break;
      case 'STATIC':
        cmd = `node ${join(standaloneDir, './node_modules/serve/build/main.js')} dist/public`;
        break;
    }

    const cp = exec(cmd, { cwd: join(standaloneDir, packageDir) });
    debugChildProcess(cp, fileURLToPath(import.meta.url));
    const port = await findWakuPort(cp);

    const stopApp = async () => {
      builtModeMap.delete(packageManager);
      await terminate(port);
    };

    return { port, stopApp, standaloneDir };
  };

  return startApp;
};
