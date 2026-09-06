/**
 * As ferramentas de ponteiro que faltavam (Bloco 7 da Fase 2).
 *
 * Mesmas tres regras da Parte 0: um gesto, um evento; erro do motor cancela sem
 * emitir; `Esc` cancela. Nenhuma reimplementa geometria — cada uma chama a operacao
 * do motor que ja existe e ja tem numero conferido.
 *
 * ## O que e ferramenta e o que e comando
 * Aqui ficam os gestos de PONTEIRO. Duplicar peca, definir margem da selecao,
 * simplificar contorno e regra de graduacao nao sao gestos: sao comandos de menu, e
 * moram em `comandos.ts`. Forcar tudo a virar ferramenta criaria maquina de estados
 * para o que e um clique de botao.
 */
import {
  ALTURA_PADRAO_DO_PIQUE_UM,
  arredondarVertice,
  chanfrarVertice,
  converterSegmento,
  espelharPeca,
  mmParaUM,
  moverControle,
  rotacionarPeca,
  type Id,
  type Vetor2,
} from '@cad/motor';

import type { Contexto, Ferramenta } from './ferramenta.js';

const ANGULO_PRESO_GRAUS = 15;

const anguloEntre = (centro: Vetor2, ponto: Vetor2): number =>
  (Math.atan2(ponto.y - centro.y, ponto.x - centro.x) * 180) / Math.PI;

/** Junta dois cliques num eixo. Serve a espelhar, dividir e eixo de dobra. */
function doisCliques(): {
  registrar(em: Vetor2): { p1: Vetor2; p2: Vetor2 } | null;
  limpar(): void;
  primeiro(): Vetor2 | null;
} {
  let p1: Vetor2 | null = null;
  return {
    registrar(em) {
      if (p1 === null) {
        p1 = em;
        return null;
      }
      const eixo = { p1, p2: em };
      p1 = null;
      return eixo.p1.x === eixo.p2.x && eixo.p1.y === eixo.p2.y ? null : eixo;
    },
    limpar() {
      p1 = null;
    },
    primeiro: () => p1,
  };
}

// ===========================================================================
// 7. Controle da curva — o gesto que da forma a cava e ao decote
// ===========================================================================

/**
 * Clicar numa aresta poe as alcas do segmento a mostra; arrastar uma alca da forma
 * a curva. Os extremos nao se movem — e isso que deixa a aresta vizinha casando.
 *
 * `segmentosAbertos` e o conjunto que a cena usa para desenhar as alcas: sem ele,
 * uma peca com cava e decote viraria um campo de bolinhas.
 */
export function ferramentaControle(segmentosAbertos: Set<Id>): Ferramenta {
  let arrasto: {
    pecaId: Id;
    segmentoId: Id;
    indice: 0 | 1;
    origem: Vetor2;
    dx: number;
    dy: number;
  } | null = null;

  return {
    nome: 'controle',
    atalho: 'B',

    aoApontar(ctx, em) {
      const alvo = ctx.alvo(em, { comControleVisivel: segmentosAbertos });
      if (alvo?.tipo === 'controle') {
        arrasto = {
          pecaId: alvo.pecaId,
          segmentoId: alvo.segmentoId,
          indice: alvo.indice,
          origem: alvo.ponto,
          dx: 0,
          dy: 0,
        };
        return;
      }
      segmentosAbertos.clear();
      if (alvo?.tipo === 'aresta') segmentosAbertos.add(alvo.segmentoId);
    },

    aoArrastar(ctx, em) {
      if (arrasto === null) return;
      arrasto.dx = em.x - arrasto.origem.x;
      arrasto.dy = em.y - arrasto.origem.y;
      const previa = ctx.tentar(() =>
        moverControle(
          ctx.base(arrasto!.pecaId),
          arrasto!.segmentoId,
          arrasto!.indice,
          arrasto!.dx,
          arrasto!.dy,
        ),
      );
      ctx.previsualizar(arrasto.pecaId, previa);
    },

    aoSoltar(ctx) {
      if (arrasto === null) return;
      const { pecaId, segmentoId, indice, dx, dy } = arrasto;
      arrasto = null;
      if (dx === 0 && dy === 0) return;
      ctx.emitir({ tipo: 'MoverControle', pecaId, payload: { segmentoId, indice, dx, dy } });
    },

    aoSair() {
      arrasto = null;
      segmentosAbertos.clear();
    },
  };
}

// ===========================================================================
// 8. Converter reta <-> curva
// ===========================================================================

/**
 * Clique numa aresta e o segmento troca de tipo.
 *
 * `reta -> curva` nao muda medida nenhuma: os controles nascem a 1/3 e 2/3 da
 * propria reta. O desenho so muda quando alguem mexer neles depois — e por isso a
 * ferramenta seguinte a usar e a do controle.
 */
export function ferramentaConverter(): Ferramenta {
  return {
    nome: 'converter',
    atalho: 'C',
    aoApontar(ctx, em) {
      const alvo = ctx.alvo(em);
      if (alvo?.tipo !== 'aresta') return;
      const segmento = ctx.base(alvo.pecaId).segmentos[alvo.segmentoId];
      if (segmento === undefined) return;
      const para = segmento.tipo === 'reta' ? 'curva' : 'reta';
      if (ctx.tentar(() => converterSegmento(ctx.base(alvo.pecaId), alvo.segmentoId, para)) === null) {
        return;
      }
      ctx.emitir({
        tipo: 'ConverterSegmento',
        pecaId: alvo.pecaId,
        payload: { segmentoId: alvo.segmentoId, para },
      });
    },
  };
}

// ===========================================================================
// 9 e 10. Fillet e chanfro
// ===========================================================================

export interface OpcoesDeCanto {
  /** Raio do fillet / distancia do chanfro, em milimetro. */
  medidaMM: number;
}

/** Fillet: clique num vertice e o canto vira arco. Recusa se o raio nao couber. */
export function ferramentaFillet(opcoes: OpcoesDeCanto): Ferramenta {
  return cantoArredondado('fillet', 'F', opcoes, 'ArredondarVertice', 'raioUM', arredondarVertice);
}

/** Chanfro: troca o canto por uma reta que corta os dois lados a `distancia`. */
export function ferramentaChanfro(opcoes: OpcoesDeCanto): Ferramenta {
  return cantoArredondado('chanfro', 'H', opcoes, 'ChanfrarVertice', 'distanciaUM', chanfrarVertice);
}

function cantoArredondado(
  nome: string,
  atalho: string,
  opcoes: OpcoesDeCanto,
  tipoDoEvento: string,
  campo: 'raioUM' | 'distanciaUM',
  operacao: (peca: never, pontoId: Id, medida: number, prefixo: Id) => unknown,
): Ferramenta {
  let contador = 0;
  let ultimo: { pecaId: Id; pontoId: Id } | null = null;

  const aplicar = (ctx: Contexto, pecaId: Id, pontoId: Id, medidaMM: number): void => {
    const medida = mmParaUM(medidaMM);
    const prefixoId = `${nome}-${ctx.cena.versaoDoLog}-${contador++}`;
    if (ctx.tentar(() => operacao(ctx.base(pecaId) as never, pontoId, medida, prefixoId)) === null) {
      return;
    }
    ctx.emitir({ tipo: tipoDoEvento, pecaId, payload: { pontoId, [campo]: medida, prefixoId } });
  };

  return {
    nome,
    atalho,
    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);
      if (alvo?.tipo !== 'ponto') return;
      ctx.selecao.clicar(alvo, mod);
      ultimo = { pecaId: alvo.pecaId, pontoId: alvo.pontoId };
      aplicar(ctx, alvo.pecaId, alvo.pontoId, opcoes.medidaMM);
    },
    aoNumero(ctx, campos) {
      const medida = campos['medida'] ?? campos['raio'] ?? campos['distancia'];
      if (medida === undefined) return;
      opcoes.medidaMM = medida;
      const alvo = ultimo ?? doPonto(ctx);
      if (alvo !== null) aplicar(ctx, alvo.pecaId, alvo.pontoId, medida);
    },
    aoSair() {
      ultimo = null;
    },
  };
}

function doPonto(ctx: Contexto): { pecaId: Id; pontoId: Id } | null {
  const [ref] = ctx.selecao.doTipo('ponto');
  return ref === undefined ? null : { pecaId: ref.pecaId, pontoId: ref.pontoId };
}

// ===========================================================================
// 12. Rotacionar
// ===========================================================================

/**
 * Arrasta em volta do centro da peca. `Shift` prende de 15 em 15 graus, e o angulo
 * pode ser digitado — girar "mais ou menos 30 graus" nao existe em modelagem.
 */
export function ferramentaRotacionar(): Ferramenta {
  let arrasto: { pecaId: Id; centro: Vetor2; inicial: number; angulo: number } | null = null;

  return {
    nome: 'rotacionar',
    atalho: 'R',

    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);
      if (alvo === null) return;
      ctx.selecao.clicar({ tipo: 'peca', pecaId: alvo.pecaId, ponto: em }, mod);
      const caixa = ctx.cena.derivados(alvo.pecaId).caixa;
      const centro: Vetor2 = {
        x: Math.round((caixa.minX + caixa.maxX) / 2),
        y: Math.round((caixa.minY + caixa.maxY) / 2),
      };
      arrasto = { pecaId: alvo.pecaId, centro, inicial: anguloEntre(centro, em), angulo: 0 };
    },

    aoArrastar(ctx, em, mod) {
      if (arrasto === null) return;
      const bruto = anguloEntre(arrasto.centro, em) - arrasto.inicial;
      arrasto.angulo = mod.shift
        ? Math.round(bruto / ANGULO_PRESO_GRAUS) * ANGULO_PRESO_GRAUS
        : Math.round(bruto * 100) / 100;
      const previa = ctx.tentar(() =>
        rotacionarPeca(ctx.base(arrasto!.pecaId), arrasto!.centro, arrasto!.angulo),
      );
      ctx.previsualizar(arrasto.pecaId, previa);
      ctx.mostrarCota({
        rotulo: `${arrasto.angulo.toFixed(1)}°`,
        valorUM: 0,
        de: arrasto.centro,
        ate: em,
      });
    },

    aoSoltar(ctx) {
      if (arrasto === null) return;
      const { pecaId, centro, angulo } = arrasto;
      arrasto = null;
      ctx.mostrarCota(null);
      if (angulo === 0) return;
      ctx.emitir({ tipo: 'RotacionarPeca', pecaId, payload: { centro, anguloGraus: angulo } });
    },

    aoNumero(ctx, campos) {
      const graus = campos['angulo'];
      const alvo = arrasto;
      arrasto = null;
      if (graus === undefined || graus === 0) return;
      const pecaId = alvo?.pecaId ?? ctx.selecao.doTipo('peca')[0]?.pecaId;
      if (pecaId === undefined) return;
      const caixa = ctx.cena.derivados(pecaId).caixa;
      ctx.emitir({
        tipo: 'RotacionarPeca',
        pecaId,
        payload: {
          centro: {
            x: Math.round((caixa.minX + caixa.maxX) / 2),
            y: Math.round((caixa.minY + caixa.maxY) / 2),
          },
          anguloGraus: graus,
        },
      });
    },

    aoSair(ctx) {
      arrasto = null;
      ctx.mostrarCota(null);
    },
  };
}

// ===========================================================================
// 13, 15 e 18. Eixos: espelhar, dividir e dobra — dois cliques cada
// ===========================================================================

/** Espelha a peca por um eixo de dois cliques. */
export function ferramentaEspelhar(): Ferramenta {
  const eixo = doisCliques();
  return {
    nome: 'espelhar',
    atalho: 'E',
    aoApontar(ctx, em) {
      const pronto = eixo.registrar(ctx.snap(em, { shift: false, ctrl: false, alt: false })?.ponto ?? em);
      if (pronto === null) return;
      const pecaId = ctx.selecao.doTipo('peca')[0]?.pecaId ?? ctx.cena.pecas[0];
      if (pecaId === undefined) return;
      if (ctx.tentar(() => espelharPeca(ctx.base(pecaId), pronto)) === null) return;
      ctx.emitir({ tipo: 'EspelharPeca', pecaId, payload: pronto });
    },
    aoSair() {
      eixo.limpar();
    },
  };
}

export interface OpcoesDeDividir {
  /** Margem das duas arestas de corte novas, em milimetro. */
  margemMM: number;
}

/** Corta a peca em duas por um eixo de dois cliques. A original desaparece. */
export function ferramentaDividir(opcoes: OpcoesDeDividir): Ferramenta {
  const eixo = doisCliques();
  let contador = 0;
  return {
    nome: 'dividir',
    atalho: 'D',
    aoApontar(ctx, em) {
      const pronto = eixo.registrar(em);
      if (pronto === null) return;
      const pecaId = ctx.selecao.doTipo('peca')[0]?.pecaId ?? ctx.cena.pecas[0];
      if (pecaId === undefined) return;
      ctx.emitir({
        tipo: 'DividirPeca',
        pecaId,
        payload: {
          ...pronto,
          margemNovaUM: mmParaUM(opcoes.margemMM),
          prefixoId: `dv-${ctx.cena.versaoDoLog}-${contador++}`,
        },
      });
    },
    aoSair() {
      eixo.limpar();
    },
  };
}

/** Marca o eixo de dobra com dois cliques. `Delete` tira o eixo selecionado. */
export function ferramentaEixoDobra(): Ferramenta {
  const eixo = doisCliques();
  let contador = 0;
  return {
    nome: 'eixoDobra',
    atalho: 'X',
    aoApontar(ctx, em) {
      const preso = ctx.snap(em, { shift: false, ctrl: false, alt: false })?.ponto ?? em;
      const pronto = eixo.registrar(preso);
      if (pronto === null) return;
      const pecaId = ctx.selecao.doTipo('peca')[0]?.pecaId ?? ctx.cena.pecas[0];
      if (pecaId === undefined) return;
      ctx.emitir({
        tipo: 'DefinirEixoDobra',
        pecaId,
        payload: {
          eixoId: `ed-${ctx.cena.versaoDoLog}-${contador++}`,
          ...pronto,
          direcao: 'dentro',
        },
      });
    },
    aoSair() {
      eixo.limpar();
    },
  };
}

// ===========================================================================
// 20. Par de costura
// ===========================================================================

export interface OpcoesDePar {
  /** Embebido: quanto a segunda aresta deve ser MAIOR que a primeira (D9). */
  embebidoMM: number;
}

/**
 * Clica duas arestas e declara que elas costuram juntas.
 *
 * As duas tem que ser de PECAS DIFERENTES (D3): cava-frente e cava-manga vivem em
 * pecas separadas, e parear uma aresta com ela mesma nao quer dizer nada.
 */
export function ferramentaParCostura(opcoes: OpcoesDePar): Ferramenta {
  let primeira: { pecaId: Id; arestaId: Id } | null = null;
  let contador = 0;

  return {
    nome: 'parCostura',
    atalho: 'P',
    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);
      if (alvo?.tipo !== 'aresta') return;
      ctx.selecao.clicar(alvo, mod);
      if (primeira === null) {
        primeira = { pecaId: alvo.pecaId, arestaId: alvo.arestaId };
        return;
      }
      const a = primeira;
      primeira = null;
      if (a.arestaId === alvo.arestaId) return;
      ctx.emitir({
        tipo: 'DefinirParCostura',
        pecaId: null,
        payload: {
          parId: `pc-${ctx.cena.versaoDoLog}-${contador++}`,
          arestaA: a.arestaId,
          arestaB: alvo.arestaId,
          embebidoUM: mmParaUM(opcoes.embebidoMM),
        },
      });
    },
    aoSair() {
      primeira = null;
    },
  };
}

// ===========================================================================
// 21. Fio do tecido / linha interna
// ===========================================================================

export type TipoDeLinha = 'fio' | 'pence' | 'furo' | 'referencia';

export interface OpcoesDeLinha {
  tipo: TipoDeLinha;
}

/**
 * Dois cliques e nasce a linha. Os pontos sao `Ponto` de verdade (D10) — e por isso
 * que o fio gradua pela mesma regra do contorno, em vez de ficar parado enquanto a
 * peca cresce.
 */
export function ferramentaLinhaInterna(opcoes: OpcoesDeLinha): Ferramenta {
  const eixo = doisCliques();
  let contador = 0;

  return {
    nome: 'linhaInterna',
    atalho: 'T',
    aoApontar(ctx, em) {
      const preso = ctx.snap(em, { shift: false, ctrl: false, alt: false })?.ponto ?? em;
      const pronto = eixo.registrar(preso);
      if (pronto === null) return;
      const pecaId = ctx.selecao.doTipo('peca')[0]?.pecaId ?? ctx.cena.pecas[0];
      if (pecaId === undefined) return;
      const prefixo = `li-${ctx.cena.versaoDoLog}-${contador++}`;
      ctx.emitir(
        {
          tipo: 'CriarPonto',
          pecaId,
          payload: { pontoId: `${prefixo}-a`, x: pronto.p1.x, y: pronto.p1.y, tipo: 'interno' },
        },
        {
          tipo: 'CriarPonto',
          pecaId,
          payload: { pontoId: `${prefixo}-b`, x: pronto.p2.x, y: pronto.p2.y, tipo: 'interno' },
        },
        {
          tipo: 'AdicionarLinhaInterna',
          pecaId,
          payload: {
            linhaId: prefixo,
            tipo: opcoes.tipo,
            pontoIds: [`${prefixo}-a`, `${prefixo}-b`],
          },
        },
      );
    },
    aoSair() {
      eixo.limpar();
    },
  };
}

// ===========================================================================
// 22. Grade point
// ===========================================================================

/**
 * Clique num ponto marca ou desmarca o grade point dele.
 *
 * Desmarcar NAO apaga as regras em cascata — o validador acusa `REGRA_SEM_GRADE_POINT`.
 * Apagar em silencio esconderia do modelista que ele acabou de perder a graduacao
 * daquele ponto.
 */
export function ferramentaGradePoint(): Ferramenta {
  let contador = 0;
  return {
    nome: 'gradePoint',
    atalho: 'K',
    aoApontar(ctx, em, mod) {
      const alvo = ctx.alvo(em);
      if (alvo?.tipo !== 'ponto') return;
      ctx.selecao.clicar(alvo, mod);
      const peca = ctx.base(alvo.pecaId);
      const existente = Object.values(peca.gradePoints).find((gp) => gp.pontoId === alvo.pontoId);
      if (existente !== undefined) {
        ctx.emitir({
          tipo: 'DesmarcarGradePoint',
          pecaId: alvo.pecaId,
          payload: { gradePointId: existente.id },
        });
        return;
      }
      ctx.emitir({
        tipo: 'MarcarGradePoint',
        pecaId: alvo.pecaId,
        payload: {
          gradePointId: `gp-${ctx.cena.versaoDoLog}-${contador++}`,
          pontoId: alvo.pontoId,
        },
      });
    },
  };
}

// ===========================================================================

/** Todas as ferramentas de ponteiro do Bloco 7, com as opcoes que a barra ajusta. */
export function ferramentasAvancadas(opcoes: {
  segmentosAbertos: Set<Id>;
  canto: OpcoesDeCanto;
  dividir: OpcoesDeDividir;
  par: OpcoesDePar;
  linha: OpcoesDeLinha;
}): Ferramenta[] {
  return [
    ferramentaControle(opcoes.segmentosAbertos),
    ferramentaConverter(),
    ferramentaFillet(opcoes.canto),
    ferramentaChanfro(opcoes.canto),
    ferramentaRotacionar(),
    ferramentaEspelhar(),
    ferramentaDividir(opcoes.dividir),
    ferramentaEixoDobra(),
    ferramentaParCostura(opcoes.par),
    ferramentaLinhaInterna(opcoes.linha),
    ferramentaGradePoint(),
  ];
}

/** Profundidade padrao do pique, reexportada para a barra nao adivinhar. */
export { ALTURA_PADRAO_DO_PIQUE_UM };
