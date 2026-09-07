/**
 * A foto vira EVENTOS.
 *
 * Decisão **I6**: igual ao importador de DXF. A peça digitalizada entra pelo log, e
 * por isso **todas** as ferramentas do editor funcionam nela sem exceção — espelhar,
 * eixo de dobra, graduação, encaixe. Nada aqui é um caminho paralelo.
 *
 * ## O que esta função recusa fazer
 * Ela para, sem emitir peça nenhuma, quando:
 *
 * - o quadro não aparece na foto (**I1** — sem referência não há escala, e um
 *   contorno perfeito fora de escala é um molde errado em toda parte ao mesmo tempo);
 * - a proporção do quadro na foto discorda da calibração declarada (o caso medido
 *   do rótulo "138 × 72 cm", que a homografia aceitaria em silêncio).
 *
 * Recusar é o comportamento certo: **I9**, nunca consertar sem avisar.
 */
import {
  MM,
  type Evento,
  type Id,
  type Problema,
  type UM,
  type Vetor2,
} from '@cad/motor';

import { cantosDoQuadro, conferirCalibracao, type Calibracao } from './calibracao.js';
import {
  ajustarCurvas,
  detectarCantos,
  detectarPiques,
  garantirCCW,
  removerPiques,
} from './contorno.js';
import { estimarHomografia, paraUM } from './homografia.js';
import { segmentar, type Imagem, type OpcoesDeSegmentacao } from './imagem.js';
import { conferirQuadroContraCalibracao, detectarQuadro } from './quadro.js';
import { contornoDaRegiao, preencherBuracos, rotular } from './regioes.js';
import { simplificarAnel } from './contorno.js';

/** Encaixe padrão de peça digitalizada: o modelista ajusta depois (I10). */
const ENCAIXE_PADRAO = {
  quantidadePorModelo: 1,
  giro: '180' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

export interface OpcoesDeDigitalizacao extends OpcoesDeSegmentacao {
  readonly tenantId: string;
  readonly modeloId: Id;
  readonly autor: string;
  readonly gerarId: () => Id;
  readonly agora?: () => string;
  readonly calibracao: Calibracao;
  readonly tamanhos?: readonly string[];
  /**
   * Margem de costura de cada aresta, em UM.
   *
   * **Zero por padrão, e é decisão (I4).** A foto dá a borda do papel, e na maioria
   * das confecções o molde de papel já inclui a costura — então a borda fotografada
   * É o contorno. Quem trabalha com molde sem margem declara aqui, e ela cresce
   * para FORA, no sentido natural do motor.
   */
  readonly margemUM?: UM;
  /**
   * Tolerância de simplificação e de ajuste, em UM.
   *
   * Sem ela, sai de 1,5 pixel — porque abaixo do pixel não existe desenho, existe
   * escada de quantização, e pedir precisão ali é fingir.
   */
  readonly toleranciaUM?: UM;
  /** Fração da imagem abaixo da qual uma mancha é respingo, não peça. */
  readonly areaMinimaFracao?: number;
  /** Nome de cada peça, na ordem da maior para a menor. O que faltar vira "Peça N". */
  readonly nomes?: readonly string[];
}

export interface PecaDigitalizada {
  readonly pecaId: Id;
  readonly nome: string;
  readonly larguraUM: UM;
  readonly alturaUM: UM;
  readonly perimetroUM: UM;
  readonly pontos: number;
  readonly cantos: number;
  readonly curvas: number;
  readonly retas: number;
  readonly piques: number;
}

export interface Digitalizacao {
  readonly eventos: readonly Evento[];
  readonly problemas: readonly Problema[];
  readonly umPorPixel: number;
  readonly toleranciaUM: UM;
  readonly marcasDoQuadro: number;
  readonly residuoDoQuadroUM: UM;
  readonly pecas: readonly PecaDigitalizada[];
}

/**
 * Soma de verificação da imagem (FNV-1a de 32 bits, em hexadecimal).
 *
 * Identifica a foto no log; **não** a autentica. Escolhida por ser síncrona e
 * rodar igual no Node e no navegador — `crypto.subtle` é assíncrono e obrigaria
 * toda a digitalização a ser assíncrona por causa de uma linha de procedência.
 */
export function somaDaImagem(img: Imagem): string {
  let h = 0x811c9dc5;
  // De 4 em 4 pixels: a soma é identidade, não integridade, e varrer 3 milhões de
  // bytes por foto para isso seria desperdício.
  for (let i = 0; i < img.dados.length; i += 16) {
    h ^= img.dados[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const perimetroDe = (anel: readonly Vetor2[]): number => {
  let soma = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    soma += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return soma;
};

function vazia(problemas: Problema[]): Digitalizacao {
  return {
    eventos: [],
    problemas,
    umPorPixel: 0,
    toleranciaUM: 0,
    marcasDoQuadro: 0,
    residuoDoQuadroUM: 0,
    pecas: [],
  };
}

/** Foto + calibração → eventos do motor. Determinístico, a menos dos ids e do relógio. */
export function digitalizar(img: Imagem, opcoes: OpcoesDeDigitalizacao): Digitalizacao {
  const problemas: Problema[] = [];

  for (const p of conferirCalibracao(opcoes.calibracao)) {
    problemas.push({ gravidade: 'erro', codigo: p.codigo, mensagem: p.mensagem });
  }
  if (problemas.length > 0) return vazia(problemas);

  const quadro = detectarQuadro(img, opcoes);
  for (const p of quadro.problemas) {
    problemas.push({ gravidade: 'erro', codigo: p.codigo, mensagem: p.mensagem });
  }
  if (quadro.cantos === null) return vazia(problemas);

  for (const p of conferirQuadroContraCalibracao(quadro, opcoes.calibracao)) {
    problemas.push({ gravidade: 'erro', codigo: p.codigo, mensagem: p.mensagem });
  }
  if (problemas.length > 0) return vazia(problemas);

  const h = estimarHomografia(quadro.cantos, [...cantosDoQuadro(opcoes.calibracao)]);

  // Quantos micrômetros vale um pixel, medido no lado de baixo do quadro. É o teto
  // de precisão da foto, e é ele que dita a tolerância.
  const a = quadro.cantos[0];
  const b = quadro.cantos[1];
  const umPorPixel = opcoes.calibracao.larguraUM / Math.hypot(b.x - a.x, b.y - a.y);
  const tolerancia = opcoes.toleranciaUM ?? Math.round(1.5 * umPorPixel);

  const s = segmentar(img, opcoes);
  const areaMinima = Math.round(
    img.largura * img.altura * (opcoes.areaMinimaFracao ?? 0.0005),
  );
  const cheia = preencherBuracos(s.papel, img.largura, img.altura);
  const { rotulos, regioes } = rotular(cheia, img.largura, img.altura, areaMinima);

  if (regioes.length === 0) {
    problemas.push({
      gravidade: 'erro',
      codigo: 'CONTORNO_VAZIO',
      mensagem:
        `Nenhuma peça de papel encontrada dentro do quadro (${(s.fracaoPapel * 100).toFixed(1)}% ` +
        `da imagem deu papel). Confira a luz e se os moldes estão no quadro.`,
    });
    return vazia(problemas);
  }

  const tamanhos = opcoes.tamanhos ?? ['M'];
  const relogio = opcoes.agora ?? ((): string => new Date().toISOString());
  const envelope = (
    pecaId: Id | null,
  ): {
    id: Id;
    tenantId: string;
    modeloId: Id;
    pecaId: Id | null;
    timestamp: string;
    autor: string;
    versaoSchema: number;
  } => ({
    id: opcoes.gerarId(),
    tenantId: opcoes.tenantId,
    modeloId: opcoes.modeloId,
    pecaId,
    timestamp: relogio(),
    autor: opcoes.autor,
    versaoSchema: 1,
  });

  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: opcoes.modeloId, tamanhos: [...tamanhos], tamanhoBase: tamanhos[0]! },
    } as Evento,
    {
      ...envelope(null),
      tipo: 'DigitalizarPorFoto',
      payload: {
        calibracaoId: opcoes.calibracao.id,
        imagemSoma: somaDaImagem(img),
        larguraPx: img.largura,
        alturaPx: img.altura,
        umPorPixel: Math.round(umPorPixel),
        residuoDoQuadroUM: Math.round(quadro.residuoPx * umPorPixel),
        toleranciaUM: tolerancia,
      },
    } as Evento,
  ];

  const margem = opcoes.margemUM ?? 0;
  const pecas: PecaDigitalizada[] = [];

  regioes.forEach((regiao, indice) => {
    const pecaId = `pec-${indice}`;
    const nome = opcoes.nomes?.[indice] ?? `Peça ${indice + 1}`;

    const emPixels = contornoDaRegiao(rotulos, img.largura, img.altura, regiao.rotulo);
    const emUM = garantirCCW(emPixels.map((p) => paraUM(h, p)));
    const simples = simplificarAnel(emUM, tolerancia);
    const { anel, piques } = removerPiques(simples, detectarPiques(simples));

    if (anel.length < 3) {
      problemas.push({
        gravidade: 'aviso',
        codigo: 'CONTORNO_VAZIO',
        mensagem:
          `A mancha ${indice + 1} sobrou com ${anel.length} ponto(s) depois da simplificação ` +
          `e não virou peça. Provavelmente era respingo.`,
      });
      return;
    }

    const cantos = detectarCantos(anel, 30, Math.max(8000, 8 * tolerancia));
    const trechos = ajustarCurvas(anel, cantos, tolerancia);

    eventos.push({
      ...envelope(pecaId),
      tipo: 'CriarPeca',
      payload: { nome, encaixe: ENCAIXE_PADRAO },
    } as Evento);

    // Um ponto por extremo de trecho: é o desenho ajustado que entra no modelo, e
    // não a nuvem de pixels. A nuvem já cumpriu o papel dela no ajuste.
    const vertices = trechos.map((t) => t.de);
    vertices.forEach((v, i) =>
      eventos.push({
        ...envelope(pecaId),
        tipo: 'CriarPonto',
        payload: { pontoId: `${pecaId}-pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
      } as Evento),
    );

    // Uma ARESTA por trecho. É o nível em que a margem e o pique se ancoram, e é o
    // que sobrevive à edição do contorno (D3 da Fase 1).
    trechos.forEach((_, i) =>
      eventos.push({
        ...envelope(pecaId),
        tipo: 'DefinirAresta',
        payload: {
          arestaId: `${pecaId}-ar-${i}`,
          pontoInicioId: `${pecaId}-pt-${i}`,
          pontoFimId: `${pecaId}-pt-${(i + 1) % vertices.length}`,
        },
      } as Evento),
    );

    trechos.forEach((t, i) =>
      eventos.push({
        ...envelope(pecaId),
        tipo: 'DefinirSegmento',
        payload: {
          segmentoId: `${pecaId}-sg-${i}`,
          arestaId: `${pecaId}-ar-${i}`,
          de: `${pecaId}-pt-${i}`,
          para: `${pecaId}-pt-${(i + 1) % vertices.length}`,
          ...(t.tipo === 'curva' && t.controles !== null
            ? { tipo: 'curva' as const, controles: t.controles }
            : { tipo: 'reta' as const }),
        },
      } as Evento),
    );

    trechos.forEach((_, i) =>
      eventos.push({
        ...envelope(pecaId),
        tipo: 'DefinirMargem',
        payload: { arestaId: `${pecaId}-ar-${i}`, margemUM: margem },
      } as Evento),
    );

    // Piques: o `s` do motor é fração do comprimento da ARESTA, então o valor em
    // comprimento de arco tem que ser dividido pela aresta em que ele caiu.
    const comprimentoTotal = perimetroDe(anel);
    for (const [k, p] of piques.entries()) {
      const fracaoNoContorno = comprimentoTotal === 0 ? 0 : p.sUM / comprimentoTotal;
      const qual = Math.min(trechos.length - 1, Math.floor(fracaoNoContorno * trechos.length));
      const dentro = fracaoNoContorno * trechos.length - qual;
      eventos.push({
        ...envelope(pecaId),
        tipo: 'AdicionarPique',
        payload: {
          piqueId: `${pecaId}-pq-${k}`,
          arestaId: `${pecaId}-ar-${qual}`,
          s: Math.max(0, Math.min(1, dentro)),
          // 'V' e o pique que um corte em V na borda produz, e e o que a deteccao
          // acha: boca estreita, fundo fechando em ponta. O modelista troca depois
          // se o notcher dele faz outro (I10).
          tipo: 'V',
          alturaUM: p.fundoUM,
          larguraUM: p.bocaUM,
          anguloGraus: 0,
        },
      } as Evento);
    }

    const xs = anel.map((p) => p.x);
    const ys = anel.map((p) => p.y);
    pecas.push({
      pecaId,
      nome,
      larguraUM: Math.max(...xs) - Math.min(...xs),
      alturaUM: Math.max(...ys) - Math.min(...ys),
      perimetroUM: Math.round(comprimentoTotal),
      pontos: vertices.length,
      cantos: cantos.length,
      curvas: trechos.filter((t) => t.tipo === 'curva').length,
      retas: trechos.filter((t) => t.tipo === 'reta').length,
      piques: piques.length,
    });
  });

  if (margem === 0) {
    problemas.push({
      gravidade: 'aviso',
      codigo: 'MARGEM_AUSENTE',
      mensagem:
        'As margens entraram ZERO: a borda fotografada virou o contorno, como se o molde de ' +
        'papel já incluísse a costura. Se não incluir, declare a margem antes de cortar — o ' +
        'motor não assume nenhuma.',
    });
  }
  if (umPorPixel > 0.7 * MM) {
    problemas.push({
      gravidade: 'aviso',
      codigo: 'RESOLUCAO_BAIXA',
      mensagem:
        `Cada pixel desta foto vale ${(umPorPixel / MM).toFixed(3)} mm. Um pique tem 1,6 mm de ` +
        `boca: nesta resolução ele ocupa ~${(1.6 / (umPorPixel / MM)).toFixed(1)} pixel(s) e não ` +
        `é detectável. Fotografe mais perto ou em resolução maior para os piques saírem.`,
    });
  }

  return {
    eventos,
    problemas,
    umPorPixel,
    toleranciaUM: tolerancia,
    marcasDoQuadro: quadro.marcas.length,
    residuoDoQuadroUM: Math.round(quadro.residuoPx * umPorPixel),
    pecas,
  };
}
