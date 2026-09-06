/**
 * A peça da demonstração: uma frente de blusa, montada pelo log de eventos.
 *
 * Não é um retângulo de teste. Tem cava e decote em Bézier, seis arestas com
 * margens diferentes (das 8 mm do decote aos 40 mm da bainha — a faixa real que a
 * Parte 7 levantou), o meio-da-frente com margem zero porque cai na dobra do
 * tecido, e regras de graduação em cinco pontos.
 */
import { MM, type Evento, type PropriedadesEncaixe, type Vetor2 } from '@cad/motor';

export const TENANT = 'confeccao-demo';
export const MODELO = 'mod-blusa';
export const PECA = 'pec-frente';

const ENCAIXE: PropriedadesEncaixe = {
  quantidadePorModelo: 1,
  giro: 'livre',
  faixaGiroGraus: 0,
  par: false,
  espelhado: true,
  dobraHorizontal: false,
  dobraVertical: true,
};

/** Vértices da frente, em mm, CCW e Y-up (D4). */
const VERTICES: readonly (Vetor2 & { readonly nome: string })[] = [
  { nome: 'barra-meio', x: 0, y: 0 },
  { nome: 'barra-lado', x: 180 * MM, y: 0 },
  { nome: 'cava-baixo', x: 190 * MM, y: 300 * MM },
  { nome: 'ombro-fora', x: 150 * MM, y: 430 * MM },
  { nome: 'ombro-decote', x: 60 * MM, y: 450 * MM },
  { nome: 'decote-meio', x: 0, y: 400 * MM },
];

/** Aresta por lado, com a margem que a indústria usa em cada uma. */
export const ARESTAS = [
  { id: 'ar-bainha', nome: 'Bainha', margemMM: 40 },
  { id: 'ar-lateral', nome: 'Lateral', margemMM: 12 },
  { id: 'ar-cava', nome: 'Cava', margemMM: 10 },
  { id: 'ar-ombro', nome: 'Ombro', margemMM: 12 },
  { id: 'ar-decote', nome: 'Decote', margemMM: 8 },
  { id: 'ar-meio', nome: 'Meio da frente (dobra)', margemMM: 0 },
] as const;

/** Controles das duas curvas: cava e decote. */
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

/** Regra de graduação por ponto, em mm por tamanho. `barra-meio` é a âncora (D7). */
const GRADUACAO: Readonly<Record<number, { dx: number; dy: number }>> = {
  1: { dx: 6, dy: 0 },
  2: { dx: 6, dy: 4 },
  3: { dx: 5, dy: 8 },
  4: { dx: 2, dy: 8 },
  5: { dx: 0, dy: 8 },
};

export const TAMANHOS = ['P', 'M', 'G'] as const;
export const TAMANHO_BASE = 'M';

export function logDaBlusa(margensMM: readonly number[] = ARESTAS.map((a) => a.margemMM)): Evento[] {
  let n = 0;
  const envelope = (pecaId: string | null) => ({
    id: `01JXDEMO${String(n++).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO,
    pecaId,
    timestamp: '2026-09-04T12:00:00.000Z',
    autor: 'demo',
    versaoSchema: 1,
  });

  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Blusa', tamanhos: [...TAMANHOS], tamanhoBase: TAMANHO_BASE },
    },
    { ...envelope(PECA), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } },
  ];

  VERTICES.forEach((v, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
    }),
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
    }),
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
    });
  });

  ARESTAS.forEach((aresta, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirMargem',
      payload: { arestaId: aresta.id, margemUM: Math.round((margensMM[i] ?? 0) * MM) },
    }),
  );

  // Fio do tecido: dois pontos internos, o de cima graduando com o ombro (D10).
  eventos.push({
    ...envelope(PECA),
    tipo: 'CriarPonto',
    payload: { pontoId: 'fio-a', x: 90 * MM, y: 40 * MM, tipo: 'interno' },
  });
  eventos.push({
    ...envelope(PECA),
    tipo: 'CriarPonto',
    payload: { pontoId: 'fio-b', x: 90 * MM, y: 360 * MM, tipo: 'interno' },
  });
  eventos.push({
    ...envelope(PECA),
    tipo: 'AdicionarLinhaInterna',
    payload: { linhaId: 'li-fio', tipo: 'fio', pontoIds: ['fio-a', 'fio-b'] },
  });

  // Eixo de dobra em cima do meio da frente (x = 0).
  eventos.push({
    ...envelope(PECA),
    tipo: 'DefinirEixoDobra',
    payload: {
      eixoId: 'dobra',
      p1: { x: 0, y: 0 },
      p2: { x: 0, y: 450 * MM },
      direcao: 'dentro',
    },
  });

  // Grade points: todos os vértices do contorno, mais as duas pontas do fio.
  VERTICES.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'MarcarGradePoint',
      payload: { gradePointId: `gp-${i}`, pontoId: `pt-${i}` },
    }),
  );
  for (const ponto of ['fio-a', 'fio-b']) {
    eventos.push({
      ...envelope(PECA),
      tipo: 'MarcarGradePoint',
      payload: { gradePointId: `gp-${ponto}`, pontoId: ponto },
    });
  }

  const passos: readonly (readonly [string, string])[] = [
    ['P', 'M'],
    ['M', 'G'],
  ];
  for (const [indice, regra] of Object.entries(GRADUACAO)) {
    for (const [de, para] of passos) {
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
      });
    }
  }
  // O fio acompanha: a ponta de cima sobe com o ombro, a de baixo fica na âncora.
  for (const [de, para] of passos) {
    eventos.push({
      ...envelope(null),
      tipo: 'DefinirRegraGraduacao',
      payload: {
        regraId: `r-fio-b-${de}${para}`,
        pontoGraduacaoId: 'gp-fio-b',
        deTamanho: de,
        paraTamanho: para,
        dx: Math.round(3 * MM),
        dy: Math.round(6 * MM),
      },
    });
  }

  return eventos;
}
