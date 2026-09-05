/**
 * Unidades: micrometro inteiro (decisao inegociavel 1).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ErroMotor } from '../src/erros.js';
import { CM, MM, cmParaUM, exigirUM, mmParaUM, umParaCM, umParaMM } from '../src/unidades.js';

describe('Conversao de borda mm/cm <-> UM', () => {
  it('converte os valores de uso real sem perder precisao', () => {
    const casos: readonly [number, number][] = [
      [1, 1_000],
      [10, 10_000],
      [0.1, 100],
      [100, 100_000],
      [200, 200_000],
      [0.001, 1],
      [12.5, 12_500],
    ];
    console.log('--- mmParaUM ---');
    for (const [mm, esperado] of casos) {
      const obtido = mmParaUM(mm);
      console.log(`${mm} mm -> ${obtido} UM (esperado ${esperado})`);
      expect(obtido).toBe(esperado);
    }

    console.log('--- cmParaUM ---');
    console.log(`1 cm -> ${cmParaUM(1)} UM (esperado 10000)`);
    expect(cmParaUM(1)).toBe(CM);
    expect(cmParaUM(2.5)).toBe(25_000);

    console.log(`10000 UM -> ${umParaMM(10_000)} mm | ${umParaCM(10_000)} cm`);
    expect(umParaMM(10_000)).toBe(10);
    expect(umParaCM(10_000)).toBe(1);
  });

  it('1 mm = 1000 UM e 1 cm = 10000 UM', () => {
    expect(MM).toBe(1000);
    expect(CM).toBe(10_000);
  });

  it('ida e volta em mm inteiro e exata para qualquer valor razoavel', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5_000, max: 5_000 }), (mm) => umParaMM(mmParaUM(mm)) === mm),
      { numRuns: 500 },
    );
    console.log('--- PROPRIEDADE: umParaMM(mmParaUM(x)) === x em 500 casos --- ok');
  });
});

describe('exigirUM — barreira contra float de milimetro no nucleo', () => {
  it('aceita micrometro inteiro', () => {
    expect(exigirUM(0, 'x')).toBe(0);
    expect(exigirUM(-10_000, 'x')).toBe(-10_000);
    expect(exigirUM(123_456, 'x')).toBe(123_456);
  });

  it('recusa float, NaN e Infinity com erro claro', () => {
    const casos: readonly [number, string][] = [
      [10.5, 'UM_NAO_INTEIRO'],
      [0.1, 'UM_NAO_INTEIRO'],
      [Number.NaN, 'VALOR_NAO_FINITO'],
      [Number.POSITIVE_INFINITY, 'VALOR_NAO_FINITO'],
      [1e300, 'UM_FORA_DA_FAIXA'],
    ];
    console.log('--- exigirUM recusa ---');
    for (const [valor, codigo] of casos) {
      let capturado: ErroMotor | null = null;
      try {
        exigirUM(valor, 'coordenada x');
      } catch (erro) {
        capturado = erro as ErroMotor;
      }
      console.log(`${valor} -> ${capturado?.codigo ?? '(passou!)'}`);
      expect(capturado?.codigo).toBe(codigo);
    }
  });

  it('mmParaUM recusa entrada nao finita em vez de devolver NaN', () => {
    expect(() => mmParaUM(Number.NaN)).toThrowError(/VALOR_NAO_FINITO/);
    expect(() => cmParaUM(Number.POSITIVE_INFINITY)).toThrowError(/VALOR_NAO_FINITO/);
  });
});
