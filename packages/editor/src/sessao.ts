/**
 * A sessao de edicao — E1 e E2 da Parte 0 da Fase 2.
 *
 * ## O documento e o fold do log (E1)
 * A sessao nao guarda uma `Peca` mutavel como fonte de verdade. Ela guarda o log
 * **persistido** (o que o servidor ja tem) mais um log **local** (o rascunho), e o
 * modelo exibido e `reconstruir([...persistido, ...rascunho.ate(cursor)])`.
 *
 * A tentacao seria guardar o `Modelo` e ir mutando, emitindo evento "tambem". Isso
 * cria dois caminhos que divergem em silencio — e o dia em que divergirem, o
 * modelista ve uma peca na tela e o corte sai outra. Aqui so ha um caminho.
 *
 * ## Undo mexe so no rascunho, e salvar sela (E2)
 * `desfazer` recua o cursor; `refazer` avanca; uma acao nova trunca a cauda. Isso e
 * barato e seguro porque nada disso saiu daqui ainda.
 *
 * Depois de `selar()` — que e o que se chama quando o servidor confirmou — o que
 * foi salvo **nao volta por undo**. Nao e limitacao: o log e append-only, e e disso
 * que vem a auditoria, o sync offline e a possibilidade de dois postos de trabalho.
 * Um "undo" que apaga evento ja gravado quebra as tres coisas de uma vez. Desfazer
 * algo salvo e **fazer a operacao inversa**, que e uma edicao normal, com evento
 * proprio e autor registrado.
 *
 * ## Cache por versao (E8)
 * `versao` e um contador monotonico que muda a cada alteracao do log efetivo. O
 * fold so refaz quando ela muda; os derivados caros (tesselacao, offset, graduacao)
 * ficam num cache com a mesma chave. Invalidacao e por evento, nunca por tempo.
 */
import {
  ErroMotor,
  reconstruir,
  type Evento,
  type Id,
  type Modelo,
  type TenantId,
} from '@cad/motor';

/** O que a sessao precisa saber para carimbar o envelope de todo evento (E12, E13). */
export interface DadosDaSessao {
  readonly tenantId: TenantId;
  readonly modeloId: Id;
  readonly autor: string;
  /** Gerador de id monotonico. Vem de fora do fold (D2 / E13). */
  readonly gerarId: () => Id;
  /** Relogio. Injetado para o teste ser deterministico. */
  readonly agora?: () => string;
}

/** Um evento sem o envelope — e o que uma ferramenta produz. */
export interface Gesto {
  readonly tipo: string;
  readonly pecaId: Id | null;
  readonly payload: unknown;
}

export class Sessao {
  readonly #dados: DadosDaSessao;
  #persistido: Evento[];
  /**
   * O rascunho e uma pilha de PASSOS, nao de eventos: cada `aplicar` vira um passo,
   * com um ou mais eventos dentro. E o que faz "mover as tres pecas selecionadas"
   * desfazer de uma vez, e nao peca por peca — o modelista fez um gesto so.
   */
  #rascunho: Evento[][] = [];
  /** Quantos PASSOS do rascunho estao aplicados. O resto e a cauda de refazer. */
  #cursor = 0;
  #versao = 0;

  #modelo: Modelo | null = null;
  #versaoDoModelo = -1;
  /** Quantas vezes o fold rodou de verdade. E o que o teste do cache mede. */
  #foldsFeitos = 0;

  constructor(persistido: readonly Evento[], dados: DadosDaSessao) {
    this.#persistido = [...persistido];
    this.#dados = dados;
  }

  // ------------------------------------------------------------- leitura

  /** O modelo exibido. Refaz o fold so quando a versao mudou (E8). */
  get modelo(): Modelo {
    if (this.#modelo === null || this.#versaoDoModelo !== this.#versao) {
      this.#modelo = reconstruir(this.log);
      this.#versaoDoModelo = this.#versao;
      this.#foldsFeitos++;
    }
    return this.#modelo;
  }

  /** O log efetivo: o persistido mais os passos aplicados do rascunho. */
  get log(): Evento[] {
    return [...this.#persistido, ...this.pendentes];
  }

  /** O que ainda nao foi para o servidor. E o que `salvar` manda. */
  get pendentes(): readonly Evento[] {
    return this.#rascunho.slice(0, this.#cursor).flat();
  }

  /** Quantos passos de undo existem. Um passo pode ter varios eventos. */
  get passos(): number {
    return this.#cursor;
  }

  get versao(): number {
    return this.#versao;
  }

  get foldsFeitos(): number {
    return this.#foldsFeitos;
  }

  get podeDesfazer(): boolean {
    return this.#cursor > 0;
  }

  get podeRefazer(): boolean {
    return this.#cursor < this.#rascunho.length;
  }

  // ------------------------------------------------------------- escrita

  /**
   * Carimba os gestos com o envelope e aplica. Tudo ou nada.
   *
   * Um gesto que o motor recusa **nao suja o documento** (E7): o `reconstruir` de
   * prova roda antes de qualquer estado mudar, e o `ErroMotor` sobe para a
   * ferramenta cancelar o gesto.
   *
   * Varios gestos numa chamada so entram como UM passo de undo — e o que faz
   * "mover tres pecas selecionadas" desfazer de uma vez, e nao peca por peca.
   */
  aplicar(...gestos: readonly Gesto[]): readonly Evento[] {
    if (gestos.length === 0) return [];
    const eventos = gestos.map((gesto) => this.#envelopar(gesto));

    // Prova antes de commitar: se o motor recusar, nada aqui mudou.
    reconstruir([...this.log, ...eventos]);

    this.#rascunho = [...this.#rascunho.slice(0, this.#cursor), eventos];
    this.#cursor = this.#rascunho.length;
    this.#versao++;
    return eventos;
  }

  desfazer(): boolean {
    if (!this.podeDesfazer) return false;
    this.#cursor--;
    this.#versao++;
    return true;
  }

  refazer(): boolean {
    if (!this.podeRefazer) return false;
    this.#cursor++;
    this.#versao++;
    return true;
  }

  /**
   * Chame depois de o servidor confirmar os `pendentes`: eles passam para o
   * persistido e o rascunho zera. O undo para aqui (E2).
   */
  selar(): void {
    this.#persistido = [...this.#persistido, ...this.pendentes];
    this.#rascunho = [];
    this.#cursor = 0;
    // A versao NAO muda: o log efetivo e exatamente o mesmo de antes de selar, e
    // incrementar aqui jogaria fora um cache que continua valido.
  }

  #envelopar(gesto: Gesto): Evento {
    const relogio = this.#dados.agora ?? (() => new Date().toISOString());
    return {
      id: this.#dados.gerarId(),
      tenantId: this.#dados.tenantId,
      modeloId: this.#dados.modeloId,
      pecaId: gesto.pecaId,
      timestamp: relogio(),
      autor: this.#dados.autor,
      versaoSchema: VERSAO,
      tipo: gesto.tipo,
      payload: gesto.payload,
    } as Evento;
  }
}

/**
 * A versao de schema que a sessao carimba. Fica aqui, e nao importada como valor
 * do motor, para o pacote nao criar dependencia de valor onde so precisa de forma.
 */
const VERSAO = 1;

/** Roda a acao e devolve o `ErroMotor` em vez de deixar subir. E o E7 em uma funcao. */
export function tentar<T>(acao: () => T): { ok: true; valor: T } | { ok: false; erro: ErroMotor } {
  try {
    return { ok: true, valor: acao() };
  } catch (erro) {
    if (erro instanceof ErroMotor) return { ok: false, erro };
    throw erro;
  }
}
