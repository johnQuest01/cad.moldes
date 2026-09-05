/**
 * Fixtures dos testes.
 *
 * Os IDs sao FIXOS de proposito. O fold e puro (D2) e so e possivel provar isso
 * com entrada deterministica: se um ULID aleatorio entrasse aqui, o teste de
 * "mesmo log -> mesmo estado byte-identico" passaria por acidente ou falharia
 * sem motivo. ULID de verdade so no emissor real (src/ids.ts).
 */
import { MM } from '../src/unidades.js';
import type { Evento } from '../src/eventos/tipos.js';
import type { PropriedadesEncaixe, TipoPonto, Vetor2 } from '../src/tipos.js';

export const TENANT = 'tenant-confeccao-01';
export const MODELO_ID = 'mod-0001';
export const PECA_ID = 'pec-0001';
export const AUTOR = 'modelista-teste';
export const AGORA = '2026-08-28T12:00:00.000Z';

export const ENCAIXE_PADRAO: PropriedadesEncaixe = {
  quantidadePorModelo: 1,
  giro: 'livre',
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

/** Envelope com tudo que o motor exige, para o teste so se preocupar com o payload. */
function envelope(indice: number, pecaId: string | null) {
  return {
    id: `evt-${String(indice).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO_ID,
    pecaId,
    timestamp: AGORA,
    autor: AUTOR,
    versaoSchema: 1,
  };
}

export interface OpcoesRetangulo {
  /** Largura em mm (eixo x). */
  readonly larguraMM: number;
  /** Altura em mm (eixo y). */
  readonly alturaMM: number;
  /** Margem de costura em mm, na ordem das arestas [baixo, direita, cima, esquerda]. */
  readonly margensMM: readonly [number, number, number, number];
  /** `true` gera o contorno em CW, para testar a normalizacao de winding (teste 18). */
  readonly sentidoHorario?: boolean;
}

/**
 * Log de eventos que monta um retangulo com uma aresta por lado.
 *
 * Vertices em CCW (Y-up): (0,0) -> (L,0) -> (L,A) -> (0,A).
 * Arestas: ar-baixo, ar-direita, ar-cima, ar-esquerda.
 */
export function logRetangulo(opcoes: OpcoesRetangulo): Evento[] {
  const L = Math.round(opcoes.larguraMM * MM);
  const A = Math.round(opcoes.alturaMM * MM);

  const cantosCCW: readonly Vetor2[] = [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: A },
    { x: 0, y: A },
  ];
  const arestasCCW = ['ar-baixo', 'ar-direita', 'ar-cima', 'ar-esquerda'] as const;

  // Em CW percorremos os mesmos cantos ao contrario. A margem continua colada na
  // mesma aresta fisica, para que o teste 18 compare geometria de corte identica.
  const horario = opcoes.sentidoHorario === true;
  const ordem = horario ? [0, 3, 2, 1] : [0, 1, 2, 3];
  const cantos = ordem.map((i) => cantosCCW[i]!);
  // Aresta i liga cantos[i] -> cantos[i+1]. Em CW isso e a aresta CCW de indice ordem[i+1].
  const arestasDoPercurso = ordem.map((_, i) =>
    horario ? arestasCCW[ordem[(i + 1) % 4]!]! : arestasCCW[i]!,
  );
  const margemDaAresta = new Map<string, number>(
    arestasCCW.map((nome, i) => [nome, Math.round(opcoes.margensMM[i]! * MM)]),
  );

  const eventos: Evento[] = [];
  let n = 0;

  eventos.push({
    ...envelope(n++, null),
    tipo: 'CriarModelo',
    payload: { nome: 'Modelo de teste', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'CriarPeca',
    payload: { nome: 'RETANGULO', encaixe: ENCAIXE_PADRAO },
  });

  const tipoPonto: TipoPonto = 'contorno';
  cantos.forEach((canto, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: canto.x, y: canto.y, tipo: tipoPonto },
    });
  });

  arestasDoPercurso.forEach((arestaId, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirAresta',
      payload: { arestaId, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
    });
  });

  arestasDoPercurso.forEach((arestaId, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % 4}`,
        tipo: 'reta',
      },
    });
  });

  arestasDoPercurso.forEach((arestaId) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirMargem',
      payload: { arestaId, margemUM: margemDaAresta.get(arestaId)! },
    });
  });

  return eventos;
}

/** Retangulo 100 x 200 mm com margem uniforme de 10 mm — a peca do teste 1. */
export function logRetanguloPadrao(sentidoHorario = false): Evento[] {
  return logRetangulo({
    larguraMM: 100,
    alturaMM: 200,
    margensMM: [10, 10, 10, 10],
    sentidoHorario,
  });
}

/**
 * Log que monta um poligono qualquer a partir de vertices em UM, com uma aresta
 * por lado e a mesma margem em todas. Usado pelos testes de entrada degenerada.
 */
export function logPoligonoLivre(vertices: readonly Vetor2[], margemUM: number): Evento[] {
  const eventos: Evento[] = [];
  let n = 0;

  eventos.push({
    ...envelope(n++, null),
    tipo: 'CriarModelo',
    payload: { nome: 'Modelo de teste', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'CriarPeca',
    payload: { nome: 'LIVRE', encaixe: ENCAIXE_PADRAO },
  });

  vertices.forEach((v, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
    });
  });
  vertices.forEach((_, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: `ar-${i}`,
        pontoInicioId: `pt-${i}`,
        pontoFimId: `pt-${(i + 1) % vertices.length}`,
      },
    });
  });
  vertices.forEach((_, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % vertices.length}`,
        tipo: 'reta',
      },
    });
  });
  vertices.forEach((_, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM },
    });
  });

  return eventos;
}

/** Ordena os vertices de um anel de forma canonica, para comparar geometria sem depender do inicio. */
export function anelCanonico(pontos: readonly Vetor2[]): string {
  return [...pontos]
    .map((p) => `${p.x},${p.y}`)
    .sort()
    .join(' ');
}

/** Constante de Bezier para aproximar arco de circulo: k = 4/3 * tan(theta/4) (D1). */
export const KAPPA_90 = (4 / 3) * Math.tan(Math.PI / 8);

/**
 * Log de uma peca em forma de "fatia de pizza": o quarto de circulo de raio R
 * como aresta CURVA, fechado por dois catetos retos ate a origem.
 *
 * Vertices (CCW, Y-up): (R,0) -> arco -> (0,R) -> (0,0) -> (R,0).
 * `ar-arco` tem comprimento analitico conhecido: pi*R/2.
 */
export function logQuartoDeCirculo(raioUM: number, margemUM = 0): Evento[] {
  const R = Math.round(raioUM);
  const K = Math.round(KAPPA_90 * R);
  const eventos: Evento[] = [];
  let n = 0;

  eventos.push({
    ...envelope(n++, null),
    tipo: 'CriarModelo',
    payload: { nome: 'Modelo de teste', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'CriarPeca',
    payload: { nome: 'FATIA', encaixe: ENCAIXE_PADRAO },
  });

  const vertices: readonly Vetor2[] = [
    { x: R, y: 0 },
    { x: 0, y: R },
    { x: 0, y: 0 },
  ];
  vertices.forEach((v, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
    });
  });

  const arestas = ['ar-arco', 'ar-vertical', 'ar-horizontal'] as const;
  arestas.forEach((arestaId, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirAresta',
      payload: { arestaId, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 3}` },
    });
  });

  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'DefinirSegmento',
    payload: {
      segmentoId: 'sg-0',
      arestaId: 'ar-arco',
      de: 'pt-0',
      para: 'pt-1',
      tipo: 'curva',
      controles: [
        { x: R, y: K },
        { x: K, y: R },
      ],
    },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'DefinirSegmento',
    payload: { segmentoId: 'sg-1', arestaId: 'ar-vertical', de: 'pt-1', para: 'pt-2', tipo: 'reta' },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'DefinirSegmento',
    payload: {
      segmentoId: 'sg-2',
      arestaId: 'ar-horizontal',
      de: 'pt-2',
      para: 'pt-0',
      tipo: 'reta',
    },
  });

  arestas.forEach((arestaId) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirMargem',
      payload: { arestaId, margemUM },
    });
  });

  return eventos;
}

/**
 * Log de uma peca com UMA aresta curva ASSIMETRICA — a curva em que `s` e `t`
 * divergem de verdade (teste 15). Fechada por retas ate a origem.
 */
export function logCurvaAssimetrica(controles: readonly [Vetor2, Vetor2], fim: Vetor2): Evento[] {
  const eventos: Evento[] = [];
  let n = 0;

  eventos.push({
    ...envelope(n++, null),
    tipo: 'CriarModelo',
    payload: { nome: 'Modelo de teste', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'CriarPeca',
    payload: { nome: 'ASSIMETRICA', encaixe: ENCAIXE_PADRAO },
  });

  const vertices: readonly Vetor2[] = [{ x: 0, y: 0 }, fim, { x: 0, y: fim.y }];
  vertices.forEach((v, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
    });
  });

  const arestas = ['ar-curva', 'ar-topo', 'ar-lado'] as const;
  arestas.forEach((arestaId, i) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirAresta',
      payload: { arestaId, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 3}` },
    });
  });

  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'DefinirSegmento',
    payload: {
      segmentoId: 'sg-0',
      arestaId: 'ar-curva',
      de: 'pt-0',
      para: 'pt-1',
      tipo: 'curva',
      controles,
    },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'DefinirSegmento',
    payload: { segmentoId: 'sg-1', arestaId: 'ar-topo', de: 'pt-1', para: 'pt-2', tipo: 'reta' },
  });
  eventos.push({
    ...envelope(n++, PECA_ID),
    tipo: 'DefinirSegmento',
    payload: { segmentoId: 'sg-2', arestaId: 'ar-lado', de: 'pt-2', para: 'pt-0', tipo: 'reta' },
  });

  arestas.forEach((arestaId) => {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'DefinirMargem',
      payload: { arestaId, margemUM: 0 },
    });
  });

  return eventos;
}

export interface EspecGradePoint {
  readonly gradePointId: string;
  readonly pontoId: string;
}

export interface EspecRegra {
  readonly regraId: string;
  readonly pontoGraduacaoId: string;
  readonly deTamanho: string;
  readonly paraTamanho: string;
  readonly dxMM: number;
  readonly dyMM: number;
}

/**
 * Acrescenta graduacao a um log ja montado.
 *
 * Grade point SEM regra e proposital nos fixtures: pela D7 ele fica parado e e
 * assim que a ancora da peca e declarada.
 */
export function comGraduacao(
  base: readonly Evento[],
  gradePoints: readonly EspecGradePoint[],
  regras: readonly EspecRegra[],
): Evento[] {
  const eventos = [...base];
  let n = base.length;

  for (const gp of gradePoints) {
    eventos.push({
      ...envelope(n++, PECA_ID),
      tipo: 'MarcarGradePoint',
      payload: { gradePointId: gp.gradePointId, pontoId: gp.pontoId },
    });
  }
  for (const regra of regras) {
    eventos.push({
      ...envelope(n++, null),
      tipo: 'DefinirRegraGraduacao',
      payload: {
        regraId: regra.regraId,
        pontoGraduacaoId: regra.pontoGraduacaoId,
        deTamanho: regra.deTamanho,
        paraTamanho: regra.paraTamanho,
        dx: Math.round(regra.dxMM * MM),
        dy: Math.round(regra.dyMM * MM),
      },
    });
  }
  return eventos;
}

/** A mesma regra nos dois passos da grade P-M-G. */
export function regraEmTodaAGrade(
  regraId: string,
  pontoGraduacaoId: string,
  dxMM: number,
  dyMM: number,
): EspecRegra[] {
  return [
    { regraId: `${regraId}-pm`, pontoGraduacaoId, deTamanho: 'P', paraTamanho: 'M', dxMM, dyMM },
    { regraId: `${regraId}-mg`, pontoGraduacaoId, deTamanho: 'M', paraTamanho: 'G', dxMM, dyMM },
  ];
}

export const PECA_FRENTE = 'pec-frente';
export const PECA_MANGA = 'pec-manga';
/** Quanto a manga fica deslocada da frente, para as duas nao se sobreporem. */
export const AFASTAMENTO_MANGA: number = 300 * MM;

/** Deslocamento por passo de tamanho de um extremo da cava, em mm. */
export interface SaltoMM {
  readonly dxMM: number;
  readonly dyMM: number;
}

export interface OpcoesCava {
  readonly raioMM: number;
  /**
   * Raio da cava da MANGA, se diferente do da frente. E assim que se monta uma
   * copa com embebido de verdade: a manga e um arco maior que a cava.
   */
  readonly raioMangaMM?: number;
  /** Salto do inicio e do fim da cava da FRENTE, por tamanho. */
  readonly frente: readonly [SaltoMM, SaltoMM];
  /** Salto do inicio e do fim da cava da MANGA. Igual ao da frente = costura casa. */
  readonly manga: readonly [SaltoMM, SaltoMM];
  /**
   * Embebido declarado no `ParCostura`: quanto a cava da MANGA deve ser maior que
   * a da FRENTE (D9). Zero em malha; 25 mm numa blusa de manga montada.
   */
  readonly embebidoMM?: number;
}

/**
 * Modelo com duas pecas — FRENTE e MANGA — cujas cavas sao a MESMA curva, uma
 * transladada da outra, declaradas como `ParCostura`.
 *
 * E o fixture do teste 5: se as duas cavas recebem os mesmos saltos de graduacao,
 * elas continuam com o mesmo comprimento em toda a grade; se recebem saltos
 * diferentes, `validarCasamento` tem que acusar.
 *
 * Cada peca e uma fatia de quarto de circulo: o arco e a cava, e dois catetos
 * retos fecham o contorno. O vertice do canto reto e grade point SEM regra — a
 * ancora (D7).
 */
export function logFrenteEManga(opcoes: OpcoesCava): Evento[] {
  const eventos: Evento[] = [];
  let n = 0;

  eventos.push({
    ...envelope(n++, null),
    tipo: 'CriarModelo',
    payload: { nome: 'Camisa de teste', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
  });

  const pecas = [
    { pecaId: PECA_FRENTE, nome: 'FRENTE', prefixo: 'f', deslocamentoX: 0, cava: 'ar-cava-frente' },
    {
      pecaId: PECA_MANGA,
      nome: 'MANGA',
      prefixo: 'm',
      deslocamentoX: AFASTAMENTO_MANGA,
      cava: 'ar-cava-manga',
    },
  ] as const;

  for (const peca of pecas) {
    const X = peca.deslocamentoX;
    const R = Math.round(
      (peca.pecaId === PECA_MANGA ? (opcoes.raioMangaMM ?? opcoes.raioMM) : opcoes.raioMM) * MM,
    );
    const K = Math.round(KAPPA_90 * R);
    eventos.push({
      ...envelope(n++, peca.pecaId),
      tipo: 'CriarPeca',
      payload: { nome: peca.nome, encaixe: ENCAIXE_PADRAO },
    });

    const vertices: readonly Vetor2[] = [
      { x: X + R, y: 0 },
      { x: X, y: R },
      { x: X, y: 0 },
    ];
    vertices.forEach((v, i) => {
      eventos.push({
        ...envelope(n++, peca.pecaId),
        tipo: 'CriarPonto',
        payload: { pontoId: `${peca.prefixo}-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
      });
    });

    const arestas = [peca.cava, `ar-${peca.prefixo}-vertical`, `ar-${peca.prefixo}-horizontal`];
    arestas.forEach((arestaId, i) => {
      eventos.push({
        ...envelope(n++, peca.pecaId),
        tipo: 'DefinirAresta',
        payload: {
          arestaId,
          pontoInicioId: `${peca.prefixo}-${i}`,
          pontoFimId: `${peca.prefixo}-${(i + 1) % 3}`,
        },
      });
    });

    eventos.push({
      ...envelope(n++, peca.pecaId),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${peca.prefixo}-0`,
        arestaId: peca.cava,
        de: `${peca.prefixo}-0`,
        para: `${peca.prefixo}-1`,
        tipo: 'curva',
        controles: [
          { x: X + R, y: K },
          { x: X + K, y: R },
        ],
      },
    });
    eventos.push({
      ...envelope(n++, peca.pecaId),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${peca.prefixo}-1`,
        arestaId: arestas[1]!,
        de: `${peca.prefixo}-1`,
        para: `${peca.prefixo}-2`,
        tipo: 'reta',
      },
    });
    eventos.push({
      ...envelope(n++, peca.pecaId),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${peca.prefixo}-2`,
        arestaId: arestas[2]!,
        de: `${peca.prefixo}-2`,
        para: `${peca.prefixo}-0`,
        tipo: 'reta',
      },
    });

    arestas.forEach((arestaId) => {
      eventos.push({
        ...envelope(n++, peca.pecaId),
        tipo: 'DefinirMargem',
        payload: { arestaId, margemUM: 10 * MM },
      });
    });

    // Os dois extremos da cava graduam; o canto reto e a ancora (grade point sem regra).
    [0, 1, 2].forEach((i) => {
      eventos.push({
        ...envelope(n++, peca.pecaId),
        tipo: 'MarcarGradePoint',
        payload: { gradePointId: `gp-${peca.prefixo}-${i}`, pontoId: `${peca.prefixo}-${i}` },
      });
    });
  }

  const saltos = [
    { prefixo: 'f', salto: opcoes.frente },
    { prefixo: 'm', salto: opcoes.manga },
  ] as const;
  for (const { prefixo, salto } of saltos) {
    salto.forEach((passo, i) => {
      for (const [de, para] of [
        ['P', 'M'],
        ['M', 'G'],
      ]) {
        eventos.push({
          ...envelope(n++, null),
          tipo: 'DefinirRegraGraduacao',
          payload: {
            regraId: `r-${prefixo}-${i}-${de}${para}`,
            pontoGraduacaoId: `gp-${prefixo}-${i}`,
            deTamanho: de!,
            paraTamanho: para!,
            dx: Math.round(passo.dxMM * MM),
            dy: Math.round(passo.dyMM * MM),
          },
        });
      }
    });
  }

  eventos.push({
    ...envelope(n++, null),
    tipo: 'DefinirParCostura',
    payload: {
      parId: 'par-cava',
      arestaA: 'ar-cava-frente',
      arestaB: 'ar-cava-manga',
      embebidoUM: Math.round((opcoes.embebidoMM ?? 0) * MM),
    },
  });

  return eventos;
}
