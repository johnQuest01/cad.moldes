/**
 * Hit-testing: o que o cursor esta apontando.
 *
 * O alvo e procurado **em UM, contra a geometria do motor** — nunca contra o
 * objeto desenhado. Se fosse contra o desenho, a area clicavel mudaria com a
 * espessura do traco, que muda com o zoom (E6); e o comportamento deixaria de ser
 * testavel sem navegador, que e a violacao mais grave da Fase 2 (E3).
 *
 * ## A ordem de prioridade e do alvo menor para o maior
 * Um pique tem 1,59 mm de boca e um ponto e adimensional: se a peca inteira
 * disputasse em pe de igualdade, nunca se pegaria nenhum dos dois. Por isso a busca
 * e por ordem de tipo, e so dentro do mesmo tipo vence o mais proximo.
 */
import { contemPonto, localizarNoContorno, type Id, type Vetor2 } from '@cad/motor';

import type { Camada } from './camadas.js';
import type { Camadas } from './camadas.js';
import type { Cena } from './cena.js';

export type Alvo =
  | { readonly tipo: 'controle'; readonly pecaId: Id; readonly segmentoId: Id; readonly indice: 0 | 1; readonly ponto: Vetor2 }
  | { readonly tipo: 'ponto'; readonly pecaId: Id; readonly pontoId: Id; readonly ponto: Vetor2 }
  | { readonly tipo: 'pique'; readonly pecaId: Id; readonly piqueId: Id; readonly ponto: Vetor2 }
  | { readonly tipo: 'interna'; readonly pecaId: Id; readonly linhaId: Id; readonly ponto: Vetor2 }
  | { readonly tipo: 'aresta'; readonly pecaId: Id; readonly arestaId: Id; readonly segmentoId: Id; readonly s: number; readonly sNoSegmento: number; readonly ponto: Vetor2 }
  | { readonly tipo: 'peca'; readonly pecaId: Id; readonly ponto: Vetor2 };

export type TipoDeAlvo = Alvo['tipo'];

/** A ordem de prioridade. Vem primeiro o alvo menor. */
export const PRIORIDADE: readonly TipoDeAlvo[] = [
  'controle',
  'ponto',
  'pique',
  'interna',
  'aresta',
  'peca',
];

/** Em que camada cada tipo de alvo mora — e o que faz travar a camada funcionar. */
export const CAMADA_DO_ALVO: Readonly<Record<TipoDeAlvo, Camada>> = Object.freeze({
  controle: 'costura',
  ponto: 'costura',
  pique: 'pique',
  interna: 'interna',
  aresta: 'costura',
  peca: 'costura',
});

/** Raio de captura padrao, em PIXELS. Vira UM pela escala da camera (E11). */
export const RAIO_DE_CAPTURA_PX = 10;

export interface OpcoesDeBusca {
  /**
   * Segmentos cujas alcas de controle estao a mostra. So o segmento selecionado
   * mostra alca — senao uma peca com cava e decote vira um campo de bolinhas.
   */
  readonly comControleVisivel?: ReadonlySet<Id>;
  /** Tipos a ignorar nesta busca (uma ferramenta que so mira aresta, por exemplo). */
  readonly ignorar?: ReadonlySet<TipoDeAlvo>;
}

/** O que o cursor esta apontando, ou `null` se nada dentro do raio. */
export function acharAlvo(
  cena: Cena,
  camadas: Camadas,
  alvo: Vetor2,
  raioUM: number,
  opcoes: OpcoesDeBusca = {},
): Alvo | null {
  const permitido = (tipo: TipoDeAlvo): boolean =>
    camadas.selecionavel(CAMADA_DO_ALVO[tipo]) && opcoes.ignorar?.has(tipo) !== true;

  for (const tipo of PRIORIDADE) {
    if (!permitido(tipo)) continue;
    const achado = buscar(tipo, cena, alvo, raioUM, opcoes);
    if (achado !== null) return achado;
  }
  return null;
}

function buscar(
  tipo: TipoDeAlvo,
  cena: Cena,
  alvo: Vetor2,
  raioUM: number,
  opcoes: OpcoesDeBusca,
): Alvo | null {
  let melhor: { alvo: Alvo; d: number } | null = null;
  const considerar = (candidato: Alvo, d: number): void => {
    if (d > raioUM) return;
    if (melhor === null || d < melhor.d) melhor = { alvo: candidato, d };
  };

  // A ordem de desenho e de baixo para cima; a busca vai de cima para baixo, para
  // a peca desenhada por ultimo ganhar o clique.
  for (const pecaId of [...cena.pecas].reverse()) {
    const { peca, contorno } = cena.derivados(pecaId);

    switch (tipo) {
      case 'controle': {
        const visiveis = opcoes.comControleVisivel;
        if (visiveis === undefined) break;
        for (const segmento of Object.values(peca.segmentos)) {
          if (!visiveis.has(segmento.id) || segmento.controles === undefined) continue;
          segmento.controles.forEach((controle, i) => {
            considerar(
              { tipo: 'controle', pecaId, segmentoId: segmento.id, indice: i as 0 | 1, ponto: controle },
              distancia(controle, alvo),
            );
          });
        }
        break;
      }

      case 'ponto': {
        for (const ponto of Object.values(peca.pontos)) {
          if (ponto.tipo !== 'contorno') continue;
          considerar({ tipo: 'ponto', pecaId, pontoId: ponto.id, ponto }, distancia(ponto, alvo));
        }
        break;
      }

      case 'pique': {
        for (const [piqueId, projetado] of cena.derivados(pecaId).piques) {
          considerar(
            { tipo: 'pique', pecaId, piqueId, ponto: projetado.pontoDaCostura },
            distancia(projetado.pontoDaCostura, alvo),
          );
        }
        break;
      }

      case 'interna': {
        for (const linha of Object.values(peca.linhasInternas)) {
          const pontos = linha.pontos.map((id) => peca.pontos[id]!);
          for (let i = 1; i < pontos.length; i++) {
            const pe = peDaPerpendicular(pontos[i - 1]!, pontos[i]!, alvo);
            considerar(
              { tipo: 'interna', pecaId, linhaId: linha.id, ponto: pe },
              distancia(pe, alvo),
            );
          }
        }
        break;
      }

      case 'aresta': {
        const lugar = localizarNoContorno(peca, alvo);
        considerar(
          {
            tipo: 'aresta',
            pecaId,
            arestaId: lugar.arestaId,
            segmentoId: lugar.segmentoId,
            s: lugar.s,
            sNoSegmento: lugar.sNoSegmento,
            ponto: lugar.ponto,
          },
          lugar.distanciaUM,
        );
        break;
      }

      case 'peca': {
        // A peca nao tem "distancia": ou o cursor esta dentro, ou nao esta. A
        // primeira de cima para baixo que contiver o ponto ganha.
        if (contemPonto(contorno, alvo)) {
          return { tipo: 'peca', pecaId, ponto: alvo };
        }
        break;
      }
    }
  }

  return melhor === null ? null : (melhor as { alvo: Alvo; d: number }).alvo;
}

function distancia(a: Vetor2, b: Vetor2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Pe da perpendicular de `p` no trecho [a, b], preso aos extremos. */
export function peDaPerpendicular(a: Vetor2, b: Vetor2, p: Vetor2): Vetor2 {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const quadrado = ex * ex + ey * ey;
  if (quadrado === 0) return { x: a.x, y: a.y };
  const bruto = ((p.x - a.x) * ex + (p.y - a.y) * ey) / quadrado;
  const u = bruto < 0 ? 0 : bruto > 1 ? 1 : bruto;
  return { x: Math.round(a.x + ex * u), y: Math.round(a.y + ey * u) };
}
