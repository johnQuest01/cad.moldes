/**
 * Calibrar o quadro com um OBJETO de tamanho conhecido — a decisão I14.
 *
 * ## Por que não medir o quadro com trena
 * Os cantos que a detecção produz são o cruzamento das retas que passam pelos
 * **centros** das marcas. Esse retângulo é uma abstração geométrica: não tem borda
 * para encostar a trena, e a borda externa do quadro — que é onde qualquer um vai
 * medir — é outra coisa. Foi exatamente esse o erro do rótulo "138 × 72 cm" da foto
 * do ateliê: proporção 1,917 declarada contra 1,742 medida, 9,1% de diferença.
 *
 * ## A troca
 * Mede-se o que é fácil e sobra o que é difícil para a conta:
 *
 * > Prenda no quadro um retângulo de papel, meça os quatro lados e as duas
 * > diagonais com trena — **medida de aresta, que qualquer um faz certo** — e tire
 * > uma foto.
 *
 * Duas incógnitas (largura e altura do quadro), duas medidas conhecidas (largura e
 * altura do objeto): o sistema fecha. E as **diagonais sobram**, o que é melhor
 * ainda: elas não entram na conta e viram conferência independente. Se a diagonal
 * calculada não bater com a medida, alguma coisa está errada e ninguém precisa
 * adivinhar o quê.
 *
 * ## Como a conta funciona
 * Com o quadro levado a um quadrado de lado 1, a homografia fica **sem escala**: o
 * objeto aparece com largura `w` e altura `h` nesse quadrado, ambos frações. Aí:
 *
 * ```
 * largura do quadro = largura real do objeto / w
 * altura  do quadro = altura  real do objeto / h
 * ```
 */
import { MM, type Problema, type UM, type Vetor2 } from '@cad/motor';

import type { Calibracao } from './calibracao.js';
import { simplificarAnel } from './contorno.js';
import { estimarHomografia, projetar, type PontoImagem } from './homografia.js';
import { segmentar, type Imagem, type OpcoesDeSegmentacao } from './imagem.js';
import { detectarQuadro } from './quadro.js';
import { contornoDaRegiao, preencherBuracos, rotular } from './regioes.js';

/** O lado do quadrado normalizado. Inteiro grande para o arredondamento não doer. */
const LADO_NORMALIZADO = 1_000_000;

export interface ObjetoConhecido {
  readonly larguraUM: UM;
  readonly alturaUM: UM;
  /** Opcionais, e é justamente por sobrarem que servem de conferência. */
  readonly diagonal1UM?: UM;
  readonly diagonal2UM?: UM;
}

export interface Calibragem {
  /** A calibração deduzida, ou `null` quando alguma coisa não fecha. */
  readonly calibracao: Calibracao | null;
  readonly problemas: readonly Problema[];
  /**
   * Diferença entre a diagonal medida com trena e a que sai da calibração, em UM.
   *
   * É a **única** conferência independente que existe aqui: largura e altura foram
   * usadas na conta e vão bater por construção. A diagonal, não.
   */
  readonly erroDaDiagonalUM: number | null;
  readonly umPorPixel: number;
  /** Quantas manchas de papel apareceram. Mais de uma na foto de calibração é suspeito. */
  readonly manchasDePapel: number;
}

export interface OpcoesDeCalibragem extends OpcoesDeSegmentacao {
  readonly id?: string;
  readonly tenantId: string;
  readonly nome?: string;
  readonly areaMinimaFracao?: number;
  /** Acima deste erro de diagonal, a calibração é recusada. */
  readonly erroMaximoDaDiagonalUM?: UM;
}

/** 3 mm em ~1,5 m é o que a trena entrega na mão de gente. Acima disso, algo está errado. */
export const ERRO_MAXIMO_DA_DIAGONAL_UM = 3000;

function vazia(problemas: Problema[], manchas = 0): Calibragem {
  return {
    calibracao: null,
    problemas,
    erroDaDiagonalUM: null,
    umPorPixel: 0,
    manchasDePapel: manchas,
  };
}

/** Os quatro extremos das diagonais — para um retângulo mais ou menos alinhado. */
function quatroCantos(
  anel: readonly { x: number; y: number }[],
): [Vetor2, Vetor2, Vetor2, Vetor2] {
  const extremo = (f: (p: { x: number; y: number }) => number): Vetor2 => {
    const melhor = anel.reduce((m, p) => (f(p) < f(m) ? p : m));
    return { x: melhor.x, y: melhor.y };
  };
  return [
    extremo((p) => p.x + p.y),
    extremo((p) => -(p.x - p.y)),
    extremo((p) => -(p.x + p.y)),
    extremo((p) => p.x - p.y),
  ];
}

const dist = (a: Vetor2, b: Vetor2): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Deduz as medidas do quadro a partir de uma foto do objeto conhecido preso nele.
 *
 * Uma vez na vida, por quadro. Depois disso é só o quadro que importa, e a
 * distância e o ângulo de cada foto podem mudar à vontade — é para isso que a
 * homografia existe.
 */
export function calibrarComObjeto(
  img: Imagem,
  objeto: ObjetoConhecido,
  opcoes: OpcoesDeCalibragem,
): Calibragem {
  const problemas: Problema[] = [];

  if (objeto.larguraUM <= 0 || objeto.alturaUM <= 0) {
    problemas.push({
      gravidade: 'erro',
      codigo: 'MEDIDA_INVALIDA',
      mensagem: 'A largura e a altura do objeto de calibração precisam ser positivas.',
    });
    return vazia(problemas);
  }

  const quadro = detectarQuadro(img, opcoes);
  for (const p of quadro.problemas) {
    problemas.push({ gravidade: 'erro', codigo: p.codigo, mensagem: p.mensagem });
  }
  if (quadro.cantos === null) return vazia(problemas);

  // O quadro vira um QUADRADO de lado 1 (em unidades grandes). Assim a homografia
  // fica sem escala nenhuma, e é a escala que se quer descobrir.
  const h = estimarHomografia(quadro.cantos, [
    { x: 0, y: 0 },
    { x: LADO_NORMALIZADO, y: 0 },
    { x: LADO_NORMALIZADO, y: LADO_NORMALIZADO },
    { x: 0, y: LADO_NORMALIZADO },
  ]);

  const s = segmentar(img, opcoes);
  const areaMinima = Math.round(img.largura * img.altura * (opcoes.areaMinimaFracao ?? 0.002));
  const cheia = preencherBuracos(s.papel, img.largura, img.altura);
  const { rotulos, regioes } = rotular(cheia, img.largura, img.altura, areaMinima);

  if (regioes.length === 0) {
    problemas.push({
      gravidade: 'erro',
      codigo: 'CONTORNO_VAZIO',
      mensagem:
        'Nenhum papel encontrado dentro do quadro. A foto de calibração precisa do retângulo ' +
        'de medida conhecida preso no quadro, e só dele.',
    });
    return vazia(problemas);
  }
  if (regioes.length > 1) {
    problemas.push({
      gravidade: 'aviso',
      codigo: 'PECAS_DEMAIS',
      mensagem:
        `Apareceram ${regioes.length} manchas de papel; foi usada a maior. Na foto de ` +
        `calibração deve estar só o objeto de medida conhecida — mais nada.`,
    });
  }

  const emPixels = contornoDaRegiao(rotulos, img.largura, img.altura, regioes[0]!.rotulo);
  const normalizado = emPixels.map((p) => projetar(h, p));
  // A tolerância em unidades normalizadas: 1,5 px, convertido pela largura do quadro.
  const a = quadro.cantos[0];
  const b = quadro.cantos[1];
  const porPixel = LADO_NORMALIZADO / dist(a, b);
  const simples = simplificarAnel(
    normalizado.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    Math.round(1.5 * porPixel),
  );

  if (simples.length < 4) {
    problemas.push({
      gravidade: 'erro',
      codigo: 'CONTORNO_VAZIO',
      mensagem: `O objeto de calibração saiu com ${simples.length} vértice(s). Um retângulo tem 4.`,
    });
    return vazia(problemas, regioes.length);
  }

  const [infEsq, infDir, supDir, supEsq] = quatroCantos(simples);
  const larguraNorm = (dist(infEsq, infDir) + dist(supEsq, supDir)) / 2;
  const alturaNorm = (dist(infEsq, supEsq) + dist(infDir, supDir)) / 2;
  if (larguraNorm === 0 || alturaNorm === 0) {
    problemas.push({
      gravidade: 'erro',
      codigo: 'MEDIDA_INVALIDA',
      mensagem: 'O objeto de calibração saiu degenerado na foto (largura ou altura zero).',
    });
    return vazia(problemas, regioes.length);
  }

  // A conta. Duas incógnitas, duas medidas conhecidas.
  const larguraUM = Math.round((objeto.larguraUM * LADO_NORMALIZADO) / larguraNorm);
  const alturaUM = Math.round((objeto.alturaUM * LADO_NORMALIZADO) / alturaNorm);

  // A conferência independente: a diagonal não entrou na conta acima.
  let erroDaDiagonal: number | null = null;
  const medida =
    objeto.diagonal1UM !== undefined && objeto.diagonal2UM !== undefined
      ? (objeto.diagonal1UM + objeto.diagonal2UM) / 2
      : (objeto.diagonal1UM ?? objeto.diagonal2UM ?? null);
  if (medida !== null && medida > 0) {
    // A diagonal, convertida pela escala recém-descoberta. Como o quadro não é
    // quadrado, x e y têm escalas DIFERENTES: converter a diagonal por uma escala
    // só daria um número plausível e errado, e a conferência perderia a graça.
    const meiaX = (Math.abs(supDir.x - infEsq.x) + Math.abs(supEsq.x - infDir.x)) / 2;
    const meiaY = (Math.abs(supDir.y - infEsq.y) + Math.abs(supEsq.y - infDir.y)) / 2;
    const calculada = Math.hypot(
      (meiaX * larguraUM) / LADO_NORMALIZADO,
      (meiaY * alturaUM) / LADO_NORMALIZADO,
    );
    erroDaDiagonal = Math.round(Math.abs(calculada - medida));
    const limite = opcoes.erroMaximoDaDiagonalUM ?? ERRO_MAXIMO_DA_DIAGONAL_UM;
    if (erroDaDiagonal > limite) {
      problemas.push({
        gravidade: 'erro',
        codigo: 'NAO_E_RETANGULO',
        mensagem:
          `A diagonal do objeto mede ${(medida / MM).toFixed(1)} mm na trena e ` +
          `${(calculada / MM).toFixed(1)} mm pela calibração — ` +
          `${(erroDaDiagonal / MM).toFixed(1)} mm de diferença. ` +
          `Ou o objeto não é retângulo, ou ele está torto na foto, ou uma das medidas ` +
          `saiu errada. A calibração NÃO foi aceita.`,
      });
      return vazia(problemas, regioes.length);
    }
  } else {
    problemas.push({
      gravidade: 'aviso',
      codigo: 'DIAGONAL_AUSENTE',
      mensagem:
        'Sem a diagonal do objeto não há conferência independente: largura e altura entram ' +
        'na conta e batem por construção, mesmo que estejam erradas. Meça a diagonal.',
    });
  }

  const calibracao: Calibracao = {
    id: opcoes.id ?? 'cal-1',
    tenantId: opcoes.tenantId,
    nome: opcoes.nome ?? 'quadro do ateliê',
    larguraUM,
    alturaUM,
    diagonal1UM: Math.round(Math.hypot(larguraUM, alturaUM)),
    diagonal2UM: Math.round(Math.hypot(larguraUM, alturaUM)),
  };

  return {
    calibracao,
    problemas,
    erroDaDiagonalUM: erroDaDiagonal,
    umPorPixel: larguraUM / dist(a, b),
    manchasDePapel: regioes.length,
  };
}

/** Ajuda o app a montar a chamada sem inverter argumentos. */
export function objetoConhecidoMM(
  larguraMM: number,
  alturaMM: number,
  diagonal1MM?: number,
  diagonal2MM?: number,
): ObjetoConhecido {
  return {
    larguraUM: Math.round(larguraMM * MM),
    alturaUM: Math.round(alturaMM * MM),
    ...(diagonal1MM === undefined ? {} : { diagonal1UM: Math.round(diagonal1MM * MM) }),
    ...(diagonal2MM === undefined ? {} : { diagonal2UM: Math.round(diagonal2MM * MM) }),
  };
}

/** Um ponto de imagem, reexportado para quem só usa a calibração. */
export type { PontoImagem };
