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
  areaPaths,
  difference,
  inflatePaths,
  minkowskiDiff,
  ramerDouglasPeucker,
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
  /** Canto inferior esquerdo da peça na faixa, em UM. É o número do relatório. */
  readonly x: number;
  readonly y: number;
  /**
   * O deslocamento a aplicar na peça depois de espelhar e girar, em UM.
   *
   * Existe separado de `x`/`y` porque o encaixe raciocina sobre o contorno
   * **simplificado e inflado**, e a peça que vai para a tela é a de verdade. Os
   * dois têm cantos diferentes, e quem aplica o encaixe não pode redescobrir o
   * canto refazendo a conta: um fio de diferença ali vira peça sobreposta, e peça
   * sobreposta é tecido cortado errado.
   */
  readonly dx: number;
  readonly dy: number;
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
  /**
   * Ordem de colocação a tentar. `0` (ou ausente) é a heurística: maiores primeiro.
   *
   * Qualquer outro número embaralha a ordem de um jeito DETERMINÍSTICO — mesma
   * semente, mesma ordem, sempre. É o que `encaixarBuscando` usa para tentar várias
   * ordens e ficar com a melhor, sem nunca deixar o resultado depender do acaso.
   */
  readonly semente?: number;
  /**
   * Passo de giro, em graus, para as pecas de giro "livre". Padrao 90.
   *
   * E o unico lugar onde ha folga real de tecido a ganhar sem mexer em regra de
   * oficio: peca sem direcao de fio pode entrar em qualquer angulo, e angulo fino
   * enfia peca em buraco que 90 graus nao alcanca. Custa tempo de conta: o numero
   * de NFPs por peca cresce na mesma proporcao.
   */
  readonly passoDeGiroGraus?: number;
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
export function rotacoesPermitidas(peca: Peca, passoDeGiroGraus = 90): number[] {
  const { giro, faixaGiroGraus } = peca.encaixe;
  if (giro === 'forcar') return [0];
  if (giro === 'livre') {
    // "livre" quer dizer QUALQUER angulo — tecido sem direcao nenhuma. O passo
    // padrao e 90 graus por economia de conta, mas quem quiser gastar tempo em
    // troca de tecido pode pedir um passo mais fino. Nao vale para "90": ali o
    // modelista declarou que a peca pode DEITAR, e nao que pode ficar enviesada.
    const passo = Math.max(5, Math.min(90, Math.round(passoDeGiroGraus)));
    const angulos: number[] = [];
    for (let g = 0; g < 360; g += passo) angulos.push(g);
    return angulos;
  }
  if (giro === '90') return [0, 90, 180, 270];
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

  const candidatas = montarCandidatas(
    modelo,
    tamanho,
    conjuntos,
    folga,
    problemas,
    opcoes.passoDeGiroGraus ?? 90,
  );
  return colocar(candidatas, util, problemas, opcoes.semente ?? 0);
}

/**
 * A parte CARA: girar, simplificar, deslocar a margem e inflar cada peça em cada
 * ângulo permitido.
 *
 * Fica separada da colocação porque não depende da ordem. A busca por uma ordem
 * melhor roda a colocação dezenas de vezes, e recalcular as formas em cada uma
 * custava minutos — medido: 24 tentativas nas 11 peças reais não terminaram em
 * dez minutos. Preparando uma vez e colocando muitas, o custo da busca passa a ser
 * o da parte barata.
 */
export function prepararEncaixe(
  modelo: Modelo,
  opcoes: OpcoesDeEncaixe = {},
): { candidatas: Candidata[]; util: number | null; problemas: Problema[] } {
  const problemas: Problema[] = [];
  const util = opcoes.larguraUtilUM ?? larguraDoPapel(modelo);
  if (util === null) return { candidatas: [], util: null, problemas };
  const candidatas = montarCandidatas(
    modelo,
    opcoes.tamanho ?? modelo.tamanhoBase,
    Math.max(1, opcoes.conjuntos ?? 1),
    opcoes.folgaUM ?? FOLGA_PADRAO_UM,
    problemas,
    opcoes.passoDeGiroGraus ?? 90,
  );
  return { candidatas, util, problemas };
}

/** A parte BARATA: decidir a ordem e ir colocando. */
function colocar(
  candidatasOriginais: readonly Candidata[],
  util: number,
  problemasDeEntrada: readonly Problema[],
  semente: number,
): Encaixe {
  const problemas: Problema[] = [...problemasDeEntrada];
  const candidatas = [...candidatasOriginais];
  if (semente === 0) {
    // Maior primeiro: e a heuristica classica do bottom-left, e a que da o melhor
    // aproveitamento sem busca. O desempate por id mantem o resultado deterministico.
    candidatas.sort((a, b) => b.area - a.area || (a.pecaId < b.pecaId ? -1 : 1) || a.copia - b.copia);
  } else {
    // A ordem e a de sempre — maiores primeiro —, PERTURBADA. Medido: embaralhar
    // por completo e pior em quase toda tentativa (1,97 m contra 1,44 m no molde de
    // 12 pecas), porque "maiores primeiro" nao e um chute: e o que deixa as pecas
    // pequenas taparem os buracos que as grandes abrem. O que vale explorar e a
    // VIZINHANCA dessa ordem, trocando de lugar quem tem area parecida.
    //
    // O empurrao vai a 35% da area: o bastante para uma manga passar na frente de
    // outra, pouco para uma gola furar a fila das frentes.
    const chave = new Map(
      candidatas.map((c) => {
        const sorteio = misturar(String(semente) + "|" + c.pecaId + "|" + String(c.copia));
        const empurrao = ((sorteio % 1000) / 1000 - 0.5) * 0.7;
        return [c, c.area * (1 + empurrao)];
      }),
    );
    candidatas.sort(
      (a, b) => (chave.get(b) ?? 0) - (chave.get(a) ?? 0) || (a.pecaId < b.pecaId ? -1 : 1),
    );
  }

  const colocacoes: Colocacao[] = [];
  const postas: Path64[] = [];
  let areaColocada = 0;
  let comprimento = 0;

  for (const candidata of candidatas) {
    const escolha = melhorPosicao(candidata, postas, util, comprimento);
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
      dx: escolha.dx,
      dy: escolha.dy,
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

/**
 * Tenta várias ordens de colocação e fica com a que gasta menos rolo.
 *
 * O encaixe de polígonos irregulares é NP-difícil: não existe "o ótimo" ao alcance
 * de uma conta. O que os sistemas bons fazem é o que está aqui — rodar a heurística
 * muitas vezes, com ordens diferentes, e guardar a melhor. O NFP, que é a parte
 * cara, já está pronto e não muda; o que muda é a ordem da fila.
 *
 * A tentativa 0 é sempre a heurística clássica (maiores primeiro, giro de 90 em 90),
 * então **o resultado nunca é pior que o de `encaixar`** — no limite, empata.
 *
 * ## Por que o passo de giro entra AQUI, e não solto
 * Medido: passar o giro de 90 para 30 graus, sozinho, chega a PIORAR. Duas tiras de
 * 1700 × 100 mm num rolo de 1,58 m saem em **1,720 m** com giro de 90 em 90 (as duas
 * em pé, lado a lado) e em **1,933 m** com giro de 30 em 30 — porque a escolha de
 * ângulo é gulosa peça a peça: a primeira tira acha bonito deitar enviesada, encolhe
 * a própria caixa, e atravanca a faixa para a segunda.
 *
 * É por isso que o passo fino não é um botão solto. Ele é uma das tentativas da
 * busca, e a busca fica com a melhor — assim ângulo fino só pode ajudar.
 *
 * Determinístico: mesma entrada e mesmo número de tentativas, mesmo encaixe.
 */
export function encaixarBuscando(
  modelo: Modelo,
  opcoes: OpcoesDeEncaixe = {},
  tentativas = 12,
): { melhor: Encaixe; tentadas: number; comprimentos: number[] } {
  const quantas = Math.max(1, Math.min(64, Math.floor(tentativas)));
  const comprimentos: number[] = [];
  let melhor: Encaixe | null = null;

  // Cada tentativa mistura uma ordem e um passo de giro. O passo declarado pelo
  // chamador, se houver, manda: quem pediu 30 graus quer 30 graus.
  const passos = opcoes.passoDeGiroGraus === undefined ? [90, 45, 30] : [opcoes.passoDeGiroGraus];

  // As formas de cada passo saem UMA vez e servem todas as ordens daquele passo.
  const preparados = passos.map((passo) => prepararEncaixe(modelo, { ...opcoes, passoDeGiroGraus: passo }));

  for (let i = 0; i < quantas; i++) {
    const pronto = preparados[i % passos.length]!;
    const e =
      pronto.util === null
        ? encaixar(modelo, opcoes)
        : colocar(pronto.candidatas, pronto.util, pronto.problemas, Math.floor(i / passos.length));
    comprimentos.push(e.comprimentoUsadoUM);
    if (e.colocacoes.length === 0) {
      // Sem colocação nenhuma o problema não é a ordem: é o rolo ou a peça.
      return { melhor: e, tentadas: i + 1, comprimentos };
    }
    const melhorAteAqui =
      melhor === null ||
      e.colocacoes.length > melhor.colocacoes.length ||
      (e.colocacoes.length === melhor.colocacoes.length &&
        e.comprimentoUsadoUM < melhor.comprimentoUsadoUM);
    if (melhorAteAqui) melhor = e;
  }

  return { melhor: melhor as Encaixe, tentadas: quantas, comprimentos };
}

// ------------------------------------------------------------------ interno

/**
 * Chave determinística a partir de um texto (FNV-1a de 32 bits).
 *
 * Serve para embaralhar sem sortear: sorteio daria um encaixe diferente a cada
 * clique, e um encaixe que não se reproduz não pode ser cortado com confiança.
 */
function misturar(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Um contorno pronto para encaixar, e o canto que ele tinha antes de ir para a origem. */
interface Forma {
  readonly caminho: Path64;
  readonly largura: number;
  readonly altura: number;
  readonly minX: number;
  readonly minY: number;
}

interface Candidata {
  readonly pecaId: Id;
  readonly nome: string;
  readonly copia: number;
  readonly espelhada: boolean;
  readonly peca: Peca;
  /** Contorno de corte por rotacao, ja com folga, encostado na origem. */
  readonly porRotacao: Map<number, Forma>;
  readonly area: number;
}

function montarCandidatas(
  modelo: Modelo,
  tamanho: string,
  conjuntos: number,
  folga: number,
  problemas: Problema[],
  passoDeGiro: number,
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

      const porRotacao = new Map<number, Forma>();
      let areaDaPeca = 0;
      for (const graus of rotacoesPermitidas(peca, passoDeGiro)) {
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
): { caminho2: Forma; area: number } | null {
  try {
    const girada = graus === 0 ? peca : rotacionarPeca(peca, { x: 0, y: 0 }, graus);

    // A simplificacao e no ANEL JA TESSELADO, e nao na peca.
    //
    //  do motor so mexe em trechos de RETAS dentro de uma
    // aresta — de proposito, para nao estragar curva. Só que peca digitalizada e
    // quase toda curva, e o  tessela cada Bezier a 0,1 mm: o anel
    // chega aqui com centenas de pontos. O Minkowski entre dois poligonos de 500
    // pontos sao 250 mil quadrilateros, e o encaixe das 11 pecas reais nao
    // terminava em dez minutos.
    //
    // Aqui o anel ja e uma poligonal simples, e o Douglas-Peucker do clipper pode
    // trabalhar nela inteira. Os 0,5 mm continuam muito abaixo da folga de 2 mm,
    // entao o erro e absorvido como sempre foi.
    const tesselado = offsetMargem(girada).pontos.map((p) => ({ x: p.x, y: p.y }));
    const corte =
      tesselado.length > 8 ? ramerDouglasPeucker(tesselado, SIMPLIFICACAO_UM) : tesselado;

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
      // `minX`/`minY` viajam junto de propósito: são o canto que este contorno
      // tinha ANTES de ser encostado na origem, e é com eles que se calcula o
      // deslocamento exato que põe a peça onde o encaixe decidiu. Sem eles, quem
      // aplica o encaixe teria que refazer simplificação, corte e inflação para
      // achar o mesmo canto — e um fio de diferença ali vira peça sobreposta.
      caminho2: { caminho, largura: maxX - minX, altura: maxY - minY, minX, minY },
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
  /** O deslocamento a aplicar na peça girada. É o que `aplicarEncaixe` usa. */
  readonly dx: number;
  readonly dy: number;
  readonly rotacao: number;
  readonly contorno: Path64;
  readonly largura: number;
  readonly altura: number;
  readonly area: number;
}

/**
 * A melhor posição para a peça: a que deixa a faixa mais curta.
 *
 * ## O erro que estava aqui, e por que ele custava tecido
 * A primeira versão pegava como candidatas apenas os **vértices de cada NFP,
 * calculado contra uma peça posta de cada vez**. Isso deixa de fora justamente as
 * posições que valem ouro num encaixe:
 *
 * - o **encaixe no canto formado por DUAS peças** — que é onde dois NFPs se cruzam,
 *   e um vértice desse cruzamento não é vértice de nenhum dos dois;
 * - a peça **encostada na borda da faixa**, que é onde um NFP corta a parede.
 *
 * Ou seja: a peça nunca se enfiava num vão entre duas vizinhas, e nunca raspava a
 * ourela. Sobrava tecido em todo lugar onde o encaixe bom aparece.
 *
 * ## O conserto: a região viável, exata
 * O conjunto de posições válidas é
 *
 * ```
 * viável = (retângulo da faixa)  −  (união de todos os NFPs)
 * ```
 *
 * e o ótimo do bottom-left está sempre num **vértice** dessa região. Quem calcula a
 * subtração é o clipper2 — e ele devolve de graça todos os cruzamentos que faltavam,
 * porque criar vértice em cruzamento é exatamente o que uma operação booleana faz.
 *
 * O retângulo já embute a parede: as posições de referência vão de `x = 0` a
 * `x = útil − largura`, então nada pode sair da faixa por construção.
 *
 * ## O objetivo
 * Não é "o mais baixo" nem "o mais à esquerda": é **o comprimento que a faixa fica
 * tendo**. Uma peça que desce muito mas cresce para além do fim da fila piora o
 * consumo; uma que encaixa num buraco no meio não muda nada e é de graça. Empate
 * resolve pelo mais baixo, depois pelo mais à esquerda, depois pelo ângulo — nessa
 * ordem, para o resultado não depender da ordem do `Map`.
 */
function melhorPosicao(
  candidata: Candidata,
  postas: readonly Path64[],
  util: number,
  comprimentoAtual: number,
): Escolha | null {
  let melhor: Escolha | null = null;
  let melhorNota: [number, number, number, number] | null = null;

  for (const [rotacao, forma] of candidata.porRotacao) {
    if (forma.largura > util) continue;

    // O teto do retângulo: alto o bastante para SEMPRE caber a peça acima de tudo
    // que já está posto. Sem essa garantia a região poderia sair vazia e a peça
    // seria recusada por um limite artificial, e não por não caber no rolo.
    const teto = comprimentoAtual + forma.altura + 1;
    const faixa: Path64 = [
      { x: 0, y: 0 },
      { x: util - forma.largura, y: 0 },
      { x: util - forma.largura, y: teto },
      { x: 0, y: teto },
    ];

    // A subtracao e INCREMENTAL, um NFP de cada vez.
    //
    // Juntar todos os NFPs numa uniao so antes de subtrair parece mais rapido e
    // esta errado: o Minkowski de pecas diferentes sai com orientacoes diferentes,
    // e a regra NonZero trata orientacao oposta como SUBTRACAO — um NFP apagava o
    // outro e a posicao proibida virava livre. Medido: 13 pares de pecas
    // sobrepostas, a pior com 1664 cm2 de area em comum. Uma peca em cima da outra.
    //
    // Subtraindo um por vez, cada operacao e entre dois conjuntos bem formados e o
    // clipper resolve a orientacao dentro dela.
    let livre: Paths64 = [faixa];
    for (const posta of postas) {
      const nfp = nfpDe(forma.caminho, posta);
      if (nfp.length === 0) continue;
      livre = difference(livre, nfp, FillRule.NonZero);
      if (livre.length === 0) break;
    }

    for (const anel of livre) {
      for (const ponto of anel) {
        const x = Number(ponto.x);
        const y = Number(ponto.y);
        if (x < 0 || y < 0 || x + forma.largura > util) continue;

        // A nota é o comprimento que a faixa PASSA A TER com esta peça aqui.
        const nota: [number, number, number, number] = [
          Math.max(comprimentoAtual, y + forma.altura),
          y,
          x,
          rotacao,
        ];
        if (melhorNota !== null && !menor(nota, melhorNota)) continue;

        melhorNota = nota;
        melhor = {
          x,
          y,
          dx: x - forma.minX,
          dy: y - forma.minY,
          rotacao,
          contorno: forma.caminho,
          largura: forma.largura,
          altura: forma.altura,
          area: candidata.area,
        };
      }
    }
  }

  return melhor;
}

/** Comparação lexicográfica de duas notas. */
function menor(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}
function unir(caminhos: Paths64): Paths64 {
  return union(caminhos, [], FillRule.NonZero);
}

/**
 * O NFP de uma peça contra outra — **sem buraco**.
 *
 * O `minkowskiDiff` do clipper devolve DOIS caminhos para dois retângulos: o NFP
 * de verdade (740 × 1240 = 917 600 mm² no caso medido) e um segundo, de área
 * negativa, que é a EROSÃO — (420−320) × (720−520) = 20 000 mm². Unindo os dois, o
 * segundo vira buraco, e o buraco vira posição livre bem no meio da peça que já
 * está lá.
 *
 * Foi o pior defeito desta fase: doze peças com treze pares sobrepostos, a pior
 * com 1664 cm² de área em comum — peça inteira em cima de peça inteira. O código
 * antigo mascarava por acaso, porque testava ponto-dentro-de-ANEL e o ponto caía
 * dentro dos dois anéis; quando a colocação passou a usar a região viável de
 * verdade, o buraco virou posição válida.
 *
 * Ficam só os anéis de área positiva. Um NFP de peça côncava pode ter buraco
 * legítimo — posição em que a móvel cabe dentro de uma reentrância da fixa —, e
 * jogar fora é perder essa posição. É uma perda de aproveitamento, não de
 * segurança, e a alternativa é peça cortada em cima de peça.
 */
function nfpDe(movel: Path64, fixa: Path64): Paths64 {
  const cru = minkowskiDiff(movel, fixa, true);
  const soFora = cru.filter((anel) => areaPaths([anel]) > 0);
  return unir(soFora.length === 0 ? cru : soFora);
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
    // O deslocamento vem GRAVADO da decisão, e não é redescoberto aqui. Foi assim
    // que apareceu o pior defeito desta fase: o encaixe decidia olhando o contorno
    // simplificado e inflado, e a aplicação encostava o contorno de verdade — dois
    // cantos diferentes, peças planejadas encostadas saindo sobrepostas em até
    // 1664 cm². Com o encaixe frouxo antigo a folga escondia; com o encaixe justo
    // aparece na primeira peça.
    return { colocacao, peca: transladarPeca(peca, colocacao.dx, colocacao.dy) };
  });
}
