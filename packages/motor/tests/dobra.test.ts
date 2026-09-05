/**
 * Operacao 5 (espelhar / rotacionar / transladar) e Bloco 8 (dobra simples).
 *
 * Testes 9 e 10 da Parte 5:
 *   9  — meia peca com eixo de dobra numa aresta -> a desdobrada tem EXATAMENTE o
 *        dobro da largura, e o consumo/area usa a desdobrada
 *  10  — espelhar por um eixo a 30 graus -> conferir contra o calculo analitico
 *
 * Mais a propriedade "espelhar duas vezes = identidade" (mesmo eixo arbitrario).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ErroMotor } from '../src/erros.js';
import type { CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import { area, areaComSinal, ehCCW } from '../src/geometria/anel.js';
import { anelDoContorno } from '../src/geometria/anel.js';
import { areaDesdobrada, contornoDesdobrado, linhaDeCorteDesdobrada } from '../src/dobra.js';
import { espelharPeca, rotacionarPeca, transladarPeca } from '../src/transformar.js';
import type { Modelo, Peca, Vetor2 } from '../src/tipos.js';
import { MM, umParaCM, umParaMM } from '../src/unidades.js';
import { logRetangulo, PECA_ID } from './fixtures.js';

function codigoDoErro(acao: () => unknown): CodigoErro | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

function caixa(pontos: readonly Vetor2[]) {
  const xs = pontos.map((p) => p.x);
  const ys = pontos.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    largura: Math.max(...xs) - Math.min(...xs),
    altura: Math.max(...ys) - Math.min(...ys),
  };
}

/** Reflexao analitica de um ponto num eixo pela origem com angulo `graus`. */
function refletirAnalitico(p: Vetor2, graus: number): { x: number; y: number } {
  const dobro = (2 * graus * Math.PI) / 180;
  return {
    x: p.x * Math.cos(dobro) + p.y * Math.sin(dobro),
    y: p.x * Math.sin(dobro) - p.y * Math.cos(dobro),
  };
}

/**
 * Meia frente: retangulo 60 x 200 mm com o eixo de dobra na aresta esquerda
 * (x = 0). Desdobrada tem que dar 120 x 200 mm.
 */
function meiaFrente(): Modelo {
  const base = logRetangulo({ larguraMM: 60, alturaMM: 200, margensMM: [10, 10, 10, 0] });
  return reconstruir([
    ...base,
    {
      id: 'evt-eixo',
      tenantId: 'tenant-confeccao-01',
      modeloId: 'mod-0001',
      pecaId: PECA_ID,
      timestamp: '2026-09-04T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
      tipo: 'DefinirEixoDobra',
      payload: {
        eixoId: 'dobra',
        p1: { x: 0, y: 0 },
        p2: { x: 0, y: 200 * MM },
        direcao: 'dentro',
      },
    },
  ]);
}

describe('Teste 9 — dobra simples: a peca desenhada e a METADE', () => {
  it('a desdobrada tem exatamente o dobro da largura e o dobro da area', () => {
    const modelo = meiaFrente();
    const peca = modelo.pecas[PECA_ID]!;
    const metade = anelDoContorno(peca);
    const desdobrada = contornoDesdobrado(peca, 'dobra').pontos;

    const caixaMetade = caixa(metade);
    const caixaTotal = caixa(desdobrada);

    console.log('--- TESTE 9 (dobra simples, eixo em x = 0) ---');
    console.log(
      `metade   : ${umParaMM(caixaMetade.largura)} x ${umParaMM(caixaMetade.altura)} mm | ` +
        `area ${umParaCM(area(metade) / 10000).toFixed(2)} cm2`,
    );
    console.log(
      `desdobrada: ${umParaMM(caixaTotal.largura)} x ${umParaMM(caixaTotal.altura)} mm | ` +
        `area ${umParaCM(area(desdobrada) / 10000).toFixed(2)} cm2`,
    );
    console.log(
      `desdobrada: ${desdobrada.map((p) => `(${umParaMM(p.x)},${umParaMM(p.y)})`).join(' ')}`,
    );

    expect(caixaTotal.largura).toBe(2 * caixaMetade.largura);
    expect(caixaTotal.largura).toBe(120 * MM);
    expect(caixaTotal.altura).toBe(200 * MM);
    expect(caixaTotal.minX).toBe(-60 * MM);
    expect(caixaTotal.maxX).toBe(60 * MM);
    // O consumo usa a area desdobrada: exatamente o dobro.
    expect(area(desdobrada)).toBe(2 * area(metade));
    expect(areaDesdobrada(peca, 'dobra')).toBe(2 * area(metade));
    // E continua um retangulo: 4 vertices, sem o vinco no meio.
    expect(desdobrada.length).toBe(4);
  });

  it('a linha de corte desdobrada respeita a margem zero na aresta da dobra', () => {
    // ar-esquerda (a que cai na dobra) tem margem 0; as outras 10 mm.
    const modelo = meiaFrente();
    const peca = modelo.pecas[PECA_ID]!;
    const corte = linhaDeCorteDesdobrada(peca, 'dobra').pontos;
    const caixaCorte = caixa(corte);

    console.log(
      `corte desdobrado: ${umParaMM(caixaCorte.largura)} x ${umParaMM(caixaCorte.altura)} mm | ` +
        `x de ${umParaMM(caixaCorte.minX)} a ${umParaMM(caixaCorte.maxX)}`,
    );
    console.log('  esperado 140 x 220 mm — 60+10 de cada lado, e nada a mais na dobra');
    expect(caixaCorte.largura).toBe(140 * MM);
    expect(caixaCorte.altura).toBe(220 * MM);
  });

  it('recusa eixo que atravessa a peca e eixo que nao existe', () => {
    const modelo = meiaFrente();
    const peca = modelo.pecas[PECA_ID]!;
    const atravessa: Peca = {
      ...peca,
      eixosDobra: {
        meio: {
          id: 'meio',
          p1: { x: 30 * MM, y: 0 },
          p2: { x: 30 * MM, y: 200 * MM },
          direcao: 'dentro',
        },
      },
    };
    const a = codigoDoErro(() => contornoDesdobrado(atravessa, 'meio'));
    const b = codigoDoErro(() => contornoDesdobrado(peca, 'nao-existe'));
    console.log(`eixo no meio da peca -> ${a}`);
    console.log(`eixo inexistente     -> ${b}`);
    expect(a).toBe('EIXO_DOBRA_ATRAVESSA_A_PECA');
    expect(b).toBe('EIXO_DOBRA_INEXISTENTE');
  });
});

describe('Teste 10 — espelhar em eixo inclinado', () => {
  it('eixo a 30 graus pela origem bate com o calculo analitico da reflexao', () => {
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
    );
    const peca = modelo.pecas[PECA_ID]!;
    // Eixo a 30 graus pela origem. p2 longe para a direcao ser precisa.
    const eixo = {
      p1: { x: 0, y: 0 },
      p2: {
        x: Math.round(1_000_000 * Math.cos(Math.PI / 6)),
        y: Math.round(1_000_000 * Math.sin(Math.PI / 6)),
      },
    };
    const espelhada = espelharPeca(peca, eixo);

    console.log('--- TESTE 10 (espelhar em eixo a 30 graus pela origem) ---');
    let piorErro = 0;
    for (const id of ['pt-0', 'pt-1', 'pt-2', 'pt-3']) {
      const antes = peca.pontos[id]!;
      const depois = espelhada.pontos[id]!;
      const esperado = refletirAnalitico(antes, 30);
      const erro = Math.hypot(depois.x - esperado.x, depois.y - esperado.y);
      piorErro = Math.max(piorErro, erro);
      console.log(
        `${id}: (${antes.x}, ${antes.y}) -> (${depois.x}, ${depois.y}) | ` +
          `analitico (${esperado.x.toFixed(2)}, ${esperado.y.toFixed(2)}) | erro ${erro.toFixed(3)} UM`,
      );
    }
    console.log(`pior erro contra o analitico: ${piorErro.toFixed(3)} UM (so arredondamento)`);
    // 0,71 UM e o maximo do arredondamento de um ponto para inteiro.
    expect(piorErro).toBeLessThanOrEqual(1);

    // A reflexao inverte o winding; o motor renormaliza para CCW (D4).
    console.log(
      `winding depois de espelhar: area com sinal ${areaComSinal(anelDoContorno(espelhada))} UM2 ` +
        `(CCW: ${ehCCW(anelDoContorno(espelhada))})`,
    );
    expect(ehCCW(anelDoContorno(espelhada))).toBe(true);
    // Isometria: a area nao muda. O residuo e o arredondamento de cada vertice
    // para inteiro (ate 0,71 UM), que num perimetro de 600 mm da uma perturbacao
    // de area da ordem de 0,7 x perimetro — comparar em valor RELATIVO.
    const areaAntes = area(anelDoContorno(peca));
    const areaDepois = area(anelDoContorno(espelhada));
    const relativo = Math.abs(areaDepois - areaAntes) / areaAntes;
    console.log(
      `area ${areaAntes} -> ${areaDepois} UM2 | diferenca relativa ${(relativo * 100).toFixed(5)}%`,
    );
    expect(relativo).toBeLessThan(1e-4);
  });

  it('transladar por inteiro e exato, e rotacionar 90 graus quatro vezes volta ao lugar', () => {
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
    );
    const peca = modelo.pecas[PECA_ID]!;

    const movida = transladarPeca(peca, 37 * MM, -12 * MM);
    console.log(
      `transladar (37, -12) mm: pt-2 (${peca.pontos['pt-2']!.x}, ${peca.pontos['pt-2']!.y}) -> ` +
        `(${movida.pontos['pt-2']!.x}, ${movida.pontos['pt-2']!.y})`,
    );
    expect(movida.pontos['pt-2']).toMatchObject({ x: 137 * MM, y: 188 * MM });

    const centro = { x: 50 * MM, y: 100 * MM };
    let girada = peca;
    for (let i = 0; i < 4; i++) girada = rotacionarPeca(girada, centro, 90);
    let piorErro = 0;
    for (const id of Object.keys(peca.pontos)) {
      piorErro = Math.max(
        piorErro,
        Math.hypot(girada.pontos[id]!.x - peca.pontos[id]!.x, girada.pontos[id]!.y - peca.pontos[id]!.y),
      );
    }
    console.log(`4 x rotacionar 90 graus: pior desvio contra o original ${piorErro} UM`);
    expect(piorErro).toBe(0);
  });

  it('propriedade: espelhar duas vezes no mesmo eixo volta ao original', () => {
    // Reflexao leva inteiro para nao-inteiro, entao a volta nao e exata: o limite
    // e o arredondamento de duas passadas, nao acumulo — reflexao e isometria.
    let piorDesvio = 0;
    let amostras = 0;

    fc.assert(
      fc.property(
        fc.record({
          x1: fc.integer({ min: -200000, max: 200000 }),
          y1: fc.integer({ min: -200000, max: 200000 }),
          angulo: fc.integer({ min: 0, max: 179 }),
        }),
        ({ x1, y1, angulo }) => {
          const modelo = reconstruir(
            logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
          );
          const peca = modelo.pecas[PECA_ID]!;
          const radianos = (angulo * Math.PI) / 180;
          const eixo = {
            p1: { x: x1, y: y1 },
            p2: {
              x: x1 + Math.round(1_000_000 * Math.cos(radianos)),
              y: y1 + Math.round(1_000_000 * Math.sin(radianos)),
            },
          };

          const voltou = espelharPeca(espelharPeca(peca, eixo), eixo);
          for (const id of Object.keys(peca.pontos)) {
            const desvio = Math.hypot(
              voltou.pontos[id]!.x - peca.pontos[id]!.x,
              voltou.pontos[id]!.y - peca.pontos[id]!.y,
            );
            amostras++;
            piorDesvio = Math.max(piorDesvio, desvio);
            expect(desvio).toBeLessThanOrEqual(2);
          }
          // E o contorno volta a percorrer os mesmos segmentos, na mesma ordem.
          expect(voltou.contorno).toEqual(peca.contorno);
        },
      ),
      { numRuns: 200 },
    );

    console.log(
      `--- PROPRIEDADE: espelhar 2x = identidade --- ${amostras} pontos | ` +
        `pior desvio ${piorDesvio.toFixed(3)} UM (limite 2 UM = 2 arredondamentos)`,
    );
  });
});
