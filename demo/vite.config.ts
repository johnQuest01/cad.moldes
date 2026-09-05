import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * A demo importa `@cad/motor` do FONTE, nao do `dist`: assim ela recarrega junto
 * com o motor enquanto se mexe no codigo, e o que se ve na tela e exatamente o
 * codigo que os testes exercitam.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@cad/motor': fileURLToPath(new URL('../packages/motor/src/index.ts', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
