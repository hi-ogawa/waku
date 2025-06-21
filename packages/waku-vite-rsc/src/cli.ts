import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

// based on
// https://github.com/hi-ogawa/vite-plugins/blob/5970c2bab1aff4d40a04756198feaeecaa924ecf/packages/react-server-next/src/cli.ts#L33-L34

function main() {
  const argv = process.argv.slice(2);

  if (argv[0] && !['dev', 'build', 'start'].includes(argv[0])) {
    console.error(`[ERROR] unsupported command '${argv[0]}'`);
    process.exit(1);
  }

  // next start -> vite preview
  if (argv[0] === 'start') {
    argv[0] = 'preview';
  }

  // auto setup vite.config.ts
  const configFile = setupViteConfig();

  // spawn vite
  const viteBin = path.join(
    createRequire(import.meta.url).resolve('vite/package.json'),
    '../bin/vite.js',
  );
  const proc = spawn(
    'node',
    [viteBin, ...argv, ...(configFile ? ['-c', configFile] : [])],
    {
      shell: false,
      stdio: 'inherit',
    },
  );
  proc.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}

// create and use default config if no vite.config.ts
function setupViteConfig() {
  if (fs.existsSync('vite.config.ts')) return;

  const DEFAULT_VITE_CONFIG = `\
import waku from "waku-vite-rsc/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [waku()],
});
`;

  const configFile = 'node_modules/.cache/waku-vite-rsc/vite.config.ts';
  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, DEFAULT_VITE_CONFIG);
  }
  return configFile;
}

main();
