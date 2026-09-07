import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * O app importa os pacotes do FONTE: assim ele recarrega junto com o motor e com o
 * editor enquanto se mexe no codigo, e o que se ve na tela e exatamente o codigo
 * que os testes exercitam.
 */
const fonte = (pacote: string, arquivo = 'src/index.ts') =>
  fileURLToPath(new URL(`../packages/${pacote}/${arquivo}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@cad/motor': fonte('motor'),
      '@cad/editor': fonte('editor'),
      '@cad/editor-pixi': fonte('editor-pixi'),
      '@cad/dxf': fonte('dxf'),
      '@cad/plotter': fonte('plotter'),
      '@cad/encaixe': fonte('encaixe'),
      '@cad/foto': fonte('foto'),
      '@cad/ia': fonte('ia'),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5200 },
});
