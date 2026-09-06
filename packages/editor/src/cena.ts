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
  projetarPique,
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
    // Guarda so a versao corrente — historico seria vazamento lento num editor
    // aberto o dia inteiro. Os tamanhos da grade convivem: a graduacao encaixada
    // pede todos a cada quadro, e expulsar um deles faria recalcular sem parar.
    const sufixo = `|${this.#sessao.versao}|`;
    for (const antiga of this.#cache.keys()) {
      if (!antiga.includes(sufixo)) this.#cache.delete(antiga);
    }
    this.#cache.set(chave, calculado);
    return calculado;
  }

  /**
   * Os derivados da peca noutro tamanho — e o que a graduacao encaixada desenha.
   * Devolve `null` se o tamanho nao esta na grade, em vez de estourar: o fantasma
   * e enfeite, e enfeite nao derruba o desenho.
   */
  derivadosDoTamanho(pecaId: Id, tamanho: string): Derivados | null {
    if (!this.modelo.tamanhos.includes(tamanho)) return null;
    const guardado = this.#tamanho;
    this.#tamanho = tamanho;
    try {
      return this.derivados(pecaId);
    } finally {
      this.#tamanho = guardado;
    }
  }

  /**
   * Problemas de todas as pecas — inclusive o erro derivado (E14).
   *
   * Sem a segunda metade, uma peca cuja margem o motor recusa perderia a linha de
   * corte NA CALADA: some do desenho e ninguem e avisado. Erro explicito e sucesso.
   */
  get problemas(): readonly Problema[] {
    return this.pecas.flatMap((id) => {
      const derivados = this.derivados(id);
      if (derivados.erro === null) return derivados.problemas;
      return [
        ...derivados.problemas,
        {
          gravidade: 'erro' as const,
          codigo: derivados.erro.codigo,
          mensagem: `Sem linha de corte: ${derivados.erro.message}`,
          pecaId: id,
        },
      ];
    });
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

    // A projecao de UM pique nao pode derrubar a peca inteira.
    //
    // Estava assim, e era um defeito de verdade: `projetarPiques` estoura em pique
    // orfao ou com normal degenerada, a excecao subia por `derivados` e o desenho
    // sumia da tela — a peca inteira, por causa de uma marca de 1,59 mm. Agora cada
    // pique e projetado por sua conta: o que falhar vira PROBLEMA e os outros
    // continuam desenhados.
    const piques: (readonly [Id, PiqueProjetado])[] = [];
    const recusados: Problema[] = [];
    if (erro === null) {
      for (const pique of Object.values(peca.piques)) {
        if (peca.arestas[pique.arestaId] === undefined) continue;
        try {
          piques.push([pique.id, projetarPique(peca, pique.id)] as const);
        } catch (falha) {
          if (!(falha instanceof ErroMotor)) throw falha;
          recusados.push({
            gravidade: 'erro',
            codigo: falha.codigo,
            mensagem: `Pique "${pique.id}" nao pode ser projetado: ${falha.message}`,
            pecaId,
            arestaId: pique.arestaId,
          });
        }
      }
    }

    return {
      peca,
      contorno,
      corte,
      tabelas,
      piques,
      problemas: [
        ...validarInconsistencias({ ...modelo, pecas: { [pecaId]: peca } }, pecaId),
        ...recusados,
      ],
      caixa: caixaDe(corte.length > 0 ? [...contorno, ...corte] : contorno),
      erro,
    };
  }
}
