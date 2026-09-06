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

/**
 * O ponto esta DENTRO do anel? Lancamento de raio, com contagem de cruzamentos.
 *
 * Mora no motor, e nao no editor, porque e conta geometrica: a Fase 2 precisa dela
 * para saber que peca o cursor esta apontando, e a Fase 5 vai precisar para o
 * encaixe. Duplicar a conta em dois lugares e como duas trenas com marcacao
 * diferente.
 *
 * O raio sai para +x. A regra `(a.y > y) !== (b.y > y)` conta cada aresta uma vez
 * so mesmo quando o raio passa exatamente por um vertice — e a formulacao classica,
 * e e ela que evita contar duas vezes e concluir "fora" de um ponto que esta dentro.
 * Ponto exatamente em cima da borda e caso ambiguo por natureza; aqui ele conta como
 * DENTRO, que e o que o cursor de um CAD espera ao encostar na linha.
 */
export function contemPonto(anel: readonly Vetor2[], ponto: Vetor2): boolean {
  const { x, y } = ponto;
  let dentro = false;

  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const a = anel[i]!;
    const b = anel[j]!;

    // Em cima da borda: decide antes, para nao depender da paridade.
    if (naCorda(a, b, ponto)) return true;

    if (a.y > y !== b.y > y) {
      const cruzamentoX = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (x < cruzamentoX) dentro = !dentro;
    }
  }
  return dentro;
}

/** O ponto esta em cima do trecho [a, b]? Colinear E entre os dois extremos. */
function naCorda(a: Vetor2, b: Vetor2, p: Vetor2): boolean {
  const produtoVetorial = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (produtoVetorial !== 0) return false;
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}
