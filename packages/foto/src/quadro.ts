/**
 * Achar o quadro de calibração na foto: as marcas da borda, e os quatro cantos.
 *
 * ## Por que ajustar RETA, e não usar os quatro cantos direto
 * O quadro do ateliê tem a borda recortada em dezenas de semicírculos brancos. A
 * tentação é pegar a marca de cada canto e pronto — quatro pontos, homografia
 * fechada. Mas aí o erro de detecção de **uma** marca vira erro de escala do molde
 * inteiro, e já está medido o que isso custa: 1 px de erro numa referência de
 * 1380 mm dá 0,218 mm numa peça de 700 mm.
 *
 * Ajustando uma **reta por lado**, com todas as marcas daquele lado, o erro de cada
 * marca é diluído pela raiz do número delas. Com ~40 marcas por lado, o erro cai
 * por volta de 6×. Os cantos saem do cruzamento das retas ajustadas, e nenhum deles
 * depende de uma marca só.
 *
 * ## O que a calibração precisa medir — e é fácil errar
 * Os cantos que saem daqui são o cruzamento das linhas que passam pelos **centros**
 * das marcas. Esse retângulo é **menor** que a borda externa do quadro. Se alguém
 * medir a borda externa com a trena e digitar aquilo, a escala inteira sai errada
 * por vários milímetros.
 *
 * A medida certa é de **centro de marca a centro de marca**: do centro do
 * semicírculo de um canto ao centro do semicírculo do canto oposto, em cada lado.
 * Acertar o centro de um círculo de 2 cm a olho dá ±2 mm, que em 1380 mm é 0,14% —
 * e é uma medida só, uma vez na vida.
 */
import { EigenvalueDecomposition, Matrix, solve } from 'ml-matrix';

import { segmentar, type Imagem, type OpcoesDeSegmentacao } from './imagem.js';
import { rotular } from './regioes.js';
import type { PontoImagem } from './homografia.js';

export interface Marca {
  readonly x: number;
  readonly y: number;
  readonly area: number;
}

export interface ProblemaDoQuadro {
  readonly codigo:
    | 'MARCAS_INSUFICIENTES'
    | 'LADO_SEM_MARCAS'
    | 'QUADRO_DEGENERADO'
    | 'MARCAS_FORA_DE_LINHA';
  readonly mensagem: string;
}

export interface QuadroDetectado {
  /** Todas as marcas aceitas, já filtradas por tamanho. */
  readonly marcas: readonly Marca[];
  /** Quantas marcas ficaram em cada lado, na ordem baixo, direita, cima, esquerda. */
  readonly porLado: readonly [number, number, number, number];
  /**
   * Os quatro cantos em pixels, na ordem que o resto do pacote assume:
   * inferior-esquerdo, inferior-direito, superior-direito, superior-esquerdo —
   * "inferior" no sentido do MUNDO (Y para cima), que na imagem é embaixo.
   */
  readonly cantos: readonly [PontoImagem, PontoImagem, PontoImagem, PontoImagem] | null;
  /** Pior distância de uma marca à reta ajustada do lado dela, em pixels. */
  readonly residuoPx: number;
  readonly problemas: readonly ProblemaDoQuadro[];
}

export interface OpcoesDoQuadro extends OpcoesDeSegmentacao {
  /** Área mínima de uma marca, em pixels. Abaixo disso é respingo. */
  readonly areaMinima?: number;
  /**
   * Quanto uma marca pode fugir da mediana de área e ainda ser marca.
   *
   * A borda é um padrão repetido: as marcas têm todas o mesmo tamanho, a menos da
   * perspectiva. O que destoa é outra coisa — barra de programa, etiqueta, reflexo
   * numa quina. Na foto do ateliê, a maior mancha branca tinha 28 693 px contra uma
   * mediana de 115: era a barra do programa, e some sozinha com este filtro.
   */
  readonly fatorDeArea?: number;
}

const mediana = (v: readonly number[]): number => {
  const o = [...v].sort((a, b) => a - b);
  return o.length === 0 ? 0 : o[Math.floor(o.length / 2)]!;
};

/** Reta ajustada por mínimos quadrados TOTAIS: `a·x + b·y = c`, com `a² + b² = 1`. */
interface Reta {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/**
 * Ajusta a reta pelo eixo PRINCIPAL da nuvem, e não por `y = mx + n`.
 *
 * `y = mx + n` explode quando o lado é vertical — e dois dos quatro lados sempre
 * são. Mínimos quadrados totais não têm eixo preferido: a reta é a direção de maior
 * variância, que vem do autovetor da covariância (via `ml-matrix`).
 */
function ajustarReta(pontos: readonly Marca[]): Reta {
  const n = pontos.length;
  const mx = pontos.reduce((s, p) => s + p.x, 0) / n;
  const my = pontos.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pontos) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const cov = new Matrix([
    [sxx / n, sxy / n],
    [sxy / n, syy / n],
  ]);
  const eig = new EigenvalueDecomposition(cov);
  const valores = eig.realEigenvalues;
  const menor = valores[0]! <= valores[1]! ? 0 : 1;
  // O autovetor do MENOR autovalor é a normal da reta.
  const a = eig.eigenvectorMatrix.get(0, menor);
  const b = eig.eigenvectorMatrix.get(1, menor);
  const norma = Math.hypot(a, b) || 1;
  return { a: a / norma, b: b / norma, c: (a * mx + b * my) / norma };
}

const distancia = (r: Reta, p: { x: number; y: number }): number =>
  Math.abs(r.a * p.x + r.b * p.y - r.c);

function cruzar(r: Reta, s: Reta): PontoImagem | null {
  try {
    const v = solve(
      new Matrix([
        [r.a, r.b],
        [s.a, s.b],
      ]),
      new Matrix([[r.c], [s.c]]),
    ).to1DArray();
    if (!Number.isFinite(v[0]!) || !Number.isFinite(v[1]!)) return null;
    return { x: v[0]!, y: v[1]! };
  } catch {
    return null;
  }
}

/** Distância ao SEGMENTO a–b, e onde ao longo dele (0 a 1) o pé da perpendicular cai. */
function aoSegmento(
  p: { x: number; y: number },
  a: PontoImagem,
  b: PontoImagem,
): { distancia: number; t: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const comprimento = vx * vx + vy * vy;
  const bruto = comprimento === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / comprimento;
  const t = Math.max(0, Math.min(1, bruto));
  return { distancia: Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)), t: bruto };
}

/**
 * Quanto de cada ponta do lado é ignorado no ajuste da reta.
 *
 * A marca de canto é compartilhada entre dois lados, e entra torta em qualquer um
 * deles que a pegue. Medido na foto do ateliê: com as pontas dentro, o desvio da
 * reta ia a 4,6 px nas extremidades enquanto o miolo ficava em 1,4 px. Tirar 8% de
 * cada ponta remove a marca do canto e deixa o resto — e os cantos continuam
 * saindo do CRUZAMENTO das retas, que é onde eles devem sair.
 */
const MARGEM_DA_PONTA = 0.08;

/**
 * Acha o quadro: segmenta o branco neutro, filtra as marcas e ajusta os quatro lados.
 *
 * Nunca "conserta" (I9): lado sem marca suficiente, marca fora de linha, quadro
 * degenerado — tudo sai como problema, e `cantos` vem `null`.
 */
export function detectarQuadro(img: Imagem, opcoes: OpcoesDoQuadro = {}): QuadroDetectado {
  const problemas: ProblemaDoQuadro[] = [];
  const s = segmentar(img, opcoes);
  const areaMinima = opcoes.areaMinima ?? 20;
  const fator = opcoes.fatorDeArea ?? 4;

  const brutas = rotular(s.bordaDoQuadro, img.largura, img.altura, areaMinima).regioes;
  const med = mediana(brutas.map((r) => r.area));
  const marcas: Marca[] = brutas
    .filter((r) => r.area >= med / fator && r.area <= med * fator)
    .map((r) => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2, area: r.area }));

  if (marcas.length < 8) {
    problemas.push({
      codigo: 'MARCAS_INSUFICIENTES',
      mensagem:
        `Só ${marcas.length} marca(s) de borda encontradas (mediana de área ${med} px). ` +
        `Sem a borda do quadro não há escala: confira o enquadramento e a luz.`,
    });
    return { marcas, porLado: [0, 0, 0, 0], cantos: null, residuoPx: 0, problemas };
  }

  // Passo 1 — quatro cantos aproximados pelos extremos das diagonais. A foto é
  // tirada mais ou menos de frente, então o quadro está mais ou menos alinhado com
  // a imagem, e isto acerta o canto certo sem precisar de fecho convexo.
  const extremo = (f: (m: Marca) => number): Marca =>
    marcas.reduce((melhor, m) => (f(m) < f(melhor) ? m : melhor));
  const supEsq = extremo((m) => m.x + m.y);
  const infDir = extremo((m) => -(m.x + m.y));
  const supDir = extremo((m) => -(m.x - m.y));
  const infEsq = extremo((m) => m.x - m.y);

  // Na imagem Y cresce para BAIXO; no mundo, para cima. O canto que a imagem chama
  // de "superior esquerdo" é o superior esquerdo do MUNDO também — o que inverte é
  // a ordem de percurso, e é por isso que a lista sai como abaixo.
  const aprox: [PontoImagem, PontoImagem, PontoImagem, PontoImagem] = [infEsq, infDir, supDir, supEsq];

  // Passo 2 — cada marca vai para o lado mais perto, e o que está longe de todos
  // os lados é descartado: etiqueta, moldura, reflexo solto.
  const diagonal = Math.hypot(img.largura, img.altura);
  const limite = diagonal * 0.03;
  const lados: Marca[][] = [[], [], [], []];
  let soltas = 0;
  let pontas = 0;
  for (const m of marcas) {
    let melhor = -1;
    let menor = Infinity;
    let melhorT = 0;
    for (let k = 0; k < 4; k++) {
      const { distancia: d, t } = aoSegmento(m, aprox[k]!, aprox[(k + 1) % 4]!);
      if (d < menor) {
        menor = d;
        melhor = k;
        melhorT = t;
      }
    }
    if (menor > limite) {
      soltas++;
      continue;
    }
    if (melhorT < MARGEM_DA_PONTA || melhorT > 1 - MARGEM_DA_PONTA) {
      pontas++;
      continue;
    }
    lados[melhor]!.push(m);
  }
  void pontas;

  const porLado: [number, number, number, number] = [
    lados[0]!.length,
    lados[1]!.length,
    lados[2]!.length,
    lados[3]!.length,
  ];
  const nomes = ['de baixo', 'da direita', 'de cima', 'da esquerda'];
  for (let k = 0; k < 4; k++) {
    if (lados[k]!.length < 2) {
      problemas.push({
        codigo: 'LADO_SEM_MARCAS',
        mensagem:
          `O lado ${nomes[k]} do quadro tem ${lados[k]!.length} marca(s), e uma reta precisa de 2. ` +
          `O quadro provavelmente saiu cortado na foto.`,
      });
    }
  }
  if (soltas > marcas.length / 4) {
    problemas.push({
      codigo: 'MARCAS_FORA_DE_LINHA',
      mensagem:
        `${soltas} de ${marcas.length} manchas brancas não caíram em nenhum lado do quadro. ` +
        `Alguma coisa branca está no quadro que não é a borda.`,
    });
  }
  if (problemas.some((p) => p.codigo === 'LADO_SEM_MARCAS')) {
    return { marcas, porLado, cantos: null, residuoPx: 0, problemas };
  }

  // Passo 3 — uma reta por lado, e os cantos no cruzamento das retas vizinhas.
  const retas = lados.map(ajustarReta);
  let residuo = 0;
  for (let k = 0; k < 4; k++) {
    for (const m of lados[k]!) residuo = Math.max(residuo, distancia(retas[k]!, m));
  }

  const cantos: PontoImagem[] = [];
  for (let k = 0; k < 4; k++) {
    // O canto k é o cruzamento do lado que chega nele com o que sai dele.
    const p = cruzar(retas[(k + 3) % 4]!, retas[k]!);
    if (p === null) {
      problemas.push({
        codigo: 'QUADRO_DEGENERADO',
        mensagem: 'Dois lados do quadro saíram paralelos e não se cruzam. Refaça a foto de frente.',
      });
      return { marcas, porLado, cantos: null, residuoPx: residuo, problemas };
    }
    cantos.push(p);
  }

  return {
    marcas,
    porLado,
    cantos: [cantos[0]!, cantos[1]!, cantos[2]!, cantos[3]!],
    residuoPx: residuo,
    problemas,
  };
}

/**
 * A proporção largura/altura que o quadro TEM na foto, medida nos quatro lados.
 *
 * Não é medida exata — perspectiva encurta o lado que está mais longe. Serve de
 * alarme de fumaça, e alarme de fumaça é o que faltava aqui.
 */
export function aspectoDetectado(cantos: QuadroDetectado['cantos']): number | null {
  if (cantos === null) return null;
  const d = (a: PontoImagem, b: PontoImagem): number => Math.hypot(b.x - a.x, b.y - a.y);
  const largura = (d(cantos[0], cantos[1]) + d(cantos[3], cantos[2])) / 2;
  const altura = (d(cantos[0], cantos[3]) + d(cantos[1], cantos[2])) / 2;
  return altura === 0 ? null : largura / altura;
}

/**
 * Diferença máxima tolerada entre a proporção medida e a declarada.
 *
 * A perspectiva de uma foto tirada de frente mexe na proporção aparente na casa de
 * poucos por cento — na foto do ateliê, os lados opostos diferem 0,4% e 4,6%. 8%
 * deixa a perspectiva passar e ainda pega erro de medida ou de digitação, que é o
 * que interessa: um erro de 10% na calibração estica TODO molde digitalizado em
 * 10% num eixo só, e nada na tela denuncia.
 */
export const TOLERANCIA_DE_ASPECTO = 0.08;

/**
 * Confere a calibração declarada contra o quadro que apareceu na foto.
 *
 * Existe por causa de um caso real, e ele é a melhor propaganda da decisão I1. A
 * foto do ateliê traz escrito "138 x 72 cm", que dá proporção 1,917. O quadro
 * medido na própria foto dá **1,742** — 9% de diferença, com pixel comprovadamente
 * quadrado (as marcas semicirculares saem 17 × 9 e 8 × 16 px, e √(2 × 0,5) = 1,000).
 *
 * Ou seja: aquele rótulo **não descreve** o retângulo que passa pelos centros das
 * marcas. Se a calibração fosse aceita assim, a homografia absorveria a diferença
 * sem reclamar — ela leva qualquer quadrilátero em qualquer retângulo — e todo
 * molde sairia esticado 9% num eixo. Silenciosamente.
 */
export function conferirQuadroContraCalibracao(
  quadro: QuadroDetectado,
  calibracao: { larguraUM: number; alturaUM: number },
): ProblemaDoQuadro[] {
  const medido = aspectoDetectado(quadro.cantos);
  if (medido === null) return [];
  const declarado = calibracao.larguraUM / calibracao.alturaUM;
  const diferenca = Math.abs(medido - declarado) / declarado;
  if (diferenca <= TOLERANCIA_DE_ASPECTO) return [];

  const larguraMM = calibracao.larguraUM / 1000;
  const alturaMM = calibracao.alturaUM / 1000;
  return [
    {
      codigo: 'MARCAS_FORA_DE_LINHA',
      mensagem:
        `A calibração diz ${larguraMM.toFixed(0)} × ${alturaMM.toFixed(0)} mm ` +
        `(proporção ${declarado.toFixed(3)}), mas o quadro na foto tem proporção ` +
        `${medido.toFixed(3)} — ${(diferenca * 100).toFixed(1)}% de diferença. ` +
        `Para essa proporção, seria ${larguraMM.toFixed(0)} × ${(larguraMM / medido).toFixed(0)} mm ` +
        `ou ${(alturaMM * medido).toFixed(0)} × ${alturaMM.toFixed(0)} mm. ` +
        `Meça de CENTRO de marca a CENTRO de marca, e não a borda externa do quadro.`,
    },
  ];
}
