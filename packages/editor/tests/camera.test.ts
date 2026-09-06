/**
 * Bloco 1 — a camera (E4, E5, E6, E11).
 *
 * Os dois testes que mais importam sao de propriedade, porque e neles que erro de
 * conversao aparece: ida e volta de coordenada, e zoom no cursor. Um CAD que
 * desloca a peca meio milimetro por causa de arredondamento na camera nao serve.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { MM, umParaMM } from '@cad/motor';

import { Camera, ZOOM_MAXIMO, ZOOM_MINIMO, caixaDe, seTocam } from '../src/index.js';

/** A caixa de uma frente de blusa: 190 x 450 mm, o tamanho do que se edita de verdade. */
const BLUSA = { minX: 0, minY: 0, maxX: 190 * MM, maxY: 450 * MM };

describe('Mundo (UM, Y-up) e tela (px, Y-down) — E4', () => {
  it('o centro da tela e o centro da camera, e o Y esta invertido', () => {
    const camera = new Camera(800, 600);
    camera.definirZoom(1);
    const centro = camera.paraTela(camera.centro);
    const acima = camera.paraTela({ x: 0, y: 100 * MM });

    console.log('--- inversao do Y ---');
    console.log(`centro do mundo -> (${centro.x}, ${centro.y}) px`);
    console.log(`100 mm ACIMA no mundo -> y = ${acima.y} px (MENOR: a tela cresce para baixo)`);
    expect(centro).toEqual({ x: 400, y: 300 });
    expect(acima.y).toBeLessThan(centro.y);
    expect(acima.y).toBe(200);
  });

  it('umPorPixel e o que alimenta todo raio de captura (E11)', () => {
    const camera = new Camera(800, 600);
    console.log('--- escala ---');
    for (const zoom of [0.5, 1, 2, 8]) {
      camera.definirZoom(zoom);
      console.log(
        `zoom ${String(zoom).padStart(4)} px/mm -> ${camera.umPorPixel} UM/px | ` +
          `raio de captura de 10 px = ${umParaMM(camera.umPorPixel * 10).toFixed(2)} mm`,
      );
    }
    camera.definirZoom(1);
    expect(camera.umPorPixel).toBe(MM);
    camera.definirZoom(2);
    expect(camera.umPorPixel).toBe(MM / 2);
  });

  it('o zoom e limitado dos dois lados', () => {
    const camera = new Camera(800, 600);
    camera.definirZoom(0);
    const minimo = camera.zoom;
    camera.definirZoom(1e9);
    const maximo = camera.zoom;
    console.log(`zoom 0 -> ${minimo} | zoom 1e9 -> ${maximo} (1 UM por pixel)`);
    expect(minimo).toBe(ZOOM_MINIMO);
    expect(maximo).toBe(ZOOM_MAXIMO);
  });
});

describe('Enquadrar e vista', () => {
  it('enquadrar a blusa poe a peca inteira dentro da tela, com folga', () => {
    const camera = new Camera(800, 600);
    camera.enquadrar(BLUSA, 32);
    const cantos = [
      camera.paraTela({ x: BLUSA.minX, y: BLUSA.minY }),
      camera.paraTela({ x: BLUSA.maxX, y: BLUSA.maxY }),
    ];
    console.log('--- enquadrar 190 x 450 mm em 800 x 600 px ---');
    console.log(`zoom ${camera.zoom.toFixed(4)} px/mm | ${camera.umPorPixel.toFixed(0)} UM/px`);
    console.log(
      `cantos em (${cantos[0]!.x.toFixed(0)}, ${cantos[0]!.y.toFixed(0)}) e ` +
        `(${cantos[1]!.x.toFixed(0)}, ${cantos[1]!.y.toFixed(0)}) px`,
    );
    for (const canto of cantos) {
      expect(canto.x).toBeGreaterThanOrEqual(31);
      expect(canto.x).toBeLessThanOrEqual(769);
      expect(canto.y).toBeGreaterThanOrEqual(31);
      expect(canto.y).toBeLessThanOrEqual(569);
    }
  });

  it('a vista diz o que esta na tela — e o que o culling usa', () => {
    const camera = new Camera(800, 600);
    camera.enquadrar(BLUSA, 32);
    const vista = camera.vista;
    const longe = { minX: 5000 * MM, minY: 0, maxX: 5200 * MM, maxY: 100 * MM };

    console.log(
      `vista: ${umParaMM(vista.minX).toFixed(0)}..${umParaMM(vista.maxX).toFixed(0)} mm em x`,
    );
    console.log(
      `a blusa aparece: ${seTocam(vista, BLUSA)} | uma peca a 5 m dali: ${seTocam(vista, longe)}`,
    );
    expect(seTocam(vista, BLUSA)).toBe(true);
    expect(seTocam(vista, longe)).toBe(false);
  });

  it('caixaDe estoura em lista vazia — caixa de nada nao existe', () => {
    expect(() => caixaDe([])).toThrow(/vazia/);
    const caixa = caixaDe([
      { x: 10, y: 20 },
      { x: -5, y: 80 },
    ]);
    console.log(`caixaDe: x ${caixa.minX}..${caixa.maxX} | y ${caixa.minY}..${caixa.maxY}`);
    expect(caixa).toEqual({ minX: -5, minY: 20, maxX: 10, maxY: 80 });
  });
});

describe('Propriedade: ida e volta de coordenada', () => {
  it('paraMundo(paraTela(p)) erra no maximo 1 UM, em qualquer camera', () => {
    let maiorErro = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: -500_000, max: 500_000 }),
        fc.integer({ min: -500_000, max: 500_000 }),
        fc.double({ min: 0.05, max: 50, noNaN: true }),
        fc.integer({ min: -200_000, max: 200_000 }),
        fc.integer({ min: -200_000, max: 200_000 }),
        (x, y, zoom, cx, cy) => {
          const camera = new Camera(1280, 800);
          camera.definirZoom(zoom);
          camera.mover(0, 0);
          // Recoloca o centro sem depender de setter publico: mover em pixels.
          const alvoCentro = camera.paraTela({ x: cx, y: cy });
          camera.mover(camera.largura / 2 - alvoCentro.x, camera.altura / 2 - alvoCentro.y);

          const volta = camera.paraMundo(camera.paraTela({ x, y }));
          const erro = Math.max(Math.abs(volta.x - x), Math.abs(volta.y - y));
          maiorErro = Math.max(maiorErro, erro);
          return erro <= 1;
        },
      ),
      { numRuns: 1000 },
    );
    console.log(`1000 pontos, camera aleatoria: erro maximo de ida e volta = ${maiorErro} UM`);
    expect(maiorErro).toBeLessThanOrEqual(1);
  });
});

describe('Propriedade: zoom no cursor (nao no centro)', () => {
  it('o ponto do mundo sob o cursor continua sob o cursor depois do zoom', () => {
    let maiorDesvio = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1280 }),
        fc.integer({ min: 0, max: 800 }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        (px, py, fator, zoomInicial) => {
          const camera = new Camera(1280, 800);
          camera.definirZoom(zoomInicial);
          const foco = { x: px, y: py };
          const antes = camera.paraMundo(foco);
          camera.aproximarNoPonto(foco, fator);
          const depois = camera.paraMundo(foco);

          // O desvio e medido em PIXELS: e o que o olho ve. Meio UM de arredondamento
          // no mundo vira desvio invisivel na tela, e e isso que precisa valer.
          const emPixels = Math.max(
            Math.abs(depois.x - antes.x),
            Math.abs(depois.y - antes.y),
          ) / camera.umPorPixel;
          maiorDesvio = Math.max(maiorDesvio, emPixels);
          return emPixels <= 1;
        },
      ),
      { numRuns: 1000 },
    );
    console.log(
      `1000 zooms no cursor: o ponto sob o cursor andou no maximo ${maiorDesvio.toFixed(4)} px`,
    );
    expect(maiorDesvio).toBeLessThanOrEqual(1);
  });

  it('caso concreto: aproximar 8x no canto do decote mantem o canto no lugar', () => {
    const camera = new Camera(1280, 800);
    camera.enquadrar(BLUSA, 40);
    const decote = { x: 0, y: 450 * MM };
    const naTela = camera.paraTela(decote);

    console.log('--- zoom no cursor ---');
    console.log(`decote em (${naTela.x.toFixed(1)}, ${naTela.y.toFixed(1)}) px, zoom ${camera.zoom.toFixed(3)}`);
    for (let i = 0; i < 3; i++) camera.aproximarNoPonto(naTela, 2);
    const depois = camera.paraTela(decote);
    console.log(
      `depois de 3 zooms de 2x: (${depois.x.toFixed(1)}, ${depois.y.toFixed(1)}) px, ` +
        `zoom ${camera.zoom.toFixed(3)} | desvio ${Math.hypot(depois.x - naTela.x, depois.y - naTela.y).toFixed(3)} px`,
    );
    expect(Math.abs(depois.x - naTela.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(depois.y - naTela.y)).toBeLessThanOrEqual(1);
  });
});

describe('Pan', () => {
  it('arrastar 100 px para a direita traz o mundo 100 px para a direita', () => {
    const camera = new Camera(800, 600);
    camera.definirZoom(2);
    const p = { x: 50 * MM, y: 50 * MM };
    const antes = camera.paraTela(p);
    camera.mover(100, 0);
    const depois = camera.paraTela(p);
    console.log(`ponto: x ${antes.x} px -> ${depois.x} px (andou ${depois.x - antes.x} px)`);
    expect(depois.x - antes.x).toBeCloseTo(100, 6);
  });
});
