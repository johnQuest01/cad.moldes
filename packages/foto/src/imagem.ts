/**
 * A imagem, e a separação do papel do fundo.
 *
 * ## O pacote não decodifica imagem
 * Entra `Imagem`, que é o mesmo formato do `ImageData` do navegador: RGBA, quatro
 * bytes por pixel, linha por linha, **origem no canto superior esquerdo e Y para
 * baixo** — a convenção do mundo da imagem, não a do motor. A inversão para Y-para-
 * cima acontece de uma vez só, na homografia, porque os pontos do quadro já são
 * dados em Y-para-cima.
 *
 * Quem decodifica JPEG é o navegador (via `canvas`) ou o teste (via `jimp`). Manter
 * o decodificador fora daqui é o que deixa este pacote rodar nos dois lugares.
 *
 * ## O achado: separar por CROMA, não por brilho
 * O palpite natural é limiar de brilho — papel claro sobre fundo escuro. **Medido
 * na foto real do ateliê, isso é o caminho errado.** O histograma de luminância
 * dentro do quadro sai espalhado, sem vale nenhum:
 *
 * ```
 * lum   0:0,0%  16:8,4%  32:11,4%  48:16,0%  64:4,9%  80:3,1%  96:2,4%  112:3,9%
 *     128:4,1%  144:9,2%  160:14,0%  176:17,2%  192:4,4%  208:0,2%  224:0,4%
 * ```
 *
 * O motivo é físico: o quadro preto tem **reflexo especular** da luz (fica claro em
 * pedaços) e o papel tem **sombra** (fica escuro em pedaços). Os dois invadem a
 * faixa de brilho um do outro.
 *
 * Já o croma `R − B` — o quanto o pixel puxa para o quente — é limpo, com um vale
 * largo no meio:
 *
 * ```
 * R−B   0:15,2%  8:12,3%  16:10,5%  24:5,4%  | 32:1,8%  40:0,9%  48:0,8%  56:0,8%
 *      64:0,9%  72:0,9%  80:1,0%  88:1,4% |  96:3,5%  104:26,6%  112:17,1%  120:0,9%
 *       └── fundo preto e borda branca ──┘   └────────── papel pardo ──────────┘
 * ```
 *
 * 38% de um lado, 48% do outro, **7,7% no vale inteiro**. Sombra não muda o croma
 * do pardo, e reflexo não pinta o preto de marrom — é por isso que funciona onde o
 * brilho falha.
 */

/** RGBA, quatro bytes por pixel, origem no canto superior esquerdo. */
export interface Imagem {
  readonly largura: number;
  readonly altura: number;
  readonly dados: Uint8ClampedArray;
}

/**
 * Limiar de croma que separa papel pardo de tudo o mais.
 *
 * 60 é o meio do vale medido (o vale vai de 32 a 88). Não é número escolhido a
 * dedo: é o ponto mais longe das duas montanhas.
 */
export const LIMIAR_CROMA_PARDO = 60;

/**
 * Acima disto, e sem croma, o pixel é da borda branca do quadro.
 *
 * Medido na foto do ateliê, olhando só os pixels NEUTROS (R − B < 30) dentro do
 * quadro — 256 mil deles:
 *
 * ```
 * lum  16:19,0%  32:24,3%  48:34,3%  64:8,8%  80:4,7%  96:2,1%  | 112:0,5%  128:0,3%
 *     144:0,4%  160:0,4%  176:0,4%  192:0,6%  208:0,8%  |  224:1,7%  240:1,7%
 *      └────────── o quadro preto: 93% ──────────┘  vale   └── a borda: 3,4% ──┘
 * ```
 *
 * O preto do quadro morre em 96 e a borda começa em 224. O vale entre os dois tem
 * 3% dos pixels e é largo: 160 fica no meio dele, longe das duas montanhas.
 */
export const LIMIAR_LUZ_BORDA = 160;

/** Máscara binária do tamanho da imagem: 1 dentro, 0 fora. */
export type Mascara = Uint8Array;

export interface Segmentacao {
  /** Papel pardo: o molde. */
  readonly papel: Mascara;
  /** Branco neutro: a borda recortada do quadro, que é o alvo de calibração. */
  readonly bordaDoQuadro: Mascara;
  /** Fração da imagem em cada classe — para o relatório dizer se a foto presta. */
  readonly fracaoPapel: number;
  readonly fracaoBorda: number;
}

const luminancia = (r: number, g: number, b: number): number =>
  0.299 * r + 0.587 * g + 0.114 * b;

export interface OpcoesDeSegmentacao {
  readonly limiarCroma?: number;
  readonly limiarLuz?: number;
  /**
   * Recorte a considerar, em pixels: `[x0, y0, x1, y1]`. Serve para excluir o que
   * não é o quadro — barra de programa, moldura da parede, chão. Sem ele, vale a
   * imagem inteira.
   */
  readonly recorte?: readonly [number, number, number, number];
}

/**
 * Separa papel pardo e borda branca, num passe só.
 *
 * Sem suavização, sem morfologia, sem heurística: é um limiar por pixel, e o
 * relatório diz quanto caiu em cada classe. Limpar a máscara é trabalho de quem
 * vem depois, e separado de propósito — assim dá para olhar a saída crua quando uma
 * foto der errado.
 */
export function segmentar(img: Imagem, opcoes: OpcoesDeSegmentacao = {}): Segmentacao {
  const limiarCroma = opcoes.limiarCroma ?? LIMIAR_CROMA_PARDO;
  const limiarLuz = opcoes.limiarLuz ?? LIMIAR_LUZ_BORDA;
  const [x0, y0, x1, y1] = opcoes.recorte ?? [0, 0, img.largura, img.altura];

  const n = img.largura * img.altura;
  const papel = new Uint8Array(n);
  const borda = new Uint8Array(n);
  let contaPapel = 0;
  let contaBorda = 0;
  let dentro = 0;

  for (let y = Math.max(0, y0); y < Math.min(img.altura, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.largura, x1); x++) {
      const i = y * img.largura + x;
      const j = i * 4;
      const r = img.dados[j]!;
      const g = img.dados[j + 1]!;
      const b = img.dados[j + 2]!;
      dentro++;
      if (r - b >= limiarCroma) {
        papel[i] = 1;
        contaPapel++;
      } else if (luminancia(r, g, b) >= limiarLuz) {
        borda[i] = 1;
        contaBorda++;
      }
    }
  }

  return {
    papel,
    bordaDoQuadro: borda,
    fracaoPapel: dentro === 0 ? 0 : contaPapel / dentro,
    fracaoBorda: dentro === 0 ? 0 : contaBorda / dentro,
  };
}
