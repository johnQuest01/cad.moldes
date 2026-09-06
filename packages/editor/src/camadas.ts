/**
 * As camadas do desenho — a mesma divisao das camadas do DXF ASTM.
 *
 * Nao e organizacao visual: e o que permite **travar** o fio para nao arrastar ele
 * sem querer ao mexer no contorno, e o que faz o hit-testing ignorar o que esta
 * desligado. Camada travada continua visivel; ela so sai da busca do cursor.
 *
 * A ordem do array e a ordem de desenho, de baixo para cima, e ela e fixa: o corte
 * embaixo da costura, o pique em cima dos dois, o texto por ultimo. Deixar o
 * usuario reordenar camada num CAD de molde nao ajuda ninguem e cria estado a mais.
 */

/** As camadas, na ordem de desenho. `overlay` nao e do mundo: e a de pixels (E5). */
export const CAMADAS = [
  'grade',
  'fantasma',
  'corte',
  'costura',
  'recorte',
  'interna',
  'pique',
  'gradePoint',
  'texto',
  'overlay',
] as const;

export type Camada = (typeof CAMADAS)[number];

/** Camada do DXF ASTM correspondente, onde existe (Parte 7 da Fase 1). */
export const CAMADA_ASTM: Readonly<Partial<Record<Camada, number>>> = Object.freeze({
  corte: 1,
  costura: 14,
  recorte: 11,
  interna: 7,
  pique: 4,
  gradePoint: 5,
  texto: 15,
});

export interface EstadoDaCamada {
  visivel: boolean;
  /** Visivel, mas fora da busca do cursor. */
  travada: boolean;
}

export class Camadas {
  readonly #estado = new Map<Camada, EstadoDaCamada>(
    CAMADAS.map((c) => [c, { visivel: true, travada: false }]),
  );

  estado(camada: Camada): EstadoDaCamada {
    return this.#estado.get(camada)!;
  }

  /** Uma camada so entra na busca do cursor se estiver visivel E destravada. */
  selecionavel(camada: Camada): boolean {
    const estado = this.#estado.get(camada)!;
    return estado.visivel && !estado.travada;
  }

  visivel(camada: Camada): boolean {
    return this.#estado.get(camada)!.visivel;
  }

  mostrar(camada: Camada, visivel: boolean): void {
    this.#estado.get(camada)!.visivel = visivel;
  }

  travar(camada: Camada, travada: boolean): void {
    this.#estado.get(camada)!.travada = travada;
  }

  alternar(camada: Camada): void {
    const estado = this.#estado.get(camada)!;
    estado.visivel = !estado.visivel;
  }
}
