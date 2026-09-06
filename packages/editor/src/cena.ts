/**
 * A cena: o modelo da sessao mais tudo o que se deriva dele, cacheado (E8).
 *
 * Tesselar, offsetar e graduar sao caros e deterministicos. Sem cache, arrastar um
 * ponto refaria a peca inteira sessenta vezes por segundo — e uma peca de verdade
 * tem centenas de segmentos. A chave e `(pecaId, versao da sessao, tamanho
 * exibido)`, e a invalidacao e por evento, nunca por tempo.
 *
 * ## O tamanho e VISUALIZACAO (E9)
 * `tamanho` diz o que se ve; a edicao vai sempre para o tamanho base. Como a regra
 * de graduacao e aditiva, o ponto arrastado segue o cursor mesmo com outro tamanho
 * na tela — a demo da Fase 1 ja provou isso.
 *
 * ## Erro derivado nao e escondido
 * `offsetMargem` estoura em peca com margem faltando. Aqui isso vira o campo `erro`
 * dos derivados, e nao um `catch` que devolve lista vazia: o desenho continua de pe
 * (o editor nao pode fechar, Parte 0) e o problema aparece na conferencia.
 */
import {
  ErroMotor,
  anelDoContorno,
  aplicarGraduacao,
  offsetMargem,
  projetarPiques,
  tabelaArcoDaAresta,
  validarInconsistencias,
  type Id,
  type Modelo,
  type Peca,
  type PiqueProjetado,
  type Problema,
  type TabelaArco,
  type Vetor2,
} from '@cad/motor';

import { caixaDe, type Caixa } from './camera.js';
import type { Sessao } from './sessao.js';

/** Tudo o que se deriva de uma peca para desenhar, medir e mirar o cursor. */
export interface Derivados {
  /** A peca ja graduada para o tamanho exibido. */
  readonly peca: Peca;
  readonly contorno: readonly Vetor2[];
  /** Vazio quando `erro` nao e nulo — sem margem nao ha linha de corte. */
  readonly corte: readonly Vetor2[];
  readonly tabelas: ReadonlyMap<Id, TabelaArco>;
  readonly piques: readonly (readonly [Id, PiqueProjetado])[];
  readonly problemas: readonly Problema[];
  readonly caixa: Caixa;
  readonly erro: ErroMotor | null;
}

export class Cena {
  readonly #sessao: Sessao;
  #tamanho: string | null;
  readonly #cache = new Map<string, Derivados>();

  constructor(sessao: Sessao, tamanho?: string) {
    this.#sessao = sessao;
    this.#tamanho = tamanho ?? null;
  }

  get modelo(): Modelo {
    return this.#sessao.modelo;
  }

  /** Versao do log. Serve de semente para ids deterministicos das ferramentas. */
  get versaoDoLog(): number {
    return this.#sessao.versao;
  }

  /** O tamanho exibido. Sem escolha explicita, e o tamanho base do modelo. */
  get tamanho(): string {
    return this.#tamanho ?? this.modelo.tamanhoBase;
  }

  set tamanho(valor: string) {
    this.#tamanho = valor;
  }

  /** As pecas na ordem de desenho: a ordem em que entraram no log. */
  get pecas(): readonly Id[] {
    return Object.keys(this.modelo.pecas);
  }

  derivados(pecaId: Id): Derivados {
    const chave = `${pecaId}|${this.#sessao.versao}|${this.tamanho}`;
    const guardado = this.#cache.get(chave);
    if (guardado !== undefined) return guardado;

    const calculado = this.#calcular(pecaId);
    // O cache guarda so a versao corrente: manter historico seria vazamento lento
    // num editor que fica aberto o dia inteiro.
    for (const antiga of this.#cache.keys()) {
      if (!antiga.endsWith(`|${this.#sessao.versao}|${this.tamanho}`)) this.#cache.delete(antiga);
    }
    this.#cache.set(chave, calculado);
    return calculado;
  }

  /** Problemas de todas as pecas. E o que o painel de conferencia mostra (E14). */
  get problemas(): readonly Problema[] {
    return this.pecas.flatMap((id) => this.derivados(id).problemas);
  }

  /** A caixa de tudo o que esta no modelo — o "ver tudo" da camera. */
  caixa(): Caixa {
    const caixas = this.pecas.map((id) => this.derivados(id).caixa);
    if (caixas.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
      minX: Math.min(...caixas.map((c) => c.minX)),
      minY: Math.min(...caixas.map((c) => c.minY)),
      maxX: Math.max(...caixas.map((c) => c.maxX)),
      maxY: Math.max(...caixas.map((c) => c.maxY)),
    };
  }

  /** Quantas vezes os derivados foram calculados de verdade. E o que o teste mede. */
  get calculos(): number {
    return this.#calculos;
  }
  #calculos = 0;

  #calcular(pecaId: Id): Derivados {
    this.#calculos++;
    const modelo = this.modelo;
    const peca = aplicarGraduacao(modelo, pecaId, this.tamanho);
    const contorno = anelDoContorno(peca);

    const tabelas = new Map<Id, TabelaArco>();
    for (const arestaId of Object.keys(peca.arestas)) {
      tabelas.set(arestaId, tabelaArcoDaAresta(peca, arestaId));
    }

    let corte: readonly Vetor2[] = [];
    let erro: ErroMotor | null = null;
    try {
      corte = offsetMargem(peca).pontos;
    } catch (falha) {
      if (!(falha instanceof ErroMotor)) throw falha;
      erro = falha;
    }

    // Pique ancorado em aresta que sumiu fica para o validador acusar; projetar
    // um deles estouraria e derrubaria o desenho inteiro.
    const vivos = Object.values(peca.piques)
      .filter((p) => peca.arestas[p.arestaId] !== undefined)
      .map((p) => p.id);
    const projetados = erro === null && vivos.length > 0 ? projetarPiques(peca, vivos) : [];
    const piques = vivos.map((id, i) => [id, projetados[i]!] as const).filter(([, p]) => p !== undefined);

    return {
      peca,
      contorno,
      corte,
      tabelas,
      piques,
      problemas: validarInconsistencias({ ...modelo, pecas: { [pecaId]: peca } }, pecaId),
      caixa: caixaDe(corte.length > 0 ? [...contorno, ...corte] : contorno),
      erro,
    };
  }
}
