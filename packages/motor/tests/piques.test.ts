/**
 * Colocar, arrastar e tirar pique — o gesto do modelista, agora pelo log.
 *
 * O motor ja sabia projetar o pique da costura para o corte, e ja criava piques
 * por dentro (abrir prega, dividir peca). Faltava o caminho de fora para dentro:
 * cursor -> `(aresta, s)` -> evento -> peca. Estes testes cobrem esse caminho e,
 * principalmente, a propriedade que justifica guardar `s` em vez de coordenada:
 * o pique tem que ACOMPANHAR a peca quando ela gradua, espelha ou e editada.
 *
 * As dimensoes usadas sao as do notcher padrao de modelagem — 1/4" x 1/16",
 * levantadas na Parte 7 (caso 4) —, nao numeros redondos inventados.
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor, type CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import type { Evento } from '../src/eventos/tipos.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import { espelharPeca } from '../src/transformar.js';
import { pontoEmS } from '../src/geometria/medir.js';
import { projetarPique } from '../src/pique.js';
import {
  ALTURA_PADRAO_DO_PIQUE_UM,
  LARGURA_PADRAO_DO_PIQUE_UM,
  adicionarPique,
  localizarNoContorno,
  moverPique,
  removerPique,
} from '../src/piques.js';
import { validarInconsistencias } from '../src/validar.js';
import type { Modelo, Peca, Problema, Vetor2 } from '../src/tipos.js';
import { MM, umParaMM } from '../src/unidades.js';
import {
  AGORA,
  AUTOR,
  MODELO_ID,
  PECA_ID,
  TENANT,
  comGraduacao,
  logRetangulo,
  regraEmTodaAGrade,
} from './fixtures.js';

function codigoDoErro(acao: () => unknown): CodigoErro | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

/** Retangulo 100 x 200 mm, margem 10 mm em todos os lados. */
function retangulo(): Modelo {
  return reconstruir(
    logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
  );
}

const peca = (modelo: Modelo): Peca => modelo.pecas[PECA_ID]!;

function eventoPique(indice: number, tipo: 'AdicionarPique', payload: unknown): Evento;
function eventoPique(indice: number, tipo: 'MoverPique', payload: unknown): Evento;
function eventoPique(indice: number, tipo: 'RemoverPique', payload: unknown): Evento;
function eventoPique(indice: number, tipo: string, payload: unknown): Evento {
  return {
    id: `evt-pq-${String(indice).padStart(3, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO_ID,
    pecaId: PECA_ID,
    timestamp: AGORA,
    autor: AUTOR,
    versaoSchema: 1,
    tipo,
    payload,
  } as Evento;
}

function adicionarPeloLog(indice: number, piqueId: string, arestaId: string, s: number): Evento {
  return eventoPique(indice, 'AdicionarPique', {
    piqueId,
    arestaId,
    s,
    tipo: 'V',
    alturaUM: ALTURA_PADRAO_DO_PIQUE_UM,
    larguraUM: LARGURA_PADRAO_DO_PIQUE_UM,
    anguloGraus: 0,
  });
}

describe('Do cursor para a aresta — localizarNoContorno', () => {
  it('um clique perto da lateral direita cai na aresta certa, com s medido por arco', () => {
    const p = peca(retangulo());
    // A lateral direita vai de (100, 0) a (100, 200). Um clique 3 mm fora dela,
    // na altura de 150 mm, tem que dar s = 0.75.
    const alvo: Vetor2 = { x: 103 * MM, y: 150 * MM };
    const lugar = localizarNoContorno(p, alvo);

    console.log('--- localizar ---');
    console.log(`clique em (103, 150) mm -> aresta "${lugar.arestaId}", s = ${lugar.s.toFixed(6)}`);
    console.log(
      `  pe da perpendicular (${umParaMM(lugar.ponto.x)}, ${umParaMM(lugar.ponto.y)}) mm | ` +
        `distancia ${umParaMM(lugar.distanciaUM)} mm`,
    );

    expect(lugar.arestaId).toBe('ar-direita');
    expect(lugar.s).toBeCloseTo(0.75, 9);
    expect(lugar.ponto).toEqual({ x: 100 * MM, y: 150 * MM });
    expect(lugar.distanciaUM).toBe(3 * MM);
  });

  it('o s devolvido, passado a pontoEmS, volta ao mesmo ponto', () => {
    const p = peca(retangulo());
    const cliques: readonly Vetor2[] = [
      { x: 30 * MM, y: -4 * MM },
      { x: 104 * MM, y: 20 * MM },
      { x: 61 * MM, y: 207 * MM },
      { x: -2 * MM, y: 180 * MM },
    ];
    console.log('--- ida e volta cursor -> (aresta, s) -> ponto ---');
    for (const clique of cliques) {
      const lugar = localizarNoContorno(p, clique);
      const volta = pontoEmS(p, lugar.arestaId, lugar.s);
      const erro = Math.hypot(volta.x - lugar.ponto.x, volta.y - lugar.ponto.y);
      console.log(
        `(${umParaMM(clique.x)}, ${umParaMM(clique.y)}) -> ${lugar.arestaId} s=${lugar.s.toFixed(4)}` +
          ` -> volta com erro de ${erro.toFixed(3)} UM`,
      );
      expect(erro).toBeLessThanOrEqual(1);
    }
  });

  it('clique bem longe ainda encontra a aresta mais proxima, e diz a distancia', () => {
    const p = peca(retangulo());
    const lugar = localizarNoContorno(p, { x: 500 * MM, y: 100 * MM });
    console.log(
      `clique a 400 mm da peca -> ${lugar.arestaId}, distancia ${umParaMM(lugar.distanciaUM)} mm`,
    );
    expect(lugar.arestaId).toBe('ar-direita');
    expect(lugar.distanciaUM).toBe(400 * MM);
  });
});

describe('Colocar, arrastar e tirar', () => {
  it('crava o pique com a dimensao do notcher padrao', () => {
    const p = adicionarPique(peca(retangulo()), { id: 'pq-1', arestaId: 'ar-direita', s: 0.5 });
    const pique = p.piques['pq-1']!;
    console.log('--- pique cravado ---');
    console.log(
      `tipo ${pique.tipo} | altura ${umParaMM(pique.alturaUM)} mm | ` +
        `largura ${umParaMM(pique.larguraUM)} mm | s = ${pique.s}`,
    );
    expect(pique.alturaUM).toBe(6350);
    expect(pique.larguraUM).toBe(1590);
    expect(Object.keys(p.piques)).toHaveLength(1);
  });

  it('arrastar muda so o s; tirar deixa a peca sem o pique', () => {
    const base = adicionarPique(peca(retangulo()), { id: 'pq-1', arestaId: 'ar-direita', s: 0.5 });
    const arrastado = moverPique(base, 'pq-1', 0.2);
    const tirado = removerPique(arrastado, 'pq-1');
    console.log(
      `s: ${base.piques['pq-1']!.s} -> ${arrastado.piques['pq-1']!.s} | ` +
        `depois de tirar sobram ${Object.keys(tirado.piques).length} pique(s)`,
    );
    expect(arrastado.piques['pq-1']!.s).toBe(0.2);
    expect(arrastado.piques['pq-1']!.arestaId).toBe('ar-direita');
    expect(tirado.piques['pq-1']).toBeUndefined();
    // Imutabilidade: a peca de origem nao foi tocada.
    expect(base.piques['pq-1']!.s).toBe(0.5);
  });

  it('recusa id repetido, s fora de [0,1], aresta inexistente e dimensao zero', () => {
    const p = adicionarPique(peca(retangulo()), { id: 'pq-1', arestaId: 'ar-direita', s: 0.5 });
    const casos: readonly (readonly [string, () => unknown])[] = [
      ['id repetido', () => adicionarPique(p, { id: 'pq-1', arestaId: 'ar-baixo', s: 0.5 })],
      ['s = 1.5', () => adicionarPique(p, { id: 'pq-2', arestaId: 'ar-baixo', s: 1.5 })],
      ['s = -0.1', () => moverPique(p, 'pq-1', -0.1)],
      ['aresta inexistente', () => adicionarPique(p, { id: 'pq-3', arestaId: 'ar-x', s: 0.5 })],
      [
        'altura zero',
        () => adicionarPique(p, { id: 'pq-4', arestaId: 'ar-baixo', s: 0.5, alturaUM: 0 }),
      ],
      ['pique inexistente', () => removerPique(p, 'pq-9')],
    ];
    console.log('--- recusas ---');
    for (const [nome, acao] of casos) {
      const codigo = codigoDoErro(acao);
      console.log(`${nome.padEnd(20)} -> ${codigo}`);
      expect(codigo).not.toBeNull();
    }
  });
});

describe('O pique acompanha a peca — e por isso que se guarda s, nao x/y', () => {
  it('sob graduacao o s nao muda e a coordenada muda junto com a aresta', () => {
    const log = comGraduacao(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
      [
        { gradePointId: 'gp-0', pontoId: 'pt-0' },
        { gradePointId: 'gp-1', pontoId: 'pt-1' },
        { gradePointId: 'gp-2', pontoId: 'pt-2' },
        { gradePointId: 'gp-3', pontoId: 'pt-3' },
      ],
      [
        ...regraEmTodaAGrade('r-1', 'gp-1', 5, 0),
        ...regraEmTodaAGrade('r-2', 'gp-2', 5, 10),
        ...regraEmTodaAGrade('r-3', 'gp-3', 0, 10),
      ],
    );
    const modelo = reconstruir(log);
    const comPique = adicionarPique(peca(modelo), {
      id: 'pq-meio',
      arestaId: 'ar-direita',
      s: 0.5,
    });
    const modeloComPique: Modelo = { ...modelo, pecas: { [PECA_ID]: comPique } };

    console.log('--- o pique sob graduacao ---');
    const posicoes: Vetor2[] = [];
    for (const tamanho of ['P', 'M', 'G']) {
      const graduada = aplicarGraduacao(modeloComPique, PECA_ID, tamanho);
      const pique = graduada.piques['pq-meio']!;
      const onde = pontoEmS(graduada, pique.arestaId, pique.s);
      posicoes.push(onde);
      console.log(
        `${tamanho}: s = ${pique.s} (nao mudou) | cai em ` +
          `(${umParaMM(onde.x).toFixed(1)}, ${umParaMM(onde.y).toFixed(1)}) mm`,
      );
      expect(pique.s).toBe(0.5);
    }
    // A lateral direita sobe 10 mm por tamanho no topo, entao o meio dela sobe 5 mm.
    expect(umParaMM(posicoes[1]!.y - posicoes[0]!.y)).toBeCloseTo(5, 6);
    expect(umParaMM(posicoes[2]!.y - posicoes[1]!.y)).toBeCloseTo(5, 6);
    expect(umParaMM(posicoes[2]!.x - posicoes[0]!.x)).toBeCloseTo(10, 6);
  });

  it('sob espelhamento o s inverte (s -> 1-s) e o pique cai no espelho do ponto', () => {
    const original = adicionarPique(peca(retangulo()), {
      id: 'pq-1',
      arestaId: 'ar-baixo',
      s: 0.25,
    });
    const antes = pontoEmS(original, 'ar-baixo', 0.25);
    const espelhada = espelharPeca(original, { p1: { x: 0, y: 0 }, p2: { x: 0, y: 200 * MM } });
    const pique = espelhada.piques['pq-1']!;
    const depois = pontoEmS(espelhada, pique.arestaId, pique.s);

    console.log('--- o pique sob espelhamento ---');
    console.log(
      `s ${original.piques['pq-1']!.s} -> ${pique.s} | ` +
        `x ${umParaMM(antes.x)} mm -> ${umParaMM(depois.x)} mm (espelho em x = 0)`,
    );
    expect(pique.s).toBeCloseTo(0.75, 12);
    expect(depois.x).toBe(-antes.x);
    expect(depois.y).toBe(antes.y);
  });

  it('projetado no corte, o pique anda exatamente a margem da aresta', () => {
    const p = adicionarPique(peca(retangulo()), { id: 'pq-1', arestaId: 'ar-direita', s: 0.5 });
    const projetado = projetarPique(p, 'pq-1');
    console.log(
      `costura (${umParaMM(projetado.pontoDaCostura.x)}, ${umParaMM(projetado.pontoDaCostura.y)}) mm` +
        ` -> corte (${umParaMM(projetado.pontoDoCorte.x)}, ${umParaMM(projetado.pontoDoCorte.y)}) mm` +
        ` = ${umParaMM(projetado.distanciaUM)} mm (a margem da aresta)`,
    );
    expect(projetado.distanciaUM).toBe(10 * MM);
    expect(projetado.paraDentro).toEqual({ x: -1, y: -0 });
  });
});

describe('Pelo log de eventos — que e a unica fonte de verdade', () => {
  it('adicionar, mover e remover reconstroem o mesmo estado, e o replay e identico', () => {
    const base = logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] });
    const log: Evento[] = [
      ...base,
      adicionarPeloLog(1, 'pq-a', 'ar-direita', 0.25),
      adicionarPeloLog(2, 'pq-b', 'ar-baixo', 0.5),
      eventoPique(3, 'MoverPique', { piqueId: 'pq-a', s: 0.8 }),
      eventoPique(4, 'RemoverPique', { piqueId: 'pq-b' }),
    ];

    const uma = peca(reconstruir(log));
    const outra = peca(reconstruir(log));

    console.log('--- pelo log ---');
    console.log(
      `piques depois de 4 eventos: ${Object.keys(uma.piques).join(', ') || '(nenhum)'} | ` +
        `pq-a em s = ${uma.piques['pq-a']!.s}`,
    );
    console.log(`replay identico: ${JSON.stringify(uma.piques) === JSON.stringify(outra.piques)}`);

    expect(Object.keys(uma.piques)).toEqual(['pq-a']);
    expect(uma.piques['pq-a']!.s).toBe(0.8);
    expect(uma.piques['pq-a']!.tipo).toBe('V');
    expect(JSON.stringify(uma.piques)).toBe(JSON.stringify(outra.piques));
  });

  it('o fold recusa o mesmo pique duas vezes — o log nao mascara conflito', () => {
    const log: Evento[] = [
      ...logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
      adicionarPeloLog(1, 'pq-a', 'ar-direita', 0.25),
      adicionarPeloLog(2, 'pq-a', 'ar-baixo', 0.25),
    ];
    const codigo = codigoDoErro(() => reconstruir(log));
    console.log(`dois AdicionarPique com o mesmo id -> ${codigo}`);
    expect(codigo).toBe('PIQUE_DUPLICADO');
  });
});

describe('O validador olha a profundidade do pique', () => {
  it('avisa quando o pique e mais fundo que a margem — ele apareceria na peca pronta', () => {
    // Margem de 5 mm na aresta de baixo; o notcher padrao corta 6,35 mm.
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [5, 10, 10, 10] }),
    );
    const fundo = adicionarPique(peca(modelo), { id: 'pq-fundo', arestaId: 'ar-baixo', s: 0.5 });
    const raso = adicionarPique(peca(modelo), { id: 'pq-raso', arestaId: 'ar-direita', s: 0.5 });

    const comFundo = validarInconsistencias({ ...modelo, pecas: { [PECA_ID]: fundo } }, PECA_ID);
    const comRaso = validarInconsistencias({ ...modelo, pecas: { [PECA_ID]: raso } }, PECA_ID);
    const so = (lista: readonly Problema[]) =>
      lista.filter((p) => p.codigo === 'PIQUE_MAIS_FUNDO_QUE_A_MARGEM');

    console.log('--- profundidade ---');
    console.log(`pique de 6,35 mm em margem de 5 mm  -> ${so(comFundo).length} aviso`);
    console.log(`pique de 6,35 mm em margem de 10 mm -> ${so(comRaso).length} aviso`);
    expect(so(comFundo)).toHaveLength(1);
    expect(so(comFundo)[0]!.gravidade).toBe('aviso');
    expect(so(comRaso)).toHaveLength(0);
  });
});
