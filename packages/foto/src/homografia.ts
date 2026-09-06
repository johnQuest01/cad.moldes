/**
 * A homografia: pixel da foto → milímetro real.
 *
 * Uma foto de um plano é uma **projeção**: retângulo vira trapézio, o lado longe
 * fica menor que o lado perto. A transformação que desfaz isso é a homografia, uma
 * matriz 3×3 determinada por quatro pares de pontos conhecidos — que é exatamente
 * o que o quadro de referência dá.
 *
 * ## Onde mora o float
 * A decisão **D1** proíbe float de milímetro no NÚCLEO. Aqui é a borda: a foto
 * chega em pixel, que é float por natureza, e a conta de projeção é float. O que a
 * decisão exige é que o **resultado** entre no motor como micrômetro inteiro — e é
 * o que `paraUM` faz, na última linha do caminho. Mesmo desenho do importador de
 * DXF.
 *
 * ## Normalização de Hartley
 * O sistema linear direto mistura pixel (~10³) com micrômetro (~10⁶), e o número
 * de condição vai a 10⁹ — a solução sai contaminada por erro de arredondamento.
 * A receita padrão (Hartley & Zisserman) é levar cada nuvem para centróide na
 * origem e distância média √2 antes de resolver, e desfazer depois. Não é
 * refinamento: sem isso a conta É outra.
 *
 * A resolução do sistema em si vem do **ml-matrix**, como manda a decisão 3 da
 * Parte 0 — álgebra linear de biblioteca testada, nunca conta caseira.
 */
import { Matrix, solve, inverse } from 'ml-matrix';
import type { UM, Vetor2 } from '@cad/motor';

/** Um ponto na imagem, em pixels. Float: pixel não é micrômetro. */
export interface PontoImagem {
  readonly x: number;
  readonly y: number;
}

/** A matriz 3×3, guardada em linha. */
export interface Homografia {
  readonly m: readonly [number, number, number, number, number, number, number, number, number];
}

export class ErroDeHomografia extends Error {
  constructor(
    readonly codigo: 'PONTOS_DEGENERADOS' | 'SISTEMA_SEM_SOLUCAO',
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDeHomografia';
  }
}

interface Normalizacao {
  readonly T: Matrix;
  readonly pontos: { x: number; y: number }[];
}

/** Centróide na origem, distância média √2. Hartley & Zisserman, 4.4.4. */
function normalizar(pontos: readonly { x: number; y: number }[]): Normalizacao {
  const n = pontos.length;
  const cx = pontos.reduce((s, p) => s + p.x, 0) / n;
  const cy = pontos.reduce((s, p) => s + p.y, 0) / n;
  const distanciaMedia = pontos.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n;
  if (distanciaMedia === 0) {
    throw new ErroDeHomografia(
      'PONTOS_DEGENERADOS',
      'Os quatro pontos de referência caíram todos no mesmo lugar. Não dá para calcular escala nenhuma.',
    );
  }
  const s = Math.SQRT2 / distanciaMedia;
  return {
    T: new Matrix([
      [s, 0, -s * cx],
      [0, s, -s * cy],
      [0, 0, 1],
    ]),
    pontos: pontos.map((p) => ({ x: (p.x - cx) * s, y: (p.y - cy) * s })),
  };
}

/**
 * A homografia que leva os quatro pontos da imagem aos quatro pontos do mundo.
 *
 * A ordem importa e é a mesma dos dois lados: inferior-esquerdo, inferior-direito,
 * superior-direito, superior-esquerdo. Trocar dois deles não dá erro — dá um molde
 * ESPELHADO, que é o pior tipo de falha possível aqui: a manga sai do lado errado
 * e nada na tela denuncia. É por isso que os marcadores se identificam sozinhos
 * (decisão I3).
 */
export function estimarHomografia(
  imagem: readonly PontoImagem[],
  mundo: readonly Vetor2[],
): Homografia {
  if (imagem.length !== 4 || mundo.length !== 4) {
    throw new ErroDeHomografia(
      'PONTOS_DEGENERADOS',
      `Uma homografia precisa de exatamente 4 pares; vieram ${imagem.length} e ${mundo.length}.`,
    );
  }

  const a = normalizar(imagem);
  const b = normalizar(mundo);

  // Para cada par (x, y) -> (X, Y), com o denominador w = h6·x + h7·y + 1:
  //   h0·x + h1·y + h2 - h6·x·X - h7·y·X = X
  //   h3·x + h4·y + h5 - h6·x·Y - h7·y·Y = Y
  // Oito equações, oito incógnitas: sistema quadrado, solução exata.
  const A: number[][] = [];
  const B: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = a.pontos[i]!;
    const { x: X, y: Y } = b.pontos[i]!;
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    B.push([X]);
    B.push([Y]);
  }

  let h: Matrix;
  try {
    h = solve(new Matrix(A), new Matrix(B));
  } catch {
    throw new ErroDeHomografia(
      'SISTEMA_SEM_SOLUCAO',
      'Os quatro pontos de referência não determinam uma perspectiva. ' +
        'Três deles alinhados fazem isso: confira se os marcadores formam mesmo um retângulo.',
    );
  }
  const v = h.to1DArray();
  if (v.some((n) => !Number.isFinite(n))) {
    throw new ErroDeHomografia(
      'PONTOS_DEGENERADOS',
      'Os quatro pontos de referência são degenerados (alinhados ou repetidos). ' +
        'Sem quatro cantos de verdade não há perspectiva a desfazer.',
    );
  }

  const Hn = new Matrix([
    [v[0]!, v[1]!, v[2]!],
    [v[3]!, v[4]!, v[5]!],
    [v[6]!, v[7]!, 1],
  ]);

  // Desfaz a normalização: H = T_mundo⁻¹ · Hn · T_imagem
  const H = inverse(b.T).mmul(Hn).mmul(a.T);
  const m = H.to1DArray();
  const escala = m[8]!;
  return {
    m: [
      m[0]! / escala,
      m[1]! / escala,
      m[2]! / escala,
      m[3]! / escala,
      m[4]! / escala,
      m[5]! / escala,
      m[6]! / escala,
      m[7]! / escala,
      1,
    ],
  };
}

/** Aplica a homografia: pixel → milímetro real, ainda em float. */
export function projetar(h: Homografia, p: PontoImagem): { x: number; y: number } {
  const [a, b, c, d, e, f, g, i] = h.m;
  const w = g * p.x + i * p.y + 1;
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}

/**
 * Pixel → micrômetro INTEIRO. É aqui que a geometria entra no motor.
 *
 * O arredondamento é o mesmo do resto do projeto: `Math.round`, e a partir daqui
 * não existe mais meio micrômetro em lugar nenhum.
 */
export function paraUM(h: Homografia, p: PontoImagem): { x: UM; y: UM } {
  const v = projetar(h, p);
  return { x: Math.round(v.x), y: Math.round(v.y) };
}

/**
 * O resíduo de reprojeção, em UM: o quanto os próprios pontos de referência erram
 * quando passam pela homografia que eles mesmos determinaram.
 *
 * Com exatamente quatro pares a solução é exata e o resíduo é ~0 — o valor serve
 * como **teste de sanidade numérica**, e é o que denuncia um quadro mal medido
 * quando houver mais de quatro marcadores.
 */
export function residuoDeReprojecao(
  h: Homografia,
  imagem: readonly PontoImagem[],
  mundo: readonly Vetor2[],
): number {
  let pior = 0;
  for (let i = 0; i < imagem.length; i++) {
    const v = projetar(h, imagem[i]!);
    const alvo = mundo[i]!;
    pior = Math.max(pior, Math.hypot(v.x - alvo.x, v.y - alvo.y));
  }
  return pior;
}
