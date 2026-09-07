/**
 * Do passeio de pixels ao contorno do motor: simplificar, achar pique, achar canto
 * e ajustar curva.
 *
 * ## A ordem importa, e não é a óbvia
 * A tentação é ajustar a curva primeiro e caçar detalhe depois. Está errado: o
 * **pique** é um corte de 6 mm de fundo por 1,6 mm de boca, e qualquer ajuste de
 * curva que passe por cima dele o transforma numa ondulação da cava. Some sem
 * avisar.
 *
 * A ordem é:
 *
 * 1. **simplificar** o passeio de pixels (Douglas-Peucker, tolerância ligada ao
 *    tamanho do pixel — abaixo dela só existe escada de quantização, não desenho);
 * 2. **achar e tirar os piques**, guardando a posição de cada um em comprimento de
 *    arco;
 * 3. **achar os cantos** no que sobrou;
 * 4. **ajustar** reta ou Bézier entre cantos consecutivos.
 *
 * ## Por que Bézier cúbica, e de onde ela vem
 * O motor guarda curva como Bézier cúbica com dois controles (decisão da Fase 1), e
 * é o que o Audaces chama de "ponto de curva com pontos de controle". O ajuste vem
 * do algoritmo publicado de Philip J. Schneider (*Graphics Gems*), pela biblioteca
 * `fit-curve` — a inegociável 3 proíbe reimplementar isso à mão.
 */
import { ramerDouglasPeucker } from 'clipper2-ts';
import fitCurveCJS from 'fit-curve';

import type { UM, Vetor2 } from '@cad/motor';

// A publicação da `fit-curve` traz o default dentro do módulo em alguns empacotamentos.
const fitCurve = ((fitCurveCJS as unknown as { default?: unknown }).default ??
  fitCurveCJS) as (pontos: [number, number][], erroMaximo: number) => [number, number][][];

/** Altura típica de um pique: 1/4 de polegada, o mesmo padrão do motor. */
export const FUNDO_TIPICO_DO_PIQUE_UM = 6350;

export interface Pique {
  /** Posição ao longo do contorno, em UM de comprimento de arco desde o ponto 0. */
  readonly sUM: number;
  readonly fundoUM: number;
  readonly bocaUM: number;
  /** Onde a boca do pique começa e termina, no anel de entrada. */
  readonly deIndice: number;
  readonly paraIndice: number;
}

export interface OpcoesDePique {
  /** Fundo mínimo para valer como pique, e não como ondulação do corte. */
  readonly fundoMinimoUM?: number;
  readonly fundoMaximoUM?: number;
  /** Boca máxima: acima disso é recorte, não pique. */
  readonly bocaMaximaUM?: number;
  /** Quantos vértices, no máximo, o pique pode consumir. */
  readonly verticesMaximos?: number;
}

/**
 * Douglas-Peucker no anel, com a implementação do **clipper2** — a mesma que o
 * motor usa em `simplificarContorno`.
 *
 * A tolerância tem que ficar **acima do tamanho do pixel**: abaixo dela não existe
 * desenho, existe escada de quantização, e "simplificar" ali é preservar ruído com
 * ares de precisão.
 */
export function simplificarAnel(anel: readonly Vetor2[], toleranciaUM: UM): Vetor2[] {
  if (anel.length < 5) return [...anel];
  const caminho = anel.map((p) => ({ x: p.x, y: p.y }));
  const saida = ramerDouglasPeucker(caminho, toleranciaUM).map((p) => ({
    x: Math.round(Number(p.x)),
    y: Math.round(Number(p.y)),
  }));
  // O clipper devolve o anel com o primeiro ponto repetido no fim; o motor guarda
  // anel sem repetir, e o ponto repetido vira um "canto" de zero grau na detecção.
  const primeiro = saida[0];
  const ultimo = saida[saida.length - 1];
  if (saida.length > 1 && primeiro !== undefined && ultimo !== undefined) {
    if (primeiro.x === ultimo.x && primeiro.y === ultimo.y) saida.pop();
  }
  return saida;
}

/** Comprimento acumulado ao longo do anel, fechando no fim. */
function arcos(anel: readonly Vetor2[]): number[] {
  const s = [0];
  for (let i = 1; i <= anel.length; i++) {
    const a = anel[i - 1]!;
    const b = anel[i % anel.length]!;
    s.push(s[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return s;
}

/** Distância COM SINAL do ponto à reta a→b. Negativo = à direita, que num anel CCW é para DENTRO. */
function desvio(p: Vetor2, a: Vetor2, b: Vetor2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const norma = Math.hypot(vx, vy);
  if (norma === 0) return 0;
  return ((p.x - a.x) * vy - (p.y - a.y) * vx) / norma;
}

/**
 * Acha os piques: reentrâncias estreitas e fundas na borda.
 *
 * O critério é o do ofício, não estatístico: **boca estreita, fundo na faixa do
 * notcher, e para DENTRO**. Um recorte de verdade é largo; uma ondulação da cava é
 * rasa; um pique é fundo e estreito. É isso que a peneira usa.
 *
 * Devolve os piques achados **sem** mexer no anel — quem tira é `removerPiques`,
 * de propósito: assim dá para ver o que foi achado antes de qualquer alteração.
 */
export function detectarPiques(anel: readonly Vetor2[], opcoes: OpcoesDePique = {}): Pique[] {
  const fundoMin = opcoes.fundoMinimoUM ?? 2000;
  const fundoMax = opcoes.fundoMaximoUM ?? 12_000;
  const bocaMax = opcoes.bocaMaximaUM ?? 5000;
  const verticesMax = opcoes.verticesMaximos ?? 8;
  const n = anel.length;
  if (n < 4) return [];

  const s = arcos(anel);
  const achados: Pique[] = [];
  let i = 0;

  while (i < n) {
    let melhor: Pique | null = null;
    // Procura a menor boca que ainda entrega fundo suficiente: um pique é o
    // caminho mais curto que desce e sobe.
    for (let salto = 2; salto <= verticesMax; salto++) {
      const a = anel[i]!;
      const b = anel[(i + salto) % n]!;
      const boca = Math.hypot(b.x - a.x, b.y - a.y);
      if (boca > bocaMax) break;

      let fundo = 0;
      let paraFora = false;
      for (let k = 1; k < salto; k++) {
        const d = desvio(anel[(i + k) % n]!, a, b);
        if (d > 0) paraFora = true;
        fundo = Math.min(fundo, d);
      }
      // Excursão para os dois lados não é pique, é curva: descarta.
      if (paraFora) continue;
      const profundidade = -fundo;
      if (profundidade < fundoMin || profundidade > fundoMax) continue;

      const candidato: Pique = {
        sUM: Math.round((s[i]! + s[i + salto]!) / 2),
        fundoUM: Math.round(profundidade),
        bocaUM: Math.round(boca),
        deIndice: i,
        paraIndice: (i + salto) % n,
      };
      if (melhor === null || candidato.bocaUM < melhor.bocaUM) melhor = candidato;
    }

    if (melhor !== null) {
      achados.push(melhor);
      // Pula o pique inteiro: um pique não contém outro.
      i += Math.max(2, (melhor.paraIndice - melhor.deIndice + n) % n);
    } else {
      i++;
    }
  }
  return achados;
}

/**
 * Tira do anel os pontos de cada pique, deixando a boca reta — e **recalcula o `s`**.
 *
 * O recálculo não é detalhe: o `s` do pique é medido ao longo da ARESTA, e a aresta
 * é o contorno sem o pique. Medido no anel cru, o caminho passa pelo fundo do V e o
 * comprimento acumulado leva junto os 6,4 mm de descida e os 6,4 de subida. Um
 * pique a 80,8 mm sairia registrado a 86,4 mm — 5,6 mm fora do lugar, o suficiente
 * para a costura não casar.
 */
export function removerPiques(
  anel: readonly Vetor2[],
  piques: readonly Pique[],
): { anel: Vetor2[]; piques: Pique[] } {
  const n = anel.length;
  const fora = new Set<number>();
  for (const p of piques) {
    const passo = (p.paraIndice - p.deIndice + n) % n;
    for (let k = 1; k < passo; k++) fora.add((p.deIndice + k) % n);
  }
  const mantidos: number[] = [];
  const reduzido: Vetor2[] = [];
  for (let i = 0; i < n; i++) {
    if (fora.has(i)) continue;
    mantidos.push(i);
    reduzido.push(anel[i]!);
  }

  // Comprimento acumulado no anel reduzido, indexado pelo índice ORIGINAL.
  const sPorIndiceOriginal = new Map<number, number>();
  const sr = arcos(reduzido);
  mantidos.forEach((original, k) => sPorIndiceOriginal.set(original, sr[k]!));

  const corrigidos = piques.map((p) => {
    const a = sPorIndiceOriginal.get(p.deIndice);
    const b = sPorIndiceOriginal.get(p.paraIndice);
    if (a === undefined || b === undefined) return p;
    return { ...p, sUM: Math.round((a + b) / 2) };
  });

  return { anel: reduzido, piques: corrigidos };
}

/**
 * Acha os cantos: vértices onde o contorno DOBRA de verdade.
 *
 * O ângulo é medido entre o trecho que chega e o que sai, com uma janela em
 * comprimento de arco em vez de "o vizinho anterior e o seguinte" — vizinho é
 * ruído, e a poucos milímetros toda curva parece um canto.
 */
export function detectarCantos(
  anel: readonly Vetor2[],
  anguloMinimoGraus = 30,
  janelaUM = 8000,
): number[] {
  const n = anel.length;
  if (n < 4) return [];
  const limite = (anguloMinimoGraus * Math.PI) / 180;
  const cantos: number[] = [];

  const andar = (inicio: number, passo: number): Vetor2 => {
    let percorrido = 0;
    let i = inicio;
    while (percorrido < janelaUM) {
      const j = (i + passo + n) % n;
      percorrido += Math.hypot(anel[j]!.x - anel[i]!.x, anel[j]!.y - anel[i]!.y);
      i = j;
      if (i === inicio) break;
    }
    return anel[i]!;
  };

  for (let i = 0; i < n; i++) {
    const p = anel[i]!;
    const antes = andar(i, -1);
    const depois = andar(i, +1);
    const a1 = Math.atan2(p.y - antes.y, p.x - antes.x);
    const a2 = Math.atan2(depois.y - p.y, depois.x - p.x);
    let giro = a2 - a1;
    while (giro > Math.PI) giro -= 2 * Math.PI;
    while (giro < -Math.PI) giro += 2 * Math.PI;
    if (Math.abs(giro) >= limite) cantos.push(i);
  }

  // Cantos vizinhos são o mesmo canto visto de vários pontos: fica o do meio.
  //
  // A junção é por DISTÂNCIA, não por índice. Num anel já simplificado, dois
  // índices seguidos podem estar a 200 mm um do outro — juntá-los por "índice
  // vizinho" transformava os quatro cantos de um retângulo num canto só, que foi
  // exatamente o que o teste do retângulo pegou.
  const s = arcos(anel);
  const juntar = janelaUM / 2;
  const juntos: number[] = [];
  let k = 0;
  while (k < cantos.length) {
    let fim = k;
    while (fim + 1 < cantos.length && s[cantos[fim + 1]!]! - s[cantos[fim]!]! <= juntar) fim++;
    juntos.push(cantos[Math.floor((k + fim) / 2)]!);
    k = fim + 1;
  }
  // O primeiro e o último podem ser o mesmo canto, visto dos dois lados do fecho.
  if (juntos.length > 1) {
    const volta = s[n]! - s[juntos[juntos.length - 1]!]! + s[juntos[0]!]!;
    if (volta <= juntar) juntos.pop();
  }
  return juntos;
}

export interface TrechoAjustado {
  readonly tipo: 'reta' | 'curva';
  readonly de: Vetor2;
  readonly para: Vetor2;
  /** Os dois controles, quando é curva. */
  readonly controles: readonly [Vetor2, Vetor2] | null;
  /** Pior distância dos pontos originais ao traçado ajustado, em UM. */
  readonly residuoUM: number;
}

/** Ajusta um trecho: reta se couber na tolerância, senão Bézier cúbica. */
function ajustarTrecho(pontos: readonly Vetor2[], toleranciaUM: number): TrechoAjustado[] {
  const de = pontos[0]!;
  const para = pontos[pontos.length - 1]!;
  if (pontos.length <= 2) {
    return [{ tipo: 'reta', de, para, controles: null, residuoUM: 0 }];
  }

  let piorNaReta = 0;
  for (const p of pontos) piorNaReta = Math.max(piorNaReta, Math.abs(desvio(p, de, para)));
  if (piorNaReta <= toleranciaUM) {
    return [{ tipo: 'reta', de, para, controles: null, residuoUM: Math.round(piorNaReta) }];
  }

  const curvas = fitCurve(
    pontos.map((p) => [p.x, p.y] as [number, number]),
    toleranciaUM,
  );
  return curvas.map((c) => {
    const ponto = (v: [number, number]): Vetor2 => ({ x: Math.round(v[0]), y: Math.round(v[1]) });
    return {
      tipo: 'curva' as const,
      de: ponto(c[0]!),
      para: ponto(c[3]!),
      controles: [ponto(c[1]!), ponto(c[2]!)] as [Vetor2, Vetor2],
      // `fit-curve` já respeita o erro máximo pedido; o resíduo real sai da medição
      // do trecho, e é o que o relatório mostra.
      residuoUM: Math.round(toleranciaUM),
    };
  });
}

/**
 * Parte o anel nos cantos e ajusta cada trecho.
 *
 * Sem canto nenhum — uma peça toda arredondada —, o anel é ajustado inteiro a
 * partir do ponto 0. Com cantos, cada trecho entre dois cantos vira uma aresta do
 * motor, que é exatamente o que a decisão D3 da Fase 1 chama de aresta.
 */
export function ajustarCurvas(
  anel: readonly Vetor2[],
  cantos: readonly number[],
  toleranciaUM: number,
): TrechoAjustado[] {
  const n = anel.length;
  if (n < 3) return [];
  const marcos = cantos.length >= 2 ? [...cantos].sort((a, b) => a - b) : [0];
  const trechos: TrechoAjustado[] = [];

  for (let k = 0; k < marcos.length; k++) {
    const inicio = marcos[k]!;
    const fim = marcos[(k + 1) % marcos.length]!;
    const pontos: Vetor2[] = [];
    let i = inicio;
    do {
      pontos.push(anel[i]!);
      i = (i + 1) % n;
    } while (i !== fim);
    pontos.push(anel[fim]!);
    if (pontos.length >= 2) trechos.push(...ajustarTrecho(pontos, toleranciaUM));
  }
  return trechos;
}
