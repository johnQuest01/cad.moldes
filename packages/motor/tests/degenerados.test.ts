/**
 * Entrada degenerada (Parte 5).
 *
 * Criterio: o motor RECUSA com erro claro. Nunca trava, nunca corrompe, nunca
 * gera um molde silenciosamente errado. Erro explicito e sucesso.
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor } from '../src/erros.js';
import { fold, reconstruir } from '../src/eventos/fold.js';
import type { Evento } from '../src/eventos/tipos.js';
import { anelDoContorno } from '../src/geometria/anel.js';
import { medirAresta } from '../src/geometria/medir.js';
import { offsetMargem } from '../src/offset.js';
import type { CodigoErro } from '../src/erros.js';
import type { Modelo, Peca } from '../src/tipos.js';
import { MM } from '../src/unidades.js';
import {
  AUTOR,
  MODELO_ID,
  PECA_ID,
  TENANT,
  logPoligonoLivre,
  logRetangulo,
  logRetanguloPadrao,
} from './fixtures.js';

function peca(modelo: Modelo): Peca {
  return modelo.pecas[PECA_ID]!;
}

/** Roda a acao e devolve o codigo do ErroMotor, ou null se nao estourou. */
function codigoDoErro(acao: () => unknown): CodigoErro | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

function eventoAvulso(tipo: Evento['tipo'], payload: unknown, pecaId: string | null = PECA_ID) {
  return {
    id: 'evt-degenerado',
    tenantId: TENANT,
    modeloId: MODELO_ID,
    pecaId,
    tipo,
    payload,
    timestamp: '2026-08-28T12:00:00.000Z',
    autor: AUTOR,
    versaoSchema: 1,
  } as Evento;
}

describe('Entrada degenerada — contorno', () => {
  it('recusa contorno com menos de 3 segmentos', () => {
    const log = logPoligonoLivre(
      [
        { x: 0, y: 0 },
        { x: 100 * MM, y: 0 },
      ],
      10 * MM,
    );
    const codigo = codigoDoErro(() => anelDoContorno(peca(reconstruir(log))));
    console.log(`contorno com 2 segmentos      -> ${codigo}`);
    expect(codigo).toBe('CONTORNO_DEGENERADO');
  });

  it('recusa contorno aberto', () => {
    // 4 pontos, mas o ultimo segmento nao volta ao primeiro ponto.
    const log = logPoligonoLivre(
      [
        { x: 0, y: 0 },
        { x: 100 * MM, y: 0 },
        { x: 100 * MM, y: 200 * MM },
        { x: 0, y: 200 * MM },
      ],
      10 * MM,
    );
    const modelo = reconstruir(log);
    const original = peca(modelo);
    // Reescreve o ultimo segmento para terminar num ponto novo, deixando o ciclo aberto.
    const comPontoExtra = fold(
      modelo,
      eventoAvulso('CriarPonto', { pontoId: 'pt-solto', x: 50 * MM, y: 300 * MM, tipo: 'contorno' }),
    );
    const aberto = fold(
      comPontoExtra,
      eventoAvulso('DefinirSegmento', {
        segmentoId: 'sg-3',
        arestaId: 'ar-3',
        de: 'pt-3',
        para: 'pt-solto',
        tipo: 'reta',
      }),
    );

    const codigo = codigoDoErro(() => anelDoContorno(peca(aberto)));
    console.log(`contorno aberto               -> ${codigo}`);
    expect(codigo).toBe('CONTORNO_ABERTO');
    // A peca original continua valida: o motor nao corrompeu nada.
    expect(anelDoContorno(original).length).toBe(4);
  });

  it('recusa segmento de comprimento zero (ponto duplicado na mesma coordenada)', () => {
    const log = logPoligonoLivre(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100 * MM, y: 0 },
        { x: 100 * MM, y: 200 * MM },
      ],
      10 * MM,
    );
    const codigo = codigoDoErro(() => anelDoContorno(peca(reconstruir(log))));
    console.log(`segmento de comprimento zero  -> ${codigo}`);
    expect(codigo).toBe('SEGMENTO_COMPRIMENTO_ZERO');
  });

  it('recusa contorno de area zero (pontos colineares)', () => {
    const log = logPoligonoLivre(
      [
        { x: 0, y: 0 },
        { x: 100 * MM, y: 0 },
        { x: 200 * MM, y: 0 },
        { x: 300 * MM, y: 0 },
      ],
      10 * MM,
    );
    const codigo = codigoDoErro(() => anelDoContorno(peca(reconstruir(log))));
    console.log(`contorno colinear (area zero) -> ${codigo}`);
    expect(codigo).toBe('AREA_ZERO');
  });

  it('recusa ponto duplicado (mesmo id criado duas vezes)', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log);
    const codigo = codigoDoErro(() =>
      fold(modelo, eventoAvulso('CriarPonto', { pontoId: 'pt-0', x: 0, y: 0, tipo: 'contorno' })),
    );
    console.log(`ponto com id repetido         -> ${codigo}`);
    expect(codigo).toBe('PONTO_DUPLICADO');
  });

  it('curva no contorno agora e TESSELADA, e o anel passa pelo interior da curva', () => {
    const modelo = reconstruir(logRetanguloPadrao());
    const comCurva = fold(
      modelo,
      eventoAvulso('DefinirSegmento', {
        segmentoId: 'sg-0',
        arestaId: 'ar-baixo',
        de: 'pt-0',
        para: 'pt-1',
        tipo: 'curva',
        controles: [
          { x: 30 * MM, y: 20 * MM },
          { x: 70 * MM, y: 20 * MM },
        ],
      }),
    );
    const anel = anelDoContorno(peca(comCurva));
    const retoNaBase = anel.filter((p) => p.y === 0);
    const alturaMaxima = Math.max(...anel.map((p) => p.y));
    console.log(
      `curva no contorno            -> ${anel.length} vertices | vertices em y=0: ${retoNaBase.length} | ` +
        `altura maxima do anel ${alturaMaxima} UM`,
    );
    // Se a curva fosse tratada como reta, o unico vertice fora de y=0 seria o topo.
    expect(anel.length).toBeGreaterThan(4);
    expect(alturaMaxima).toBe(200 * MM);
  });

  it('recusa aresta cujos segmentos nao formam um trecho continuo do contorno', () => {
    const modelo = reconstruir(logRetanguloPadrao());
    // ar-baixo passa a reivindicar tambem o segmento de cima: dois trechos soltos.
    const quebrada = fold(
      modelo,
      eventoAvulso('DefinirSegmento', {
        segmentoId: 'sg-2',
        arestaId: 'ar-baixo',
        de: 'pt-2',
        para: 'pt-3',
        tipo: 'reta',
      }),
    );
    const codigo = codigoDoErro(() => medirAresta(peca(quebrada), 'ar-baixo'));
    console.log(`aresta em dois trechos        -> ${codigo}`);
    expect(codigo).toBe('ARESTA_DESCONTINUA');
  });

  it('recusa aresta cujos extremos declarados nao batem com o contorno (D3)', () => {
    const modelo = reconstruir(logRetanguloPadrao());
    const mentirosa = fold(
      modelo,
      eventoAvulso('DefinirAresta', {
        arestaId: 'ar-baixo',
        pontoInicioId: 'pt-2',
        pontoFimId: 'pt-3',
      }),
    );
    const codigo = codigoDoErro(() => medirAresta(peca(mentirosa), 'ar-baixo'));
    console.log(`aresta com extremos errados   -> ${codigo}`);
    expect(codigo).toBe('ARESTA_EXTREMOS_DIVERGENTES');
  });
});

describe('Entrada degenerada — margem e offset', () => {
  it('recusa margem ausente em vez de assumir zero', () => {
    const log = logRetanguloPadrao();
    // Remove a margem de uma aresta, simulando peca importada sem margem definida.
    const modelo = reconstruir(log);
    const original = peca(modelo);
    const semUma: Peca = {
      ...original,
      margens: Object.fromEntries(
        Object.entries(original.margens).filter(([arestaId]) => arestaId !== 'ar-cima'),
      ),
    };
    const codigo = codigoDoErro(() => offsetMargem(semUma));
    console.log(`margem ausente numa aresta    -> ${codigo}`);
    expect(codigo).toBe('MARGEM_AUSENTE');
  });

  it('recusa margem negativa ja no evento', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log);
    const codigo = codigoDoErro(() =>
      fold(modelo, eventoAvulso('DefinirMargem', { arestaId: 'ar-baixo', margemUM: -5 * MM })),
    );
    console.log(`margem negativa               -> ${codigo}`);
    expect(codigo).toBe('MARGEM_NEGATIVA');
  });

  it('recusa offset de contorno em CW (delta positivo apontaria para dentro)', () => {
    const modelo = reconstruir(logRetanguloPadrao(true));
    const codigo = codigoDoErro(() => offsetMargem(peca(modelo)));
    console.log(`offset com contorno em CW     -> ${codigo}`);
    expect(codigo).toBe('OFFSET_NAO_CRESCEU');
  });

  it('margem maior que a propria peca cresce sem colapsar o contorno', () => {
    // Retangulo de 100x200 mm com margem de 150 mm em toda volta: a margem e
    // maior que a largura da peca. Nao e erro — o corte simplesmente fica enorme.
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [150, 150, 150, 150] }),
    );
    const corte = offsetMargem(peca(modelo));
    const xs = corte.pontos.map((p) => p.x);
    const ys = corte.pontos.map((p) => p.y);
    const largura = Math.max(...xs) - Math.min(...xs);
    const altura = Math.max(...ys) - Math.min(...ys);
    console.log(
      `margem 150 mm em peca de 100 mm -> corte ${largura / MM} x ${altura / MM} mm ` +
        `(${corte.pontos.length} vertices)`,
    );
    expect(largura).toBe(400 * MM);
    expect(altura).toBe(500 * MM);
  });

  it('margem zero e legitima: linha de corte coincide com a de costura', () => {
    const log = logPoligonoLivre(
      [
        { x: 0, y: 0 },
        { x: 100 * MM, y: 0 },
        { x: 100 * MM, y: 200 * MM },
        { x: 0, y: 200 * MM },
      ],
      0,
    );
    const corte = offsetMargem(peca(reconstruir(log)));
    console.log(
      `margem zero -> corte: ${corte.pontos.map((p) => `(${p.x},${p.y})`).join(' ')}`,
    );
    expect(corte.pontos).toEqual([
      { x: 0, y: 0 },
      { x: 100_000, y: 0 },
      { x: 100_000, y: 200_000 },
      { x: 0, y: 200_000 },
    ]);
  });

  it('coordenadas gigantes estouram na barreira de inteiro seguro', () => {
    const log = logRetanguloPadrao();
    const modelo = reconstruir(log.slice(0, 2));
    const codigo = codigoDoErro(() =>
      fold(modelo, eventoAvulso('CriarPonto', { pontoId: 'pt-g', x: 1e300, y: 0, tipo: 'contorno' })),
    );
    console.log(`coordenada gigante (1e300)    -> ${codigo}`);
    expect(codigo).toBe('UM_FORA_DA_FAIXA');
  });
});
