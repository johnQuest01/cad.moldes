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

/**
 * Tolerâncias de cor (distância RGB ao quadrado).
 *
 * A do FUNDO é APERTADA de propósito, e é medida: um furo de olhal preto
 * (25,25,25) numa tira sobre mesa escura (45,42,40) dista 30,2 (914 ao
 * quadrado) — com tolerância 30 o flood da mesa NÃO entra pelo furo e a tira
 * não é partida por dentro. A sombra suave da mesa não estoura porque a média
 * da inundação DESLIZA junto. A de REGIÃO é mais folgada: dentro de uma peça
 * o JPEG mete mais ruído que no fundo liso.
 */
const TOL_SEMENTE_2 = 45 * 45;
const TOL_PASSO_2 = 18 * 18;
/**
 * Teto ABSOLUTO do flood de fundo: por mais suave que a rampa seja, o fundo
 * nunca anda para um pixel a mais de 60 de TODAS as cores de fundo. Medido na
 * captura de video do atelie: sem o teto, a penumbra borrada da borda da peca
 * (passos de ~10 por pixel) deixava o flood entrar no kraft e comer as pecas
 * por dentro (fundo dava 97,9% da imagem); com ele, 44,1% — a mesa, e so ela.
 */
const TETO_FUNDO_2 = 60 * 60;
const TOL_REGIAO_2 = 60 * 60;

/**
 * Rotula os moldes em DOIS ESTÁGIOS — a lição das três imagens reais:
 *
 *  1. Componentes BINÁRIOS de tudo que não é fundo. Na foto de ateliê isso é
 *     a peça inteira, com as marcações do software (pontos verdes, linhas
 *     vermelhas) absorvidas — era o que a v1 fazia bem e a v2 (só cor)
 *     regrediu: cada marquinha na borda serrilhava o contorno.
 *  2. DENTRO de cada componente, sub-rotulagem por cor. O componente só é
 *     PARTIDO quando a evidência é forte — duas ou mais sub-regiões grandes
 *     (≥12% do componente) cobrindo ≥60% dele. É o caso do encaixe colorido
 *     com peças encostadas. Uma peça kraft com sardas coloridas dá UMA sub
 *     grande + migalhas, e fica inteira, com a borda lisa.
 */
function segmentarPorCor(img: Imagem, areaMinima: number): {
  rotulos: Int32Array;
  regioes: RegiaoDeCor[];
  fracaoCoberta: number;
} {
  const { largura, altura, dados } = img;
  const borda = indicesDaBorda(largura, altura);
  const { cores, fracaoCoberta } = coresDoFundo(img, borda);

  // O caso MEDIDO na captura de video do atelie: a moldura da imagem e a
  // barra escura do player (37,44,42) e a MESA de verdade (73,75,67) quase
  // nao encosta na moldura — sem semente, a mesa inteira viraria "molde" e
  // colaria as pecas. Entao as cores dominantes GLOBAIS da imagem tambem
  // semeiam o fundo, mas SO as parentes de alguma cor da moldura (a mesa
  // dista 55 da barra e entra; o verde das pecas de um diagrama dista ~150
  // do branco e fica de fora — senao peca virava fundo).
  const caixasGlobais = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < largura * altura; i += 7) {
    const r = dados[i * 4]!;
    const g = dados[i * 4 + 1]!;
    const b = dados[i * 4 + 2]!;
    const chave = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const caixa = caixasGlobais.get(chave) ?? { n: 0, r: 0, g: 0, b: 0 };
    caixa.n++;
    caixa.r += r;
    caixa.g += g;
    caixa.b += b;
    caixasGlobais.set(chave, caixa);
  }
  const globais = [...caixasGlobais.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .map((c) => ({ r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }))
    .filter((globo) =>
      cores.some((c) => {
        const dr = globo.r - c.r;
        const dg = globo.g - c.g;
        const db = globo.b - c.b;
        return dr * dr + dg * dg + db * db <= 60 * 60;
      }),
    );
  const sementes = [...cores, ...globais];

  // Inundacao do fundo a partir da moldura, por GRADIENTE: o vizinho entra se
  // a cor dele esta a um passo curto da cor do pixel POR ONDE se chegou.
  //
  // E a fisica da mesa fotografada: sombra e vinheta sao RAMPAS (passo de 1 a
  // 3 por pixel — o flood flui por baixo delas ate onde a mesa for); a borda
  // de uma peca e um DEGRAU (kraft 190 contra mesa 45 — bloqueia), e o furo
  // de olhal preto no meio de uma tira tambem e degrau contra a propria mesa
  // do istmo (30 de distancia > passo de 18 — o flood NAO atravessa a tira
  // por dentro do furo, que era o que picotava as tiras em tocos). As duas
  // tentativas anteriores falharam cada uma num lado: tolerancia absoluta
  // FOLGADA comia os furos, e APERTADA nao cobria a sombra e colava pecas.
  const fundo = new Uint8Array(largura * altura);
  const pilha: number[] = [];
  for (const i of borda) {
    if (fundo[i] === 0 && sementes.some((c) => dist2(dados, i, c.r, c.g, c.b) <= TOL_SEMENTE_2)) {
      fundo[i] = 1;
      pilha.push(i);
    }
  }
  // As sementes GLOBAIS valem na imagem inteira (a mesa que nao encosta na
  // moldura), com tolerancia mais justa que a da moldura.
  if (globais.length > 0) {
    for (let i = 0; i < fundo.length; i++) {
      if (fundo[i] === 0 && globais.some((c) => dist2(dados, i, c.r, c.g, c.b) <= 24 * 24)) {
        fundo[i] = 1;
        pilha.push(i);
      }
    }
  }
  const pertoDeFundo = (v: number): boolean =>
    sementes.some((c) => dist2(dados, v, c.r, c.g, c.b) <= TETO_FUNDO_2);
  while (pilha.length > 0) {
    const j = pilha.pop()!;
    const jr = dados[j * 4]!;
    const jg = dados[j * 4 + 1]!;
    const jb = dados[j * 4 + 2]!;
    const x = j % largura;
    const vizinhos = [j - largura, j + largura, x > 0 ? j - 1 : -1, x < largura - 1 ? j + 1 : -1];
    for (const v of vizinhos) {
      if (v < 0 || v >= fundo.length || fundo[v] === 1) continue;
      if (dist2(dados, v, jr, jg, jb) <= TOL_PASSO_2 && pertoDeFundo(v)) {
        fundo[v] = 1;
        pilha.push(v);
      }
    }
  }

  // Estagio 1: componentes binarios do que nao e fundo.
  const compDe = new Int32Array(largura * altura);
  interface Componente {
    readonly id: number;
    area: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    readonly pixels: number[];
  }
  const componentes: Componente[] = [];
  let proximoComp = 0;
  for (let inicio = 0; inicio < compDe.length; inicio++) {
    if (fundo[inicio] === 1 || compDe[inicio] !== 0) continue;
    proximoComp++;
    const comp: Componente = {
      id: proximoComp,
      area: 0,
      minX: largura,
      minY: altura,
      maxX: 0,
      maxY: 0,
      pixels: [],
    };
    compDe[inicio] = proximoComp;
    pilha.push(inicio);
    while (pilha.length > 0) {
      const i = pilha.pop()!;
      const x = i % largura;
      const y = (i - x) / largura;
      comp.area++;
      comp.pixels.push(i);
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      const vizinhos = [i - largura, i + largura, x > 0 ? i - 1 : -1, x < largura - 1 ? i + 1 : -1];
      for (const v of vizinhos) {
        if (v < 0 || v >= compDe.length || fundo[v] === 1 || compDe[v] !== 0) continue;
        compDe[v] = proximoComp;
        pilha.push(v);
      }
    }
    componentes.push(comp);
  }

  // Distancia (Chebyshev, duas passadas) de cada pixel ao FUNDO mais proximo.
  // O contato de uma sub com o fundo e medido ATRAVES do halo de anti-aliasing
  // (1 a 2 px de transicao em toda imagem JPEG): vizinhanca direta dava contato
  // ~0% ate para peca escancarada no branco — medido no encaixe real.
  const INF = 1 << 29;
  const distFundo = new Int32Array(largura * altura).fill(INF);
  for (let i = 0; i < distFundo.length; i++) if (fundo[i] === 1) distFundo[i] = 0;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = y * largura + x;
      let m = distFundo[i]!;
      if (x > 0) m = Math.min(m, distFundo[i - 1]! + 1);
      if (y > 0) {
        m = Math.min(m, distFundo[i - largura]! + 1);
        if (x > 0) m = Math.min(m, distFundo[i - largura - 1]! + 1);
        if (x < largura - 1) m = Math.min(m, distFundo[i - largura + 1]! + 1);
      }
      distFundo[i] = m;
    }
  }
  for (let y = altura - 1; y >= 0; y--) {
    for (let x = largura - 1; x >= 0; x--) {
      const i = y * largura + x;
      let m = distFundo[i]!;
      if (x < largura - 1) m = Math.min(m, distFundo[i + 1]! + 1);
      if (y < altura - 1) {
        m = Math.min(m, distFundo[i + largura]! + 1);
        if (x < largura - 1) m = Math.min(m, distFundo[i + largura + 1]! + 1);
        if (x > 0) m = Math.min(m, distFundo[i + largura - 1]! + 1);
      }
      distFundo[i] = m;
    }
  }

  // Estagio 2: sub-rotulagem por cor DENTRO do componente, e a decisao de partir.
  const rotulos = new Int32Array(largura * altura);
  const regioes: RegiaoDeCor[] = [];
  let proximo = 0;
  const novaRegiao = (): RegiaoDeCor => {
    proximo++;
    return { rotulo: proximo, area: 0, minX: largura, minY: altura, maxX: 0, maxY: 0 };
  };
  const registrar = (regiao: RegiaoDeCor, i: number): void => {
    const x = i % largura;
    const y = (i - x) / largura;
    regiao.area++;
    if (x < regiao.minX) regiao.minX = x;
    if (x > regiao.maxX) regiao.maxX = x;
    if (y < regiao.minY) regiao.minY = y;
    if (y > regiao.maxY) regiao.maxY = y;
  };

  for (const comp of componentes) {
    // Sub-rotulos por cor, so por pixels DESTE componente, com a media deslizando.
    const subDe = new Map<number, number>(); // pixel -> sub
    const subs: { area: number; pixels: number[]; r: number; g: number; b: number }[] = [];
    for (const semente of comp.pixels) {
      if (subDe.has(semente)) continue;
      const sub = { area: 0, pixels: [] as number[], r: 0, g: 0, b: 0 };
      let somaR = 0;
      let somaG = 0;
      let somaB = 0;
      subDe.set(semente, subs.length);
      pilha.push(semente);
      while (pilha.length > 0) {
        const i = pilha.pop()!;
        const x = i % largura;
        sub.area++;
        sub.pixels.push(i);
        somaR += dados[i * 4]!;
        somaG += dados[i * 4 + 1]!;
        somaB += dados[i * 4 + 2]!;
        const mR = somaR / sub.area;
        const mG = somaG / sub.area;
        const mB = somaB / sub.area;
        const vizinhos = [i - largura, i + largura, x > 0 ? i - 1 : -1, x < largura - 1 ? i + 1 : -1];
        for (const v of vizinhos) {
          if (v < 0 || v >= compDe.length || compDe[v] !== comp.id || subDe.has(v)) continue;
          if (dist2(dados, v, mR, mG, mB) <= TOL_REGIAO_2) {
            subDe.set(v, subs.length);
            pilha.push(v);
          }
        }
      }
      sub.r = somaR / sub.area;
      sub.g = somaG / sub.area;
      sub.b = somaB / sub.area;
      subs.push(sub);
    }

    // Uma sub so e CANDIDATA a peca propria quando passa em tres provas:
    //
    //  - area ABSOLUTA (a minima de peca da imagem), com piso relativo de 3%
    //    para nao promover marcacao comprida em peca gigante — o limiar
    //    relativo puro (12%) falhou no encaixe real de 10+ pecas encostadas,
    //    onde nenhuma chegava a 12% do blob;
    //  - BORDA LIVRE: peca de verdade toca o FUNDO em boa parte do proprio
    //    perimetro; um furo de olhal ou um texto fica no interior (contato
    //    zero) ou so encosta no fundo por uma janelinha (o istmo do furo que
    //    atravessa a tira) — abaixo de 20% do perimetro estimado, nao e peca;
    //  - e o conjunto so PARTE se ha >= 2 candidatas de cores DIFERENTES
    //    entre si: kraft cortado ao meio por um ponto preto e a mesma peca.
    const candidatas = subs.filter((s) => {
      if (s.area < Math.max(areaMinima, comp.area * 0.03)) return false;
      // Contato com o fundo MEDIDO contra o perimetro real da sub: um ponto
      // que atravessa a tira toca o fundo so nos dois topos (~29% do proprio
      // perimetro); uma peca de verdade, mesmo espremida no meio da fileira,
      // fica acima de 40%.
      let contato = 0;
      let perimetro = 0;
      for (const i of s.pixels) {
        const x = i % largura;
        const vizinhos = [i - largura, i + largura, x > 0 ? i - 1 : -1, x < largura - 1 ? i + 1 : -1];
        let naBorda = false;
        for (const v of vizinhos) {
          if (v < 0 || v >= fundo.length || fundo[v] === 1 || subDe.get(v) !== subDe.get(i)) {
            naBorda = true;
            break;
          }
        }
        if (naBorda) {
          perimetro++;
          if (distFundo[i]! <= 3) contato++;
        }
      }
      return perimetro > 0 && contato / perimetro >= 0.35;
    });
    const cobertura = candidatas.reduce((soma, s) => soma + s.area, 0) / comp.area;
    let coresDiferentes = false;
    for (let a = 0; a < candidatas.length && !coresDiferentes; a++) {
      for (let b = a + 1; b < candidatas.length; b++) {
        const ga = candidatas[a]!;
        const gb = candidatas[b]!;
        const dr = ga.r - gb.r;
        const dg = ga.g - gb.g;
        const db = ga.b - gb.b;
        if (dr * dr + dg * dg + db * db > TOL_REGIAO_2) {
          coresDiferentes = true;
          break;
        }
      }
    }
    if (candidatas.length >= 2 && cobertura >= 0.5 && coresDiferentes) {
      // Evidencia forte de pecas encostadas de cores diferentes: PARTE.
      for (const sub of candidatas) {
        const regiao = novaRegiao();
        for (const i of sub.pixels) {
          rotulos[i] = regiao.rotulo;
          registrar(regiao, i);
        }
        regioes.push(regiao);
      }
    } else {
      // Uma cor dominante (ou salpicos): o componente fica INTEIRO e liso.
      const regiao = novaRegiao();
      for (const i of comp.pixels) {
        rotulos[i] = regiao.rotulo;
        registrar(regiao, i);
      }
      regioes.push(regiao);
    }
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

  const areaMinima = Math.round(img.largura * img.altura * (opcoes.areaMinimaFracao ?? 0.002));
  const { rotulos, regioes, fracaoCoberta } = segmentarPorCor(img, areaMinima);
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
