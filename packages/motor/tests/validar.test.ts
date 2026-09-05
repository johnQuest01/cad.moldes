/**
 * Bloco 10 — validacao de inconsistencias (Parte 2, operacao 8) e teste 13 da
 * Parte 5 (integridade do event sourcing).
 *
 * O validador RELATA. Cada teste aqui monta um defeito conhecido e confere que o
 * motor o encontra, com a gravidade certa — e que uma peca boa nao gera erro.
 */
import { describe, expect, it } from 'vitest';

import { fold, reconstruir } from '../src/eventos/fold.js';
import type { Evento } from '../src/eventos/tipos.js';
import { validarInconsistencias, validarModelo } from '../src/validar.js';
import type { Modelo, Peca, Pique, Problema } from '../src/tipos.js';
import { MM } from '../src/unidades.js';
import {
  AGORA,
  AUTOR,
  comGraduacao,
  logFrenteEManga,
  logPoligonoLivre,
  logRetangulo,
  MODELO_ID,
  PECA_ID,
  regraEmTodaAGrade,
  TENANT,
} from './fixtures.js';

const codigos = (problemas: readonly Problema[]) => problemas.map((p) => p.codigo).sort();

function mostrar(titulo: string, problemas: readonly Problema[]): void {
  console.log(`--- ${titulo} --- ${problemas.length} problema(s)`);
  for (const p of problemas) console.log(`  [${p.gravidade}] ${p.codigo}: ${p.mensagem}`);
}

function evento(indice: number, tipo: string, payload: unknown, pecaId: string | null = PECA_ID) {
  return {
    id: `evt-v-${indice}`,
    tenantId: TENANT,
    modeloId: MODELO_ID,
    pecaId,
    timestamp: AGORA,
    autor: AUTOR,
    versaoSchema: 1,
    tipo,
    payload,
  } as unknown as Evento;
}

/** Retangulo com fio, para servir de peca "boa". */
function retanguloCompleto(): Modelo {
  const base = logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] });
  return reconstruir([
    ...base,
    evento(0, 'CriarPonto', { pontoId: 'fio-a', x: 50 * MM, y: 20 * MM, tipo: 'interno' }),
    evento(1, 'CriarPonto', { pontoId: 'fio-b', x: 50 * MM, y: 180 * MM, tipo: 'interno' }),
    evento(2, 'AdicionarLinhaInterna', {
      linhaId: 'li-fio',
      tipo: 'fio',
      pontoIds: ['fio-a', 'fio-b'],
    }),
  ]);
}

describe('Operacao 8 — validar inconsistencias', () => {
  it('peca completa e sem defeito nao gera problema nenhum', () => {
    const modelo = retanguloCompleto();
    const problemas = validarInconsistencias(modelo, PECA_ID);
    mostrar('peca boa', problemas);
    expect(problemas).toEqual([]);
  });

  it('acusa fio ausente como AVISO, nao como erro', () => {
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
    );
    const problemas = validarInconsistencias(modelo, PECA_ID);
    mostrar('sem fio', problemas);
    expect(codigos(problemas)).toEqual(['FIO_AUSENTE']);
    expect(problemas[0]!.gravidade).toBe('aviso');
  });

  it('acusa margem ausente e margem negativa', () => {
    const modelo = retanguloCompleto();
    const peca = modelo.pecas[PECA_ID]!;
    const semMargem: Peca = {
      ...peca,
      margens: { 'ar-baixo': 10 * MM, 'ar-direita': -5 * MM, 'ar-cima': 10 * MM },
    };
    const problemas = validarInconsistencias(
      { ...modelo, pecas: { ...modelo.pecas, [PECA_ID]: semMargem } },
      PECA_ID,
    );
    mostrar('margens quebradas', problemas);
    expect(codigos(problemas)).toEqual(['MARGEM_AUSENTE', 'MARGEM_NEGATIVA']);
    expect(problemas.every((p) => p.gravidade === 'erro')).toBe(true);
  });

  it('acusa contorno que cruza a si mesmo (laco)', () => {
    // Gravata-borboleta ASSIMETRICA: os lados (0,0)-(100,20) e (100,0)-(0,100) se
    // cruzam em (83,3 ; 16,7). Assimetrica de proposito — na simetrica os dois
    // lacos tem area igual, o shoelace da ZERO e o AREA_ZERO dispara antes,
    // escondendo a auto-intersecao atras de outro defeito.
    const modelo = reconstruir(
      logPoligonoLivre(
        [
          { x: 0, y: 0 },
          { x: 100 * MM, y: 20 * MM },
          { x: 100 * MM, y: 0 },
          { x: 0, y: 100 * MM },
        ],
        10 * MM,
      ),
    );
    const problemas = validarInconsistencias(modelo, PECA_ID);
    mostrar('contorno em gravata-borboleta', problemas);
    expect(problemas.map((p) => p.codigo)).toContain('CONTORNO_AUTO_INTERSECTADO');
    expect(problemas.find((p) => p.codigo === 'CONTORNO_AUTO_INTERSECTADO')!.gravidade).toBe('erro');
  });

  it('acusa pique orfao e pique com s fora de [0, 1]', () => {
    const modelo = retanguloCompleto();
    const peca = modelo.pecas[PECA_ID]!;
    const orfao: Pique = {
      id: 'pq-orfao',
      tipo: 'V',
      alturaUM: 6350,
      larguraUM: 1590,
      anguloGraus: 0,
      arestaId: 'ar-que-nao-existe',
      s: 0.5,
    };
    const foraDaAresta: Pique = { ...orfao, id: 'pq-fora', arestaId: 'ar-baixo', s: 1.4 };
    const comPiques: Peca = { ...peca, piques: { 'pq-orfao': orfao, 'pq-fora': foraDaAresta } };

    const problemas = validarInconsistencias(
      { ...modelo, pecas: { ...modelo.pecas, [PECA_ID]: comPiques } },
      PECA_ID,
    );
    mostrar('piques quebrados', problemas);
    expect(codigos(problemas)).toEqual(['PIQUE_FORA_DA_ARESTA', 'PIQUE_ORFAO']);
  });

  it('acusa grade point sem regra e ponto interno parado numa peca que gradua (D10)', () => {
    const base = logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] });
    const comFio = [
      ...base,
      evento(0, 'CriarPonto', { pontoId: 'fio-a', x: 50 * MM, y: 20 * MM, tipo: 'interno' }),
      evento(1, 'CriarPonto', { pontoId: 'fio-b', x: 50 * MM, y: 180 * MM, tipo: 'interno' }),
      evento(2, 'AdicionarLinhaInterna', {
        linhaId: 'li-fio',
        tipo: 'fio',
        pontoIds: ['fio-a', 'fio-b'],
      }),
    ];
    const modelo = reconstruir(
      comGraduacao(
        comFio,
        [
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          // marcado e sem regra: e a ancora da D7, mas o validador avisa
          { gradePointId: 'gp-0', pontoId: 'pt-0' },
        ],
        regraEmTodaAGrade('r1', 'gp-1', 6, 0),
      ),
    );

    const problemas = validarInconsistencias(modelo, PECA_ID);
    mostrar('graduacao com pontas soltas', problemas);
    // 1 grade point sem regra + 2 pontos do fio sem grade point.
    expect(codigos(problemas)).toEqual([
      'GRADE_POINT_SEM_REGRA',
      'PONTO_INTERNO_SEM_REGRA',
      'PONTO_INTERNO_SEM_REGRA',
    ]);
    expect(problemas.every((p) => p.gravidade === 'aviso')).toBe(true);
  });

  it('nao avisa sobre ponto interno quando a peca nao gradua', () => {
    const modelo = retanguloCompleto();
    console.log(
      `peca com fio e sem nenhuma regra de graduacao -> ` +
        `${validarInconsistencias(modelo, PECA_ID).length} problema(s)`,
    );
    expect(validarInconsistencias(modelo, PECA_ID)).toEqual([]);
  });

  it('validarModelo junta as pecas e o casamento de costuras', () => {
    const saltoParado = [
      { dxMM: 0, dyMM: 0 },
      { dxMM: 0, dyMM: 0 },
    ] as const;
    const modelo = reconstruir(
      logFrenteEManga({
        raioMM: 150,
        raioMangaMM: 150 + 25 / (Math.PI / 2),
        frente: saltoParado,
        manga: saltoParado,
        embebidoMM: 0, // declara "fecha exata", mas a copa e 25 mm maior
      }),
    );
    const problemas = validarModelo(modelo);
    mostrar('modelo inteiro (2 pecas)', problemas.slice(0, 5));
    console.log(`  ... total ${problemas.length} problema(s)`);

    // Fio ausente nas duas pecas + 3 divergencias de casamento (uma por tamanho).
    expect(problemas.filter((p) => p.codigo === 'FIO_AUSENTE')).toHaveLength(2);
    expect(problemas.filter((p) => p.codigo === 'CASAMENTO_DIVERGENTE')).toHaveLength(3);
  });

  it('contorno quebrado vira problema em vez de estourar', () => {
    // Um validador que para no primeiro defeito e inutil: o modelista quer a lista.
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
    );
    const peca = modelo.pecas[PECA_ID]!;
    const aberta: Peca = { ...peca, contorno: peca.contorno.slice(0, 3) };
    const problemas = validarInconsistencias(
      { ...modelo, pecas: { ...modelo.pecas, [PECA_ID]: aberta } },
      PECA_ID,
    );
    mostrar('contorno aberto', problemas.slice(0, 2));
    expect(problemas.map((p) => p.codigo)).toContain('CONTORNO_ABERTO');
    // E nao estourou: devolveu lista.
    expect(Array.isArray(problemas)).toBe(true);
  });
});

describe('Teste 13 — integridade do event sourcing', () => {
  /**
   * Log rico: duas pecas, curva, graduacao, edicao de ponto, insercao, fillet,
   * conversao de segmento, fio, eixo de dobra e par de costura. Se algum desses
   * caminhos gerasse entropia propria (D2), o replay divergiria do snapshot.
   */
  function logCompleto(): Evento[] {
    const base = logFrenteEManga({
      raioMM: 150,
      frente: [
        { dxMM: 8, dyMM: 0 },
        { dxMM: 0, dyMM: 5 },
      ],
      manga: [
        { dxMM: 8, dyMM: 0 },
        { dxMM: 0, dyMM: 5 },
      ],
      embebidoMM: 0,
    });
    const extra = (i: number, tipo: string, payload: unknown, pecaId: string | null) => ({
      id: `evt-x-${i}`,
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId,
      timestamp: AGORA,
      autor: AUTOR,
      versaoSchema: 1,
      tipo,
      payload,
    });
    return [
      ...base,
      extra(0, 'CriarPonto', { pontoId: 'fio-a', x: 30 * MM, y: 20 * MM, tipo: 'interno' }, 'pec-frente'),
      extra(1, 'CriarPonto', { pontoId: 'fio-b', x: 30 * MM, y: 90 * MM, tipo: 'interno' }, 'pec-frente'),
      extra(2, 'AdicionarLinhaInterna', { linhaId: 'li-fio', tipo: 'fio', pontoIds: ['fio-a', 'fio-b'] }, 'pec-frente'),
      extra(3, 'InserirPonto', { segmentoId: 'sg-f-1', s: 0.4, prefixoId: 'ins' }, 'pec-frente'),
      extra(4, 'ModificarPonto', { pontoId: 'ins-p', dx: 3 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 }, 'pec-frente'),
      extra(5, 'ConverterSegmento', { segmentoId: 'sg-m-1', para: 'curva' }, 'pec-manga'),
      extra(6, 'DefinirEixoDobra', { eixoId: 'dobra', p1: { x: 0, y: 0 }, p2: { x: 0, y: 150 * MM }, direcao: 'dentro' }, 'pec-frente'),
      extra(7, 'TransladarPeca', { dx: 5 * MM, dy: 7 * MM }, 'pec-manga'),
    ] as unknown as Evento[];
  }

  it('reconstruir do log bate 100% com o snapshot JSONB, IDs inclusive', () => {
    const log = logCompleto();
    const modelo = reconstruir(log);

    // O snapshot e o que iria para a coluna JSONB do Neon.
    const snapshot = JSON.stringify(modelo);
    const reconstruido = JSON.stringify(reconstruir(log));
    const voltandoDoJSONB = JSON.stringify(JSON.parse(snapshot));

    console.log('--- TESTE 13 (integridade) ---');
    console.log(`eventos no log: ${log.length} | pecas: ${Object.keys(modelo.pecas).length}`);
    console.log(`snapshot: ${snapshot.length} caracteres`);
    console.log(`replay == snapshot: ${reconstruido === snapshot}`);
    console.log(`round-trip JSONB == snapshot: ${voltandoDoJSONB === snapshot}`);

    expect(reconstruido).toBe(snapshot);
    expect(voltandoDoJSONB).toBe(snapshot);
  });

  it('aplicar o log evento a evento da o mesmo estado de reconstruir o log inteiro', () => {
    const log = logCompleto();
    let passoAPasso: Modelo | null = null;
    for (const evento of log) passoAPasso = fold(passoAPasso, evento);

    console.log(
      `fold incremental (${log.length} eventos) == reconstruir(log): ` +
        `${JSON.stringify(passoAPasso) === JSON.stringify(reconstruir(log))}`,
    );
    expect(passoAPasso).toEqual(reconstruir(log));
  });

  it('os IDs derivados de prefixo saem iguais em todo replay (D2)', () => {
    const log = logCompleto();
    const primeiro = reconstruir(log).pecas['pec-frente']!;
    const segundo = reconstruir(log).pecas['pec-frente']!;

    console.log(
      `ids de ponto da FRENTE: ${Object.keys(primeiro.pontos).sort().join(', ')}`,
    );
    expect(Object.keys(segundo.pontos).sort()).toEqual(Object.keys(primeiro.pontos).sort());
    // O ponto inserido tem id derivado do prefixo, nao sorteado.
    expect(primeiro.pontos['ins-p']).toBeDefined();
    expect(primeiro.pontos['ins-p']).toEqual(segundo.pontos['ins-p']);
  });
});
