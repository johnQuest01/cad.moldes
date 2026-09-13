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
const ia = fileURLToPath(new URL('../ia/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@cad/motor': motor, '@cad/ia': ia } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    /**
     * Arquivos em SERIE, com hook folgado: cada arquivo sobe um Postgres
     * inteiro em WASM (PGlite), e tres subindo juntos numa maquina modesta
     * estouravam o hook de 10 s de vez em quando — flake de infraestrutura,
     * nao de logica. Em serie a suite fica ~2 s mais lenta e deterministica.
     */
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
