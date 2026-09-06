/**
 * Fase 6 — achar o quadro de calibração, na foto real.
 *
 * O teste que mais importa aqui não é o que passa: é o que **recusa**. A foto do
 * ateliê traz escrito "138 × 72 cm" e o quadro medido nela não tem essa proporção.
 * Aceitar aquele rótulo esticaria todo molde digitalizado em 9% num eixo, sem nada
 * na tela denunciar — porque a homografia leva qualquer quadrilátero em qualquer
 * retângulo, e não reclama nunca.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';
import { describe, expect, it } from 'vitest';

import { MM } from '@cad/motor';

import {
  aspectoDetectado,
  conferirQuadroContraCalibracao,
  detectarQuadro,
  estimarHomografia,
  projetar,
  rotular,
  segmentar,
  type Imagem,
} from '../src/index.js';

const CAMINHO = fileURLToPath(new URL('./fixtures/parede-01.png', import.meta.url));

async function carregar(): Promise<Imagem> {
  const jimp = await Jimp.read(readFileSync(CAMINHO));
  return {
    largura: jimp.bitmap.width,
    altura: jimp.bitmap.height,
    dados: new Uint8ClampedArray(jimp.bitmap.data),
  };
}

describe('O quadro na foto do ateliê', () => {
  it('acha as marcas da borda e ajusta os quatro lados', async () => {
    const img = await carregar();
    const q = detectarQuadro(img);

    console.log('--- o quadro ---');
    console.log(`${q.marcas.length} marcas aceitas`);
    console.log(`por lado (baixo, direita, cima, esquerda): ${q.porLado.join(', ')}`);
    console.log(`pior desvio de uma marca à reta do lado dela: ${q.residuoPx.toFixed(2)} px`);
    console.log(`problemas: ${q.problemas.map((p) => p.codigo).join(', ') || 'nenhum'}`);
    const nomes = ['inf-esq', 'inf-dir', 'sup-dir', 'sup-esq'];
    q.cantos?.forEach((c, i) => console.log(`  ${nomes[i]}: (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`));

    expect(q.problemas).toHaveLength(0);
    expect(q.cantos).not.toBeNull();
    expect(q.marcas.length).toBeGreaterThan(100);
    // Todo lado com marca suficiente para uma reta, e com folga.
    for (const n of q.porLado) expect(n).toBeGreaterThanOrEqual(10);
  });

  it('a barra do programa, que é branca e enorme, é descartada pelo tamanho', async () => {
    const img = await carregar();
    const s = segmentar(img);
    const todas = rotular(s.bordaDoQuadro, img.largura, img.altura, 20).regioes;
    const q = detectarQuadro(img);
    const maior = Math.max(...todas.map((r) => r.area));
    const maiorAceita = Math.max(...q.marcas.map((m) => m.area));
    console.log(
      `maior mancha branca da imagem: ${maior} px (a barra do programa) | ` +
        `maior marca aceita: ${maiorAceita} px`,
    );
    expect(maior).toBeGreaterThan(10_000);
    expect(maiorAceita).toBeLessThan(1000);
  });
});

describe('O alarme que impede o molde esticado', () => {
  it('recusa "138 × 72 cm": o quadro na foto NÃO tem essa proporção', async () => {
    const img = await carregar();
    const q = detectarQuadro(img);
    const medido = aspectoDetectado(q.cantos)!;

    const rotulo = { larguraUM: 1380 * MM, alturaUM: 720 * MM };
    const problemas = conferirQuadroContraCalibracao(q, rotulo);

    console.log('--- o rotulo nao bate com a foto ---');
    console.log(`proporcao declarada (1380/720): ${(1380 / 720).toFixed(4)}`);
    console.log(`proporcao medida na foto:       ${medido.toFixed(4)}`);
    console.log(`diferenca: ${((Math.abs(medido - 1380 / 720) / (1380 / 720)) * 100).toFixed(1)}%`);
    console.log(`"${problemas[0]?.mensagem}"`);

    expect(problemas).toHaveLength(1);
  });

  it('uma calibração compatível com a foto passa', async () => {
    const img = await carregar();
    const q = detectarQuadro(img);
    const medido = aspectoDetectado(q.cantos)!;
    const coerente = { larguraUM: 1380 * MM, alturaUM: Math.round((1380 / medido) * MM) };
    console.log(
      `1380 x ${(coerente.alturaUM / MM).toFixed(0)} mm (proporcao ${medido.toFixed(3)}) -> ` +
        `${conferirQuadroContraCalibracao(q, coerente).length} problema(s)`,
    );
    expect(conferirQuadroContraCalibracao(q, coerente)).toHaveLength(0);
  });

  it('a homografia ACEITA a calibração errada sem reclamar — é por isso que o alarme existe', async () => {
    const img = await carregar();
    const q = detectarQuadro(img)!;
    const cantos = q.cantos!;

    // Com o rótulo errado, a homografia fecha perfeitamente nos quatro cantos.
    const mundoErrado = [
      { x: 0, y: 0 },
      { x: 1380 * MM, y: 0 },
      { x: 1380 * MM, y: 720 * MM },
      { x: 0, y: 720 * MM },
    ];
    const h = estimarHomografia(cantos, mundoErrado);
    let pior = 0;
    for (let i = 0; i < 4; i++) {
      const v = projetar(h, cantos[i]!);
      pior = Math.max(pior, Math.hypot(v.x - mundoErrado[i]!.x, v.y - mundoErrado[i]!.y));
    }
    console.log(
      `com a calibracao ERRADA, o residuo nos quatro cantos e ${pior.toFixed(3)} UM — ou seja, ZERO.`,
    );
    console.log('a homografia leva qualquer quadrilatero em qualquer retangulo. Ela nunca reclama.');
    console.log('quem reclama e a conferencia de proporcao, e por isso ela nao e opcional.');
    expect(pior).toBeLessThan(10);
  });
});
