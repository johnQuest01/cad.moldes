/**
 * Fold puro e determinismo (Parte 4, D2 / teste de propriedade "fold deterministico").
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ErroMotor } from '../src/erros.js';
import { fold, reconstruir } from '../src/eventos/fold.js';
import type { Evento } from '../src/eventos/tipos.js';
import { MM } from '../src/unidades.js';
import { logRetanguloPadrao, MODELO_ID, PECA_ID, TENANT } from './fixtures.js';

describe('Fold — funcao pura (D2)', () => {
  it('aplicar o mesmo log duas vezes produz estado byte-identico', () => {
    const log = logRetanguloPadrao();
    const a = JSON.stringify(reconstruir(log));
    const b = JSON.stringify(reconstruir(log));

    console.log('--- FOLD DETERMINISTICO ---');
    console.log(`eventos no log     : ${log.length}`);
    console.log(`bytes do estado    : ${a.length}`);
    console.log(`estados identicos  : ${a === b}`);

    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('nao muta o estado de entrada', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log.slice(0, 3));
    const antes = JSON.stringify(modelo);
    const depois = fold(modelo, log[3]!);
    const antesAindaIgual = JSON.stringify(modelo);

    console.log('--- IMUTABILIDADE ---');
    console.log(`entrada intacta apos o fold: ${antes === antesAindaIgual}`);
    console.log(`saida e objeto novo        : ${depois !== modelo}`);

    expect(antesAindaIgual).toBe(antes);
    expect(depois).not.toBe(modelo);
  });

  it('reconstroi os mesmos IDs — o fold nao gera entropia propria', () => {
    const log = logRetanguloPadrao();
    const peca = reconstruir(log).pecas[PECA_ID]!;

    const pontos = Object.keys(peca.pontos).sort();
    const arestas = Object.keys(peca.arestas).sort();
    const segmentos = Object.keys(peca.segmentos).sort();

    console.log('--- IDS DETERMINISTICOS ---');
    console.log(`pontos   : ${pontos.join(', ')}`);
    console.log(`arestas  : ${arestas.join(', ')}`);
    console.log(`segmentos: ${segmentos.join(', ')}`);
    console.log(`contorno : ${peca.contorno.join(' -> ')}`);

    expect(pontos).toEqual(['pt-0', 'pt-1', 'pt-2', 'pt-3']);
    expect(arestas).toEqual(['ar-baixo', 'ar-cima', 'ar-direita', 'ar-esquerda']);
    expect(segmentos).toEqual(['sg-0', 'sg-1', 'sg-2', 'sg-3']);
    expect(peca.contorno).toEqual(['sg-0', 'sg-1', 'sg-2', 'sg-3']);
  });

  it('a ordem de aplicacao de um mesmo log e a unica coisa que decide o estado', () => {
    // Propriedade: prefixos do log sempre reconstroem igual, para qualquer corte.
    const log = logRetanguloPadrao();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: log.length }), (corte) => {
        const prefixo = log.slice(0, corte);
        return JSON.stringify(reconstruir(prefixo)) === JSON.stringify(reconstruir(prefixo));
      }),
      { numRuns: 200 },
    );
    console.log('--- PROPRIEDADE: fold deterministico em 200 prefixos --- ok');
  });
});

describe('Fold — isolamento multi-empresa (decisao inegociavel 6)', () => {
  it('recusa evento de outro tenant', () => {
    const log = logRetanguloPadrao();
    const intruso: Evento = { ...log[2]!, tenantId: 'tenant-concorrente' };
    const modelo = reconstruir(log.slice(0, 2));

    let capturado: ErroMotor | null = null;
    try {
      fold(modelo, intruso);
    } catch (erro) {
      capturado = erro as ErroMotor;
    }

    console.log('--- TENANT ---');
    console.log(`erro: ${capturado?.message ?? '(nenhum)'}`);

    expect(capturado).toBeInstanceOf(ErroMotor);
    expect(capturado?.codigo).toBe('TENANT_DIVERGENTE');
  });

  it('recusa evento sem tenantId', () => {
    const log = logRetanguloPadrao();
    const semTenant = { ...log[0]!, tenantId: '' } as Evento;
    expect(() => fold(null, semTenant)).toThrowError(/EVENTO_SEM_TENANT/);
  });
});

describe('Fold — validacoes de referencia', () => {
  it('recusa versao de schema desconhecida', () => {
    const log = logRetanguloPadrao();
    const futuro = { ...log[0]!, versaoSchema: 99 } as Evento;
    expect(() => fold(null, futuro)).toThrowError(/EVENTO_VERSAO_DESCONHECIDA/);
  });

  it('recusa evento antes de CriarModelo', () => {
    const log = logRetanguloPadrao();
    expect(() => fold(null, log[1]!)).toThrowError(/PECA_INEXISTENTE/);
  });

  it('recusa segmento apontando para aresta inexistente', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log.slice(0, 10));
    const evento: Evento = {
      id: 'evt-x',
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: PECA_ID,
      tipo: 'DefinirSegmento',
      payload: { segmentoId: 'sg-x', arestaId: 'ar-fantasma', de: 'pt-0', para: 'pt-1', tipo: 'reta' },
      timestamp: '2026-08-28T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
    };
    expect(() => fold(modelo, evento)).toThrowError(/ARESTA_INEXISTENTE/);
  });

  it('recusa curva sem os 2 pontos de controle (D1: Bezier cubico)', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log.slice(0, 10));
    const evento: Evento = {
      id: 'evt-x',
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: PECA_ID,
      tipo: 'DefinirSegmento',
      payload: { segmentoId: 'sg-x', arestaId: 'ar-baixo', de: 'pt-0', para: 'pt-1', tipo: 'curva' },
      timestamp: '2026-08-28T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
    };
    expect(() => fold(modelo, evento)).toThrowError(/CURVA_SEM_CONTROLES/);
  });

  it('recusa coordenada que nao e micrometro inteiro (float de mm vazando pro nucleo)', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log.slice(0, 2));
    const evento: Evento = {
      id: 'evt-x',
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: PECA_ID,
      tipo: 'CriarPonto',
      // 10,5 mm digitado como float em vez de 10500 UM.
      payload: { pontoId: 'pt-float', x: 10.5, y: 0, tipo: 'contorno' },
      timestamp: '2026-08-28T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
    };

    let capturado: ErroMotor | null = null;
    try {
      fold(modelo, evento);
    } catch (erro) {
      capturado = erro as ErroMotor;
    }
    console.log('--- UM INTEIRO ---');
    console.log(`erro: ${capturado?.message ?? '(nenhum)'}`);
    expect(capturado?.codigo).toBe('UM_NAO_INTEIRO');
  });

  it('ParCostura vive no modelo e exige que as duas arestas existam (D3)', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log);
    const par: Evento = {
      id: 'evt-par',
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: null,
      tipo: 'DefinirParCostura',
      payload: { parId: 'par-1', arestaA: 'ar-baixo', arestaB: 'ar-cima', embebidoUM: 25 * MM },
      timestamp: '2026-08-28T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
    };
    const comPar = fold(modelo, par);

    console.log('--- PAR DE COSTURA ---');
    console.log(`par-1: ${JSON.stringify(comPar.paresCostura['par-1'])}`);

    expect(comPar.paresCostura['par-1']).toEqual({
      id: 'par-1',
      modeloId: MODELO_ID,
      arestaA: 'ar-baixo',
      arestaB: 'ar-cima',
      // D9: o embebido viaja no evento e e obrigatorio; nao ha default.
      embebidoUM: 25 * MM,
    });

    const fantasma: Evento = {
      ...par,
      id: 'evt-par-2',
      payload: { parId: 'par-2', arestaA: 'ar-baixo', arestaB: 'ar-nao-existe', embebidoUM: 0 },
    };
    expect(() => fold(comPar, fantasma)).toThrowError(/ARESTA_INEXISTENTE/);
  });

  it('MoverPonto altera so o ponto alvo', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log);
    const mover: Evento = {
      id: 'evt-mover',
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: PECA_ID,
      tipo: 'MoverPonto',
      payload: { pontoId: 'pt-1', x: 150 * MM, y: 0 },
      timestamp: '2026-08-28T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
    };
    const depois = fold(modelo, mover).pecas[PECA_ID]!;
    const antes = modelo.pecas[PECA_ID]!;

    console.log('--- MOVER PONTO ---');
    console.log(`pt-1 antes : (${antes.pontos['pt-1']!.x}, ${antes.pontos['pt-1']!.y})`);
    console.log(`pt-1 depois: (${depois.pontos['pt-1']!.x}, ${depois.pontos['pt-1']!.y})`);
    console.log(`pt-2 antes : (${antes.pontos['pt-2']!.x}, ${antes.pontos['pt-2']!.y})`);
    console.log(`pt-2 depois: (${depois.pontos['pt-2']!.x}, ${depois.pontos['pt-2']!.y})`);

    expect(depois.pontos['pt-1']).toEqual({ id: 'pt-1', x: 150_000, y: 0, tipo: 'contorno' });
    expect(depois.pontos['pt-2']).toEqual(antes.pontos['pt-2']);
    expect(depois.pontos['pt-0']).toEqual(antes.pontos['pt-0']);
    expect(depois.pontos['pt-3']).toEqual(antes.pontos['pt-3']);
  });
});
