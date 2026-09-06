/**
 * As seis ferramentas essenciais (Bloco 4 da Fase 2).
 *
 * Todas seguem as tres regras da Parte 0:
 *   1. um gesto = um evento (ou nenhum);
 *   2. erro do motor cancela, sem emitir e sem sujar o documento;
 *   3. `Esc` cancela — quem trata isso e o `Editor`, para nao repetir em seis lugares.
 *
 * O que mudar aqui muda o molde de verdade: cada ferramenta chama a operacao do
 * motor que ja existe e ja tem teste numerico. Nenhuma reimplementa geometria.
 */
import {
  ALTURA_PADRAO_DO_PIQUE_UM,
  LARGURA_PADRAO_DO_PIQUE_UM,
  MM,
  inserirPonto,
  mmParaUM,
  medirAresta,
  medirSegmento,
  modificarPonto,
  moverPique,
  transladarPeca,
  type Id,
  type TipoPique,
  type Vetor2,
} from '@cad/motor';

import type { TipoDeAlvo } from './alvo.js';
import type { Contexto, Ferramenta } from './ferramenta.js';
import { TIPOS_DO_MARQUEE, referenciaDe } from './selecao.js';
import type { Modificadores } from './snap.js';

/** Quanto o cursor precisa andar para o gesto virar arrasto, e nao clique. */
export const LIMIAR_DE_ARRASTO_PX = 3;

/**
 * Pedaco minimo que um segmento pode sobrar ao ser partido, em UM (1 mm).
 *
 * Sem isto, arrastar em cima da linha bem ao lado de um vertice nasce um ponto a
 * fracao de milimetro do vizinho, e o contorno ganha uma farpa — dois pontos
 * quase no mesmo lugar, linha sobre linha. E o tipo de defeito que so aparece na
 * hora de cortar.
 */
export const PEDACO_MINIMO_UM = 1000;

const distancia = (a: Vetor2, b: Vetor2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Delta do gesto, com `Shift` preso ao eixo. Sem snap — e o caso da peca inteira. */
function deltaCru(origem: Vetor2, em: Vetor2, mod: Modificadores): { dx: number; dy: number } {
  const bruto = { dx: em.x - origem.x, dy: em.y - origem.y };
  return mod.shift ? ortogonalizar(bruto.dx, bruto.dy) : bruto;
}

/** Delta do gesto passando pelo snap. E o caso do ponto, que agarra em vertice. */
function deltaAte(
  ctx: Contexto,
  origem: Vetor2,
  em: Vetor2,
  mod: Modificadores,
): { dx: number; dy: number } {
  const destino = ctx.snap(em, mod)?.ponto ?? em;
  return deltaCru(origem, destino, mod);
}

/** Prende o delta ao eixo mais forte. E o `Shift` de todo CAD. */
function ortogonalizar(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

// ===========================================================================
// 1. Selecionar
// ===========================================================================

/**
 * Clique, Shift/Ctrl e marquee janela x cruzamento. Nao emite evento nenhum —
 * selecionar nao muda o molde, e por isso nao entra no log.
 */
export function ferramentaSelecionar(): Ferramenta {
  let origem: Vetor2 | null = null;
  let virouMarquee = false;

  return {
    nome: 'selecionar',
    atalho: 'V',

    aoApontar(_ctx, em) {
      origem = em;
      virouMarquee = false;
    },

    aoArrastar(ctx, em) {
      if (origem === null) return;
      if (!virouMarquee && distancia(origem, em) < LIMIAR_DE_ARRASTO_PX * ctx.camera.umPorPixel) {
        return;
      }
      virouMarquee = true;
    },

    aoSoltar(ctx, em, mod) {
      if (origem === null) return;
      if (virouMarquee) ctx.selecao.marquee(ctx.cena, ctx.camadas, origem, em, mod, TIPOS_DO_MARQUEE);
      else ctx.selecao.clicar(ctx.alvo(em), mod);
      origem = null;
      virouMarquee = false;
    },

    aoTecla(ctx, tecla, mod) {
      if (tecla === 'a' && mod.ctrl) ctx.selecao.selecionarTudo(ctx.cena, ctx.camadas);
    },
  };
}

// ===========================================================================
// 2. Mover ponto — o gesto central da modelagem
// ===========================================================================

export interface OpcoesDeMover {
  modo: 'discreto' | 'proporcional';
  nVizinhos: number;
}

/**
 * Arrasta um vertice do contorno. No modo proporcional os vizinhos acompanham com
 * o decaimento `(1+cos(pi*i/(N+1)))/2` — a conta que nao deixa bico na curva.
 *
 * A edicao vai para o tamanho BASE (E9); a graduacao recalcula por cima. Como a
 * regra e aditiva, o ponto arrastado segue o cursor mesmo com P ou G na tela.
 */
export function ferramentaMoverPonto(opcoes: OpcoesDeMover): Ferramenta {
  let arrasto: {
    pecaId: Id;
    /** Os pontos que vao junto. Um so, ou o grupo inteiro que estava selecionado. */
    pontos: Id[];
    origem: Vetor2;
    dx: number;
    dy: number;
    /**
     * Preenchido quando o gesto comecou EM CIMA DA LINHA, e nao num vertice: o
     * ponto ainda nao existe, e nasce junto com o movimento.
     */
    nascendo: { segmentoId: Id; s: number; prefixoId: Id } | null;
  } | null = null;
  let contador = 0;

  /**
   * Esta ferramenta so mira VERTICE e LINHA.
   *
   * Pique e linha interna tem prioridade alta no hit-testing porque sao alvos
   * pequenos — mas aqui eles so atrapalhavam: quem crava um pique para marcar onde
   * a linha esta torta e depois tenta arrumar ali descobria que aquele pedaco do
   * contorno tinha virado uma zona morta, porque o clique pegava o pique e a
   * ferramenta parava. Cada um tem a sua ferramenta; esta e a do ponto.
   */
  const IGNORAR = new Set<TipoDeAlvo>(['pique', 'interna', 'controle']);

  /**
   * Grupo anda RIGIDO; ponto sozinho respeita o modo escolhido.
   *
   * Aplicar o decaimento proporcional a cada ponto de um grupo composto os
   * deslocamentos: quem esta no meio do grupo levaria o proprio arrasto mais o
   * arraste dos vizinhos, e a selecao sairia deformada. Quem seleciona uma area e
   * arrasta quer aquela area no lugar novo, inteira.
   */
  const modoDo = (quantos: number): 'discreto' | 'proporcional' =>
    quantos > 1 ? 'discreto' : opcoes.modo;
  const vizinhosDe = (quantos: number): number => (quantos > 1 ? 0 : opcoes.nVizinhos);

  const aplicar = (ctx: Contexto, dx: number, dy: number): void => {
    if (arrasto === null) return;
    const { pecaId, pontos } = arrasto;
    const nascendo = arrasto.nascendo;
    const previa = ctx.tentar(() => {
      let peca = ctx.base(pecaId);
      if (nascendo !== null) {
        peca = inserirPonto(peca, nascendo.segmentoId, nascendo.s, nascendo.prefixoId);
      }
      for (const pontoId of pontos) {
        peca = modificarPonto(peca, pontoId, dx, dy, modoDo(pontos.length), vizinhosDe(pontos.length));
      }
      return peca;
    });
    ctx.previsualizar(pecaId, previa);
  };

  return {
    nome: 'moverPonto',
    atalho: 'M',

    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em, { ignorar: IGNORAR });

      // Comecou EM CIMA DA LINHA, longe de vertice: nasce um ponto ali e o gesto
      // ja o arrasta. E o gesto de arrumar linha torta — antes disso, um trecho de
      // aresta sem vertice era intocavel, e so restava inserir ponto a parte e
      // voltar para mover. Um gesto, um passo de undo, dois eventos.
      if (alvo?.tipo === 'aresta') {
        // Perto demais de um vertice: pega o VERTICE em vez de criar uma farpa.
        const comprimento = medirSegmento(ctx.base(alvo.pecaId), alvo.segmentoId);
        const folga = comprimento === 0 ? 1 : PEDACO_MINIMO_UM / comprimento;
        if (alvo.sNoSegmento < folga || alvo.sNoSegmento > 1 - folga) {
          const segmento = ctx.base(alvo.pecaId).segmentos[alvo.segmentoId]!;
          const pontoId = alvo.sNoSegmento < 0.5 ? segmento.de : segmento.para;
          const ponto = ctx.base(alvo.pecaId).pontos[pontoId]!;
          ctx.selecao.clicar(
            { tipo: 'ponto', pecaId: alvo.pecaId, pontoId, ponto },
            mod,
          );
          arrasto = {
            pecaId: alvo.pecaId,
            pontos: [pontoId],
            origem: { x: ponto.x, y: ponto.y },
            dx: 0,
            dy: 0,
            nascendo: null,
          };
          return;
        }
        const s = alvo.sNoSegmento;
        const prefixoId = `mv-${ctx.cena.versaoDoLog}-${contador++}`;
        arrasto = {
          pecaId: alvo.pecaId,
          pontos: [`${prefixoId}-p`],
          origem: alvo.ponto,
          dx: 0,
          dy: 0,
          nascendo: { segmentoId: alvo.segmentoId, s, prefixoId },
        };
        return;
      }

      if (alvo === null || alvo.tipo !== 'ponto') {
        ctx.selecao.clicar(alvo, mod);
        return;
      }

      // Se o ponto clicado ja fazia parte de uma selecao, o gesto move o GRUPO —
      // e o "mover a area" que todo CAD de molde tem. Clicar fora dela recomeca.
      const jaSelecionado = ctx.selecao.tem({
        tipo: 'ponto',
        pecaId: alvo.pecaId,
        pontoId: alvo.pontoId,
      });
      if (!jaSelecionado) ctx.selecao.clicar(alvo, mod);

      const grupo = ctx.selecao
        .doTipo('ponto')
        .filter((ref) => ref.pecaId === alvo.pecaId)
        .map((ref) => ref.pontoId);

      arrasto = {
        pecaId: alvo.pecaId,
        pontos: grupo.length > 1 ? grupo : [alvo.pontoId],
        origem: alvo.ponto,
        dx: 0,
        dy: 0,
        nascendo: null,
      };
    },

    aoArrastar(ctx, em, mod) {
      if (arrasto === null) return;
      const { dx, dy } = deltaAte(ctx, arrasto.origem, em, mod);
      arrasto.dx = dx;
      arrasto.dy = dy;
      aplicar(ctx, dx, dy);
      ctx.mostrarCota({
        rotulo: 'deslocamento',
        valorUM: Math.hypot(dx, dy),
        de: arrasto.origem,
        ate: { x: arrasto.origem.x + dx, y: arrasto.origem.y + dy },
      });
    },

    aoSoltar(ctx, em, mod) {
      if (arrasto === null) return;
      // O delta e recalculado NA SOLTURA, nao herdado do ultimo `pointermove`.
      //
      // Era um defeito de verdade: um `pointerup` que cai alguns pixels adiante do
      // ultimo movimento — o que acontece o tempo todo com o mouse — commitava o
      // deslocamento ANTIGO, e a peca "voltava" para onde tinha passado, em vez de
      // ficar onde foi largada.
      const final = deltaAte(ctx, arrasto.origem, em, mod);
      const { pecaId, pontos, nascendo } = arrasto;
      const { dx, dy } = final;
      arrasto = null;
      // A cota do arrasto e do GESTO: acabou o gesto, some. A da regua e outra
      // coisa — ela e a saida da ferramenta, e fica ate a proxima medida.
      ctx.mostrarCota(null);
      if (dx === 0 && dy === 0) return;

      const inserir =
        nascendo === null
          ? []
          : [
              {
                tipo: 'InserirPonto',
                pecaId,
                payload: {
                  segmentoId: nascendo.segmentoId,
                  s: nascendo.s,
                  prefixoId: nascendo.prefixoId,
                },
              },
            ];
      // Um `emitir` so: mover cinco pontos e UM passo de undo, nao cinco — e
      // inserir + mover, quando o ponto nasce no gesto, tambem e um passo so.
      ctx.emitir(
        ...inserir,
        ...gestosDeMover(pecaId, pontos, dx, dy, modoDo(pontos.length), vizinhosDe(pontos.length)),
      );
    },

    aoNumero(ctx, campos) {
      // E10: valor digitado ganha do ultimo pixel. Vem em MILIMETRO.
      const doArrasto = arrasto;
      const selecionados = ctx.selecao.doTipo('ponto');
      const pecaId = doArrasto?.pecaId ?? selecionados[0]?.pecaId;
      if (pecaId === undefined) return;
      const pontos =
        doArrasto?.pontos ??
        selecionados.filter((ref) => ref.pecaId === pecaId).map((ref) => ref.pontoId);
      if (pontos.length === 0) return;

      const dx = mmParaUM(campos['dx'] ?? 0);
      const dy = mmParaUM(campos['dy'] ?? 0);
      arrasto = null;
      if (dx === 0 && dy === 0) return;
      ctx.emitir(...gestosDeMover(pecaId, pontos, dx, dy, modoDo(pontos.length), vizinhosDe(pontos.length)));
    },

    aoSair(ctx) {
      arrasto = null;
      ctx.previsualizar('', null);
    },
  };
}

function gestosDeMover(
  pecaId: Id,
  pontos: readonly Id[],
  dx: number,
  dy: number,
  modo: 'discreto' | 'proporcional',
  nVizinhos: number,
): { tipo: string; pecaId: Id; payload: unknown }[] {
  return pontos.map((pontoId) => ({
    tipo: 'ModificarPonto',
    pecaId,
    payload: { pontoId, dx, dy, modo, nVizinhos },
  }));
}

// ===========================================================================
// 3. Mover peca
// ===========================================================================

/**
 * Arrasta a peca inteira. Com varias selecionadas, emite um evento por peca **no
 * mesmo gesto** — assim o undo desfaz o movimento inteiro, e nao peca por peca.
 */
export function ferramentaMoverPeca(): Ferramenta {
  let arrasto: { pecas: Id[]; origem: Vetor2; dx: number; dy: number } | null = null;

  return {
    nome: 'moverPeca',
    atalho: 'G',

    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);
      if (alvo === null) {
        ctx.selecao.clicar(null, mod);
        return;
      }
      // Clicar em qualquer parte da peca move a peca: aqui o alvo e sempre a peca.
      const jaSelecionada = ctx.selecao
        .doTipo('peca')
        .some((ref) => ref.pecaId === alvo.pecaId);
      if (!jaSelecionada) {
        ctx.selecao.clicar({ tipo: 'peca', pecaId: alvo.pecaId, ponto: em }, mod);
      }
      const pecas = ctx.selecao.doTipo('peca').map((ref) => ref.pecaId);
      arrasto = { pecas: pecas.length > 0 ? pecas : [alvo.pecaId], origem: em, dx: 0, dy: 0 };
    },

    aoArrastar(ctx, em, mod) {
      if (arrasto === null) return;
      const { dx, dy } = deltaCru(arrasto.origem, em, mod);
      arrasto.dx = dx;
      arrasto.dy = dy;
      // A previa mostra so a primeira peca do lote: desenhar todas custaria uma
      // graduacao por peca por quadro, e o ganho visual e nenhum.
      const primeira = arrasto.pecas[0]!;
      const previa = ctx.tentar(() => transladarPeca(ctx.base(primeira), dx, dy));
      ctx.previsualizar(primeira, previa);
    },

    aoSoltar(ctx, em, mod) {
      if (arrasto === null) return;
      // Mesma regra do mover ponto: vale onde o botao foi SOLTO.
      const { dx, dy } = deltaCru(arrasto.origem, em, mod);
      const { pecas } = arrasto;
      arrasto = null;
      if (dx === 0 && dy === 0) return;
      ctx.emitir(
        ...pecas.map((pecaId) => ({ tipo: 'TransladarPeca', pecaId, payload: { dx, dy } })),
      );
    },

    aoNumero(ctx, campos) {
      const pecas = ctx.selecao.doTipo('peca').map((ref) => ref.pecaId);
      if (pecas.length === 0) return;
      const dx = mmParaUM(campos['dx'] ?? 0);
      const dy = mmParaUM(campos['dy'] ?? 0);
      arrasto = null;
      if (dx === 0 && dy === 0) return;
      ctx.emitir(...pecas.map((pecaId) => ({ tipo: 'TransladarPeca', pecaId, payload: { dx, dy } })));
    },

    aoSair() {
      arrasto = null;
    },
  };
}

// ===========================================================================
// 4. Pique
// ===========================================================================

export interface OpcoesDePique {
  tipo: TipoPique;
  profundidadeMM: number;
  larguraMM: number;
}

/**
 * Clique no contorno crava; arrastar um pique existente desliza na MESMA aresta;
 * `Delete` tira o selecionado.
 *
 * Puxar um pique para outra aresta nao faz nada de proposito: trocar de aresta e
 * apagar e recravar, e isso o modelista faz com intencao, nao por engano.
 */
export function ferramentaPique(opcoes: OpcoesDePique): Ferramenta {
  let arrasto: { pecaId: Id; piqueId: Id; arestaId: Id; s: number } | null = null;
  let contador = 0;

  return {
    nome: 'pique',
    atalho: 'N',

    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);

      if (alvo?.tipo === 'pique') {
        const pique = ctx.base(alvo.pecaId).piques[alvo.piqueId]!;
        ctx.selecao.clicar(alvo, mod);
        arrasto = { pecaId: alvo.pecaId, piqueId: alvo.piqueId, arestaId: pique.arestaId, s: pique.s };
        return;
      }
      if (alvo?.tipo !== 'aresta') return;

      const piqueId = `pq-${ctx.cena.versaoDoLog}-${contador++}`;
      ctx.emitir({
        tipo: 'AdicionarPique',
        pecaId: alvo.pecaId,
        payload: {
          piqueId,
          arestaId: alvo.arestaId,
          s: alvo.s,
          tipo: opcoes.tipo,
          alturaUM: mmParaUM(opcoes.profundidadeMM),
          larguraUM: mmParaUM(opcoes.larguraMM),
          anguloGraus: 0,
        },
      });
      ctx.selecao.clicar({ tipo: 'pique', pecaId: alvo.pecaId, piqueId, ponto: alvo.ponto }, {
        shift: false,
        ctrl: false,
        alt: false,
      });
    },

    aoArrastar(ctx, em) {
      if (arrasto === null) return;
      const alvo = ctx.alvo(em, { ignorar: new Set(['ponto', 'pique', 'interna', 'peca']) });
      if (alvo?.tipo !== 'aresta' || alvo.arestaId !== arrasto.arestaId) return;
      arrasto.s = alvo.s;
      const previa = ctx.tentar(() => moverPique(ctx.base(arrasto!.pecaId), arrasto!.piqueId, alvo.s));
      ctx.previsualizar(arrasto.pecaId, previa);
    },

    aoSoltar(ctx) {
      if (arrasto === null) return;
      const { pecaId, piqueId, s } = arrasto;
      const original = ctx.base(pecaId).piques[piqueId]!;
      arrasto = null;
      if (s === original.s) return;
      ctx.emitir({ tipo: 'MoverPique', pecaId, payload: { piqueId, s } });
    },

    aoTecla(ctx, tecla) {
      if (tecla !== 'Delete' && tecla !== 'Backspace') return;
      const piques = ctx.selecao.doTipo('pique');
      if (piques.length === 0) return;
      ctx.emitir(
        ...piques.map((ref) => ({
          tipo: 'RemoverPique',
          pecaId: ref.pecaId,
          payload: { piqueId: ref.piqueId },
        })),
      );
    },

    aoNumero(ctx, campos) {
      const [ref] = ctx.selecao.doTipo('pique');
      if (ref === undefined) return;
      const pique = ctx.base(ref.pecaId).piques[ref.piqueId]!;
      // Aceita `s` direto ou a distancia em mm desde o inicio da aresta.
      const s =
        campos['s'] ??
        (campos['distancia'] === undefined
          ? undefined
          : mmParaUM(campos['distancia']) / medirAresta(ctx.base(ref.pecaId), pique.arestaId));
      if (s === undefined) return;
      ctx.emitir({ tipo: 'MoverPique', pecaId: ref.pecaId, payload: { piqueId: ref.piqueId, s } });
    },

    aoSair() {
      arrasto = null;
    },
  };
}

// ===========================================================================
// 5. Inserir ponto (e excluir, com Alt)
// ===========================================================================

/**
 * Clique no contorno: nasce um ponto ali e o segmento vira dois. `Alt`+clique num
 * ponto do meio de uma aresta faz o inverso, fundindo os dois segmentos vizinhos.
 */
export function ferramentaInserirPonto(): Ferramenta {
  let contador = 0;

  return {
    nome: 'inserirPonto',
    atalho: 'I',

    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);
      if (alvo === null) return;

      if (mod.alt) {
        if (alvo.tipo !== 'ponto') return;
        ctx.emitir({
          tipo: 'ExcluirPonto',
          pecaId: alvo.pecaId,
          payload: { pontoId: alvo.pontoId },
        });
        return;
      }

      if (alvo.tipo !== 'aresta') return;
      // `inserirPonto` recusa 0 e 1: os extremos do segmento ja sao pontos.
      const s = Math.min(0.98, Math.max(0.02, alvo.sNoSegmento));
      ctx.emitir({
        tipo: 'InserirPonto',
        pecaId: alvo.pecaId,
        payload: {
          segmentoId: alvo.segmentoId,
          s,
          prefixoId: `ins-${ctx.cena.versaoDoLog}-${contador++}`,
        },
      });
    },
  };
}

// ===========================================================================
// 6. Medir — a regua, que nao muda nada
// ===========================================================================

/**
 * Clique em duas coisas e a cota aparece. Nao emite evento: medir nao altera o
 * molde.
 *
 * E aqui que se confere que a tela nao mente — **todo numero sai de uma funcao de
 * medida do motor**, nunca de uma conta feita no editor.
 */
export function ferramentaMedir(): Ferramenta {
  let primeiro: Vetor2 | null = null;

  return {
    nome: 'medir',
    atalho: 'L',

    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);

      // Clicar numa aresta sozinha da o comprimento dela, medido pelo motor.
      if (alvo?.tipo === 'aresta' && primeiro === null) {
        const comprimento = ctx.tentar(() => medirAresta(ctx.base(alvo.pecaId), alvo.arestaId));
        if (comprimento !== null) {
          ctx.mostrarCota({
            rotulo: `aresta ${alvo.arestaId}`,
            valorUM: comprimento,
            de: alvo.ponto,
            ate: alvo.ponto,
          });
          return;
        }
      }

      const ponto = ctx.snap(em, mod)?.ponto ?? alvo?.ponto ?? em;
      if (primeiro === null) {
        primeiro = ponto;
        ctx.mostrarCota(null);
        return;
      }
      ctx.mostrarCota({
        rotulo: 'distancia',
        valorUM: Math.round(distancia(primeiro, ponto)),
        de: primeiro,
        ate: ponto,
      });
      primeiro = null;
    },

    aoSair(ctx) {
      primeiro = null;
      ctx.mostrarCota(null);
    },
  };
}

// ===========================================================================

/** As seis do Bloco 4, na ordem da barra de ferramentas. */
export function ferramentasEssenciais(opcoes?: {
  mover?: OpcoesDeMover;
  pique?: OpcoesDePique;
}): Ferramenta[] {
  return [
    ferramentaSelecionar(),
    ferramentaMoverPonto(opcoes?.mover ?? { modo: 'proporcional', nVizinhos: 2 }),
    ferramentaMoverPeca(),
    ferramentaPique(
      opcoes?.pique ?? {
        tipo: 'V',
        profundidadeMM: ALTURA_PADRAO_DO_PIQUE_UM / MM,
        larguraMM: LARGURA_PADRAO_DO_PIQUE_UM / MM,
      },
    ),
    ferramentaInserirPonto(),
    ferramentaMedir(),
  ];
}

/** Reexportado para a barra de ferramentas montar os botoes sem adivinhar. */
export { referenciaDe };
export type { Modificadores };
