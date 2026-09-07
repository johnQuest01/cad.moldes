/**
 * Fase 6 — o caminho inteiro na foto do ateliê: foto → peças em milímetro.
 *
 * **A escala aqui é PROVISÓRIA**, e isso não é detalhe de rodapé. O rótulo da foto
 * diz 138 × 72 cm e o quadro medido nela não tem essa proporção (1,742 contra
 * 1,917), então a calibração de verdade ainda não existe — ela virá da foto de um
 * objeto de tamanho conhecido, que é a decisão I14.
 *
 * O que este teste prova é o **encadeamento**: quadro → homografia → segmentação →
 * contorno → milímetro → simplificação → piques → cantos → curvas, sem nada
 * quebrar no meio. Os milímetros que ele imprime valem como ordem de grandeza para
 * conferir com a trena, não como medida.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';
import { describe, expect, it } from 'vitest';

import { MM, type Vetor2 } from '@cad/motor';

import {
  ajustarCurvas,
  aspectoDetectado,
  contornoDaRegiao,
  detectarCantos,
  detectarPiques,
  detectarQuadro,
  estimarHomografia,
  paraUM,
  preencherBuracos,
  removerPiques,
  rotular,
  segmentar,
  simplificarAnel,
  type Imagem,
} from '../src/index.js';

const CAMINHO = fileURLToPath(new URL('./fixtures/parede-01.png', import.meta.url));

/** Largura ASSUMIDA do quadro entre os centros das marcas. Provisória (I14). */
const LARGURA_ASSUMIDA_UM = 1380 * MM;

async function carregar(): Promise<Imagem> {
  const jimp = await Jimp.read(readFileSync(CAMINHO));
  return {
    largura: jimp.bitmap.width,
    altura: jimp.bitmap.height,
    dados: new Uint8ClampedArray(jimp.bitmap.data),
  };
}

const caixa = (pontos: readonly Vetor2[]) => ({
  largura: Math.max(...pontos.map((p) => p.x)) - Math.min(...pontos.map((p) => p.x)),
  altura: Math.max(...pontos.map((p) => p.y)) - Math.min(...pontos.map((p) => p.y)),
});

const perimetro = (anel: readonly Vetor2[]): number => {
  let soma = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    soma += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return soma;
};

describe('Foto → peças em milímetro', () => {
  it('as onze peças atravessam o caminho inteiro', async () => {
    const img = await carregar();

    // 1. o quadro, e a homografia com a escala provisória.
    const quadro = detectarQuadro(img);
    const aspecto = aspectoDetectado(quadro.cantos)!;
    const alturaUM = Math.round(LARGURA_ASSUMIDA_UM / aspecto);
    const h = estimarHomografia(quadro.cantos!, [
      { x: 0, y: 0 },
      { x: LARGURA_ASSUMIDA_UM, y: 0 },
      { x: LARGURA_ASSUMIDA_UM, y: alturaUM },
      { x: 0, y: alturaUM },
    ]);

    // Quantos milímetros vale um pixel: é o teto de precisão desta foto, e é o
    // que dita toda tolerância abaixo. Pedir 0,2 mm aqui seria fingir.
    const a = quadro.cantos![0];
    const b = quadro.cantos![1];
    const mmPorPixel = LARGURA_ASSUMIDA_UM / MM / Math.hypot(b.x - a.x, b.y - a.y);
    const tolerancia = Math.round(1.5 * mmPorPixel * MM);

    console.log('--- foto -> milimetro (escala PROVISORIA) ---');
    console.log(
      `quadro assumido: ${LARGURA_ASSUMIDA_UM / MM} x ${(alturaUM / MM).toFixed(0)} mm ` +
        `(altura vinda da proporcao medida ${aspecto.toFixed(4)})`,
    );
    console.log(
      `resolucao: ${mmPorPixel.toFixed(3)} mm por pixel -> tolerancia de trabalho ` +
        `${(tolerancia / MM).toFixed(2)} mm`,
    );

    // 2. as peças.
    const s = segmentar(img);
    const areaMinima = Math.round(img.largura * img.altura * 0.0005);
    const cheia = preencherBuracos(s.papel, img.largura, img.altura);
    const { rotulos, regioes } = rotular(cheia, img.largura, img.altura, areaMinima);

    console.log('');
    console.log('peca   largura   altura   perimetro   pontos   cantos   trechos   piques');
    let totalPontos = 0;
    let totalTrechos = 0;
    let totalPiques = 0;

    for (const [i, r] of regioes.entries()) {
      const emPixels = contornoDaRegiao(rotulos, img.largura, img.altura, r.rotulo);
      // 3. pixel -> micrometro, de uma vez, pela homografia.
      const emUM = emPixels.map((p) => paraUM(h, p));
      // 4. simplificar, 5. piques, 6. cantos, 7. curvas.
      const simples = simplificarAnel(emUM, tolerancia);
      const { anel: semPiques, piques } = removerPiques(simples, detectarPiques(simples));
      const cantos = detectarCantos(semPiques, 30, 12_000);
      const trechos = ajustarCurvas(semPiques, cantos, tolerancia);

      const c = caixa(semPiques);
      totalPontos += simples.length;
      totalTrechos += trechos.length;
      totalPiques += piques.length;
      console.log(
        `${String(i + 1).padStart(4)}   ` +
          `${(c.largura / MM).toFixed(0).padStart(7)}   ` +
          `${(c.altura / MM).toFixed(0).padStart(6)}   ` +
          `${(perimetro(semPiques) / MM).toFixed(0).padStart(9)}   ` +
          `${String(simples.length).padStart(6)}   ` +
          `${String(cantos.length).padStart(6)}   ` +
          `${String(trechos.length).padStart(7)}   ` +
          `${String(piques.length).padStart(6)}`,
      );
      expect(simples.length).toBeGreaterThanOrEqual(3);
      expect(trechos.length).toBeGreaterThanOrEqual(1);
    }

    console.log('');
    console.log(
      `total: ${regioes.length} pecas, ${totalPontos} pontos, ${totalTrechos} trechos ` +
        `(retas + Beziers), ${totalPiques} piques`,
    );
    console.log(
      'as medidas acima sao ORDEM DE GRANDEZA: a escala real so vem com a foto de',
    );
    console.log('calibracao (I14). Confira com a trena se batem — se nao baterem, o quadro');
    console.log('nao mede 1380 mm entre os centros das marcas, e o numero certo sai dai.');

    expect(regioes.length).toBe(11);
    expect(totalTrechos).toBeGreaterThan(regioes.length);
  });
});
