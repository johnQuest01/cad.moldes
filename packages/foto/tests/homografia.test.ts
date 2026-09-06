/**
 * Fase 6 — o quadro de referência e a homografia.
 *
 * O que precisa ficar provado, com número:
 *  - pixel volta a virar milímetro real, com a perspectiva desfeita;
 *  - **quanto** um erro de 1 px na detecção do marcador custa em milímetro — que é
 *    a decisão I2 ("a referência é a parede, não o ímã") virando número;
 *  - trocar dois cantos produz um molde ESPELHADO em silêncio, que é o motivo de
 *    os marcadores precisarem se identificar sozinhos (I3);
 *  - um quadro mal medido é recusado, e a mensagem diz o que fazer.
 */
import { describe, expect, it } from 'vitest';

import { MM, type Vetor2 } from '@cad/motor';

import {
  cantosDoQuadro,
  conferirCalibracao,
  estimarHomografia,
  paraUM,
  projetar,
  residuoDeReprojecao,
  type Calibracao,
  type PontoImagem,
} from '../src/index.js';

/** O quadro da foto real do ateliê: 138 × 72 cm. */
const QUADRO: Calibracao = {
  id: 'cal-1',
  tenantId: 'confeccao-a',
  nome: 'quadro do ateliê',
  larguraUM: 1380 * MM,
  alturaUM: 720 * MM,
  diagonal1UM: Math.round(Math.hypot(1380 * MM, 720 * MM)),
  diagonal2UM: Math.round(Math.hypot(1380 * MM, 720 * MM)),
};

/**
 * Uma câmera de verdade: furo de agulha, inclinada, a 2,5 m do quadro.
 *
 * Não é uma homografia inventada — é a projeção que uma foto de celular faz mesmo,
 * com o lado longe menor que o lado perto. Se o código só funcionasse com uma
 * matriz sintética, o teste não provaria nada.
 */
function camera(opcoes: { inclinacaoGraus: number; distanciaUM: number; focoPx: number }) {
  const t = (opcoes.inclinacaoGraus * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  const centro = { x: QUADRO.larguraUM / 2, y: QUADRO.alturaUM / 2 };
  return (p: Vetor2): PontoImagem => {
    // Centraliza no quadro, inclina em torno do eixo X, e afasta a câmera.
    const x = p.x - centro.x;
    const y = p.y - centro.y;
    const yc = y * cos;
    const zc = opcoes.distanciaUM - y * sen;
    return { x: 2000 + (opcoes.focoPx * x) / zc, y: 1500 - (opcoes.focoPx * yc) / zc };
  };
}

const LENTE = { inclinacaoGraus: 12, distanciaUM: 2500 * MM, focoPx: 3000 };

describe('A homografia desfaz a perspectiva', () => {
  it('pixel volta a ser milímetro real, num quadro de 138 × 72 cm', () => {
    const lente = camera(LENTE);
    const cantos = cantosDoQuadro(QUADRO);
    const naFoto = cantos.map(lente);
    const h = estimarHomografia(naFoto, cantos);

    // Uma malha de pontos espalhados pelo quadro — não só os cantos, que são os
    // únicos que a conta viu.
    let pior = 0;
    const amostras: string[] = [];
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const fy of [0.1, 0.5, 0.9]) {
        const real: Vetor2 = {
          x: Math.round(QUADRO.larguraUM * fx),
          y: Math.round(QUADRO.alturaUM * fy),
        };
        const devolta = paraUM(h, lente(real));
        const erro = Math.hypot(devolta.x - real.x, devolta.y - real.y);
        pior = Math.max(pior, erro);
        if (fy === 0.5) amostras.push(`(${real.x / MM}, ${real.y / MM}) -> erro ${erro} UM`);
      }
    }

    console.log('--- pixel -> milimetro ---');
    console.log(
      `quadro ${QUADRO.larguraUM / MM} x ${QUADRO.alturaUM / MM} mm | camera a ` +
        `${LENTE.distanciaUM / MM} mm, inclinada ${LENTE.inclinacaoGraus} graus`,
    );
    console.log(
      `escala na foto: ${(Math.hypot(naFoto[1]!.x - naFoto[0]!.x, naFoto[1]!.y - naFoto[0]!.y) / (QUADRO.larguraUM / MM)).toFixed(3)} px/mm`,
    );
    for (const a of amostras) console.log(`  ${a}`);
    console.log(`pior erro em 15 pontos: ${pior} UM = ${(pior / MM).toFixed(4)} mm`);
    console.log(`residuo de reprojecao nos 4 cantos: ${residuoDeReprojecao(h, naFoto, cantos).toFixed(3)} UM`);

    // 1 UM = 1 micrômetro. O erro aqui é só o arredondamento para inteiro.
    expect(pior).toBeLessThanOrEqual(1);
  });

  it('recusa quatro pontos alinhados, em vez de inventar uma perspectiva', () => {
    const emLinha: PontoImagem[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ];
    expect(() => estimarHomografia(emLinha, cantosDoQuadro(QUADRO))).toThrow(/degenerad|perspectiva/i);
    console.log('4 pontos alinhados -> recusado, como manda a I9 (nunca conserta em silencio)');
  });
});

describe('Por que a referência é a PAREDE, e não o ímã (decisão I2)', () => {
  it('1 px de erro na detecção custa 60× mais com referência pequena', () => {
    const lente = camera(LENTE);
    const cantos = cantosDoQuadro(QUADRO);

    /** Erro, em UM, num ponto a 700 mm do canto, quando um marcador erra 1 px. */
    const custoDeUmPixel = (
      refMundo: readonly Vetor2[],
      refFoto: readonly PontoImagem[],
    ): number => {
      const certa = estimarHomografia(refFoto, refMundo);
      const torta = estimarHomografia(
        [{ x: refFoto[0]!.x + 1, y: refFoto[0]!.y }, ...refFoto.slice(1)],
        refMundo,
      );
      // Um molde de 700 mm no meio do quadro: mede-se o quanto a ponta dele anda.
      const a: Vetor2 = { x: 340 * MM, y: 360 * MM };
      const b: Vetor2 = { x: 1040 * MM, y: 360 * MM };
      const medir = (h: ReturnType<typeof estimarHomografia>) => {
        const pa = projetar(h, lente(a));
        const pb = projetar(h, lente(b));
        return Math.hypot(pb.x - pa.x, pb.y - pa.y);
      };
      return Math.abs(medir(torta) - medir(certa));
    };

    // (a) O quadro da parede: 1380 mm de base.
    const comQuadro = custoDeUmPixel(cantos, cantos.map(lente));

    // (b) Um ímã de 20 mm no meio do quadro, usado como referência.
    const c = { x: QUADRO.larguraUM / 2, y: QUADRO.alturaUM / 2 };
    const ima: Vetor2[] = [
      { x: c.x - 10 * MM, y: c.y - 10 * MM },
      { x: c.x + 10 * MM, y: c.y - 10 * MM },
      { x: c.x + 10 * MM, y: c.y + 10 * MM },
      { x: c.x - 10 * MM, y: c.y + 10 * MM },
    ];
    const comIma = custoDeUmPixel(ima, ima.map(lente));

    console.log('--- 1 px de erro na deteccao, medido numa peca de 700 mm ---');
    console.log(`referencia = quadro da parede (1380 mm): ${(comQuadro / MM).toFixed(3)} mm de erro`);
    console.log(`referencia = ima de 20 mm:               ${(comIma / MM).toFixed(3)} mm de erro`);
    console.log(`o quadro e ${(comIma / comQuadro).toFixed(0)}x melhor`);
    console.log(`tolerancia do oficio: 1.000 mm`);

    expect(comQuadro).toBeLessThan(1 * MM);
    expect(comIma).toBeGreaterThan(comQuadro * 10);
  });
});

describe('Por que os marcadores precisam se identificar sozinhos (decisão I3)', () => {
  it('trocar dois cantos ESPELHA o molde, e nada denuncia', () => {
    const lente = camera(LENTE);
    const cantos = cantosDoQuadro(QUADRO);
    const naFoto = cantos.map(lente);

    const certa = estimarHomografia(naFoto, cantos);
    // Inferior-esquerdo trocado com inferior-direito: o erro que um ímã cinza
    // igual a outro ímã cinza produziria.
    const trocada = estimarHomografia([naFoto[1]!, naFoto[0]!, naFoto[3]!, naFoto[2]!], cantos);

    const ponto: Vetor2 = { x: 200 * MM, y: 200 * MM };
    const bom = projetar(certa, lente(ponto));
    const ruim = projetar(trocada, lente(ponto));

    console.log('--- cantos trocados ---');
    console.log(`ponto real (${ponto.x / MM}, ${ponto.y / MM}) mm`);
    console.log(`  ordem certa:   (${(bom.x / MM).toFixed(1)}, ${(bom.y / MM).toFixed(1)}) mm`);
    console.log(`  cantos trocados: (${(ruim.x / MM).toFixed(1)}, ${(ruim.y / MM).toFixed(1)}) mm`);
    console.log(
      `residuo nos 4 cantos com a ordem trocada: ` +
        `${residuoDeReprojecao(trocada, [naFoto[1]!, naFoto[0]!, naFoto[3]!, naFoto[2]!], cantos).toFixed(3)} UM ` +
        `— ou seja, ZERO: a conta fecha e o molde sai espelhado`,
    );

    // O x espelha em torno do meio do quadro; o resíduo continua zero.
    expect(Math.abs(ruim.x - (QUADRO.larguraUM - ponto.x))).toBeLessThan(1 * MM);
    expect(
      residuoDeReprojecao(trocada, [naFoto[1]!, naFoto[0]!, naFoto[3]!, naFoto[2]!], cantos),
    ).toBeLessThan(1);
  });
});

describe('O quadro mal medido é recusado', () => {
  it('retângulo de verdade passa', () => {
    expect(conferirCalibracao(QUADRO)).toHaveLength(0);
    console.log(
      `138 x 72 cm, diagonal ${(QUADRO.diagonal1UM / MM).toFixed(1)} mm -> aprovado`,
    );
  });

  it('diagonais que não fecham são recusadas, com a diferença no texto', () => {
    const torto: Calibracao = { ...QUADRO, diagonal2UM: QUADRO.diagonal2UM + 9 * MM };
    const problemas = conferirCalibracao(torto);
    console.log(`diagonais 1556.4 e 1565.4 mm -> ${problemas[0]?.codigo}`);
    console.log(`  "${problemas[0]?.mensagem}"`);
    expect(problemas.map((p) => p.codigo)).toContain('DIAGONAIS_DESIGUAIS');
  });

  it('lado digitado errado é pego por Pitágoras, mesmo com as diagonais iguais', () => {
    // As duas diagonais concordam entre si, mas não com os lados: sem esta conta,
    // um erro de digitação na largura passaria batido e contaminaria toda foto.
    const errado: Calibracao = { ...QUADRO, larguraUM: 1350 * MM };
    const problemas = conferirCalibracao(errado);
    console.log(`largura digitada 1350 em vez de 1380 -> ${problemas[0]?.codigo}`);
    console.log(`  "${problemas[0]?.mensagem}"`);
    expect(problemas.map((p) => p.codigo)).toContain('NAO_E_RETANGULO');
  });

  it('medida negativa ou zero é recusada antes de qualquer conta', () => {
    const problemas = conferirCalibracao({ ...QUADRO, alturaUM: 0 });
    expect(problemas.map((p) => p.codigo)).toContain('MEDIDA_INVALIDA');
    console.log(`altura 0 -> ${problemas[0]?.codigo}`);
  });
});
