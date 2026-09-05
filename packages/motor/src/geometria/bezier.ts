/**
 * Bezier cubico (D1) — subdivisao e tesselacao DETERMINISTICA.
 *
 * ## Por que a tesselacao nao vem do verb (desvio documentado da inegociavel 3)
 *
 * A Parte 0 manda tirar curva de biblioteca testada (`verb-nurbs`). Ao verificar
 * antes de usar (protocolo verify-before-act), o amostrador adaptativo do verb
 * mostrou dois defeitos que o tornam inutilizavel AQUI — e so aqui, na tesselacao:
 *
 * 1. **Nao e deterministico.** `verb.eval.Tess.rationalCurveAdaptiveSampleRange`
 *    sonda a planeza num ponto sorteado (`var t = 0.5 + 0.2 * Math.random()`,
 *    verb.es.js:7362). Medido: 200 curvas Bezier aleatorias, 3 tesselacoes cada,
 *    mesma tolerancia -> **184 das 200 devolveram poligonais diferentes** entre
 *    chamadas. Como a poligonal nunca e persistida (Parte 2, op. 2: "tesselar
 *    sempre na leitura"), isso faria o perimetro da mesma peca mudar a cada
 *    leitura e quebraria por construcao o teste de integridade da Parte 4.
 * 2. **A tolerancia dele nao e distancia.** `verb.core.Trig.threePointsAreFlat`
 *    compara `|(P2-P1) x (P3-P1)|^2 < tol` (verb.es.js:3763) — o parametro esta
 *    em unidade de AREA AO QUADRADO, nao em micrometros. Passar
 *    `TOLERANCIA_TESSELACAO_UM = 100` ali nao significa "0,1 mm de desvio".
 *
 * O que ficou do verb: a **avaliacao** (`rationalCurvePoint`), o **comprimento de
 * arco** (`rationalCurveArcLength`, Gauss-Legendre) e o `paramAtArcLength`. Foram
 * medidos como deterministicos (200 curvas x 3 chamadas, 0 instaveis) e sao usados
 * nos testes como ORACULO INDEPENDENTE do que este arquivo produz.
 *
 * ## O criterio usado aqui
 *
 * Subdivisao por de Casteljau no ponto exato `t = 0,5` (deterministico) ate o
 * **limite provado** de desvio da corda cair abaixo da tolerancia. Escrevendo o
 * erro `e(t) = B(t) - L(t)` na base de Bernstein:
 *
 *     e(t) = B1,3(t)*(P1 - L1) + B2,3(t)*(P2 - L2),
 *     com L1 = P0 + (P3-P0)/3  e  L2 = P0 + 2*(P3-P0)/3
 *
 * e como `max_t [B1,3(t) + B2,3(t)] = max_t 3t(1-t) = 3/4`:
 *
 *     |e(t)| <= (3/4) * max(|P1 - L1|, |P2 - L2|)
 *
 * E cota superior, nao estimativa: se ela passa, o desvio real passa. Vale tambem
 * para curva fechada em si mesma (P0 = P3), onde L1 = L2 = P0.
 */
import { ErroMotor } from '../erros.js';
import type { Vetor2 } from '../tipos.js';
import type { UM } from '../unidades.js';

/**
 * Ponto em UM de ponto flutuante — existe SO dentro da subdivisao.
 * O de Casteljau gera coordenadas fracionarias por construcao; arredondar a cada
 * nivel acumularia erro. Volta a inteiro na fronteira (`tesselarBezier`).
 */
export interface Vetor2F {
  readonly x: number;
  readonly y: number;
}

/** Bezier cubico: [P0, C1, C2, P3]. Exatamente 4 pontos (D1). */
export type Bezier = readonly [Vetor2F, Vetor2F, Vetor2F, Vetor2F];

/**
 * Teto de subdivisao. Cada nivel divide o limite de desvio por ~4, entao 24
 * niveis cobrem 4^24 ~ 2,8e14 de reducao — mais do que a faixa de inteiro seguro
 * permite representar. Estourar isso significa entrada degenerada (controles
 * infinitos, NaN), e ai estoura com erro em vez de devolver poligonal truncada.
 */
const PROFUNDIDADE_MAXIMA = 24;

/** Fator do limite de Bernstein: max_t 3t(1-t) = 3/4. */
const FATOR_BERNSTEIN = 0.75;

/** Avalia a Bezier em `t` (0..1) pela forma de Bernstein. */
export function pontoEmT(bezier: Bezier, t: number): Vetor2F {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  const [p0, c1, c2, p3] = bezier;
  return {
    x: b0 * p0.x + b1 * c1.x + b2 * c2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * c1.y + b2 * c2.y + b3 * p3.y,
  };
}

/**
 * Limite superior PROVADO do desvio entre a curva e a corda P0->P3, em UM.
 * Ver a deducao no cabecalho. Nunca subestima o desvio real.
 */
export function limiteDesvioDaCorda(bezier: Bezier): number {
  const [p0, c1, c2, p3] = bezier;
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const l1x = p0.x + dx / 3;
  const l1y = p0.y + dy / 3;
  const l2x = p0.x + (2 * dx) / 3;
  const l2y = p0.y + (2 * dy) / 3;
  const d1 = Math.hypot(c1.x - l1x, c1.y - l1y);
  const d2 = Math.hypot(c2.x - l2x, c2.y - l2y);
  return FATOR_BERNSTEIN * Math.max(d1, d2);
}

/**
 * de Casteljau em `t`. Devolve as duas partes EXATAS da curva: juntas elas sao a
 * mesma curva de antes, nao uma aproximacao. E o que permite inserir um ponto no
 * meio de uma curva sem mudar o desenho (Bloco 7, operacao 13).
 */
export function subdividirEmT(bezier: Bezier, t: number): [Bezier, Bezier] {
  const [p0, c1, c2, p3] = bezier;
  const a = entre(p0, c1, t);
  const b = entre(c1, c2, t);
  const c = entre(c2, p3, t);
  const d = entre(a, b, t);
  const e = entre(b, c, t);
  const f = entre(d, e, t);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}

/** de Casteljau em t = 0,5. */
export function subdividirNoMeio(bezier: Bezier): [Bezier, Bezier] {
  return subdividirEmT(bezier, 0.5);
}

/** Ponto da poligonal junto com o parametro `t` que o gerou. */
export interface AmostraDaCurva {
  readonly ponto: Vetor2F;
  readonly t: number;
}

/**
 * Mesma tesselacao de `tesselarBezier`, guardando o `t` de cada vertice.
 *
 * E o que sustenta a conversao `s -> t`: `s` e fracao de COMPRIMENTO DE ARCO e `t`
 * e o parametro da Bezier, e os dois so coincidem em curva simetrica. Sem esta
 * tabela, inserir um ponto "no meio" cairia no lugar errado (o mesmo erro que a
 * D1 proibe para o pique).
 */
export function tesselarBezierComT(bezier: Bezier, toleranciaUM: UM): AmostraDaCurva[] {
  exigirEntradaUsavel(bezier, toleranciaUM);
  const saida: AmostraDaCurva[] = [{ ponto: bezier[0], t: 0 }];
  acumularComT(bezier, toleranciaUM, 0, 0, 1, saida);
  return saida;
}

/**
 * Parametro `t` da Bezier na posicao `s` (0..1) de comprimento de arco.
 * Busca binaria na tabela acumulada + interpolacao linear dentro da corda.
 */
export function parametroEmS(bezier: Bezier, s: number, toleranciaUM: UM): number {
  if (!Number.isFinite(s) || s < 0 || s > 1) {
    throw new ErroMotor(
      'S_FORA_DA_FAIXA',
      `A posicao s = ${String(s)} esta fora de [0, 1]. s e fracao do comprimento de arco.`,
      { s },
    );
  }
  if (s === 0) return 0;
  if (s === 1) return 1;

  const amostras = tesselarBezierComT(bezier, toleranciaUM);
  const acumulado: number[] = [0];
  for (let i = 1; i < amostras.length; i++) {
    const a = amostras[i - 1]!.ponto;
    const b = amostras[i]!.ponto;
    acumulado.push(acumulado[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }

  const total = acumulado[acumulado.length - 1]!;
  if (total === 0) {
    throw new ErroMotor(
      'SEGMENTO_COMPRIMENTO_ZERO',
      'A curva tem comprimento zero; nao ha posicao de arco a converter em t.',
      { s },
    );
  }

  const alvo = s * total;
  let baixo = 0;
  let alto = acumulado.length - 1;
  while (alto - baixo > 1) {
    const meio = (baixo + alto) >> 1;
    if (acumulado[meio]! <= alvo) baixo = meio;
    else alto = meio;
  }

  const corda = acumulado[baixo + 1]! - acumulado[baixo]!;
  const fracao = corda === 0 ? 0 : (alvo - acumulado[baixo]!) / corda;
  const t0 = amostras[baixo]!.t;
  const t1 = amostras[baixo + 1]!.t;
  return t0 + (t1 - t0) * fracao;
}

/**
 * Poligonal da Bezier dentro da tolerancia, em UM de ponto flutuante.
 * Inclui os dois extremos. Deterministica: mesma entrada -> mesma saida, sempre.
 */
export function tesselarBezier(bezier: Bezier, toleranciaUM: UM): Vetor2F[] {
  exigirEntradaUsavel(bezier, toleranciaUM);
  const saida: Vetor2F[] = [bezier[0]];
  acumular(bezier, toleranciaUM, 0, saida);
  return saida;
}

function acumular(bezier: Bezier, toleranciaUM: UM, profundidade: number, saida: Vetor2F[]): void {
  if (limiteDesvioDaCorda(bezier) <= toleranciaUM) {
    saida.push(bezier[3]);
    return;
  }
  if (profundidade >= PROFUNDIDADE_MAXIMA) {
    throw new ErroMotor(
      'TESSELACAO_NAO_CONVERGIU',
      `A subdivisao passou de ${PROFUNDIDADE_MAXIMA} niveis sem chegar a ${toleranciaUM} UM. ` +
        `Isso indica curva degenerada (controles absurdos), nao curva dificil.`,
      { toleranciaUM, profundidade },
    );
  }
  const [esquerda, direita] = subdividirNoMeio(bezier);
  acumular(esquerda, toleranciaUM, profundidade + 1, saida);
  acumular(direita, toleranciaUM, profundidade + 1, saida);
}

/** Monta a Bezier de um segmento a partir dos extremos inteiros e dos controles. */
export function bezierDe(
  de: Vetor2,
  controles: readonly [Vetor2, Vetor2],
  para: Vetor2,
): Bezier {
  return [de, controles[0], controles[1], para];
}

function entre(a: Vetor2F, b: Vetor2F, t: number): Vetor2F {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function exigirEntradaUsavel(bezier: Bezier, toleranciaUM: UM): void {
  if (!Number.isFinite(toleranciaUM) || toleranciaUM <= 0) {
    throw new ErroMotor(
      'TOLERANCIA_INVALIDA',
      `Tolerancia de tesselacao precisa ser um numero positivo; recebi ${String(toleranciaUM)}.`,
      { toleranciaUM },
    );
  }
  for (const ponto of bezier) {
    if (!Number.isFinite(ponto.x) || !Number.isFinite(ponto.y)) {
      throw new ErroMotor(
        'CURVA_DEGENERADA',
        `Bezier com ponto de controle nao finito (${String(ponto.x)}, ${String(ponto.y)}).`,
        { bezier },
      );
    }
  }
}

function acumularComT(
  bezier: Bezier,
  toleranciaUM: UM,
  profundidade: number,
  t0: number,
  t1: number,
  saida: AmostraDaCurva[],
): void {
  if (limiteDesvioDaCorda(bezier) <= toleranciaUM) {
    saida.push({ ponto: bezier[3], t: t1 });
    return;
  }
  if (profundidade >= PROFUNDIDADE_MAXIMA) {
    throw new ErroMotor(
      'TESSELACAO_NAO_CONVERGIU',
      `A subdivisao passou de ${PROFUNDIDADE_MAXIMA} niveis sem chegar a ${toleranciaUM} UM.`,
      { toleranciaUM, profundidade },
    );
  }
  const [esquerda, direita] = subdividirNoMeio(bezier);
  const tMeio = (t0 + t1) / 2;
  acumularComT(esquerda, toleranciaUM, profundidade + 1, t0, tMeio, saida);
  acumularComT(direita, toleranciaUM, profundidade + 1, tMeio, t1, saida);
}
