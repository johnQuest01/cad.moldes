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
 * ## Como acha "só os moldes" — por COR, não por claro/escuro
 * A primeira versão separava claro de escuro (Otsu) e apanhou na primeira
 * imagem de verdade: um encaixe colorido de screenshot, com peças rosa, preta
 * e laranja ENCOSTADAS umas nas outras sobre fundo branco e faixas cinza nas
 * bordas do vídeo. Tudo que se tocava virava uma mancha só, e o laranja claro
 * caía do lado do fundo. O desenho atual:
 *
 *  1. O FUNDO são as cores dominantes da MOLDURA da imagem (até 4 — o branco
 *     da folha e o cinza da barra do vídeo, por exemplo). Inundação a partir
 *     da borda marca todo fundo alcançável.
 *  2. O que sobra é molde em potencial, rotulado por CONTINUIDADE DE COR:
 *     o vizinho entra se a cor dele está perto da média da região. Rosa
 *     encostado em preto separa; e a transição borrada do JPEG entre duas
 *     peças não casa com nenhuma das duas — vira separador de graça.
 *  3. Buraco dentro de peça (texto, seta de fio) é preenchido, e uma região
 *     que o preenchimento de outra já engoliu (o próprio texto) não vira
 *     "peça" duplicada: as máscaras preenchidas são processadas da maior
 *     para a menor e consomem as internas.
 *
 * Limite dito: duas peças da MESMA cor coladas sem um pixel de vão continuam
 * saindo grudadas — separar isso de verdade é segmentação de gente grande, e
 * brinquedo não mente sobre o que é.
 */
import { MM, type Evento, type Id, type Problema, type Vetor2 } from '@cad/motor';

import { ajustarCurvas, detectarCantos, garantirCCW, simplificarAnel } from './contorno.js';
import type { Imagem, Mascara } from './imagem.js';
import { contornoDaRegiao, preencherBuracos } from './regioes.js';
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

/** Distância de cor ao quadrado, direto no RGB — JPEG mete ruído, o quadrado aguenta. */
const dist2 = (
  dados: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
): number => {
  const dr = dados[i * 4]! - r;
  const dg = dados[i * 4 + 1]! - g;
  const db = dados[i * 4 + 2]! - b;
  return dr * dr + dg * dg + db * db;
};

/** Os índices da moldura de 1 px da imagem. */
function indicesDaBorda(largura: number, altura: number): number[] {
  const borda: number[] = [];
  for (let x = 0; x < largura; x++) borda.push(x, (altura - 1) * largura + x);
  for (let y = 1; y < altura - 1; y++) borda.push(y * largura, y * largura + largura - 1);
  return borda;
}

/**
 * As cores dominantes da moldura (até 4): caixas de 32 por canal, com a MÉDIA
 * real de cada caixa — o branco da folha E o cinza da barra do vídeo entram.
 */
function coresDoFundo(
  img: Imagem,
  borda: readonly number[],
): { cores: { r: number; g: number; b: number }[]; fracaoCoberta: number } {
  const caixas = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of borda) {
    const r = img.dados[i * 4]!;
    const g = img.dados[i * 4 + 1]!;
    const b = img.dados[i * 4 + 2]!;
    const chave = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const caixa = caixas.get(chave) ?? { n: 0, r: 0, g: 0, b: 0 };
    caixa.n++;
    caixa.r += r;
    caixa.g += g;
    caixa.b += b;
    caixas.set(chave, caixa);
  }
  const ordenadas = [...caixas.values()].sort((a, b) => b.n - a.n);
  const cores: { r: number; g: number; b: number }[] = [];
  let cobertos = 0;
  for (const caixa of ordenadas.slice(0, 4)) {
    cores.push({ r: caixa.r / caixa.n, g: caixa.g / caixa.n, b: caixa.b / caixa.n });
    cobertos += caixa.n;
    if (cobertos / borda.length >= 0.95) break;
  }
  return { cores, fracaoCoberta: cobertos / borda.length };
}

interface RegiaoDeCor {
  readonly rotulo: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Tolerância de cor: fundo um pouco folgada (sombra leve), região mais justa. */
const TOL_FUNDO_2 = 64 * 64;
const TOL_REGIAO_2 = 60 * 60;

/**
 * Rotula os moldes: fundo alcançável pela borda sai; o resto agrupa por cor.
 * A média da região desliza com ela — gradiente suave de luz não parte a peça,
 * fronteira nítida de cor parte.
 */
function segmentarPorCor(img: Imagem): {
  rotulos: Int32Array;
  regioes: RegiaoDeCor[];
  fracaoCoberta: number;
} {
  const { largura, altura, dados } = img;
  const borda = indicesDaBorda(largura, altura);
  const { cores, fracaoCoberta } = coresDoFundo(img, borda);

  const ehCorDeFundo = (i: number): boolean =>
    cores.some((c) => dist2(dados, i, c.r, c.g, c.b) <= TOL_FUNDO_2);

  // Inundacao do fundo, 4 vizinhos, a partir da moldura.
  const fundo = new Uint8Array(largura * altura);
  const pilha: number[] = [];
  for (const i of borda) {
    if (fundo[i] === 0 && ehCorDeFundo(i)) {
      fundo[i] = 1;
      pilha.push(i);
    }
  }
  while (pilha.length > 0) {
    const i = pilha.pop()!;
    const x = i % largura;
    const vizinhos = [i - largura, i + largura, x > 0 ? i - 1 : -1, x < largura - 1 ? i + 1 : -1];
    for (const v of vizinhos) {
      if (v < 0 || v >= fundo.length || fundo[v] === 1) continue;
      if (ehCorDeFundo(v)) {
        fundo[v] = 1;
        pilha.push(v);
      }
    }
  }

  // Rotulagem por cor do que sobrou.
  const rotulos = new Int32Array(largura * altura);
  const regioes: RegiaoDeCor[] = [];
  let proximo = 0;
  for (let inicio = 0; inicio < rotulos.length; inicio++) {
    if (fundo[inicio] === 1 || rotulos[inicio] !== 0) continue;
    proximo++;
    const regiao: RegiaoDeCor = {
      rotulo: proximo,
      area: 0,
      minX: largura,
      minY: altura,
      maxX: 0,
      maxY: 0,
    };
    let somaR = 0;
    let somaG = 0;
    let somaB = 0;
    rotulos[inicio] = proximo;
    pilha.push(inicio);
    while (pilha.length > 0) {
      const i = pilha.pop()!;
      const x = i % largura;
      const y = (i - x) / largura;
      regiao.area++;
      somaR += dados[i * 4]!;
      somaG += dados[i * 4 + 1]!;
      somaB += dados[i * 4 + 2]!;
      if (x < regiao.minX) regiao.minX = x;
      if (x > regiao.maxX) regiao.maxX = x;
      if (y < regiao.minY) regiao.minY = y;
      if (y > regiao.maxY) regiao.maxY = y;
      const mR = somaR / regiao.area;
      const mG = somaG / regiao.area;
      const mB = somaB / regiao.area;
      const vizinhos = [i - largura, i + largura, x > 0 ? i - 1 : -1, x < largura - 1 ? i + 1 : -1];
      for (const v of vizinhos) {
        if (v < 0 || v >= rotulos.length || fundo[v] === 1 || rotulos[v] !== 0) continue;
        if (dist2(dados, v, mR, mG, mB) <= TOL_REGIAO_2) {
          rotulos[v] = proximo;
          pilha.push(v);
        }
      }
    }
    regioes.push(regiao);
  }
  return { rotulos, regioes, fracaoCoberta };
}

/**
 * A máscara PREENCHIDA da região, no recorte do bounding (com 1 px de folga):
 * o texto e a seta de fio dentro da peça viram peça, como no papel.
 */
function mascaraPreenchida(
  rotulos: Int32Array,
  largura: number,
  regiao: RegiaoDeCor,
): { mascara: Mascara; l: number; a: number; x0: number; y0: number } {
  const x0 = regiao.minX - 1;
  const y0 = regiao.minY - 1;
  const l = regiao.maxX - regiao.minX + 3;
  const a = regiao.maxY - regiao.minY + 3;
  const recorte: Mascara = new Uint8Array(l * a);
  for (let y = regiao.minY; y <= regiao.maxY; y++) {
    for (let x = regiao.minX; x <= regiao.maxX; x++) {
      if (rotulos[y * largura + x] === regiao.rotulo) {
        recorte[(y - y0) * l + (x - x0)] = 1;
      }
    }
  }
  return { mascara: preencherBuracos(recorte, l, a), l, a, x0, y0 };
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

  const { rotulos, regioes, fracaoCoberta } = segmentarPorCor(img);
  if (fracaoCoberta < 0.7) {
    return vazio([
      {
        gravidade: 'erro',
        codigo: 'CONTORNO_VAZIO',
        mensagem:
          `A borda da imagem tem cor demais (${(fracaoCoberta * 100).toFixed(0)}% coberta ` +
          `pelas cores dominantes; preciso de 70%). Funciona melhor com os moldes sobre um ` +
          `fundo liso, com folga de fundo em volta.`,
      },
    ]);
  }

  const areaMinima = Math.round(img.largura * img.altura * (opcoes.areaMinimaFracao ?? 0.002));
  const grandes = regioes.filter((r) => r.area >= areaMinima);
  if (grandes.length === 0) {
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

  // Cada regiao com a mascara ja PREENCHIDA; da maior para a menor, as que
  // cairam dentro de outra (texto, seta, interior de contorno) sao consumidas.
  const candidatas = grandes
    .slice(0, 48)
    .map((regiao) => {
      const m = mascaraPreenchida(rotulos, img.largura, regiao);
      let areaCheia = 0;
      for (const v of m.mascara) areaCheia += v;
      return { regiao, ...m, areaCheia };
    })
    .sort((a, b) => b.areaCheia - a.areaCheia);

  if (candidatas[0]!.areaCheia > img.largura * img.altura * 0.9) {
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

  const consumido = new Uint8Array(img.largura * img.altura);
  const escolhidas: typeof candidatas = [];
  for (const c of candidatas) {
    let dentro = 0;
    for (let y = 0; y < c.a; y++) {
      for (let x = 0; x < c.l; x++) {
        if (c.mascara[y * c.l + x] === 1 && consumido[(y + c.y0) * img.largura + (x + c.x0)] === 1) {
          dentro++;
        }
      }
    }
    if (dentro > c.areaCheia * 0.5) continue; // texto/interior de peca ja emitida
    escolhidas.push(c);
    for (let y = 0; y < c.a; y++) {
      for (let x = 0; x < c.l; x++) {
        if (c.mascara[y * c.l + x] === 1) consumido[(y + c.y0) * img.largura + (x + c.x0)] = 1;
      }
    }
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
  escolhidas.forEach((c, indice) => {
    const pecaId = `demo-${indice}`;
    const nome = `Molde ${indice + 1} (demo)`;

    // O contorno sai da mascara preenchida do RECORTE; as coordenadas voltam
    // ao quadro inteiro pelo deslocamento, e o Y vira para cima (D4).
    const binarios = new Int32Array(c.mascara.length);
    for (let i = 0; i < c.mascara.length; i++) binarios[i] = c.mascara[i]!;
    const emPixels = contornoDaRegiao(binarios, c.l, c.a, 1);
    const emUM = garantirCCW(
      emPixels.map((p) => ({
        x: Math.round((p.x + c.x0) * umPorPixel),
        y: Math.round((img.altura - 1 - (p.y + c.y0)) * umPorPixel),
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

  const problemas: Problema[] = [
    {
      gravidade: 'aviso',
      codigo: 'MARGEM_AUSENTE',
      mensagem:
        `DEMONSTRAÇÃO SEM ESCALA: a imagem inteira foi assumida com ${larguraMM} mm de largura. ` +
        `As medidas são fictícias — serve para mexer, testar ferramenta e mostrar o programa. ` +
        `Para molde de cortar, use a digitalização com o quadro calibrado.`,
    },
  ];

  return { eventos, problemas, umPorPixel, pecas };
}
