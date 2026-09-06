/**
 * Regiões: achar cada peça na máscara, tapar os ímãs e tirar o contorno.
 *
 * ## Decisão I13 — onde a regra da "biblioteca testada" começa
 * A decisão 3 da Parte 0 manda tirar **geometria** de biblioteca testada, e ela vale
 * inteira: homografia vem do `ml-matrix`, Minkowski vem do `clipper2`, ajuste de
 * Bézier vem de implementação publicada.
 *
 * O que está aqui é **domínio de imagem**, não de geometria: rotular componentes
 * conexos, preencher buraco e andar pela borda de um conjunto de pixels. A
 * alternativa seria carregar 14 MB de OpenCV em WASM só para isso.
 *
 * A troca é explícita, e o preço dela é pago em teste: cada função aqui é conferida
 * contra figura sintética de resultado **conhecido de antemão** — retângulo, anel,
 * dois quadrados separados —, e não só contra a foto, onde ninguém sabe a resposta
 * certa. É a diferença entre "parece que funcionou" e "funcionou".
 */
import type { Mascara } from './imagem.js';

export interface Regiao {
  readonly rotulo: number;
  readonly area: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Um pixel qualquer da região — porta de entrada para o traçado da borda. */
  readonly semente: { x: number; y: number };
}

export interface Rotulagem {
  /** Mesmo tamanho da máscara: 0 = fora, n = região n. */
  readonly rotulos: Int32Array;
  readonly regioes: readonly Regiao[];
}

/**
 * Rotula os componentes conexos por vizinhança de 4.
 *
 * Vizinhança de 4, e não de 8, de propósito: com 8 duas peças que só se encostam
 * numa quina viram uma peça só, e o molde sai grudado. Encostar em quina acontece
 * — a foto do ateliê tem peças a poucos milímetros uma da outra.
 *
 * A varredura é iterativa (pilha explícita). Recursão aqui estoura a pilha do Node
 * numa peça grande: uma peça de 400 × 700 mm nesta foto tem ~150 mil pixels.
 */
export function rotular(
  mascara: Mascara,
  largura: number,
  altura: number,
  areaMinima = 0,
): Rotulagem {
  const rotulos = new Int32Array(largura * altura);
  const regioes: Regiao[] = [];
  const pilha: number[] = [];
  let proximo = 0;

  for (let inicio = 0; inicio < mascara.length; inicio++) {
    if (mascara[inicio] !== 1 || rotulos[inicio] !== 0) continue;

    proximo++;
    let area = 0;
    let minX = largura;
    let minY = altura;
    let maxX = -1;
    let maxY = -1;
    rotulos[inicio] = proximo;
    pilha.push(inicio);

    while (pilha.length > 0) {
      const i = pilha.pop()!;
      const x = i % largura;
      const y = (i - x) / largura;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && mascara[i - 1] === 1 && rotulos[i - 1] === 0) {
        rotulos[i - 1] = proximo;
        pilha.push(i - 1);
      }
      if (x + 1 < largura && mascara[i + 1] === 1 && rotulos[i + 1] === 0) {
        rotulos[i + 1] = proximo;
        pilha.push(i + 1);
      }
      if (y > 0 && mascara[i - largura] === 1 && rotulos[i - largura] === 0) {
        rotulos[i - largura] = proximo;
        pilha.push(i - largura);
      }
      if (y + 1 < altura && mascara[i + largura] === 1 && rotulos[i + largura] === 0) {
        rotulos[i + largura] = proximo;
        pilha.push(i + largura);
      }
    }

    regioes.push({
      rotulo: proximo,
      area,
      minX,
      minY,
      maxX,
      maxY,
      semente: { x: inicio % largura, y: Math.floor(inicio / largura) },
    });
  }

  const grandes = regioes.filter((r) => r.area >= areaMinima);
  return { rotulos, regioes: [...grandes].sort((a, b) => b.area - a.area) };
}

/**
 * Tapa os buracos: tudo que não está ligado à borda da imagem vira parte da peça.
 *
 * É o que resolve os ímãs. O ímã fica **em cima** do molde, escurece o pardo o
 * bastante para cair fora do limiar de croma, e deixa um furo na máscara. Furo
 * inteiramente cercado por papel é ímã, e some.
 *
 * Furo que **encosta na borda da imagem** não é tapado — porque aí não é furo, é
 * fundo. É o mesmo motivo pelo qual ímã sentado no contorno tem que ser recusado e
 * não remendado (decisão I9): remendar ali seria inventar a borda do molde.
 */
export function preencherBuracos(mascara: Mascara, largura: number, altura: number): Mascara {
  const fora = new Uint8Array(mascara.length);
  const pilha: number[] = [];

  const semear = (i: number): void => {
    if (mascara[i] === 0 && fora[i] === 0) {
      fora[i] = 1;
      pilha.push(i);
    }
  };
  for (let x = 0; x < largura; x++) {
    semear(x);
    semear((altura - 1) * largura + x);
  }
  for (let y = 0; y < altura; y++) {
    semear(y * largura);
    semear(y * largura + largura - 1);
  }

  while (pilha.length > 0) {
    const i = pilha.pop()!;
    const x = i % largura;
    const y = (i - x) / largura;
    if (x > 0) semear(i - 1);
    if (x + 1 < largura) semear(i + 1);
    if (y > 0) semear(i - largura);
    if (y + 1 < altura) semear(i + largura);
  }

  const cheia = new Uint8Array(mascara.length);
  for (let i = 0; i < mascara.length; i++) cheia[i] = fora[i] === 1 ? 0 : 1;
  return cheia;
}

/** Quantos buracos a região tem, e a área de cada um. Serve ao relatório. */
export function buracosDe(
  mascara: Mascara,
  cheia: Mascara,
  largura: number,
  altura: number,
): { area: number; x: number; y: number }[] {
  const soBuraco = new Uint8Array(mascara.length);
  for (let i = 0; i < mascara.length; i++) soBuraco[i] = cheia[i] === 1 && mascara[i] === 0 ? 1 : 0;
  return rotular(soBuraco, largura, altura).regioes.map((r) => ({
    area: r.area,
    x: Math.round((r.minX + r.maxX) / 2),
    y: Math.round((r.minY + r.maxY) / 2),
  }));
}

/**
 * O contorno da região, em pixels, andando pela borda (traçado de Moore).
 *
 * Sai anti-horário **no sistema do motor** (Y para cima). Como a imagem tem Y para
 * baixo, o passeio que é horário na tela é anti-horário no mundo — e essa é a
 * orientação que a decisão D9 da Fase 1 exige de todo contorno.
 *
 * O ponto de partida é o pixel mais acima e mais à esquerda da região, que é sempre
 * um pixel de borda: começar por dentro faria o passeio nunca fechar.
 */
export function contornoDaRegiao(
  rotulos: Int32Array,
  largura: number,
  altura: number,
  rotulo: number,
): { x: number; y: number }[] {
  const pertence = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < largura && y < altura && rotulos[y * largura + x] === rotulo;

  let inicio: { x: number; y: number } | null = null;
  for (let i = 0; i < rotulos.length && inicio === null; i++) {
    if (rotulos[i] === rotulo) inicio = { x: i % largura, y: Math.floor(i / largura) };
  }
  if (inicio === null) return [];

  // Vizinhança de 8, em sentido HORÁRIO NA TELA a partir do oeste. Com Y para
  // baixo, horário na tela é anti-horário no mundo — que é a orientação que a
  // decisão D9 exige de todo contorno.
  const VIZINHOS = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ] as const;
  const direcaoDe = (dx: number, dy: number): number => {
    for (let k = 0; k < 8; k++) if (VIZINHOS[k]![0] === dx && VIZINHOS[k]![1] === dy) return k;
    return 0;
  };

  // Traçado de Moore com RASTRO: a cada passo, a busca recomeça no vizinho
  // seguinte ao último pixel de FUNDO examinado. É o rastro que faz o passeio
  // acompanhar a borda; sem ele, o caminho corta por dentro e fecha em dois
  // passos — foi exatamente o defeito que o teste do retângulo 20 × 15 pegou,
  // devolvendo 4 pontos em vez de 66.
  //
  // O ponto de partida é o primeiro pixel da região na varredura, então o vizinho
  // a oeste dele é fundo (ou está fora da imagem, o que dá no mesmo aqui).
  const caminho: { x: number; y: number }[] = [inicio];
  let atual = inicio;
  let rastro = { x: inicio.x - 1, y: inicio.y };
  let passos = 0;
  const limite = largura * altura * 8;

  do {
    const d = direcaoDe(rastro.x - atual.x, rastro.y - atual.y);
    let achou = false;
    for (let k = 1; k <= 8; k++) {
      const v = VIZINHOS[(d + k) % 8]!;
      const px = atual.x + v[0];
      const py = atual.y + v[1];
      if (pertence(px, py)) {
        const anterior = VIZINHOS[(d + k - 1) % 8]!;
        rastro = { x: atual.x + anterior[0], y: atual.y + anterior[1] };
        atual = { x: px, y: py };
        caminho.push(atual);
        achou = true;
        break;
      }
    }
    // Pixel isolado: não tem borda para andar.
    if (!achou) break;
    passos++;
  } while ((atual.x !== inicio.x || atual.y !== inicio.y) && passos < limite);

  // O passeio volta ao ponto de partida; o motor guarda o anel sem repetir.
  if (
    caminho.length > 1 &&
    caminho[caminho.length - 1]!.x === inicio.x &&
    caminho[caminho.length - 1]!.y === inicio.y
  ) {
    caminho.pop();
  }
  return caminho;
}
