/**
 * Campo de deslocamento: mover pontos do contorno levando a curva junto.
 *
 * Compartilhado pela graduacao (Bloco 5) e pela edicao de ponto (Bloco 7), que
 * fazem a MESMA coisa depois de decidir quanto cada ponto anda — o que muda entre
 * as duas e so como o deslocamento de cada ponto e calculado.
 *
 * ## Por que os controles da Bezier andam 1/3 e 2/3
 * Se os extremos de um segmento andam `d0` e `d3`, o campo de deslocamento dentro
 * do segmento e linear em `t`: `D(t) = (1-t)·d0 + t·d3`. Escrevendo `D` na base de
 * Bernstein cubica, os coeficientes sao `d0`, `d0 + (d3-d0)/3`, `d0 + 2(d3-d0)/3`,
 * `d3`. Como a soma de duas cubicas de Bezier e outra cubica de Bezier com os
 * pontos de controle somados, a curva deslocada e EXATAMENTE:
 *
 *     P0 + d0,  C1 + d0 + (d3-d0)/3,  C2 + d0 + 2(d3-d0)/3,  P3 + d3
 *
 * Nada de reamostrar a curva e reajustar controles por aproximacao: o resultado e
 * exato, e por isso duas curvas congruentes que recebem os mesmos deslocamentos
 * continuam com o mesmo comprimento (e o que sustenta o casamento sob graduacao).
 */
import type { Id, Peca, Ponto, Segmento, Vetor2 } from '../tipos.js';

/**
 * Deslocamento em UM de ponto flutuante.
 *
 * Fracionario de proposito: tanto a interpolacao da graduacao quanto o decaimento
 * do modo proporcional produzem fracao de micrometro. Arredondar antes de somar a
 * coordenada acumularia erro; o arredondamento acontece uma vez so, no fim.
 */
export interface Deslocamento {
  readonly dx: number;
  readonly dy: number;
}

export const PARADO: Deslocamento = { dx: 0, dy: 0 };

/**
 * Aplica o campo de deslocamento aos pontos e aos controles das Bezier.
 * Nao muta a entrada. Ponto que nao esta no mapa fica exatamente onde estava.
 */
export function aplicarDeslocamentos(
  peca: Peca,
  porPonto: ReadonlyMap<Id, Deslocamento>,
): Peca {
  const pontos: Record<Id, Ponto> = {};
  for (const [id, ponto] of Object.entries(peca.pontos)) {
    const deslocamento = porPonto.get(id);
    pontos[id] =
      deslocamento === undefined
        ? ponto
        : {
            ...ponto,
            x: Math.round(ponto.x + deslocamento.dx),
            y: Math.round(ponto.y + deslocamento.dy),
          };
  }

  const segmentos: Record<Id, Segmento> = {};
  for (const [id, segmento] of Object.entries(peca.segmentos)) {
    if (segmento.controles === undefined) {
      segmentos[id] = segmento;
      continue;
    }
    const noInicio = porPonto.get(segmento.de) ?? PARADO;
    const noFim = porPonto.get(segmento.para) ?? PARADO;
    segmentos[id] = {
      ...segmento,
      controles: [
        moverControle(segmento.controles[0], noInicio, noFim, 1 / 3),
        moverControle(segmento.controles[1], noInicio, noFim, 2 / 3),
      ],
    };
  }

  return { ...peca, pontos, segmentos };
}

/** Ids dos pontos do contorno, na ordem do percurso. */
export function verticesDoContorno(peca: Peca): Id[] {
  return peca.contorno.map((segmentoId) => peca.segmentos[segmentoId]!.de);
}

function moverControle(
  controle: Vetor2,
  noInicio: Deslocamento,
  noFim: Deslocamento,
  fracao: number,
): Vetor2 {
  return {
    x: Math.round(controle.x + noInicio.dx + (noFim.dx - noInicio.dx) * fracao),
    y: Math.round(controle.y + noInicio.dy + (noFim.dy - noInicio.dy) * fracao),
  };
}
