/**
 * A calibração: o quadro de referência do ateliê.
 *
 * Decisão **I2** da Fase 6: a referência de escala é a PAREDE, não o molde e não os
 * ímãs que seguram. Molde recortado não tem dimensão conhecida — foi embora na
 * tesoura —, e ímã em cima do papel fica à frente do plano pela espessura dele.
 *
 * Decisão **I8**: o quadro descreve a INSTALAÇÃO, não o modelo. É configuração do
 * tenant, com `tenant_id` como toda entidade persistida, e não entra no log do
 * molde. O que entra no log é a referência a ela.
 */
import type { Id, UM } from '@cad/motor';

export interface Calibracao {
  readonly id: Id;
  readonly tenantId: string;
  readonly nome: string;
  /** Largura do retângulo de referência, medida com trena. */
  readonly larguraUM: UM;
  readonly alturaUM: UM;
  /**
   * As duas diagonais, também medidas com trena.
   *
   * Não são redundância: são a CONFERÊNCIA. Um retângulo que não fecha nas
   * diagonais não é retângulo, e a homografia sai torta sem avisar ninguém — o
   * molde inteiro fica trapezoidal e nada na tela denuncia. Medir a diagonal é o
   * que separa "achei que estava reto" de "está reto".
   */
  readonly diagonal1UM: UM;
  readonly diagonal2UM: UM;
}

export interface ProblemaDeCalibracao {
  readonly codigo: 'MEDIDA_INVALIDA' | 'DIAGONAIS_DESIGUAIS' | 'NAO_E_RETANGULO';
  readonly mensagem: string;
  /** O quanto passou do limite, em UM — para a mensagem poder ser específica. */
  readonly desvioUM: number;
}

/**
 * Tolerância da conferência do quadro, em UM. 2 mm em ~1,5 m é o que uma trena
 * bem esticada entrega na mão de gente; abaixo disso a exigência viraria teatro.
 */
export const TOLERANCIA_DO_QUADRO_UM = 2000;

/**
 * Confere se as quatro medidas descrevem mesmo um retângulo.
 *
 * Devolve a lista de problemas — vazia quer dizer aprovado. Nunca "conserta" as
 * medidas: I9 da Fase 6, e o motivo é que uma medida corrigida em silêncio vira
 * um erro de escala que aparece em todo molde digitalizado daí em diante.
 */
export function conferirCalibracao(c: Calibracao): ProblemaDeCalibracao[] {
  const problemas: ProblemaDeCalibracao[] = [];

  for (const [nome, valor] of [
    ['largura', c.larguraUM],
    ['altura', c.alturaUM],
    ['diagonal 1', c.diagonal1UM],
    ['diagonal 2', c.diagonal2UM],
  ] as const) {
    if (!Number.isFinite(valor) || valor <= 0) {
      problemas.push({
        codigo: 'MEDIDA_INVALIDA',
        mensagem: `A ${nome} do quadro é ${valor} UM. Meça com trena e digite um número positivo.`,
        desvioUM: 0,
      });
    }
  }
  if (problemas.length > 0) return problemas;

  const diferenca = Math.abs(c.diagonal1UM - c.diagonal2UM);
  if (diferenca > TOLERANCIA_DO_QUADRO_UM) {
    problemas.push({
      codigo: 'DIAGONAIS_DESIGUAIS',
      mensagem:
        `As diagonais do quadro diferem em ${(diferenca / 1000).toFixed(1)} mm ` +
        `(${(c.diagonal1UM / 1000).toFixed(1)} e ${(c.diagonal2UM / 1000).toFixed(1)} mm). ` +
        `Se não fecham, o quadro não é retângulo: mova um marcador até fecharem.`,
      desvioUM: diferenca,
    });
  }

  // Pitágoras: num retângulo, a diagonal é a hipotenusa dos lados. Se a diagonal
  // medida discorda dos lados medidos, alguma das quatro medidas está errada — e
  // sem esta conta os erros se cancelariam aos pares sem ninguém ver.
  const esperada = Math.hypot(c.larguraUM, c.alturaUM);
  const media = (c.diagonal1UM + c.diagonal2UM) / 2;
  const desvio = Math.abs(media - esperada);
  if (desvio > TOLERANCIA_DO_QUADRO_UM) {
    problemas.push({
      codigo: 'NAO_E_RETANGULO',
      mensagem:
        `Com ${(c.larguraUM / 1000).toFixed(1)} × ${(c.alturaUM / 1000).toFixed(1)} mm de lados, a ` +
        `diagonal teria que dar ${(esperada / 1000).toFixed(1)} mm, e as medidas dão ` +
        `${(media / 1000).toFixed(1)} mm — ${(desvio / 1000).toFixed(1)} mm de diferença. ` +
        `Confira as quatro medidas.`,
      desvioUM: desvio,
    });
  }

  return problemas;
}

/**
 * Os quatro cantos do quadro no mundo real, em UM, com a origem no canto inferior
 * esquerdo e **Y para cima** — o sistema do motor (decisão D9 da Fase 1).
 *
 * A ordem é a que todo o resto assume: inferior-esquerdo, inferior-direito,
 * superior-direito, superior-esquerdo. Anti-horário, como o contorno.
 */
export function cantosDoQuadro(c: Calibracao): readonly [
  { x: UM; y: UM },
  { x: UM; y: UM },
  { x: UM; y: UM },
  { x: UM; y: UM },
] {
  return [
    { x: 0, y: 0 },
    { x: c.larguraUM, y: 0 },
    { x: c.larguraUM, y: c.alturaUM },
    { x: 0, y: c.alturaUM },
  ];
}
