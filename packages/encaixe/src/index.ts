/**
 * @cad/encaixe — pôr as peças na faixa do tecido (Fase 5).
 *
 * É a fase que carrega o ROI: economia de tecido é o único retorno que uma
 * confecção calcula na ponta do lápis. Também é a mais difícil das cinco.
 *
 * ## No-Fit Polygon, e não força bruta
 * Para saber onde uma peça CABE ao lado de outra, o caminho certo e conhecido é o
 * **NFP**: `NFP(fixa, movel) = fixa ⊕ (−movel)`. Uma posição da móvel colide com a
 * fixa se, e só se, o ponto de referência dela cai DENTRO do NFP. As posições que
 * encostam sem sobrepor são exatamente os vértices do NFP — o que transforma uma
 * busca contínua num punhado de candidatos.
 *
 * A soma de Minkowski vem do **clipper2**, como manda a decisão inegociável 3 da
 * Parte 0: geometria de biblioteca testada, nunca conta caseira.
 *
 * ## Os eixos: a largura do rolo é X, a faixa corre em +Y
 * A mesma convenção do `@cad/plotter`, e isso não é detalhe: as duas fases falam
 * do mesmo rolo, e discordar de qual eixo é a largura seria a receita de um molde
 * silenciosamente errado. Por isso `aplicarEncaixe` entrega as peças já postas no
 * sistema que o HPGL consome, sem nenhuma conversão pelo caminho.
 *
 * ## O FIO manda na rotação
 * É o que separa encaixe de roupa de encaixe genérico. Uma peça de tecido plano
 * não pode girar 90 graus: o fio ficaria atravessado e a peça deformaria no uso. O
 * que pode girar sai de `PropriedadesEncaixe.giro`, que o modelista declarou —
 * este pacote obedece, não adivinha.
 */
import {
  EndType,
  FillRule,
  JoinType,
  inflatePaths,
  minkowskiDiff,
  union,
  type Path64,
  type Paths64,
} from 'clipper2-ts';
import {
  ErroMotor,
  aplicarGraduacao,
  area,
  contemPonto,
  offsetMargem,
  rotacionarPeca,
  espelharPeca,
  simplificarContorno,
  transladarPeca,
  type Id,
  type Modelo,
  type Peca,
  type Problema,
  type Vetor2,
} from '@cad/motor';

/**
 * Folga entre peças, em UM. 2 mm é o que a faca precisa para não morder a vizinha
 * — e é ela que também absorve o erro da simplificação abaixo.
 */
export const FOLGA_PADRAO_UM = 2000;

/**
 * Tolerância da simplificação do contorno antes de encaixar, em UM.
 *
 * Uma cava tesselada tem centenas de vértices, e o Minkowski entre dois polígonos
 * de centenas de vértices é caro sem ganho nenhum: 0,5 mm está muito abaixo da
 * folga de 2 mm, então o erro é absorvido inteiro e nenhuma peça encosta na outra
 * por causa dele.
 */
export const SIMPLIFICACAO_UM = 500;

export interface Colocacao {
  readonly pecaId: Id;
  /** Qual cópia desta peça (uma peça pode ir 2, 4 vezes no molde). */
  readonly copia: number;
  readonly x: number;
  readonly y: number;
  readonly rotacaoGraus: number;
  readonly espelhada: boolean;
}

export interface Encaixe {
  readonly colocacoes: readonly Colocacao[];
  /** Quanto de tecido a fila consome, em UM. É a conta que vira metro e dinheiro. */
  readonly comprimentoUsadoUM: number;
  readonly larguraUtilUM: number;
  /** Área das peças dividida pela área do retângulo consumido. 0 a 1. */
  readonly aproveitamento: number;
  readonly problemas: readonly Problema[];
}

export interface OpcoesDeEncaixe {
  readonly tamanho?: string;
  /** Largura útil da faixa, em UM. Sem ela, usa a do papel do modelo. */
  readonly larguraUtilUM?: number;
  readonly folgaUM?: number;
  /** Repetições do modelo inteiro (um encaixe de 3 conjuntos, por exemplo). */
  readonly conjuntos?: number;
}

/**
 * Angulos que cada peca pode assumir, conforme o `giro` declarado.
 *
 * E aqui que o FIO manda. As opcoes do modelo vem da tela do cliente:
 *
 * | `giro` | o que quer dizer | angulos |
 * |---|---|---|
 * | `forcar` | posicao travada; nem virar de cabeca para baixo | 0 |
 * | `180` | pode virar de cabeca para baixo — o fio e uma LINHA, nao uma seta | 0, 180 |
 * | `90` | pode deitar: so tecido sem direcao de fio (malha, nao tecido) | 0, 90, 180, 270 |
 * | `livre` | qualquer angulo; aqui entra em passos de 90 | 0, 90, 180, 270 |
 * | `esquerda` / `direita` | inclinar so para um lado, ate `faixaGiroGraus` | 0, 180 e a inclinacao |
 *
 * `esquerda` e `direita` existem para tecido com listra ou xadrez, em que a peca
 * pode ser levemente enviesada para um lado so — inclinar para o outro trocaria o
 * sentido do desenho do tecido.
 */
export function rotacoesPermitidas(peca: Peca): number[] {
  const { giro, faixaGiroGraus } = peca.encaixe;
  if (giro === 'forcar') return [0];
  if (giro === 'livre' || giro === '90') return [0, 90, 180, 270];
  if (giro === '180') return [0, 180];

  const faixa = Math.abs(faixaGiroGraus);
  const angulos = new Set([0, 180]);
  if (faixa > 0) {
    const sinal = giro === 'esquerda' ? 1 : -1;
    for (const base of [0, 180]) angulos.add((base + sinal * faixa + 360) % 360);
  }
  return [...angulos].sort((a, b) => a - b);
}

/** Encaixa o modelo na faixa. Determinístico: mesma entrada, mesmo encaixe. */
export function encaixar(modelo: Modelo, opcoes: OpcoesDeEncaixe = {}): Encaixe {
  const tamanho = opcoes.tamanho ?? modelo.tamanhoBase;
  const folga = opcoes.folgaUM ?? FOLGA_PADRAO_UM;
  const conjuntos = Math.max(1, opcoes.conjuntos ?? 1);
  const util = opcoes.larguraUtilUM ?? larguraDoPapel(modelo);
  const problemas: Problema[] = [];

  if (util === null) {
    return {
      colocacoes: [],
      comprimentoUsadoUM: 0,
      larguraUtilUM: 0,
      aproveitamento: 0,
      problemas: [
        {
          gravidade: 'erro',
          codigo: 'PAPEL_INVALIDO',
          mensagem:
            'Nao ha largura de faixa: declare o papel do modelo ou passe `larguraUtilUM`. ' +
            'Encaixar sem saber a largura do rolo nao quer dizer nada.',
        },
      ],
    };
  }

  const candidatas = montarCandidatas(modelo, tamanho, conjuntos, folga, problemas);
  // Maior primeiro: e a heuristica classica do bottom-left, e a que da o melhor
  // aproveitamento sem busca. O desempate por id mantem o resultado deterministico.
  candidatas.sort((a, b) => b.area - a.area || (a.pecaId < b.pecaId ? -1 : 1) || a.copia - b.copia);

  const colocacoes: Colocacao[] = [];
  const postas: Path64[] = [];
  let areaColocada = 0;
  let comprimento = 0;

  for (const candidata of candidatas) {
    const escolha = melhorPosicao(candidata, postas, util);
    if (escolha === null) {
      problemas.push({
        gravidade: 'erro',
        codigo: 'PECA_MAIS_LARGA_QUE_O_PAPEL',
        mensagem:
          `A peca "${candidata.nome}" nao cabe nos ${util} UM uteis da faixa em rotacao ` +
          `nenhuma das permitidas (${rotacoesPermitidas(candidata.peca).join(', ')} graus). ` +
          `O giro declarado e "${candidata.peca.encaixe.giro}".`,
        pecaId: candidata.pecaId,
      });
      continue;
    }

    colocacoes.push({
      pecaId: candidata.pecaId,
      copia: candidata.copia,
      x: escolha.x,
      y: escolha.y,
      rotacaoGraus: escolha.rotacao,
      espelhada: candidata.espelhada,
    });
    postas.push(deslocado(escolha.contorno, escolha.x, escolha.y));
    areaColocada += Math.abs(escolha.area);
    comprimento = Math.max(comprimento, escolha.y + escolha.altura);
  }

  const areaDaFaixa = comprimento * util;
  return {
    colocacoes,
    comprimentoUsadoUM: comprimento,
    larguraUtilUM: util,
    aproveitamento: areaDaFaixa === 0 ? 0 : areaColocada / areaDaFaixa,
    problemas,
  };
}

// ------------------------------------------------------------------ interno

interface Candidata {
  readonly pecaId: Id;
  readonly nome: string;
  readonly copia: number;
  readonly espelhada: boolean;
  readonly peca: Peca;
  /** Contorno de corte por rotacao, ja com folga, encostado na origem. */
  readonly porRotacao: Map<number, { caminho: Path64; largura: number; altura: number }>;
  readonly area: number;
}

function montarCandidatas(
  modelo: Modelo,
  tamanho: string,
  conjuntos: number,
  folga: number,
  problemas: Problema[],
): Candidata[] {
  const candidatas: Candidata[] = [];

  for (const pecaId of Object.keys(modelo.pecas)) {
    let peca: Peca;
    try {
      peca = aplicarGraduacao(modelo, pecaId, tamanho);
    } catch (erro) {
      if (!(erro instanceof ErroMotor)) throw erro;
      problemas.push({
        gravidade: 'erro',
        codigo: erro.codigo,
        mensagem: `A peca "${pecaId}" nao entrou no encaixe: ${erro.message}`,
        pecaId,
      });
      continue;
    }

    const quantidade = Math.max(1, peca.encaixe.quantidadePorModelo) * conjuntos;
    // `par` quer dizer que metade das copias vai espelhada: manga direita e
    // esquerda saem do mesmo molde, viradas.
    const espelhadas = peca.encaixe.par ? Math.floor(quantidade / 2) : 0;

    for (let copia = 0; copia < quantidade; copia++) {
      const espelhada = copia < espelhadas;
      const base = espelhada
        ? espelharPeca(peca, { p1: { x: 0, y: 0 }, p2: { x: 0, y: 1000 } })
        : peca;

      const porRotacao = new Map<number, { caminho: Path64; largura: number; altura: number }>();
      let areaDaPeca = 0;
      for (const graus of rotacoesPermitidas(peca)) {
        const forma = contornoParaEncaixe(base, graus, folga);
        if (forma === null) continue;
        porRotacao.set(graus, forma.caminho2);
        areaDaPeca = forma.area;
      }
      if (porRotacao.size === 0) continue;

      candidatas.push({
        pecaId,
        nome: peca.metadados.nome,
        copia,
        espelhada,
        peca,
        porRotacao,
        area: areaDaPeca,
      });
    }
  }
  return candidatas;
}

/**
 * O contorno usado no encaixe: linha de CORTE, simplificada, inflada pela metade
 * da folga e encostada na origem.
 *
 * Meia folga em cada peca da a folga inteira entre duas — e assim a folga entra
 * uma vez so na conta, em vez de dobrar sem ninguem perceber.
 */
function contornoParaEncaixe(
  peca: Peca,
  graus: number,
  folga: number,
): { caminho2: { caminho: Path64; largura: number; altura: number }; area: number } | null {
  try {
    const girada = graus === 0 ? peca : rotacionarPeca(peca, { x: 0, y: 0 }, graus);
    const simples = simplificarContorno(girada, SIMPLIFICACAO_UM);
    const corte = offsetMargem(simples).pontos;

    // Meia folga em CADA peca da a folga inteira entre duas — e assim ela entra
    // uma vez so na conta, em vez de dobrar sem ninguem perceber. Quem infla e o
    // clipper2, pelo mesmo motivo de sempre: geometria de biblioteca testada.
    const inflado = inflatePaths(
      [corte.map((p) => ({ x: p.x, y: p.y }))],
      folga / 2,
      JoinType.Miter,
      EndType.Polygon,
    );
    const anel = inflado[0] ?? corte.map((p) => ({ x: p.x, y: p.y }));

    const minX = Math.min(...anel.map((p) => p.x));
    const minY = Math.min(...anel.map((p) => p.y));
    const maxX = Math.max(...anel.map((p) => p.x));
    const maxY = Math.max(...anel.map((p) => p.y));
    const caminho: Path64 = anel.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    return {
      caminho2: { caminho, largura: maxX - minX, altura: maxY - minY },
      area: Math.abs(area(corte)),
    };
  } catch (erro) {
    if (!(erro instanceof ErroMotor)) throw erro;
    return null;
  }
}

interface Escolha {
  readonly x: number;
  readonly y: number;
  readonly rotacao: number;
  readonly contorno: Path64;
  readonly largura: number;
  readonly altura: number;
  readonly area: number;
}

/**
 * A posicao mais a esquerda (e mais baixa no empate) em que a peca cabe.
 *
 * Os candidatos sao os vertices dos NFPs — as posicoes em que a peca ENCOSTA numa
 * ja posta sem sobrepor — mais o pe da faixa. Isso e o que torna a busca finita: o
 * otimo do bottom-left esta sempre num desses pontos.
 */
function melhorPosicao(
  candidata: Candidata,
  postas: readonly Path64[],
  util: number,
): Escolha | null {
  let melhor: Escolha | null = null;

  for (const [rotacao, forma] of candidata.porRotacao) {
    if (forma.largura > util) continue;

    const nfps = postas.map((posta) => unir(minkowskiDiff(forma.caminho, posta, true)));
    const pontos: Vetor2[] = [{ x: 0, y: 0 }];
    for (const nfp of nfps) {
      for (const anel of nfp) {
        for (const p of anel) pontos.push({ x: Number(p.x), y: Number(p.y) });
      }
    }

    // Ordem: quem avanca menos no rolo primeiro, e a esquerda no empate. E o
    // "bottom-left" da literatura, com a faixa correndo em y.
    pontos.sort((a, b) => a.y - b.y || a.x - b.x);

    for (const ponto of pontos) {
      const x = ponto.x;
      const y = Math.max(0, ponto.y);
      if (x < 0 || x + forma.largura > util) continue;
      if (nfps.some((nfp) => dentroDeAlgum(nfp, { x, y }))) continue;

      const escolha: Escolha = {
        x,
        y,
        rotacao,
        contorno: forma.caminho,
        largura: forma.largura,
        altura: forma.altura,
        area: candidata.area,
      };
      // Entre rotacoes, ganha quem avanca menos no rolo; empate pelo x, depois
      // pelo angulo, para o resultado nao depender da ordem do Map.
      if (
        melhor === null ||
        y + forma.altura < melhor.y + melhor.altura ||
        (y + forma.altura === melhor.y + melhor.altura &&
          (x < melhor.x || (x === melhor.x && rotacao < melhor.rotacao)))
      ) {
        melhor = escolha;
      }
      break;
    }
  }

  return melhor;
}

function unir(caminhos: Paths64): Paths64 {
  return union(caminhos, [], FillRule.NonZero);
}

function dentroDeAlgum(nfp: Paths64, ponto: Vetor2): boolean {
  for (const anel of nfp) {
    const pontos = anel.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    if (pontos.length < 3) continue;
    if (contemPonto(pontos, ponto) && !naBorda(pontos, ponto)) return true;
  }
  return false;
}

/** Em cima da borda do NFP a peca ENCOSTA sem sobrepor — e posicao valida. */
function naBorda(anel: readonly Vetor2[], ponto: Vetor2): boolean {
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    const produto = (b.x - a.x) * (ponto.y - a.y) - (b.y - a.y) * (ponto.x - a.x);
    if (produto !== 0) continue;
    if (
      ponto.x >= Math.min(a.x, b.x) &&
      ponto.x <= Math.max(a.x, b.x) &&
      ponto.y >= Math.min(a.y, b.y) &&
      ponto.y <= Math.max(a.y, b.y)
    ) {
      return true;
    }
  }
  return false;
}

function deslocado(caminho: Path64, dx: number, dy: number): Path64 {
  return caminho.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function larguraDoPapel(modelo: Modelo): number | null {
  const papel = modelo.papel;
  return papel === null ? null : papel.larguraUM - 2 * papel.margemDeSegurancaUM;
}

/**
 * Aplica o encaixe: devolve as peças já postas onde o encaixe mandou.
 *
 * É o que o desenho e o HPGL consomem — e é aqui que fica claro por que o encaixe
 * não inventa geometria: ele só decide POSIÇÃO e ÂNGULO, e quem move a peça são as
 * operações do motor, que já têm teste com número.
 */
export function aplicarEncaixe(
  modelo: Modelo,
  encaixe: Encaixe,
  tamanho?: string,
): { colocacao: Colocacao; peca: Peca }[] {
  const alvo = tamanho ?? modelo.tamanhoBase;
  return encaixe.colocacoes.map((colocacao) => {
    let peca = aplicarGraduacao(modelo, colocacao.pecaId, alvo);
    if (colocacao.espelhada) {
      peca = espelharPeca(peca, { p1: { x: 0, y: 0 }, p2: { x: 0, y: 1000 } });
    }
    if (colocacao.rotacaoGraus !== 0) {
      peca = rotacionarPeca(peca, { x: 0, y: 0 }, colocacao.rotacaoGraus);
    }
    const corte = offsetMargem(peca).pontos;
    const minX = Math.min(...corte.map((p) => p.x));
    const minY = Math.min(...corte.map((p) => p.y));
    return { colocacao, peca: transladarPeca(peca, colocacao.x - minX, colocacao.y - minY) };
  });
}
