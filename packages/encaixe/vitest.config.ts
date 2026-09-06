import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Como nos outros pacotes: nos testes, `@cad/motor` resolve para o FONTE. */
const motor = fileURLToPath(new URL('../motor/src/index.ts', import.meta.url));
const plotter = fileURLToPath(new URL('../plotter/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@cad/motor': motor, '@cad/plotter': plotter } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', reporters: ['verbose'] },
});
