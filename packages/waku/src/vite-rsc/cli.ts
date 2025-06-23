import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

export async function cli(options: { cmd: string; port: number }) {
  let configFile: string | undefined;

  if (fs.existsSync('waku-vite-rsc.config.ts')) {
    // allow a dedicated config file for Vite RSC port
    configFile = 'waku-vite-rsc.config.ts';
  } else if (!fs.existsSync('vite.config.ts')) {
    // auto setup vite.config.ts in a hidden place
    const configCode = `\
import waku from "waku/vite-rsc/plugin";

export default {
  plugins: [waku()],
};
`;
    configFile = `node_modules/.cache/waku-vite-rsc/vite.config.${hashString(configCode)}.ts`;
    if (!fs.existsSync(configFile)) {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, configCode);
    }
  }

  // spawn vite
  const viteBin = path.join(
    require.resolve('vite/package.json'),
    '../bin/vite.js',
  );
  const proc = spawn(
    'node',
    [
      viteBin,
      options.cmd === 'start' ? 'preview' : options.cmd,
      ...(options.cmd !== 'build' && options.port
        ? ['--port', String(options.port)]
        : []),
      ...(configFile ? ['-c', configFile] : []),
    ],
    {
      shell: false,
      stdio: 'inherit',
    },
  );
  proc.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}

function hashString(v: string) {
  return createHash('sha256').update(v).digest().toString('hex').slice(0, 10);
}
