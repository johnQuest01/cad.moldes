/**
 * A peca dos testes do editor: uma frente de blusa, montada pelo log.
 *
 * Nao e um retangulo. Tem cava e decote em Bezier, margens diferentes por aresta,
 * fio do tecido em `Ponto` de verdade (D10), eixo de dobra no meio da frente e
 * grade points com regra. E o minimo para que hit-testing e snap sejam exercitados
 * no que eles vao encontrar na vida real — num retangulo, o snap de meio por arco
 * daria o mesmo resultado que o `t = 0.5`, e o teste nao provaria nada.
 */
import { MM, criarGeradorMonotonico, type Evento, type Vetor2 } from '@cad/motor';

import { Sessao, type DadosDaSessao } from '../src/index.js';

export const TENANT = 'confeccao-a';
export const MODELO = 'mod-blusa';
export const PECA = 'pec-frente';

export const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: 'livre' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: true,
  dobraHorizontal: false,
  dobraVertical: true,
};

/** Vertices da frente, em mm, CCW e Y-up (D4). */
export const VERTICES: readonly Vetor2[] = [
  { x: 0, y: 0 },
  { x: 180 * MM, y: 0 },
  { x: 190 * MM, y: 300 * MM },
  { x: 150 * MM, y: 430 * MM },
  { x: 60 * MM, y: 450 * MM },
  { x: 0, y: 400 * MM },
];

export const ARESTAS = [
  { id: 'ar-bainha', nome: 'Bainha', margemMM: 40 },
  { id: 'ar-lateral', nome: 'Lateral', margemMM: 12 },
  { id: 'ar-cava', nome: 'Cava', margemMM: 10 },
  { id: 'ar-ombro', nome: 'Ombro', margemMM: 12 },
  { id: 'ar-decote', nome: 'Decote', margemMM: 8 },
  { id: 'ar-meio', nome: 'Meio da frente (dobra)', margemMM: 0 },
] as const;

/** Cava (aresta 2) e decote (aresta 4) sao Bezier. */
const CURVAS: Readonly<Record<number, readonly [Vetor2, Vetor2]>> = {
  2: [
    { x: 188 * MM, y: 362 * MM },
    { x: 172 * MM, y: 424 * MM },
  ],
  4: [
    { x: 36 * MM, y: 448 * MM },
    { x: 4 * MM, y: 432 * MM },
  ],
};

export function logDaBlusa(): Evento[] {
  let n = 0;
  const envelope = (pecaId: string | null) => ({
    id: `01JXBLUSA${String(n++).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO,
    pecaId,
    timestamp: '2026-09-05T12:00:00.000Z',
    autor: 'fixture',
    versaoSchema: 1,
  });

  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Blusa', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
    },
    { ...envelope(PECA), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } },
  ] as Evento[];

  VERTICES.forEach((v, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
    } as Evento),
  );
  ARESTAS.forEach((aresta, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: aresta.id,
        pontoInicioId: `pt-${i}`,
        pontoFimId: `pt-${(i + 1) % VERTICES.length}`,
      },
    } as Evento),
  );
  ARESTAS.forEach((aresta, i) => {
    const controles = CURVAS[i];
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: aresta.id,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % VERTICES.length}`,
        tipo: controles === undefined ? 'reta' : 'curva',
        ...(controles === undefined ? {} : { controles }),
      },
    } as Evento);
  });
  ARESTAS.forEach((aresta) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirMargem',
      payload: { arestaId: aresta.id, margemUM: Math.round(aresta.margemMM * MM) },
    } as Evento),
  );

  // Fio do tecido: dois pontos internos ligados (D10).
  eventos.push(
    {
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: 'fio-a', x: 90 * MM, y: 40 * MM, tipo: 'interno' },
    } as Evento,
    {
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: 'fio-b', x: 90 * MM, y: 360 * MM, tipo: 'interno' },
    } as Evento,
    {
      ...envelope(PECA),
      tipo: 'AdicionarLinhaInterna',
      payload: { linhaId: 'li-fio', tipo: 'fio', pontoIds: ['fio-a', 'fio-b'] },
    } as Evento,
    {
      ...envelope(PECA),
      tipo: 'DefinirEixoDobra',
      payload: {
        eixoId: 'dobra',
        p1: { x: 0, y: 0 },
        p2: { x: 0, y: 450 * MM },
        direcao: 'dentro',
      },
    } as Evento,
  );

  // Grade points e regras: pt-0 fica sem regra, e a ancora (D7).
  VERTICES.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'MarcarGradePoint',
      payload: { gradePointId: `gp-${i}`, pontoId: `pt-${i}` },
    } as Evento),
  );
  const regras: Readonly<Record<number, { dx: number; dy: number }>> = {
    1: { dx: 6, dy: 0 },
    2: { dx: 6, dy: 4 },
    3: { dx: 5, dy: 8 },
    4: { dx: 2, dy: 8 },
    5: { dx: 0, dy: 8 },
  };
  for (const [indice, regra] of Object.entries(regras)) {
    for (const [de, para] of [
      ['P', 'M'],
      ['M', 'G'],
    ] as const) {
      eventos.push({
        ...envelope(null),
        tipo: 'DefinirRegraGraduacao',
        payload: {
          regraId: `r-${indice}-${de}${para}`,
          pontoGraduacaoId: `gp-${indice}`,
          deTamanho: de,
          paraTamanho: para,
          dx: Math.round(regra.dx * MM),
          dy: Math.round(regra.dy * MM),
        },
      } as Evento);
    }
  }

  return eventos;
}

export function dadosDaSessao(): DadosDaSessao {
  const gerar = criarGeradorMonotonico();
  let relogio = 0;
  return {
    tenantId: TENANT,
    modeloId: MODELO,
    autor: 'modelista',
    gerarId: () => gerar(),
    agora: () => new Date(Date.UTC(2026, 8, 5, 13, 0, relogio++)).toISOString(),
  };
}

export function sessaoDaBlusa(): Sessao {
  return new Sessao(logDaBlusa(), dadosDaSessao());
}
