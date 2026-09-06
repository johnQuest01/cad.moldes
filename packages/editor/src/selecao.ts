/**
 * Selecao.
 *
 * ## O que fica guardado e REFERENCIA, nao coordenada
 * Um `Alvo` carrega o ponto em que o cursor bateu — util no instante do clique,
 * mentira um segundo depois: basta o modelista arrastar o ponto e a coordenada
 * guardada aponta para onde ele estava. A selecao guarda `Referencia`: so ids.
 * Isso a faz sobreviver a edicao, a graduacao e a troca de tamanho na tela.
 *
 * ## Marquee: janela x cruzamento
 * A convencao de CAD, que e o oposto da de programa de desenho:
 *
 *  - arrasto da ESQUERDA para a DIREITA = **janela**: pega so o que esta
 *    INTEIRAMENTE dentro;
 *  - arrasto da DIREITA para a ESQUERDA = **cruzamento**: pega tudo o que a caixa
 *    TOCA.
 *
 * Quem vem do Audaces, do AutoCAD ou do Gerber tem isso no dedo. Inverter confunde
 * para sempre, e o custo de acertar e uma comparacao de `x`.
 *
 * ## Referencia orfa
 * Excluir um ponto que estava selecionado deixa a selecao apontando para o que nao
 * existe mais. `podar` tira essas — e devolve quantas tirou, porque sumir com item
 * selecionado em silencio e o tipo de coisa que o modelista percebe tarde.
 */
import type { Id, Vetor2 } from '@cad/motor';
import { seCruzam } from '@cad/motor';

import type { Alvo, TipoDeAlvo } from './alvo.js';
import type { Caixa } from './camera.js';
import type { Camadas } from './camadas.js';
import { CAMADA_DO_ALVO } from './alvo.js';
import type { Cena } from './cena.js';
import type { Modificadores } from './snap.js';

export type Referencia =
  | { readonly tipo: 'ponto'; readonly pecaId: Id; readonly pontoId: Id }
  | { readonly tipo: 'controle'; readonly pecaId: Id; readonly segmentoId: Id; readonly indice: 0 | 1 }
  | { readonly tipo: 'pique'; readonly pecaId: Id; readonly piqueId: Id }
  | { readonly tipo: 'interna'; readonly pecaId: Id; readonly linhaId: Id }
  | { readonly tipo: 'aresta'; readonly pecaId: Id; readonly arestaId: Id }
  | { readonly tipo: 'peca'; readonly pecaId: Id };

/** Tira a coordenada do alvo e guarda so a identidade. */
export function referenciaDe(alvo: Alvo): Referencia {
  switch (alvo.tipo) {
    case 'ponto':
      return { tipo: 'ponto', pecaId: alvo.pecaId, pontoId: alvo.pontoId };
    case 'controle':
      return {
        tipo: 'controle',
        pecaId: alvo.pecaId,
        segmentoId: alvo.segmentoId,
        indice: alvo.indice,
      };
    case 'pique':
      return { tipo: 'pique', pecaId: alvo.pecaId, piqueId: alvo.piqueId };
    case 'interna':
      return { tipo: 'interna', pecaId: alvo.pecaId, linhaId: alvo.linhaId };
    case 'aresta':
      return { tipo: 'aresta', pecaId: alvo.pecaId, arestaId: alvo.arestaId };
    case 'peca':
      return { tipo: 'peca', pecaId: alvo.pecaId };
  }
}

/** Chave estavel de uma referencia. E o que faz alternar e desduplicar funcionarem. */
export function chaveDa(ref: Referencia): string {
  switch (ref.tipo) {
    case 'ponto':
      return `ponto|${ref.pecaId}|${ref.pontoId}`;
    case 'controle':
      return `controle|${ref.pecaId}|${ref.segmentoId}|${ref.indice}`;
    case 'pique':
      return `pique|${ref.pecaId}|${ref.piqueId}`;
    case 'interna':
      return `interna|${ref.pecaId}|${ref.linhaId}`;
    case 'aresta':
      return `aresta|${ref.pecaId}|${ref.arestaId}`;
    case 'peca':
      return `peca|${ref.pecaId}`;
  }
}

export type ModoDeMarquee = 'janela' | 'cruzamento';

/** O retangulo do marquee, normalizado, mais o modo que o sentido do arrasto pediu. */
export function caixaDoMarquee(de: Vetor2, ate: Vetor2): { caixa: Caixa; modo: ModoDeMarquee } {
  return {
    caixa: {
      minX: Math.min(de.x, ate.x),
      maxX: Math.max(de.x, ate.x),
      minY: Math.min(de.y, ate.y),
      maxY: Math.max(de.y, ate.y),
    },
    modo: ate.x >= de.x ? 'janela' : 'cruzamento',
  };
}

/** O que o marquee recolhe quando ninguem diz o contrario. Peca e opt-in. */
export const TIPOS_DO_MARQUEE: readonly TipoDeAlvo[] = ['ponto', 'pique', 'interna', 'aresta'];

export class Selecao {
  #itens: Referencia[] = [];

  get itens(): readonly Referencia[] {
    return this.#itens;
  }
  get vazia(): boolean {
    return this.#itens.length === 0;
  }
  get tamanho(): number {
    return this.#itens.length;
  }

  tem(ref: Referencia): boolean {
    const chave = chaveDa(ref);
    return this.#itens.some((item) => chaveDa(item) === chave);
  }

  /** So as referencias de um tipo. E o que a ferramenta usa para saber se pode agir. */
  doTipo<T extends Referencia['tipo']>(tipo: T): Extract<Referencia, { tipo: T }>[] {
    return this.#itens.filter((item): item is Extract<Referencia, { tipo: T }> => item.tipo === tipo);
  }

  /** As pecas envolvidas, sem repetir. */
  get pecas(): readonly Id[] {
    return [...new Set(this.#itens.map((item) => item.pecaId))];
  }

  limpar(): void {
    this.#itens = [];
  }

  /**
   * Clique: sem modificador substitui; Shift alterna; Ctrl acrescenta.
   * Clique no vazio sem modificador limpa — com modificador, nao mexe.
   */
  clicar(alvo: Alvo | null, mod: Modificadores): void {
    if (alvo === null) {
      if (!mod.shift && !mod.ctrl) this.limpar();
      return;
    }
    const ref = referenciaDe(alvo);
    if (mod.shift) {
      this.#alternar(ref);
      return;
    }
    if (mod.ctrl) {
      this.#acrescentar([ref]);
      return;
    }
    this.#itens = [ref];
  }

  /**
   * Marquee. Sem modificador substitui a selecao; com Shift ou Ctrl, acrescenta.
   * `tipos` diz o que recolher — a ferramenta decide se quer pontos ou pecas.
   */
  marquee(
    cena: Cena,
    camadas: Camadas,
    de: Vetor2,
    ate: Vetor2,
    mod: Modificadores,
    tipos: readonly TipoDeAlvo[] = TIPOS_DO_MARQUEE,
  ): ModoDeMarquee {
    const { caixa, modo } = caixaDoMarquee(de, ate);
    const achados = recolher(cena, camadas, caixa, modo, tipos);
    if (mod.shift || mod.ctrl) this.#acrescentar(achados);
    else this.#itens = achados;
    return modo;
  }

  /** Todas as pecas das camadas visiveis. E o `Ctrl+A`. */
  selecionarTudo(cena: Cena, camadas: Camadas): void {
    if (!camadas.selecionavel('costura')) {
      this.limpar();
      return;
    }
    this.#itens = cena.pecas.map((pecaId) => ({ tipo: 'peca', pecaId }));
  }

  /**
   * Tira as referencias que nao existem mais no modelo. Devolve quantas tirou.
   * Chame depois de toda edicao que possa remover entidade.
   */
  podar(cena: Cena): number {
    const antes = this.#itens.length;
    this.#itens = this.#itens.filter((ref) => existe(cena, ref));
    return antes - this.#itens.length;
  }

  #alternar(ref: Referencia): void {
    const chave = chaveDa(ref);
    const jaEstava = this.#itens.some((item) => chaveDa(item) === chave);
    this.#itens = jaEstava
      ? this.#itens.filter((item) => chaveDa(item) !== chave)
      : [...this.#itens, ref];
  }

  #acrescentar(refs: readonly Referencia[]): void {
    const chaves = new Set(this.#itens.map(chaveDa));
    for (const ref of refs) {
      const chave = chaveDa(ref);
      if (chaves.has(chave)) continue;
      chaves.add(chave);
      this.#itens.push(ref);
    }
  }
}

function existe(cena: Cena, ref: Referencia): boolean {
  const peca = cena.modelo.pecas[ref.pecaId];
  if (peca === undefined) return false;
  switch (ref.tipo) {
    case 'peca':
      return true;
    case 'ponto':
      return peca.pontos[ref.pontoId] !== undefined;
    case 'controle': {
      const segmento = peca.segmentos[ref.segmentoId];
      return segmento?.controles !== undefined;
    }
    case 'pique':
      return peca.piques[ref.piqueId] !== undefined;
    case 'interna':
      return peca.linhasInternas[ref.linhaId] !== undefined;
    case 'aresta':
      return peca.arestas[ref.arestaId] !== undefined;
  }
}

// --------------------------------------------------------------- o marquee

function recolher(
  cena: Cena,
  camadas: Camadas,
  caixa: Caixa,
  modo: ModoDeMarquee,
  tipos: readonly TipoDeAlvo[],
): Referencia[] {
  const achados: Referencia[] = [];
  const quer = (tipo: TipoDeAlvo): boolean =>
    tipos.includes(tipo) && camadas.selecionavel(CAMADA_DO_ALVO[tipo]);

  for (const pecaId of cena.pecas) {
    const derivados = cena.derivados(pecaId);
    const { peca, contorno, tabelas } = derivados;

    if (quer('ponto')) {
      for (const ponto of Object.values(peca.pontos)) {
        if (ponto.tipo !== 'contorno') continue;
        if (dentro(caixa, ponto)) achados.push({ tipo: 'ponto', pecaId, pontoId: ponto.id });
      }
    }

    if (quer('pique')) {
      for (const [piqueId, projetado] of derivados.piques) {
        if (dentro(caixa, projetado.pontoDaCostura)) {
          achados.push({ tipo: 'pique', pecaId, piqueId });
        }
      }
    }

    if (quer('interna')) {
      for (const linha of Object.values(peca.linhasInternas)) {
        const pontos = linha.pontos.map((id) => peca.pontos[id]!);
        if (pega(caixa, modo, pontos, false)) {
          achados.push({ tipo: 'interna', pecaId, linhaId: linha.id });
        }
      }
    }

    if (quer('aresta')) {
      for (const [arestaId, tabela] of tabelas) {
        if (pega(caixa, modo, tabela.pontos, false)) {
          achados.push({ tipo: 'aresta', pecaId, arestaId });
        }
      }
    }

    if (quer('peca') && pega(caixa, modo, contorno, true)) {
      achados.push({ tipo: 'peca', pecaId });
    }
  }
  return achados;
}

const dentro = (caixa: Caixa, p: Vetor2): boolean =>
  p.x >= caixa.minX && p.x <= caixa.maxX && p.y >= caixa.minY && p.y <= caixa.maxY;

/**
 * A poligonal e pega pela caixa?
 *
 * Janela: TODOS os pontos dentro. Cruzamento: qualquer ponto dentro, ou qualquer
 * corda cruzando uma das quatro bordas da caixa — sem a segunda metade, uma caixa
 * pequena no meio de uma aresta longa nao pegaria nada, que e justamente o gesto de
 * quem quer pegar aquela aresta.
 */
function pega(
  caixa: Caixa,
  modo: ModoDeMarquee,
  pontos: readonly Vetor2[],
  fechada: boolean,
): boolean {
  if (pontos.length === 0) return false;
  if (modo === 'janela') return pontos.every((p) => dentro(caixa, p));

  if (pontos.some((p) => dentro(caixa, p))) return true;

  const cantos: readonly Vetor2[] = [
    { x: caixa.minX, y: caixa.minY },
    { x: caixa.maxX, y: caixa.minY },
    { x: caixa.maxX, y: caixa.maxY },
    { x: caixa.minX, y: caixa.maxY },
  ];
  const ultimo = fechada ? pontos.length : pontos.length - 1;
  for (let i = 0; i < ultimo; i++) {
    const a = pontos[i]!;
    const b = pontos[(i + 1) % pontos.length]!;
    for (let j = 0; j < 4; j++) {
      if (seCruzam(a, b, cantos[j]!, cantos[(j + 1) % 4]!)) return true;
    }
  }
  return false;
}
