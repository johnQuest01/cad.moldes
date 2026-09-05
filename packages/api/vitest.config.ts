import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Nos testes, `@cad/motor` resolve para o FONTE, nao para o `dist`.
 *
 * Sem isso, `npm test` num clone limpo falha: o pacote publica `dist/index.js`, que
 * so existe depois do build, e o teste passaria a depender da ordem de dois
 * comandos. Apontar para o fonte tambem da rastro de pilha em cima do codigo real.
 *
 * Quem confere que o `dist` continua importavel e o CI, num passo proprio depois
 * do build — o `exports` do package.json e parte do contrato e nao pode quebrar
 * em silencio.
 */
const motor = fileURLToPath(new URL('../motor/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@cad/motor': motor } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', reporters: ['verbose'] },
});
