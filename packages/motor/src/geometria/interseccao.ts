/**
 * Cruzamento de dois trechos de reta.
 *
 * Mora no motor, e nao no editor, pela mesma razao de `contemPonto`: e conta
 * geometrica, e ja ha tres lugares querendo ela — o snap de intersecao, a selecao
 * por cruzamento e, na Fase 5, o encaixe. Tres copias da mesma conta e tres
 * oportunidades de divergir por um micrometro.
 */
import type { Vetor2 } from '../tipos.js';

/**
 * Ponto em que [a1, b1] cruza [a2, b2], ou `null`.
 *
 * Devolve `null` tambem para trechos PARALELOS, colineares inclusive: dois trechos
 * em cima um do outro se tocam em infinitos pontos, e devolver um deles seria
 * escolher arbitrariamente. Quem precisa desse caso trata sobreposicao, nao
 * cruzamento.
 *
 * O cruzamento e arredondado para UM inteiro, como manda a D1.
 */
export function cruzarSegmentos(
  a1: Vetor2,
  b1: Vetor2,
  a2: Vetor2,
  b2: Vetor2,
): Vetor2 | null {
  const d1x = b1.x - a1.x;
  const d1y = b1.y - a1.y;
  const d2x = b2.x - a2.x;
  const d2y = b2.y - a2.y;

  const denominador = d1x * d2y - d1y * d2x;
  if (denominador === 0) return null;

  const wx = a2.x - a1.x;
  const wy = a2.y - a1.y;
  const t = (wx * d2y - wy * d2x) / denominador;
  const u = (wx * d1y - wy * d1x) / denominador;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: Math.round(a1.x + d1x * t), y: Math.round(a1.y + d1y * t) };
}

/** Os dois trechos se cruzam? Mesma conta, sem alocar o ponto. */
export function seCruzam(a1: Vetor2, b1: Vetor2, a2: Vetor2, b2: Vetor2): boolean {
  return cruzarSegmentos(a1, b1, a2, b2) !== null;
}
