import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Nos testes, os pacotes do monorepo resolvem para o FONTE. */
const fonte = (p: string) => fileURLToPath(new URL(`../${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@cad/motor': fonte('motor'), '@cad/editor': fonte('editor') } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', reporters: ['verbose'] },
});
