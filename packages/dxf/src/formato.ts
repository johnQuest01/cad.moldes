/**
 * O formato DXF cru: pares (codigo, valor) e as camadas da ASTM.
 *
 * ## Milimetro com TRES casas (F2)
 * `0,001 mm` e exatamente `1 UM`. Com tres casas, `UM -> mm -> UM` e sem perda, e o
 * round-trip pode ser exigido no numero exato em vez de "dentro da tolerancia".
 * Menos casas perderia micrometro; mais seria ruido.
 */
import { CAMADA_ASTM_DO_PIQUE, type TipoPique } from '@cad/motor';

/** Um par do DXF: codigo de grupo e valor, na ordem em que aparecem no arquivo. */
export interface Par {
  readonly codigo: number;
  readonly valor: string;
}

/** As camadas da ASTM D6673 que este pacote entende (Parte 7, caso 1). */
export const CAMADA = Object.freeze({
  CORTE: 1,
  TURN_POINT: 2,
  CURVE_POINT: 3,
  PIQUE: 4,
  GRADE_POINT: 5,
  EIXO_DOBRA: 6,
  FIO: 7,
  LINHA_INTERNA: 8,
  RECORTE: 11,
  FURO: 13,
  COSTURA: 14,
  TEXTO: 15,
});

/** Camada -> tipo de pique. E o inverso de `CAMADA_ASTM_DO_PIQUE` do motor. */
export const TIPO_DO_PIQUE_POR_CAMADA: Readonly<Record<number, TipoPique>> = Object.freeze({
  4: 'V',
  80: 'T',
  81: 'MX',
  82: 'CHECK',
  83: 'U',
});

/** A camada em que um pique daquele tipo e escrito. */
export const camadaDoPique = (tipo: TipoPique): number => CAMADA_ASTM_DO_PIQUE[tipo];

/** UM -> milimetro, com as tres casas que fazem o round-trip ser exato (F2). */
export function emMilimetros(um: number): string {
  return (um / 1000).toFixed(3);
}

/** Milimetro do arquivo -> UM inteiro. */
export function paraUM(milimetros: string): number {
  const valor = Number(milimetros);
  if (!Number.isFinite(valor)) {
    throw new Error(`O DXF traz "${milimetros}" onde deveria haver um numero.`);
  }
  return Math.round(valor * 1000);
}

/**
 * Le o DXF ASCII em pares.
 *
 * O formato e literalmente uma lista alternada de linhas: codigo, valor, codigo,
 * valor. Um arquivo com numero impar de linhas uteis esta truncado — e truncado e
 * erro, nao "le o que der".
 */
export function lerPares(texto: string): Par[] {
  const linhas = texto.split(/\r?\n/);
  // O arquivo pode terminar com linha em branco; so ela e descartavel.
  while (linhas.length > 0 && linhas[linhas.length - 1]!.trim() === '') linhas.pop();
  if (linhas.length % 2 !== 0) {
    throw new Error(
      `O DXF tem ${linhas.length} linhas uteis, um numero impar: o arquivo esta truncado. ` +
        `Cada par e uma linha de codigo e uma de valor.`,
    );
  }

  const pares: Par[] = [];
  for (let i = 0; i < linhas.length; i += 2) {
    const codigo = Number(linhas[i]!.trim());
    if (!Number.isInteger(codigo)) {
      throw new Error(
        `Linha ${i + 1} do DXF deveria ser um codigo de grupo inteiro, e traz "${linhas[i]!}".`,
      );
    }
    pares.push({ codigo, valor: linhas[i + 1]!.trim() });
  }
  return pares;
}

/** Escreve os pares no formato do arquivo. */
export function escreverPares(pares: readonly Par[]): string {
  return pares.map((p) => `${p.codigo}\n${p.valor}`).join('\n') + '\n';
}

/** Atalho para montar pares sem repetir a forma. */
export const par = (codigo: number, valor: string | number): Par => ({
  codigo,
  valor: typeof valor === 'number' ? String(valor) : valor,
});

/**
 * Sane o nome para o que o DXF aceita em nome de bloco: maiusculas, sem espaco e
 * sem os caracteres que a especificacao reserva.
 */
export function nomeDeBloco(nome: string): string {
  const limpo = nome
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9_$-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return limpo.length === 0 ? 'PECA' : limpo;
}
