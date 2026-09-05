/**
 * Anel de pontos: a forma achatada do contorno, pronta para o clipper2.
 *
 * O anel e fechado por construcao — o primeiro ponto NAO e repetido no fim.
 * Convencao Y-up (D4).
 */
import { exigir } from '../erros.js';
import type { Peca, Vetor2 } from '../tipos.js';
import { TOLERANCIA_TESSELACAO_UM, type UM } from '../unidades.js';
import { tesselarContorno } from './tesselar.js';

/**
 * Area com sinal pela formula do shoelace, em UM^2.
 * Positiva = CCW, negativa = CW. E a fonte de verdade do winding (D4).
 */
export function areaComSinal(anel: readonly Vetor2[]): number {
  if (anel.length < 3) return 0;
  let dobro = 0;
  for (let i = 0; i < anel.length; i++) {
    const atual = anel[i]!;
    const proximo = anel[(i + 1) % anel.length]!;
    dobro += atual.x * proximo.y - proximo.x * atual.y;
  }
  return dobro / 2;
}

/** Area absoluta em UM^2. */
export function area(anel: readonly Vetor2[]): number {
  return Math.abs(areaComSinal(anel));
}

/** True quando o anel esta em CCW (area com sinal positiva). */
export function ehCCW(anel: readonly Vetor2[]): boolean {
  return areaComSinal(anel) > 0;
}

/**
 * Anel de vertices da LINHA DE COSTURA da peca, ja tesselado, em UM inteiro.
 *
 * Delega a caminhada e a validacao (continuidade, fechamento, segmento de
 * comprimento zero) a `tesselarContorno` e acrescenta a unica checagem que e
 * de anel, nao de contorno: area diferente de zero.
 */
export function anelDoContorno(peca: Peca, toleranciaUM: UM = TOLERANCIA_TESSELACAO_UM): Vetor2[] {
  const anel = tesselarContorno(peca, toleranciaUM);

  exigir(
    area(anel) > 0,
    'AREA_ZERO',
    `O contorno da peca "${peca.metadados.nome}" tem area zero (pontos colineares).`,
    { pecaId: peca.id },
  );

  return anel;
}
