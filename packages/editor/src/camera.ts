/**
 * Camera: a ponte entre o mundo (UM, Y-up) e a tela (pixels, Y-down).
 *
 * E4 e E5 da Parte 0: a inversao do Y acontece **aqui e no container do mundo**, e
 * em lugar nenhum mais. Nenhum outro codigo do editor nega coordenada.
 *
 * ## Zoom no cursor, nao no centro
 * O ponto do mundo debaixo do cursor tem que continuar debaixo do cursor depois do
 * zoom. E a diferenca entre um CAD e um visualizador de imagem: no CAD a pessoa
 * aponta o que quer ver de perto, e a ferramenta obedece.
 *
 * ## Por que `zoom` e "pixels por milimetro"
 * Guardar "UM por pixel" daria numeros como 0.0012 no controle de zoom; guardar
 * pixels por milimetro da 2.5, que e o que o modelista entende — e 1.0 quer dizer
 * escala natural aproximada numa tela comum. A conversao interna e uma divisao por
 * MM, feita num lugar so.
 */
import { MM, type Vetor2 } from '@cad/motor';

/** Um ponto da tela, em pixels. Y cresce para BAIXO, como no DOM e no Pixi. */
export interface Pixel {
  readonly x: number;
  readonly y: number;
}

export interface Caixa {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Zoom minimo util: abaixo disso a peca inteira ja e um risco. */
export const ZOOM_MINIMO = 0.01;
/** Zoom maximo util: 1 UM por pixel. Nao ha o que ver abaixo do micrometro. */
export const ZOOM_MAXIMO = MM;

export class Camera {
  /** Centro da vista, em UM, no mundo. */
  #centro: Vetor2 = { x: 0, y: 0 };
  /** Pixels de tela por milimetro de mundo. */
  #zoom = 1;
  #largura: number;
  #altura: number;

  constructor(larguraPx: number, alturaPx: number) {
    this.#largura = larguraPx;
    this.#altura = alturaPx;
  }

  get centro(): Vetor2 {
    return this.#centro;
  }
  get zoom(): number {
    return this.#zoom;
  }
  get largura(): number {
    return this.#largura;
  }
  get altura(): number {
    return this.#altura;
  }

  /** Quantos UM cabem num pixel agora. E daqui que sai todo raio de captura (E11). */
  get umPorPixel(): number {
    return MM / this.#zoom;
  }

  redimensionar(larguraPx: number, alturaPx: number): void {
    this.#largura = larguraPx;
    this.#altura = alturaPx;
  }

  /** Mundo (UM, Y-up) -> tela (px, Y-down). */
  paraTela(p: Vetor2): Pixel {
    const escala = this.#zoom / MM;
    return {
      x: this.#largura / 2 + (p.x - this.#centro.x) * escala,
      y: this.#altura / 2 - (p.y - this.#centro.y) * escala,
    };
  }

  /**
   * Tela (px) -> mundo (UM inteiro).
   *
   * Arredonda porque o nucleo so aceita inteiro (D1). O erro de ida e volta e, por
   * construcao, no maximo meio UM — meio micrometro, contra os 100 UM da tolerancia
   * de tesselacao.
   */
  paraMundo(px: Pixel): Vetor2 {
    const escala = this.#zoom / MM;
    return {
      x: Math.round(this.#centro.x + (px.x - this.#largura / 2) / escala),
      y: Math.round(this.#centro.y - (px.y - this.#altura / 2) / escala),
    };
  }

  mover(dxPx: number, dyPx: number): void {
    const escala = this.#zoom / MM;
    this.#centro = {
      x: Math.round(this.#centro.x - dxPx / escala),
      y: Math.round(this.#centro.y + dyPx / escala),
    };
  }

  /**
   * Aproxima ou afasta MANTENDO o ponto do mundo que esta sob `foco`.
   *
   * A conta: guarda o ponto do mundo sob o cursor, muda o zoom, e desloca o centro
   * pela diferenca entre onde aquele ponto foi parar e onde ele estava.
   */
  aproximarNoPonto(foco: Pixel, fator: number): void {
    const antes = this.#mundoExato(foco);
    this.#zoom = limitar(this.#zoom * fator, ZOOM_MINIMO, ZOOM_MAXIMO);
    const depois = this.#mundoExato(foco);
    this.#centro = {
      x: Math.round(this.#centro.x + (antes.x - depois.x)),
      y: Math.round(this.#centro.y + (antes.y - depois.y)),
    };
  }

  definirZoom(zoom: number): void {
    this.#zoom = limitar(zoom, ZOOM_MINIMO, ZOOM_MAXIMO);
  }

  /** Enquadra a caixa com uma folga em pixels de cada lado ("ver tudo", "ver a peca"). */
  enquadrar(caixa: Caixa, folgaPx = 32): void {
    const largura = Math.max(caixa.maxX - caixa.minX, 1);
    const altura = Math.max(caixa.maxY - caixa.minY, 1);
    const utilX = Math.max(this.#largura - 2 * folgaPx, 1);
    const utilY = Math.max(this.#altura - 2 * folgaPx, 1);
    this.#zoom = limitar(
      Math.min((utilX * MM) / largura, (utilY * MM) / altura),
      ZOOM_MINIMO,
      ZOOM_MAXIMO,
    );
    this.#centro = {
      x: Math.round((caixa.minX + caixa.maxX) / 2),
      y: Math.round((caixa.minY + caixa.maxY) / 2),
    };
  }

  /** A regiao do mundo visivel agora. E o que o culling usa (Parte 1). */
  get vista(): Caixa {
    const cantoA = this.paraMundo({ x: 0, y: 0 });
    const cantoB = this.paraMundo({ x: this.#largura, y: this.#altura });
    return {
      minX: Math.min(cantoA.x, cantoB.x),
      maxX: Math.max(cantoA.x, cantoB.x),
      minY: Math.min(cantoA.y, cantoB.y),
      maxY: Math.max(cantoA.y, cantoB.y),
    };
  }

  /** Sem arredondar: e o que o zoom no cursor precisa para nao acumular erro. */
  #mundoExato(px: Pixel): { x: number; y: number } {
    const escala = this.#zoom / MM;
    return {
      x: this.#centro.x + (px.x - this.#largura / 2) / escala,
      y: this.#centro.y - (px.y - this.#altura / 2) / escala,
    };
  }
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return valor < minimo ? minimo : valor > maximo ? maximo : valor;
}

/** Caixa envolvente de uma nuvem de pontos. Vazia estoura — caixa de nada nao existe. */
export function caixaDe(pontos: readonly Vetor2[]): Caixa {
  if (pontos.length === 0) {
    throw new Error('caixaDe recebeu uma lista vazia: nao existe caixa envolvente de nada.');
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pontos) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** As duas caixas se tocam? E o teste de culling: fora da vista nao desenha. */
export function seTocam(a: Caixa, b: Caixa): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
