/**
 * Traçar moldes de uma imagem QUALQUER — sem quadro, sem escala: o BRINQUEDO.
 *
 * O caminho de produção (`digitalizar`) recusa foto sem quadro, e recusa por
 * princípio (I1): sem referência não há escala, e contorno perfeito fora de
 * escala é molde errado em toda parte ao mesmo tempo. Este arquivo NÃO fura
 * esse princípio — ele atende outro pedido: pegar uma imagem de molde da
 * internet e pôr as peças no palco para MEXER, demonstrar e brincar. A escala
 * é declaradamente inventada (a imagem inteira vale `larguraMM`), todo
 * resultado carrega o aviso, e o nome do modelo grita DEMO.
 *
 * ## Como acha "só os moldes"
 * Imagem de internet vem de dois jeitos, e o mesmo truque serve para os dois:
 *
 *  - DIAGRAMA: fundo branco, moldes desenhados em linha escura. O fundo é o
 *    branco que ENCOSTA na borda da imagem; o interior de cada molde é branco
 *    também, mas cercado de tinta — não se chega nele pela borda.
 *  - FOTO: papel claro sobre mesa escura (ou o contrário). O fundo é a classe
 *    de cor da borda; o papel é o resto.
 *
 * Então: limiar de Otsu separa claro de escuro; a classe MAJORITÁRIA da borda
 * é "fundo"; inundação a partir da borda marca todo o fundo alcançável; o que
 * sobrar — tinta E interiores cercados — é molde. Buraco dentro de molde é
 * preenchido, mancha pequena é respingo, e uma "peça" que cobre a imagem
 * quase inteira é segmentação falhada e vira recusa explicada.
 */
import { MM, type Evento, type Id, type Problema, type UM, type Vetor2 } from '@cad/motor';

import {
  ajustarCurvas,
  detectarCantos,
  garantirCCW,
  simplificarAnel,
} from './contorno.js';
import type { Imagem, Mascara } from './imagem.js';
import { contornoDaRegiao, preencherBuracos, rotular } from './regioes.js';
import { somaDaImagem, type PecaDigitalizada } from './digitalizar.js';

/** Encaixe padrão do brinquedo: igual ao da digitalização (I10 — ajusta depois). */
const ENCAIXE_PADRAO = {
  quantidadePorModelo: 1,
  giro: '180' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

export interface OpcoesDoBrinquedo {
  readonly tenantId: string;
  readonly modeloId: Id;
  readonly autor: string;
  readonly gerarId: () => Id;
  readonly agora?: () => string;
  /**
   * Quantos milímetros a LARGURA da imagem inteira vale. Padrão 1000 — um
   * molde que ocupa metade da imagem sai com ~meio metro, tamanho de gente.
   * É chute declarado, não medida: o aviso vai junto em todo resultado.
   */
  readonly larguraMM?: number;
  /** Fração da imagem abaixo da qual uma mancha é respingo. Padrão 0,2%. */
  readonly areaMinimaFracao?: number;
  readonly tamanhos?: readonly string[];
}

export interface Brinquedo {
  readonly eventos: readonly Evento[];
  readonly problemas: readonly Problema[];
  readonly umPorPixel: number;
  readonly pecas: readonly PecaDigitalizada[];
}

const vazio = (problemas: Problema[]): Brinquedo => ({
  eventos: [],
  problemas,
  umPorPixel: 0,
  pecas: [],
});

/** Luminância inteira 0–255 (Rec. 601, a mesma conta de `imagem.ts`). */
function luminancia(img: Imagem): Uint8Array {
  const saida = new Uint8Array(img.largura * img.altura);
  for (let i = 0, p = 0; i < saida.length; i++, p += 4) {
    saida[i] =
      (299 * img.dados[p]! + 587 * img.dados[p + 1]! + 114 * img.dados[p + 2]!) / 1000;
  }
  return saida;
}

/** Limiar de Otsu: separa claro de escuro maximizando a variância entre classes. */
function limiarDeOtsu(lum: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of lum) hist[v]!++;
  const total = lum.length;
  let somaTotal = 0;
  for (let t = 0; t < 256; t++) somaTotal += t * hist[t]!;

  let somaFundo = 0;
  let pesoFundo = 0;
  let melhor = 127;
  let melhorVariancia = -1;
  for (let t = 0; t < 256; t++) {
    pesoFundo += hist[t]!;
    if (pesoFundo === 0) continue;
    const pesoFrente = total - pesoFundo;
    if (pesoFrente === 0) break;
    somaFundo += t * hist[t]!;
    const mediaFundo = somaFundo / pesoFundo;
    const mediaFrente = (somaTotal - somaFundo) / pesoFrente;
    const variancia = pesoFundo * pesoFrente * (mediaFundo - mediaFrente) ** 2;
    if (variancia > melhorVariancia) {
      melhorVariancia = variancia;
      melhor = t;
    }
  }
  return melhor;
}

/**
 * A máscara do MOLDE: tudo que não é fundo alcançável pela borda.
 * Devolve também a fração de borda que é fundo — borda muito misturada é sinal
 * de imagem que este truque não entende.
 */
function mascaraDoMolde(img: Imagem): { molde: Mascara; fracaoDaBordaNoFundo: number } {
  const { largura, altura } = img;
  const lum = luminancia(img);
  const limiar = limiarDeOtsu(lum);
  const claro = (i: number): boolean => lum[i]! > limiar;

  // A classe do FUNDO e a maioria da moldura de 1 px da imagem.
  let clarosNaBorda = 0;
  let borda = 0;
  const daBorda: number[] = [];
  for (let x = 0; x < largura; x++) daBorda.push(x, (altura - 1) * largura + x);
  for (let y = 1; y < altura - 1; y++) daBorda.push(y * largura, y * largura + largura - 1);
  for (const i of daBorda) {
    borda++;
    if (claro(i)) clarosNaBorda++;
  }
  const fundoEhClaro = clarosNaBorda * 2 >= borda;
  const fracaoDaBordaNoFundo =
    (fundoEhClaro ? clarosNaBorda : borda - clarosNaBorda) / Math.max(1, borda);

  // Inundacao (4 vizinhos) a partir da borda, so por pixels da classe do fundo.
  const alcancado = new Uint8Array(largura * altura);
  const pilha: number[] = [];
  for (const i of daBorda) {
    if (claro(i) === fundoEhClaro && alcancado[i] === 0) {
      alcancado[i] = 1;
      pilha.push(i);
    }
  }
  while (pilha.length > 0) {
    const i = pilha.pop()!;
    const x = i % largura;
    const vizinhos = [i - largura, i + largura, x > 0 ? i - 1 : -1, x < largura - 1 ? i + 1 : -1];
    for (const v of vizinhos) {
      if (v < 0 || v >= alcancado.length || alcancado[v] === 1) continue;
      if (claro(v) === fundoEhClaro) {
        alcancado[v] = 1;
        pilha.push(v);
      }
    }
  }

  const molde: Mascara = new Uint8Array(largura * altura);
  for (let i = 0; i < molde.length; i++) molde[i] = alcancado[i] === 1 ? 0 : 1;
  return { molde, fracaoDaBordaNoFundo };
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

/**
 * Imagem de internet → eventos do motor, com escala INVENTADA e dita.
 *
 * As peças entram pelo log como qualquer outra (I6): espelhar, pence, pregas,
 * graduação e encaixe funcionam nelas sem exceção. O que NÃO se faz com o
 * resultado é cortar tecido — e o aviso repete isso em todo retorno.
 */
export function tracarDaInternet(img: Imagem, opcoes: OpcoesDoBrinquedo): Brinquedo {
  const problemas: Problema[] = [];
  if (img.largura < 16 || img.altura < 16) {
    return vazio([
      {
        gravidade: 'erro',
        codigo: 'CONTORNO_VAZIO',
        mensagem: `A imagem tem ${img.largura} × ${img.altura} px — pequena demais para ter molde.`,
      },
    ]);
  }

  const larguraMM = opcoes.larguraMM ?? 1000;
  const umPorPixel = (larguraMM * MM) / img.largura;
  // Abaixo de ~1,5 px nao existe desenho, existe escada de quantizacao.
  const tolerancia = Math.round(1.5 * umPorPixel);

  const { molde, fracaoDaBordaNoFundo } = mascaraDoMolde(img);
  if (fracaoDaBordaNoFundo < 0.7) {
    return vazio([
      {
        gravidade: 'erro',
        codigo: 'CONTORNO_VAZIO',
        mensagem:
          `A borda da imagem e ${(fracaoDaBordaNoFundo * 100).toFixed(0)}% de uma cor so — ` +
          `preciso de pelo menos 70% para saber qual e o fundo. Funciona melhor com molde ` +
          `escuro sobre fundo claro (ou o contrario), com folga de fundo em volta.`,
      },
    ]);
  }

  const cheia = preencherBuracos(molde, img.largura, img.altura);
  const areaMinima = Math.round(img.largura * img.altura * (opcoes.areaMinimaFracao ?? 0.002));
  const { rotulos, regioes } = rotular(cheia, img.largura, img.altura, areaMinima);

  if (regioes.length === 0) {
    return vazio([
      {
        gravidade: 'erro',
        codigo: 'CONTORNO_VAZIO',
        mensagem:
          'Nenhum molde encontrado: nada na imagem esta separado do fundo. Use uma imagem de ' +
          'molde com contorno fechado (diagrama de modelagem) ou foto de peca sobre fundo liso.',
      },
    ]);
  }
  const maior = regioes.reduce((a, b) => (b.area > a.area ? b : a));
  if (maior.area > img.largura * img.altura * 0.9) {
    return vazio([
      {
        gravidade: 'erro',
        codigo: 'CONTORNO_VAZIO',
        mensagem:
          'A "peça" encontrada cobre a imagem quase inteira — isso e a segmentacao falhando, ' +
          'nao um molde. Procure uma imagem com fundo liso e contraste de verdade.',
      },
    ]);
  }

  const tamanhos = opcoes.tamanhos ?? ['M'];
  const relogio = opcoes.agora ?? ((): string => new Date().toISOString());
  const envelope = (pecaId: Id | null) => ({
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
        calibracaoId: 'internet-sem-escala-DEMO',
        imagemSoma: somaDaImagem(img),
        larguraPx: img.largura,
        alturaPx: img.altura,
        umPorPixel: Math.round(umPorPixel),
        residuoDoQuadroUM: 0,
        toleranciaUM: tolerancia,
      },
    } as Evento,
  ];

  const pecas: PecaDigitalizada[] = [];
  // Da maior para a menor: "Molde 1" e sempre a peca principal da imagem.
  const ordenadas = [...regioes].sort((a, b) => b.area - a.area);
  ordenadas.forEach((regiao, indice) => {
    const pecaId = `demo-${indice}`;
    const nome = `Molde ${indice + 1} (demo)`;

    const emPixels = contornoDaRegiao(rotulos, img.largura, img.altura, regiao.rotulo);
    // Pixel (Y para baixo) vira UM (Y para cima, D4); o CCW e conferido depois.
    const emUM = garantirCCW(
      emPixels.map((p) => ({
        x: Math.round(p.x * umPorPixel),
        y: Math.round((img.altura - 1 - p.y) * umPorPixel),
      })),
    );
    const anel = simplificarAnel(emUM, tolerancia);
    if (anel.length < 3) return; // respingo que a simplificacao consumiu

    const cantos = detectarCantos(anel, 30, Math.max(8000, 8 * tolerancia));
    const trechos = ajustarCurvas(anel, cantos, tolerancia);
    if (trechos.length === 0) return;

    eventos.push({
      ...envelope(pecaId),
      tipo: 'CriarPeca',
      payload: { nome, encaixe: ENCAIXE_PADRAO },
    } as Evento);
    const vertices = trechos.map((t) => t.de);
    vertices.forEach((v, i) =>
      eventos.push({
        ...envelope(pecaId),
        tipo: 'CriarPonto',
        payload: { pontoId: `${pecaId}-pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
      } as Evento),
    );
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
    // Margem zero e SEM deteccao de pique: numa imagem sem escala, um "pique"
    // achado seria ruido com nome de precisao.
    trechos.forEach((_, i) =>
      eventos.push({
        ...envelope(pecaId),
        tipo: 'DefinirMargem',
        payload: { arestaId: `${pecaId}-ar-${i}`, margemUM: 0 },
      } as Evento),
    );

    const xs = anel.map((p) => p.x);
    const ys = anel.map((p) => p.y);
    pecas.push({
      pecaId,
      nome,
      larguraUM: Math.max(...xs) - Math.min(...xs),
      alturaUM: Math.max(...ys) - Math.min(...ys),
      perimetroUM: Math.round(perimetroDe(anel)),
      pontos: vertices.length,
      cantos: cantos.length,
      curvas: trechos.filter((t) => t.tipo === 'curva').length,
      retas: trechos.filter((t) => t.tipo === 'reta').length,
      piques: 0,
    });
  });

  if (pecas.length === 0) {
    return vazio([
      {
        gravidade: 'erro',
        codigo: 'CONTORNO_VAZIO',
        mensagem: 'As manchas encontradas eram pequenas demais para virar molde.',
      },
    ]);
  }

  problemas.push({
    gravidade: 'aviso',
    codigo: 'MARGEM_AUSENTE',
    mensagem:
      `DEMONSTRAÇÃO SEM ESCALA: a imagem inteira foi assumida com ${larguraMM} mm de largura. ` +
      `As medidas são fictícias — serve para mexer, testar ferramenta e mostrar o programa. ` +
      `Para molde de cortar, use a digitalização com o quadro calibrado.`,
  });

  return { eventos, problemas, umPorPixel, pecas };
}
