/**
 * @cad/editor — o COMPORTAMENTO do editor de moldes.
 *
 * TypeScript puro: sem DOM, sem PixiJS, sem canvas. Roda no Node e e testado
 * headless, exatamente como `@cad/motor`. Quem desenha e recebe ponteiro e teclado
 * e o `@cad/editor-pixi`, um andar acima.
 *
 * E3 da Fase 2: um `import` de `pixi.js` ou de `document` aqui dentro e erro de
 * arquitetura, nao detalhe — e ha um teste que falha se acontecer.
 */

export { Sessao, tentar, type DadosDaSessao, type Gesto } from './sessao.js';

export {
  Camera,
  caixaDe,
  seTocam,
  ZOOM_MINIMO,
  ZOOM_MAXIMO,
  type Caixa,
  type Pixel,
} from './camera.js';
