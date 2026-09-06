/**
 * Snap: onde o cursor "agarra" (E11).
 *
 * Decisao de interface, nao de geometria — por isso mora aqui e nao no motor. O
 * raio de cada tipo e medido em **pixels**, e portanto e constante na tela: o que
 * agarra a 12 px de distancia continua agarrando a 12 px depois do zoom. Medir em
 * UM faria o snap ficar impossivel de usar no zoom out e grudento no zoom in.
 *
 * ## A ordem e de PRIORIDADE, nao de proximidade
 * Um vertice a 8 px ganha de um ponto de grade a 2 px. Quem aproximou o cursor de
 * um canto quer o canto — e a grade e so um auxiliar. Dentro do mesmo tipo, vence o
 * mais proximo.
 *
 * ## `meio` e por comprimento de ARCO
 * O bonus da D1 vale aqui igual: `t = 0.5` nao e o meio da curva. "Pique no meio da
 * cava" e um gesto real, e o meio tem que ser o meio de verdade.
 *
 * `Alt` segurado desliga tudo — e a valvula de escape para quando o snap atrapalha.
 */
import { MM, cruzarSegmentos, pontoNaTabela, type Id, type Vetor2 } from '@cad/motor';

import { peDaPerpendicular } from './alvo.js';
import type { Camadas } from './camadas.js';
import type { Cena } from './cena.js';

export type TipoDeSnap =
  | 'vertice'
  | 'intersecao'
  | 'meio'
  | 'eixo'
  | 'ortogonal'
  | 'noContorno'
  | 'grade';

export interface Snap {
  readonly tipo: TipoDeSnap;
  readonly ponto: Vetor2;
  readonly pecaId?: Id;
  readonly arestaId?: Id;
  readonly pontoId?: Id;
  readonly eixoId?: Id;
  readonly s?: number;
  /** Para o snap ortogonal: 0, 45, 90, 135... */
  readonly anguloGraus?: number;
}

/** Raio de captura de cada tipo, em PIXELS. A ordem do array e a de prioridade. */
export const RAIOS_PX: readonly (readonly [TipoDeSnap, number])[] = [
  ['vertice', 12],
  ['intersecao', 10],
  ['meio', 10],
  ['eixo', 8],
  ['ortogonal', 8],
  ['noContorno', 8],
  ['grade', 6],
];

/** Passo da grade de fundo: 5 cm, como o papel de molde. */
export const PASSO_DA_GRADE_UM = 50 * MM;

/** Angulos que o snap ortogonal prende. */
export const ANGULOS_ORTOGONAIS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

export interface Modificadores {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export const SEM_MODIFICADOR: Modificadores = { shift: false, ctrl: false, alt: false };

export interface OpcoesDeSnap {
  /** Tipos ligados. O que nao estiver aqui nao e procurado. */
  readonly ligados?: ReadonlySet<TipoDeSnap>;
  /** Origem do gesto — sem ela nao existe snap ortogonal. */
  readonly origem?: Vetor2;
}

const TODOS: ReadonlySet<TipoDeSnap> = new Set(RAIOS_PX.map(([tipo]) => tipo));

/**
 * O snap ativo, ou `null`.
 *
 * `umPorPixel` vem da camera: e o unico lugar onde o zoom entra nesta conta.
 */
export function acharSnap(
  cena: Cena,
  camadas: Camadas,
  alvo: Vetor2,
  umPorPixel: number,
  mod: Modificadores = SEM_MODIFICADOR,
  opcoes: OpcoesDeSnap = {},
): Snap | null {
  if (mod.alt) return null;
  const ligados = opcoes.ligados ?? TODOS;

  for (const [tipo, raioPx] of RAIOS_PX) {
    if (!ligados.has(tipo)) continue;
    const raio = raioPx * umPorPixel;
    const achado = procurar(tipo, cena, camadas, alvo, raio, opcoes);
    if (achado !== null) return achado;
  }
  return null;
}

function procurar(
  tipo: TipoDeSnap,
  cena: Cena,
  camadas: Camadas,
  alvo: Vetor2,
  raio: number,
  opcoes: OpcoesDeSnap,
): Snap | null {
  let melhor: { snap: Snap; d: number } | null = null;
  const considerar = (snap: Snap): void => {
    const d = Math.hypot(snap.ponto.x - alvo.x, snap.ponto.y - alvo.y);
    if (d > raio) return;
    if (melhor === null || d < melhor.d) melhor = { snap, d };
  };

  if (tipo === 'grade') {
    const arredondar = (v: number) => Math.round(v / PASSO_DA_GRADE_UM) * PASSO_DA_GRADE_UM;
    considerar({ tipo: 'grade', ponto: { x: arredondar(alvo.x), y: arredondar(alvo.y) } });
    return colher(melhor);
  }

  if (tipo === 'ortogonal') {
    const origem = opcoes.origem;
    if (origem === undefined) return null;
    const dx = alvo.x - origem.x;
    const dy = alvo.y - origem.y;
    const comprimento = Math.hypot(dx, dy);
    if (comprimento === 0) return null;
    for (const graus of ANGULOS_ORTOGONAIS) {
      const rad = (graus * Math.PI) / 180;
      // Projeta o cursor no raio daquele angulo: e o ponto ortogonal mais proximo.
      const projecao = dx * Math.cos(rad) + dy * Math.sin(rad);
      if (projecao <= 0) continue;
      considerar({
        tipo: 'ortogonal',
        anguloGraus: graus,
        ponto: {
          x: Math.round(origem.x + Math.cos(rad) * projecao),
          y: Math.round(origem.y + Math.sin(rad) * projecao),
        },
      });
    }
    return colher(melhor);
  }

  for (const pecaId of cena.pecas) {
    const derivados = cena.derivados(pecaId);
    const { peca, contorno, tabelas } = derivados;

    switch (tipo) {
      case 'vertice': {
        if (!camadas.selecionavel('costura')) break;
        for (const ponto of Object.values(peca.pontos)) {
          // Copia so a coordenada: devolver o `Ponto` inteiro vazaria id e tipo
          // para dentro de um campo que promete ser um par (x, y).
          considerar({
            tipo: 'vertice',
            ponto: { x: ponto.x, y: ponto.y },
            pecaId,
            pontoId: ponto.id,
          });
        }
        break;
      }

      case 'meio': {
        if (!camadas.selecionavel('costura')) break;
        for (const [arestaId, tabela] of tabelas) {
          considerar({
            tipo: 'meio',
            ponto: pontoNaTabela(tabela, 0.5, arestaId),
            pecaId,
            arestaId,
            s: 0.5,
          });
        }
        break;
      }

      case 'eixo': {
        for (const eixo of Object.values(peca.eixosDobra)) {
          const pe = peDaPerpendicular(eixo.p1, eixo.p2, alvo);
          considerar({ tipo: 'eixo', ponto: pe, pecaId, eixoId: eixo.id });
        }
        break;
      }

      case 'intersecao': {
        if (!camadas.selecionavel('costura')) break;
        // So as cordas que passam perto do cursor entram no cruzamento de todos
        // contra todos: sem esse filtro seria O(n^2) sobre a peca inteira, e uma
        // peca real tem centenas de segmentos.
        for (const cruzamento of intersecoesPerto(contorno, alvo, raio)) {
          considerar({ tipo: 'intersecao', ponto: cruzamento, pecaId });
        }
        break;
      }

      case 'noContorno': {
        if (!camadas.selecionavel('costura')) break;
        for (let i = 0; i < contorno.length; i++) {
          const a = contorno[i]!;
          const b = contorno[(i + 1) % contorno.length]!;
          considerar({ tipo: 'noContorno', ponto: peDaPerpendicular(a, b, alvo), pecaId });
        }
        break;
      }
    }
  }

  return colher(melhor);
}

function colher(melhor: { snap: Snap; d: number } | null): Snap | null {
  return melhor === null ? null : melhor.snap;
}

/** Cruzamentos entre cordas NAO vizinhas do anel, dentro da janela do cursor. */
function intersecoesPerto(anel: readonly Vetor2[], alvo: Vetor2, raio: number): Vetor2[] {
  const janela = raio * 2;
  const perto: (readonly [Vetor2, Vetor2, number])[] = [];
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    if (Math.min(a.x, b.x) - janela > alvo.x || Math.max(a.x, b.x) + janela < alvo.x) continue;
    if (Math.min(a.y, b.y) - janela > alvo.y || Math.max(a.y, b.y) + janela < alvo.y) continue;
    perto.push([a, b, i]);
  }

  const achados: Vetor2[] = [];
  for (let i = 0; i < perto.length; i++) {
    for (let j = i + 1; j < perto.length; j++) {
      const [a1, b1, indice1] = perto[i]!;
      const [a2, b2, indice2] = perto[j]!;
      // Cordas vizinhas se encontram no vertice comum: isso e `vertice`, nao
      // intersecao, e ja tem prioridade maior.
      if (Math.abs(indice1 - indice2) <= 1) continue;
      const cruzamento = cruzarSegmentos(a1, b1, a2, b2);
      if (cruzamento !== null) achados.push(cruzamento);
    }
  }
  return achados;
}
