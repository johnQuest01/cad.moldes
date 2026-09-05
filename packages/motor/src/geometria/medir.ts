/**
 * Medicao (Parte 2, operacao 3) e ancoragem por comprimento de arco.
 *
 * Bezier nao tem comprimento em forma fechada. Conforme a Parte 2: SOMA-SE O
 * TESSELADO e faz-se busca binaria na tabela de comprimento acumulado para
 * converter `s -> ponto`.
 *
 * ## Por que a tabela e a fonte unica de verdade
 * O `s` do Pique e posicao normalizada por COMPRIMENTO DE ARCO (0..1), nunca o
 * `t` de Bezier: em curva, `t = 0,5` NAO e o meio da curva. Medir por um caminho
 * (Gauss-Legendre do verb, por exemplo) e posicionar o pique por outro faria o
 * pique cair em lugar diferente do que a medida diz. Aqui os dois saem da MESMA
 * poligonal — o pique cai exatamente onde a fita metrica do motor marca.
 *
 * O comprimento somado em cordas SUBESTIMA o arco (corda < arco). Com sagita
 * limitada a 100 UM o desvio medido em curva real fica na casa de 1e-2 UM; o
 * numero conferido esta no teste 3.
 */
import { exigir } from '../erros.js';
import type { Id, Peca, Vetor2 } from '../tipos.js';
import { TOLERANCIA_MEDICAO_UM, type UM } from '../unidades.js';
import { segmentosDaAresta } from './aresta.js';
import { tesselarSegmento } from './tesselar.js';

/**
 * Tabela de comprimento de arco acumulado de uma aresta.
 * `acumulado[i]` e o comprimento da poligonal do inicio ate `pontos[i]`, em UM
 * de ponto flutuante — arredondar aqui perderia a resolucao que sustenta o `s`.
 */
export interface TabelaArco {
  readonly pontos: readonly Vetor2[];
  readonly acumulado: readonly number[];
  readonly comprimento: number;
}

/** Monta a tabela de comprimento acumulado da aresta inteira. */
export function tabelaArcoDaAresta(
  peca: Peca,
  arestaId: Id,
  toleranciaUM: UM = TOLERANCIA_MEDICAO_UM,
): TabelaArco {
  const segmentos = segmentosDaAresta(peca, arestaId);
  const pontos: Vetor2[] = [];

  for (const segmento of segmentos) {
    const trecho = tesselarSegmento(peca, segmento.id, toleranciaUM);
    // O primeiro ponto do segmento e o ultimo do anterior: entra uma vez so.
    for (let i = pontos.length === 0 ? 0 : 1; i < trecho.length; i++) pontos.push(trecho[i]!);
  }

  const acumulado: number[] = [0];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]!;
    const b = pontos[i]!;
    acumulado.push(acumulado[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }

  const comprimento = acumulado[acumulado.length - 1]!;
  exigir(
    comprimento > 0,
    'ARESTA_COMPRIMENTO_ZERO',
    `A aresta "${arestaId}" da peca "${peca.metadados.nome}" tem comprimento zero. ` +
      `Nao da para ancorar pique nem aplicar margem nela.`,
    { pecaId: peca.id, arestaId },
  );

  return { pontos, acumulado, comprimento };
}

/** Comprimento da aresta em UM inteiro (reta ou curva). Parte 2, operacao 3. */
export function medirAresta(peca: Peca, arestaId: Id): UM {
  return Math.round(tabelaArcoDaAresta(peca, arestaId).comprimento);
}

/** Comprimento de um unico segmento em UM inteiro. */
export function medirSegmento(
  peca: Peca,
  segmentoId: Id,
  toleranciaUM: UM = TOLERANCIA_MEDICAO_UM,
): UM {
  const pontos = tesselarSegmento(peca, segmentoId, toleranciaUM);
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]!;
    const b = pontos[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return Math.round(total);
}

/**
 * Ponto da aresta na posicao `s` (0..1) medida por COMPRIMENTO DE ARCO.
 * `s = 0` devolve o ponto inicial e `s = 1` o final, exatos.
 */
export function pontoEmS(peca: Peca, arestaId: Id, s: number): Vetor2 {
  const tabela = tabelaArcoDaAresta(peca, arestaId);
  return pontoNaTabela(tabela, s, arestaId);
}

/** Mesma conta de `pontoEmS`, para quem ja tem a tabela na mao (evita re-tesselar). */
export function pontoNaTabela(tabela: TabelaArco, s: number, arestaId: Id): Vetor2 {
  exigir(
    Number.isFinite(s) && s >= 0 && s <= 1,
    'S_FORA_DA_FAIXA',
    `A posicao s = ${String(s)} da aresta "${arestaId}" esta fora de [0, 1]. ` +
      `s e fracao do comprimento de arco, nao coordenada nem parametro de Bezier.`,
    { arestaId, s },
  );

  const { pontos, acumulado, comprimento } = tabela;
  if (s === 0) return pontos[0]!;
  if (s === 1) return pontos[pontos.length - 1]!;

  const alvo = s * comprimento;

  // Busca binaria: maior i com acumulado[i] <= alvo.
  let baixo = 0;
  let alto = acumulado.length - 1;
  while (alto - baixo > 1) {
    const meio = (baixo + alto) >> 1;
    if (acumulado[meio]! <= alvo) baixo = meio;
    else alto = meio;
  }

  const a = pontos[baixo]!;
  const b = pontos[baixo + 1]!;
  const cordaInicio = acumulado[baixo]!;
  const corda = acumulado[baixo + 1]! - cordaInicio;
  const fracao = corda === 0 ? 0 : (alvo - cordaInicio) / corda;
  return {
    x: Math.round(a.x + (b.x - a.x) * fracao),
    y: Math.round(a.y + (b.y - a.y) * fracao),
  };
}
