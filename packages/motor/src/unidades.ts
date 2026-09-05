/**
 * Unidades do motor.
 *
 * DECISAO INEGOCIAVEL 1 (Parte 0): a unidade interna e o MICROMETRO INTEIRO.
 * `1 mm = 1000 UM`. Todo calculo geometrico acontece em inteiro — exigencia do
 * clipper2 e defesa contra o arredondamento acumulado que destroi precisao de CAD.
 *
 * mm e cm sao APENAS formatacao de borda. Este arquivo e o unico lugar do motor
 * onde a conversao (e portanto o arredondamento) pode acontecer.
 */
import { ErroMotor } from './erros.js';

/** Micrometro inteiro. NUNCA guarde float de milimetro no nucleo. */
export type UM = number;

/** 1 mm = 1000 UM. */
export const MM: UM = 1000;

/** 1 cm = 10000 UM. */
export const CM: UM = 10_000;

/**
 * Desvio maximo aceito ao tesselar uma curva e ao simplificar um contorno:
 * 0,1 mm. Constante unica — nao espalhar numero magico equivalente.
 */
export const TOLERANCIA_TESSELACAO_UM: UM = 100;

/**
 * Desvio maximo aceito ao MEDIR (comprimento de arco e ancoragem de pique por `s`):
 * 10 UM = 0,01 mm. E dez vezes mais fina que a tolerancia de tesselacao, e a razao
 * esta medida, nao chutada.
 *
 * O comprimento sai da soma das cordas do tesselado (Parte 2, op. 3), e corda
 * SUBESTIMA arco. O erro relativo cresce quando o raio diminui. Medido no quarto
 * de circulo, contra o comprimento do verb (Gauss-Legendre) da MESMA Bezier:
 *
 *   raio      tol 100 UM        tol 10 UM
 *   10 mm     -25,2 UM (-0,16%)  -2,2 UM (-0,014%)
 *   100 mm    -15,7 UM (-0,010%) -3,7 UM (-0,0024%)
 *
 * Medir na tolerancia de tesselacao gastaria 0,16% do comprimento em curva
 * apertada — 1,6 mm num metro de costura, oito vezes o desvio de casamento aceito
 * na pratica (0,00 a 0,02 cm). Com 10 UM o pior caso fica em 0,015%.
 *
 * Consequencia assumida: o pique ancorado por `s` sai da tabela FINA e cai sobre a
 * curva de verdade; a poligonal grossa usada no offset pode se afastar dele em ate
 * TOLERANCIA_TESSELACAO_UM. A curva e a fonte de verdade, nao a poligonal grossa.
 */
export const TOLERANCIA_MEDICAO_UM: UM = 10;

/**
 * Diferenca maxima aceita entre duas arestas que costuram juntas: 200 UM = 0,02 cm.
 *
 * Nao e um numero escolhido por conforto, sao os dois tetos que se encontram:
 *  - a referencia real observada na confeccao para casamento de costura e
 *    0,00 a 0,02 cm;
 *  - o erro de medicao do motor (corda subestimando arco, ver TOLERANCIA_MEDICAO_UM)
 *    fica em 0,015% do comprimento — numa cava de 500 mm sao 75 UM, ja dentro deste
 *    teto. Um limite mais apertado que isso acusaria ruido de medicao como defeito
 *    de modelagem, e o modelista aprenderia a ignorar o alerta.
 */
export const TOLERANCIA_CASAMENTO_UM: UM = 200;

/**
 * Limite de miter do offset (D4: JoinType = Miter, nunca Round).
 * 2,0 significa que a ponta do canto pode se afastar no maximo 2x a margem.
 * Um canto de 90 graus pede razao 1/sen(45) = 1,414 — cabe folgado.
 * Cantos mais agudos que ~2x sao achatados pelo clipper em vez de virar
 * um espinho de comprimento quase infinito.
 */
export const LIMITE_MITER = 2.0;

function exigirNumeroFinito(valor: number, nomeDoCampo: string): void {
  if (!Number.isFinite(valor)) {
    throw new ErroMotor(
      'VALOR_NAO_FINITO',
      `${nomeDoCampo} precisa ser um numero finito; recebi ${String(valor)}.`,
    );
  }
}

/** Converte milimetros (borda) para micrometros inteiros (nucleo). */
export function mmParaUM(mm: number): UM {
  exigirNumeroFinito(mm, 'milimetros');
  return Math.round(mm * MM);
}

/** Converte centimetros (borda) para micrometros inteiros (nucleo). */
export function cmParaUM(cm: number): UM {
  exigirNumeroFinito(cm, 'centimetros');
  return Math.round(cm * CM);
}

/** Converte micrometros para milimetros. So para exibir/exportar — nunca realimente o nucleo. */
export function umParaMM(um: UM): number {
  exigirNumeroFinito(um, 'micrometros');
  return um / MM;
}

/** Converte micrometros para centimetros. So para exibir/exportar. */
export function umParaCM(um: UM): number {
  exigirNumeroFinito(um, 'micrometros');
  return um / CM;
}

/**
 * Garante que um valor que atravessa a fronteira ja e micrometro inteiro.
 * Chamado pelo fold em todo evento que traz coordenada, para que um float de
 * milimetro nunca entre no nucleo em silencio.
 */
export function exigirUM(valor: number, nomeDoCampo: string): UM {
  exigirNumeroFinito(valor, nomeDoCampo);
  if (!Number.isInteger(valor)) {
    throw new ErroMotor(
      'UM_NAO_INTEIRO',
      `${nomeDoCampo} precisa ser micrometro INTEIRO, recebi ${valor}. ` +
        `Converta na borda com mmParaUM()/cmParaUM() — o nucleo nao aceita float de mm.`,
    );
  }
  if (!Number.isSafeInteger(valor)) {
    throw new ErroMotor(
      'UM_FORA_DA_FAIXA',
      `${nomeDoCampo} = ${valor} UM esta fora da faixa de inteiro seguro do JavaScript.`,
    );
  }
  return valor;
}
