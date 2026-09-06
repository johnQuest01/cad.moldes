/**
 * Bloco 0 da Fase 2 — as lacunas que o levantamento do editor encontrou.
 *
 * Duas operacoes que existiam sem evento (`dividirPeca`, `abrirPregas`), duas que
 * nao existiam (`moverControle`, `duplicarPeca`) e oito remocoes que nao tinham
 * como acontecer. Sem isto, o editor iria inevitavelmente mutar `Peca` por fora do
 * log para preencher o buraco — e o log deixaria de ser a fonte de verdade, que e
 * a unica coisa que sustenta o backend, o offline e a auditoria.
 *
 * O teste que mais importa aqui nao e "a funcao roda": e **reconstruir so pelo log
 * bate com a chamada direta**. E o que prova que o gesto sobrevive a um replay.
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor, type CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import type { Evento } from '../src/eventos/tipos.js';
import { VERSAO_SCHEMA_ATUAL } from '../src/eventos/tipos.js';
import { moverControle } from '../src/edicao.js';
import { duplicarPeca } from '../src/duplicar.js';
import { dividirPeca } from '../src/dividir.js';
import { abrirPregas } from '../src/pregas.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import { area, anelDoContorno, contemPonto } from '../src/geometria/anel.js';
import { medirAresta, pontoEmS } from '../src/geometria/medir.js';
import { offsetMargem } from '../src/offset.js';
import { adicionarPique } from '../src/piques.js';
import { validarModelo } from '../src/validar.js';
import type { Modelo, Peca, Vetor2 } from '../src/tipos.js';
import { MM, umParaMM } from '../src/unidades.js';
import {
  AGORA,
  AUTOR,
  ENCAIXE_PADRAO,
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

let contador = 0;
function evt(tipo: string, payload: unknown, pecaId: string | null = PECA_ID): Evento {
  return {
    id: `evt-b0-${String(contador++).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO_ID,
    pecaId,
    timestamp: AGORA,
    autor: AUTOR,
    versaoSchema: VERSAO_SCHEMA_ATUAL,
    tipo,
    payload,
  } as Evento;
}

const base = (margensMM: [number, number, number, number] = [10, 10, 10, 10]): Evento[] =>
  logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM });

const peca = (modelo: Modelo, id: string = PECA_ID): Peca => modelo.pecas[id]!;

/** Comparacao canonica: os mapas do motor nao tem ordem garantida entre execucoes. */
function canonico(valor: unknown): string {
  return JSON.stringify(valor, (_chave, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const objeto = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(objeto).sort().map((k) => [k, objeto[k]]));
  });
}

// ===========================================================================
// 1. moverControle — a curva ganha forma
// ===========================================================================

describe('moverControle — sem isto, uma curva convertida fica reta para sempre', () => {
  /** Retangulo com a lateral direita convertida em curva. */
  function comCurva(): Peca {
    const log = [...base(), evt('ConverterSegmento', { segmentoId: 'sg-1', para: 'curva' })];
    return peca(reconstruir(log));
  }

  it('a reta convertida em curva ainda mede o mesmo; mover o controle e que muda', () => {
    const reta = peca(reconstruir(base()));
    const curva = comCurva();
    const empurrada = moverControle(curva, 'sg-1', 0, 30 * MM, 0);

    console.log('--- comprimento da lateral direita ---');
    console.log(`reta                       ${umParaMM(medirAresta(reta, 'ar-direita'))} mm`);
    console.log(`convertida em curva        ${umParaMM(medirAresta(curva, 'ar-direita'))} mm`);
    console.log(`controle 0 empurrado 30 mm ${umParaMM(medirAresta(empurrada, 'ar-direita'))} mm`);

    expect(medirAresta(curva, 'ar-direita')).toBe(medirAresta(reta, 'ar-direita'));
    expect(medirAresta(empurrada, 'ar-direita')).toBeGreaterThan(medirAresta(curva, 'ar-direita'));
  });

  it('os extremos do segmento NAO se movem — e o que deixa a aresta vizinha casando', () => {
    const curva = comCurva();
    const empurrada = moverControle(curva, 'sg-1', 1, -25 * MM, 12 * MM);
    const antes = [curva.pontos['pt-1']!, curva.pontos['pt-2']!];
    const depois = [empurrada.pontos['pt-1']!, empurrada.pontos['pt-2']!];

    console.log(
      `inicio (${umParaMM(antes[0]!.x)}, ${umParaMM(antes[0]!.y)}) -> ` +
        `(${umParaMM(depois[0]!.x)}, ${umParaMM(depois[0]!.y)}) mm | ` +
        `fim (${umParaMM(antes[1]!.x)}, ${umParaMM(antes[1]!.y)}) -> ` +
        `(${umParaMM(depois[1]!.x)}, ${umParaMM(depois[1]!.y)}) mm`,
    );
    expect(depois[0]).toEqual(antes[0]);
    expect(depois[1]).toEqual(antes[1]);
  });

  it('ida e volta devolve a peca IDENTICA — a operacao e pura e reversivel', () => {
    const curva = comCurva();
    const volta = moverControle(moverControle(curva, 'sg-1', 0, 30 * MM, -8 * MM), 'sg-1', 0, -30 * MM, 8 * MM);
    console.log(`ida e volta identica: ${canonico(volta) === canonico(curva)}`);
    expect(canonico(volta)).toBe(canonico(curva));
  });

  it('sob graduacao, o s de um pique na curva nao muda e a coordenada muda', () => {
    const log = [
      ...comGraduacao(
        base(),
        [0, 1, 2, 3].map((i) => ({ gradePointId: `gp-${i}`, pontoId: `pt-${i}` })),
        [
          ...regraEmTodaAGrade('r-1', 'gp-1', 5, 0),
          ...regraEmTodaAGrade('r-2', 'gp-2', 5, 10),
          ...regraEmTodaAGrade('r-3', 'gp-3', 0, 10),
        ],
      ),
      evt('ConverterSegmento', { segmentoId: 'sg-1', para: 'curva' }),
      evt('MoverControle', { segmentoId: 'sg-1', indice: 0, dx: 25 * MM, dy: 0 }),
    ];
    const modelo = reconstruir(log);
    const comPique = adicionarPique(peca(modelo), {
      id: 'pq-1',
      arestaId: 'ar-direita',
      s: 0.5,
    });
    const comAPeca: Modelo = { ...modelo, pecas: { [PECA_ID]: comPique } };

    console.log('--- pique na curva, sob graduacao ---');
    const onde: Vetor2[] = [];
    for (const tamanho of ['P', 'M', 'G']) {
      const g = aplicarGraduacao(comAPeca, PECA_ID, tamanho);
      const p = g.piques['pq-1']!;
      const ponto = pontoEmS(g, p.arestaId, p.s);
      onde.push(ponto);
      console.log(
        `${tamanho}: s = ${p.s} | (${umParaMM(ponto.x).toFixed(1)}, ${umParaMM(ponto.y).toFixed(1)}) mm`,
      );
      expect(p.s).toBe(0.5);
    }
    expect(onde[0]).not.toEqual(onde[2]);
  });

  it('recusa segmento reto, indice fora de {0,1} e segmento inexistente', () => {
    const curva = comCurva();
    const casos: readonly (readonly [string, () => unknown])[] = [
      ['segmento reto', () => moverControle(curva, 'sg-0', 0, 1000, 0)],
      ['indice 2', () => moverControle(curva, 'sg-1', 2 as 0 | 1, 1000, 0)],
      ['segmento inexistente', () => moverControle(curva, 'sg-9', 0, 1000, 0)],
      ['dx nao inteiro', () => moverControle(curva, 'sg-1', 0, 0.5, 0)],
    ];
    console.log('--- recusas de moverControle ---');
    for (const [nome, acao] of casos) {
      const codigo = codigoDoErro(acao);
      console.log(`${nome.padEnd(22)} -> ${codigo}`);
      expect(codigo).not.toBeNull();
    }
  });

  it('pelo log: reconstruir bate com a chamada direta', () => {
    const direto = moverControle(comCurva(), 'sg-1', 0, 30 * MM, -8 * MM);
    const pelaLog = peca(
      reconstruir([
        ...base(),
        evt('ConverterSegmento', { segmentoId: 'sg-1', para: 'curva' }),
        evt('MoverControle', { segmentoId: 'sg-1', indice: 0, dx: 30 * MM, dy: -8 * MM }),
      ]),
    );
    console.log(`log == chamada direta: ${canonico(pelaLog) === canonico(direto)}`);
    expect(canonico(pelaLog)).toBe(canonico(direto));
  });
});

// ===========================================================================
// 2. duplicarPeca — frente vira costas
// ===========================================================================

describe('duplicarPeca — o gesto com que todo molde comeca', () => {
  const REGRAS = [
    ...regraEmTodaAGrade('r-1', 'gp-1', 5, 0),
    ...regraEmTodaAGrade('r-2', 'gp-2', 5, 10),
    ...regraEmTodaAGrade('r-3', 'gp-3', 0, 10),
  ];
  const logGraduado = (): Evento[] =>
    comGraduacao(
      base(),
      [0, 1, 2, 3].map((i) => ({ gradePointId: `gp-${i}`, pontoId: `pt-${i}` })),
      REGRAS,
    );

  it('a copia mede igual e nao compartilha NENHUM id com a original', () => {
    const original = peca(reconstruir(base()));
    const { peca: copia } = duplicarPeca(original, 'pec-costas', 'cp', {
      dx: 200 * MM,
      dy: 0,
    });

    const ids = (p: Peca): Set<string> =>
      new Set([
        ...Object.keys(p.pontos),
        ...Object.keys(p.segmentos),
        ...Object.keys(p.arestas),
        ...Object.keys(p.gradePoints),
      ]);
    const comuns = [...ids(original)].filter((id) => ids(copia).has(id));

    console.log('--- a copia ---');
    console.log(
      `area   original ${(area(anelDoContorno(original)) / 1e8).toFixed(1)} cm2 | ` +
        `copia ${(area(anelDoContorno(copia)) / 1e8).toFixed(1)} cm2`,
    );
    for (const aresta of ['ar-baixo', 'ar-direita', 'ar-cima', 'ar-esquerda']) {
      const novo = copia.arestas[`cp-ar-${['ar-baixo', 'ar-direita', 'ar-cima', 'ar-esquerda'].indexOf(aresta)}`];
      if (novo === undefined) continue;
      console.log(
        `  ${aresta.padEnd(12)} ${umParaMM(medirAresta(original, aresta))} mm -> ` +
          `${umParaMM(medirAresta(copia, novo.id))} mm`,
      );
    }
    console.log(`ids em comum: ${comuns.length}`);

    expect(area(anelDoContorno(copia))).toBe(area(anelDoContorno(original)));
    expect(comuns).toHaveLength(0);
    expect(copia.metadados.nome).toBe('RETANGULO (copia)');
  });

  it('editar a copia nao mexe na original', () => {
    const modelo = reconstruir([
      ...base(),
      evt('DuplicarPeca', {
        novoPecaId: 'pec-costas',
        prefixoId: 'cp',
        dx: 200 * MM,
        dy: 0,
        comGraduacao: false,
      }),
      evt('ModificarPonto', { pontoId: 'cp-pt-2', dx: 30 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 }, 'pec-costas'),
    ]);
    const original = peca(modelo);
    const copia = peca(modelo, 'pec-costas');
    const largura = (p: Peca) => {
      const anel = anelDoContorno(p);
      return Math.max(...anel.map((v) => v.x)) - Math.min(...anel.map((v) => v.x));
    };
    console.log(
      `depois de puxar 30 mm na copia: original ${umParaMM(largura(original))} mm | ` +
        `copia ${umParaMM(largura(copia))} mm`,
    );
    expect(umParaMM(largura(original))).toBe(100);
    expect(umParaMM(largura(copia))).toBe(130);
  });

  it('com comGraduacao, a copia gradua igual; sem, o validador acusa', () => {
    const comRegras = reconstruir([
      ...logGraduado(),
      evt('DuplicarPeca', {
        novoPecaId: 'pec-costas',
        prefixoId: 'cp',
        dx: 300 * MM,
        dy: 0,
        comGraduacao: true,
      }),
    ]);
    const semRegras = reconstruir([
      ...logGraduado(),
      evt('DuplicarPeca', {
        novoPecaId: 'pec-costas',
        prefixoId: 'cp',
        dx: 300 * MM,
        dy: 0,
        comGraduacao: false,
      }),
    ]);
    const largura = (m: Modelo, id: string, t: string) => {
      const anel = anelDoContorno(aplicarGraduacao(m, id, t));
      return umParaMM(Math.max(...anel.map((v) => v.x)) - Math.min(...anel.map((v) => v.x)));
    };

    console.log('--- graduacao da copia ---');
    for (const t of ['P', 'M', 'G']) {
      console.log(
        `${t}: original ${largura(comRegras, PECA_ID, t)} mm | copia ${largura(comRegras, 'pec-costas', t)} mm`,
      );
      expect(largura(comRegras, 'pec-costas', t)).toBe(largura(comRegras, PECA_ID, t));
    }
    const semGraduacao = ['P', 'M', 'G'].map((t) => largura(semRegras, 'pec-costas', t));
    console.log(`sem comGraduacao, a copia fica parada: ${semGraduacao.join(', ')} mm`);
    expect(new Set(semGraduacao).size).toBe(1);

    const avisos = validarModelo(semRegras).filter((p) => p.codigo === 'GRADE_POINT_SEM_REGRA');
    console.log(`e o validador acusa ${avisos.length} GRADE_POINT_SEM_REGRA na copia`);
    expect(avisos.length).toBeGreaterThan(0);
  });

  it('recusa duplicar por cima de peca existente', () => {
    const codigo = codigoDoErro(() =>
      reconstruir([
        ...base(),
        evt('DuplicarPeca', {
          novoPecaId: PECA_ID,
          prefixoId: 'cp',
          dx: 0,
          dy: 0,
          comGraduacao: false,
        }),
      ]),
    );
    console.log(`DuplicarPeca com id ja usado -> ${codigo}`);
    expect(codigo).toBe('PECA_DUPLICADA');
  });
});

// ===========================================================================
// 3 e 4. DividirPeca e AbrirPregas — as operacoes existiam sem evento
// ===========================================================================

describe('DividirPeca — a peca cortada desaparece e as duas partes entram', () => {
  const EIXO = { p1: { x: -1000 * MM, y: 100 * MM }, p2: { x: 1000 * MM, y: 100 * MM } };

  it('reconstruir pelo log bate com dividirPeca chamada na mao', () => {
    const original = peca(reconstruir(base()));
    const [d1, d2] = dividirPeca(original, EIXO, 10 * MM, 'dv');
    const modelo = reconstruir([
      ...base(),
      evt('DividirPeca', { p1: EIXO.p1, p2: EIXO.p2, margemNovaUM: 10 * MM, prefixoId: 'dv' }),
    ]);

    console.log('--- divisao pelo log ---');
    console.log(`pecas depois do evento: ${Object.keys(modelo.pecas).join(', ')}`);
    expect(modelo.pecas[PECA_ID]).toBeUndefined();
    expect(canonico(modelo.pecas[d1.id])).toBe(canonico(d1));
    expect(canonico(modelo.pecas[d2.id])).toBe(canonico(d2));
  });

  it('as partes consomem mais tecido que a inteira — a margem nova das duas bordas', () => {
    const modelo = reconstruir([
      ...base(),
      evt('DividirPeca', { p1: EIXO.p1, p2: EIXO.p2, margemNovaUM: 10 * MM, prefixoId: 'dv' }),
    ]);
    const inteira = area(offsetMargem(peca(reconstruir(base()))).pontos);
    const partes = Object.values(modelo.pecas).reduce(
      (soma, p) => soma + area(offsetMargem(p).pontos),
      0,
    );
    console.log(
      `inteira ${(inteira / 1e8).toFixed(1)} cm2 | partes ${(partes / 1e8).toFixed(1)} cm2 | ` +
        `a mais ${((partes - inteira) / 1e8).toFixed(1)} cm2`,
    );
    expect(partes).toBeGreaterThan(inteira);
  });

  it('replay duas vezes da o mesmo resultado', () => {
    const log = [
      ...base(),
      evt('DividirPeca', { p1: EIXO.p1, p2: EIXO.p2, margemNovaUM: 10 * MM, prefixoId: 'dv' }),
    ];
    console.log(`replay identico: ${canonico(reconstruir(log)) === canonico(reconstruir(log))}`);
    expect(canonico(reconstruir(log))).toBe(canonico(reconstruir(log)));
  });
});

describe('AbrirPregas — os piques de prega passam a existir no log', () => {
  function logComEixos(): Evento[] {
    const eventos = [...logRetangulo({ larguraMM: 200, alturaMM: 300, margensMM: [10, 10, 10, 10] })];
    [50, 100, 150].forEach((x, i) => {
      eventos.push(
        evt('DefinirEixoDobra', {
          eixoId: `pr-${i}`,
          p1: { x: x * MM, y: -500 * MM },
          p2: { x: x * MM, y: 500 * MM },
          direcao: i % 2 === 0 ? 'dentro' : 'fora',
          profundidadeUM: 20 * MM,
        }),
      );
    });
    return eventos;
  }

  it('reconstruir pelo log bate com abrirPregas, e a largura plana bate com a conta manual', () => {
    const acabada = peca(reconstruir(logComEixos()));
    const eixos = ['pr-0', 'pr-1', 'pr-2'];
    const direto = abrirPregas(acabada, eixos, 'pg');
    const pelaLog = peca(
      reconstruir([...logComEixos(), evt('AbrirPregas', { eixoIds: eixos, prefixoId: 'pg' })]),
    );
    const largura = (p: Peca) => {
      const anel = anelDoContorno(p);
      return umParaMM(Math.max(...anel.map((v) => v.x)) - Math.min(...anel.map((v) => v.x)));
    };

    console.log('--- pregas pelo log ---');
    console.log(
      `acabada ${largura(acabada)} mm -> plana ${largura(pelaLog)} mm ` +
        `(conta manual: 200 + 3 x 2 x 20 = 320)`,
    );
    console.log(`piques de prega no modelo reconstruido: ${Object.keys(pelaLog.piques).length}`);
    expect(largura(pelaLog)).toBe(320);
    expect(canonico(pelaLog)).toBe(canonico(direto));
    expect(Object.keys(pelaLog.piques).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 5. As remocoes e a propriedade de encaixe
// ===========================================================================

describe('As remocoes — e as duas referencias que sobrevivem de proposito', () => {
  it('cada remocao tira o que devia; remover de novo estoura com o codigo certo', () => {
    const comCoisas = [
      ...base(),
      evt('CriarPonto', { pontoId: 'in-a', x: 40 * MM, y: 40 * MM, tipo: 'interno' }),
      evt('CriarPonto', { pontoId: 'in-b', x: 40 * MM, y: 160 * MM, tipo: 'interno' }),
      evt('AdicionarLinhaInterna', { linhaId: 'li-fio', tipo: 'fio', pontoIds: ['in-a', 'in-b'] }),
      evt('MarcarGradePoint', { gradePointId: 'gp-0', pontoId: 'pt-0' }),
    ];
    const modelo = reconstruir([
      ...comCoisas,
      evt('RemoverLinhaInterna', { linhaId: 'li-fio' }),
      evt('DesmarcarGradePoint', { gradePointId: 'gp-0' }),
    ]);

    console.log('--- remocoes ---');
    console.log(
      `linhas internas: ${Object.keys(peca(modelo).linhasInternas).length} | ` +
        `grade points: ${Object.keys(peca(modelo).gradePoints).length}`,
    );
    expect(Object.keys(peca(modelo).linhasInternas)).toHaveLength(0);
    expect(Object.keys(peca(modelo).gradePoints)).toHaveLength(0);

    // Remover de novo o que ja saiu: o log ate aqui e o que ja tem as duas remocoes.
    const jaRemovido = [
      ...comCoisas,
      evt('RemoverLinhaInterna', { linhaId: 'li-fio' }),
      evt('DesmarcarGradePoint', { gradePointId: 'gp-0' }),
    ];
    const repetidos: readonly (readonly [string, Evento])[] = [
      ['RemoverLinhaInterna', evt('RemoverLinhaInterna', { linhaId: 'li-fio' })],
      ['DesmarcarGradePoint', evt('DesmarcarGradePoint', { gradePointId: 'gp-0' })],
      ['RemoverRecorte', evt('RemoverRecorte', { recorteId: 'rc-x' })],
      ['RemoverRegraGraduacao', evt('RemoverRegraGraduacao', { regraId: 'r-x' }, null)],
      ['RemoverParCostura', evt('RemoverParCostura', { parId: 'pc-x' }, null)],
    ];
    for (const [nome, evento] of repetidos) {
      const codigo = codigoDoErro(() => reconstruir([...jaRemovido, evento]));
      console.log(`${nome.padEnd(22)} no que nao existe -> ${codigo}`);
      expect(codigo).not.toBeNull();
    }
  });

  it('desmarcar grade point deixa a regra orfa, e o validador ACUSA em vez de apagar junto', () => {
    const log = comGraduacao(
      base(),
      [{ gradePointId: 'gp-1', pontoId: 'pt-1' }],
      regraEmTodaAGrade('r-1', 'gp-1', 5, 0),
    );
    const antes = reconstruir(log);
    const depois = reconstruir([...log, evt('DesmarcarGradePoint', { gradePointId: 'gp-1' })]);

    const orfas = (m: Modelo) => validarModelo(m).filter((p) => p.codigo === 'REGRA_SEM_GRADE_POINT');
    console.log(
      `regras no modelo: ${Object.keys(depois.regrasGraduacao).length} (nao foram apagadas em cascata)`,
    );
    console.log(`REGRA_SEM_GRADE_POINT: antes ${orfas(antes).length} | depois ${orfas(depois).length}`);
    expect(Object.keys(depois.regrasGraduacao)).toHaveLength(2);
    expect(orfas(antes)).toHaveLength(0);
    expect(orfas(depois)).toHaveLength(2);
  });

  it('remover peca deixa o par de costura pendurado, e a conferencia ACUSA', () => {
    const duasPecas = [
      ...base(),
      evt('CriarPeca', { nome: 'COSTAS', encaixe: ENCAIXE_PADRAO }, 'pec-2'),
      evt('CriarPonto', { pontoId: 'b-0', x: 300 * MM, y: 0, tipo: 'contorno' }, 'pec-2'),
      evt('CriarPonto', { pontoId: 'b-1', x: 400 * MM, y: 0, tipo: 'contorno' }, 'pec-2'),
      evt('CriarPonto', { pontoId: 'b-2', x: 400 * MM, y: 200 * MM, tipo: 'contorno' }, 'pec-2'),
      evt('CriarPonto', { pontoId: 'b-3', x: 300 * MM, y: 200 * MM, tipo: 'contorno' }, 'pec-2'),
      ...[0, 1, 2, 3].map((i) =>
        evt(
          'DefinirAresta',
          { arestaId: `b-ar-${i}`, pontoInicioId: `b-${i}`, pontoFimId: `b-${(i + 1) % 4}` },
          'pec-2',
        ),
      ),
      ...[0, 1, 2, 3].map((i) =>
        evt(
          'DefinirSegmento',
          {
            segmentoId: `b-sg-${i}`,
            arestaId: `b-ar-${i}`,
            de: `b-${i}`,
            para: `b-${(i + 1) % 4}`,
            tipo: 'reta',
          },
          'pec-2',
        ),
      ),
      ...[0, 1, 2, 3].map((i) => evt('DefinirMargem', { arestaId: `b-ar-${i}`, margemUM: 10 * MM }, 'pec-2')),
      evt(
        'DefinirParCostura',
        { parId: 'pc-1', arestaA: 'ar-direita', arestaB: 'b-ar-3', embebidoUM: 0 },
        null,
      ),
    ];
    const inteiro = reconstruir(duasPecas);
    const semAPeca = reconstruir([...duasPecas, evt('RemoverPeca', {}, 'pec-2')]);
    const pendentes = (m: Modelo) => validarModelo(m).filter((p) => p.codigo === 'PAR_COSTURA_PENDENTE');

    console.log(
      `pecas: ${Object.keys(inteiro.pecas).length} -> ${Object.keys(semAPeca.pecas).length} | ` +
        `pares de costura ainda no modelo: ${Object.keys(semAPeca.paresCostura).length}`,
    );
    console.log(
      `PAR_COSTURA_PENDENTE: antes ${pendentes(inteiro).length} | depois ${pendentes(semAPeca).length}`,
    );
    expect(pendentes(inteiro)).toHaveLength(0);
    expect(pendentes(semAPeca)).toHaveLength(1);
  });

  it('DefinirEncaixe troca as propriedades depois de a peca existir', () => {
    const modelo = reconstruir([
      ...base(),
      evt('DefinirEncaixe', {
        encaixe: { ...ENCAIXE_PADRAO, quantidadePorModelo: 4, par: true, giro: 'nenhum' },
      }),
    ]);
    const e = peca(modelo).encaixe;
    console.log(`quantidade ${e.quantidadePorModelo} | par ${String(e.par)} | giro ${e.giro}`);
    expect(e.quantidadePorModelo).toBe(4);
    expect(e.par).toBe(true);
  });

  it('DefinirMetadados recusa nome em branco — peca sem nome ninguem acha no corte', () => {
    const codigo = codigoDoErro(() =>
      reconstruir([...base(), evt('DefinirMetadados', { nome: '   ' })]),
    );
    console.log(`DefinirMetadados com nome em branco -> ${codigo}`);
    expect(codigo).toBe('NOME_VAZIO');
  });
});

// ===========================================================================
// 6. Compatibilidade: o log antigo continua reconstruindo igual
// ===========================================================================

describe('Compatibilidade de schema', () => {
  it('VERSAO_SCHEMA_ATUAL continua 1 e um log sem os eventos novos reconstroi igual', () => {
    const antigo = base();
    const reconstruido = reconstruir(antigo);
    console.log(`VERSAO_SCHEMA_ATUAL = ${VERSAO_SCHEMA_ATUAL}`);
    console.log(
      `log antigo (${antigo.length} eventos) reconstroi: ` +
        `${Object.keys(reconstruido.pecas).length} peca, ` +
        `${umParaMM(medirAresta(peca(reconstruido), 'ar-baixo'))} mm de bainha`,
    );
    expect(VERSAO_SCHEMA_ATUAL).toBe(1);
    expect(umParaMM(medirAresta(peca(reconstruido), 'ar-baixo'))).toBe(100);
  });

  it('o fold recusa tipo de evento desconhecido em vez de ignorar em silencio', () => {
    const codigo = codigoDoErro(() => reconstruir([...base(), evt('EventoQueNaoExiste', {})]));
    console.log(`tipo desconhecido -> ${codigo}`);
    expect(codigo).toBe('EVENTO_VERSAO_DESCONHECIDA');
  });
});

// ===========================================================================
// 7. contemPonto — a conta que o editor precisa, e que mora no motor
// ===========================================================================

describe('contemPonto — dentro, fora e em cima da borda', () => {
  it('acerta o retangulo, inclusive nos casos que enganam o lancamento de raio', () => {
    const anel = anelDoContorno(peca(reconstruir(base())));
    const casos: readonly (readonly [string, Vetor2, boolean])[] = [
      ['no meio', { x: 50 * MM, y: 100 * MM }, true],
      ['fora, a direita', { x: 150 * MM, y: 100 * MM }, false],
      ['fora, abaixo', { x: 50 * MM, y: -1 * MM }, false],
      ['em cima da borda de baixo', { x: 50 * MM, y: 0 }, true],
      ['no vertice', { x: 0, y: 0 }, true],
      ['na altura de um vertice, fora', { x: -1 * MM, y: 200 * MM }, false],
      ['na altura de um vertice, dentro', { x: 50 * MM, y: 200 * MM }, true],
    ];
    console.log('--- contemPonto ---');
    for (const [nome, ponto, esperado] of casos) {
      const resultado = contemPonto(anel, ponto);
      console.log(`${nome.padEnd(30)} -> ${resultado ? 'dentro' : 'fora'}`);
      expect(resultado).toBe(esperado);
    }
  });

  it('num contorno com curva, o ponto entre a corda e a curva e classificado pela curva', () => {
    // Lateral direita convertida em curva e empurrada 30 mm para fora: um ponto a
    // 110 mm passa a estar DENTRO, e antes estava fora.
    const reta = anelDoContorno(peca(reconstruir(base())));
    const curva = anelDoContorno(
      peca(
        reconstruir([
          ...base(),
          evt('ConverterSegmento', { segmentoId: 'sg-1', para: 'curva' }),
          evt('MoverControle', { segmentoId: 'sg-1', indice: 0, dx: 30 * MM, dy: 0 }),
          evt('MoverControle', { segmentoId: 'sg-1', indice: 1, dx: 30 * MM, dy: 0 }),
        ]),
      ),
    );
    const alvo = { x: 110 * MM, y: 100 * MM };
    console.log(
      `ponto (110, 100) mm: com a lateral reta -> ${contemPonto(reta, alvo) ? 'dentro' : 'fora'} | ` +
        `com a lateral curvada 30 mm -> ${contemPonto(curva, alvo) ? 'dentro' : 'fora'}`,
    );
    expect(contemPonto(reta, alvo)).toBe(false);
    expect(contemPonto(curva, alvo)).toBe(true);
  });
});

// ===========================================================================
// 8. O papel do plotter — a restricao que nao existia
// ===========================================================================

describe('O papel do plotter: a peca cabe no rolo?', () => {
  /** Larguras de rolo praticadas na modelagem. Margem de 10 mm em cada borda. */
  const ROLOS = [
    ['90 cm', 900 * MM],
    ['1,60 m', 1600 * MM],
  ] as const;

  const comPapel = (larguraUM: number, largura: number, altura: number): Modelo =>
    reconstruir([
      ...logRetangulo({ larguraMM: largura, alturaMM: altura, margensMM: [10, 10, 10, 10] }),
      evt(
        'DefinirPapel',
        { papelId: 'pl-1', nome: 'rolo', larguraUM, margemDeSegurancaUM: 10 * MM },
        null,
      ),
    ]);

  const so = (m: Modelo, codigo: string) => validarModelo(m).filter((p) => p.codigo === codigo);

  it('sem papel declarado, o validador nao da palpite', () => {
    const semPapel = reconstruir(
      logRetangulo({ larguraMM: 3000, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
    );
    console.log('--- sem papel ---');
    console.log(`peca de 3 m, sem rolo declarado -> papel = ${String(semPapel.papel)}`);
    expect(semPapel.papel).toBeNull();
    expect(so(semPapel, 'PECA_MAIS_LARGA_QUE_O_PAPEL')).toHaveLength(0);
  });

  it('a que cabe passa; a que nao cabe de jeito nenhum e ERRO', () => {
    console.log('--- cabe no rolo? (linha de CORTE, util = rolo - 2 x 10 mm) ---');
    for (const [nome, larguraUM] of ROLOS) {
      const util = umParaMM(larguraUM - 20 * MM);
      const pequena = comPapel(larguraUM, 100, 200);
      const enorme = comPapel(larguraUM, umParaMM(larguraUM), umParaMM(larguraUM));
      console.log(
        `${nome.padEnd(7)} (util ${util} mm): corte de 120 mm -> ` +
          `${so(pequena, 'PECA_MAIS_LARGA_QUE_O_PAPEL').length} erro | ` +
          `corte de ${util + 40} mm -> ${so(enorme, 'PECA_MAIS_LARGA_QUE_O_PAPEL').length} erro`,
      );
      expect(so(pequena, 'PECA_MAIS_LARGA_QUE_O_PAPEL')).toHaveLength(0);
      expect(so(enorme, 'PECA_MAIS_LARGA_QUE_O_PAPEL')).toHaveLength(1);
    }
  });

  it('a que so cabe DEITADA e aviso — girar no papel e livre, no tecido nao', () => {
    const deitada = comPapel(900 * MM, 900, 300);
    const avisos = so(deitada, 'PECA_SO_CABE_GIRADA');
    const erros = so(deitada, 'PECA_MAIS_LARGA_QUE_O_PAPEL');
    console.log('--- so cabe deitada ---');
    console.log(
      `rolo de 900 mm (util 880) | corte de 920 x 320 mm -> ` +
        `${erros.length} erro, ${avisos.length} aviso [${avisos[0]?.gravidade}] ${avisos[0]?.codigo}`,
    );
    expect(erros).toHaveLength(0);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.gravidade).toBe('aviso');
  });

  it('a MARGEM DE COSTURA conta: e a linha de corte que vai para o papel', () => {
    const noLimite = comPapel(900 * MM, 870, 200);
    const erros = so(noLimite, 'PECA_MAIS_LARGA_QUE_O_PAPEL');
    const avisos = so(noLimite, 'PECA_SO_CABE_GIRADA');
    console.log(
      `costura de 870 mm cabe nos 880 uteis, mas o CORTE tem 890 -> ` +
        `${erros.length + avisos.length} problema(s): ${[...erros, ...avisos][0]?.codigo}`,
    );
    expect(erros.length + avisos.length).toBe(1);
  });

  it('rolo invalido e recusado no fold', () => {
    const codigo = codigoDoErro(() =>
      reconstruir([
        ...base(),
        evt(
          'DefinirPapel',
          { papelId: 'pl-x', nome: 'ruim', larguraUM: 100 * MM, margemDeSegurancaUM: 60 * MM },
          null,
        ),
      ]),
    );
    console.log(`rolo de 100 mm com 60 mm de margem em cada borda -> ${codigo}`);
    expect(codigo).toBe('PAPEL_INVALIDO');
  });
});
