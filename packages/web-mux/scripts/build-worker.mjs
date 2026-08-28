// esbuild's bin is a native ELF after install scripts run — call the JS API
// instead so the build works with scripts on (termux) and off (ci)
import { build } from 'esbuild';

await build({
  entryPoints: ['src/worker.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/worker.js',
  allowOverwrite: true,
});
