/**
 * Transformacoes rigidas da peca (Parte 2, operacao 5): espelhar, rotacionar,
 * transladar. O espelhamento aceita EIXO ARBITRARIO — horizontal e vertical sao
 * casos particulares dele, nao operacoes separadas.
 *
 * ## Por que os controles da Bezier sao transformados direto
 * Bezier e invariante afim: transformar os quatro pontos de controle e o mesmo que
 * transformar cada ponto da curva. Nao ha o que reamostrar nem aproximar — ao
 * contrario da graduacao e da edicao de ponto, onde o deslocamento varia ao longo
 * do contorno e por isso passa pelo campo linear de `geometria/deslocar.ts`.
 *
 * ## Espelhar inverte o winding
 * Reflexao troca a orientacao: um contorno CCW vira CW. Como a D4 exige CCW no
 * nucleo, `espelharPeca` renormaliza no fim — o que tambem reflete o `s` dos
 * piques (s -> 1 - s), porque a aresta passou a ser percorrida ao contrario.
 *
 * ## O arredondamento
 * Rotacao e reflexao em eixo obliquo levam inteiro para nao-inteiro, e o nucleo e
 * inteiro (inegociavel 1). Cada ponto e arredondado uma vez, entao o erro por
 * ponto fica em ate 0,71 UM e NAO se acumula: a transformacao e aplicada sempre
 * sobre as coordenadas originais, nunca sobre o resultado da anterior.
 */
import { exigir } from './erros.js';
import type { Id, Peca, Ponto, Segmento, Vetor2 } from './tipos.js';
import { exigirUM, type UM } from './unidades.js';
import { normalizarWinding } from './geometria/winding.js';

/** Eixo arbitrario dado por dois pontos distintos. */
export interface Eixo {
  readonly p1: Vetor2;
  readonly p2: Vetor2;
}

/** Move a peca inteira por um delta. Nao muta a entrada. */
export function transladarPeca(peca: Peca, dx: UM, dy: UM): Peca {
  const deltaX = exigirUM(dx, 'dx de transladarPeca');
  const deltaY = exigirUM(dy, 'dy de transladarPeca');
  // Translacao por inteiro nao arredonda nada e nao mexe no winding.
  return transformar(peca, (p) => ({ x: p.x + deltaX, y: p.y + deltaY }));
}

/** Gira a peca em torno de um centro. Angulo em graus, positivo = anti-horario (Y-up). */
export function rotacionarPeca(peca: Peca, centro: Vetor2, anguloGraus: number): Peca {
  exigir(
    Number.isFinite(anguloGraus),
    'VALOR_NAO_FINITO',
    `O angulo de rotacao precisa ser finito; recebi ${String(anguloGraus)}.`,
    { pecaId: peca.id, anguloGraus },
  );
  const radianos = (anguloGraus * Math.PI) / 180;
  const cosseno = Math.cos(radianos);
  const seno = Math.sin(radianos);
  return transformar(peca, (p) => {
    const dx = p.x - centro.x;
    const dy = p.y - centro.y;
    return {
      x: Math.round(centro.x + dx * cosseno - dy * seno),
      y: Math.round(centro.y + dx * seno + dy * cosseno),
    };
  });
}

/**
 * Espelha a peca num eixo arbitrario e renormaliza o winding para CCW (D4).
 *
 * Reflexao de `P` no eixo que passa por `A` com direcao unitaria `d`:
 *
 *     v = P - A;   P' = A + 2*(v . d)*d - v
 */
export function espelharPeca(peca: Peca, eixo: Eixo): Peca {
  const direcao = direcaoDoEixo(eixo, peca.id);
  const espelhada = transformar(peca, (p) => {
    const vx = p.x - eixo.p1.x;
    const vy = p.y - eixo.p1.y;
    const projecao = vx * direcao.x + vy * direcao.y;
    return {
      x: Math.round(eixo.p1.x + 2 * projecao * direcao.x - vx),
      y: Math.round(eixo.p1.y + 2 * projecao * direcao.y - vy),
    };
  });
  return normalizarWinding(espelhada);
}

/** Reflete um ponto solto no eixo, sem passar pela peca. Usado pela dobra. */
export function refletirPonto(ponto: Vetor2, eixo: Eixo, direcao: Vetor2Flutuante): Vetor2 {
  const vx = ponto.x - eixo.p1.x;
  const vy = ponto.y - eixo.p1.y;
  const projecao = vx * direcao.x + vy * direcao.y;
  return {
    x: Math.round(eixo.p1.x + 2 * projecao * direcao.x - vx),
    y: Math.round(eixo.p1.y + 2 * projecao * direcao.y - vy),
  };
}

export interface Vetor2Flutuante {
  readonly x: number;
  readonly y: number;
}

/** Direcao unitaria do eixo. Estoura se os dois pontos forem o mesmo. */
export function direcaoDoEixo(eixo: Eixo, pecaId: Id): Vetor2Flutuante {
  const dx = eixo.p2.x - eixo.p1.x;
  const dy = eixo.p2.y - eixo.p1.y;
  const comprimento = Math.hypot(dx, dy);
  exigir(
    comprimento > 0,
    'EIXO_DEGENERADO',
    `O eixo dado por (${eixo.p1.x}, ${eixo.p1.y}) e (${eixo.p2.x}, ${eixo.p2.y}) tem os dois ` +
      `pontos na mesma coordenada; nao define direcao.`,
    { pecaId, eixo },
  );
  return { x: dx / comprimento, y: dy / comprimento };
}

/**
 * Lado do eixo em que o ponto esta: positivo, negativo ou zero (em cima).
 * Produto vetorial 2D entre a direcao do eixo e o vetor ate o ponto.
 */
export function ladoDoEixo(ponto: Vetor2, eixo: Eixo, direcao: Vetor2Flutuante): number {
  const vx = ponto.x - eixo.p1.x;
  const vy = ponto.y - eixo.p1.y;
  return direcao.x * vy - direcao.y * vx;
}

/**
 * Aplica a mesma funcao a todo `Ponto` e a todo controle de Bezier.
 * Toda a geometria da peca — contorno, fio, pence, furo, recorte — e feita de
 * `Ponto` (D10), entao percorrer `peca.pontos` alcanca tudo de uma vez.
 */
function transformar(peca: Peca, fn: (p: Vetor2) => Vetor2): Peca {
  const pontos: Record<Id, Ponto> = {};
  for (const [id, ponto] of Object.entries(peca.pontos)) {
    const movido = fn({ x: ponto.x, y: ponto.y });
    pontos[id] = { ...ponto, x: movido.x, y: movido.y };
  }

  const segmentos: Record<Id, Segmento> = {};
  for (const [id, segmento] of Object.entries(peca.segmentos)) {
    segmentos[id] =
      segmento.controles === undefined
        ? segmento
        : { ...segmento, controles: [fn(segmento.controles[0]), fn(segmento.controles[1])] };
  }

  const eixosDobra = { ...peca.eixosDobra };
  for (const [id, eixo] of Object.entries(peca.eixosDobra)) {
    eixosDobra[id] = { ...eixo, p1: fn(eixo.p1), p2: fn(eixo.p2) };
  }

  return { ...peca, pontos, segmentos, eixosDobra };
}
