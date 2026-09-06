/**
 * O contrato das ferramentas e o `Editor` que as conduz (E7).
 *
 * ## Ferramenta e maquina de estados PURA
 * Ela nao conhece DOM, nao conhece Pixi e nao mexe no documento por fora: o unico
 * caminho para mudar alguma coisa e `ctx.emitir`, que vira evento no log.
 *
 * ## Erro do motor CANCELA o gesto
 * Toda chamada ao motor dentro de uma ferramenta e envolvida em `ctx.tentar`. Se o
 * motor recusar, a ferramenta nao emite nada, a previsualizacao some e a mensagem
 * vai para a interface com o codigo. O documento fica exatamente como estava — e a
 * `Sessao` ja garante isso do lado dela, provando o lote antes de commitar.
 *
 * ## Um gesto, um evento
 * Arrastar de A a B emite UM `ModificarPonto` com o delta total, no `soltar` — nao
 * sessenta, um por quadro. Enquanto o botao esta apertado existe so uma
 * PREVISUALIZACAO, que nao encosta na sessao.
 *
 * ## A previsualizacao e calculada na peca BASE
 * E depois graduada para o tamanho na tela. Fazer o contrario — editar a peca ja
 * graduada — daria uma previa que difere do resultado no modo proporcional, porque
 * o decaimento depende da posicao dos vizinhos, e ela muda de tamanho para tamanho.
 * Previa que mente e pior que previa nenhuma.
 */
import {
  ErroMotor,
  aplicarGraduacao,
  type Id,
  type Modelo,
  type Peca,
  type Vetor2,
} from '@cad/motor';

import { acharAlvo, RAIO_DE_CAPTURA_PX, type Alvo, type OpcoesDeBusca } from './alvo.js';
import { Camadas } from './camadas.js';
import { Camera, type Pixel } from './camera.js';
import { Cena } from './cena.js';
import { Selecao } from './selecao.js';
import { Sessao, type Gesto } from './sessao.js';
import { acharSnap, SEM_MODIFICADOR, type Modificadores, type OpcoesDeSnap, type Snap } from './snap.js';

/** Uma medida que a ferramenta quer mostrar na tela. Nao muda o documento. */
export interface Cota {
  readonly rotulo: string;
  readonly valorUM: number;
  readonly de: Vetor2;
  readonly ate: Vetor2;
}

export interface Contexto {
  readonly cena: Cena;
  readonly camadas: Camadas;
  readonly camera: Camera;
  readonly selecao: Selecao;
  readonly modelo: Modelo;
  /** A peca como esta no LOG (base, sem graduacao). E nela que se edita (E9). */
  base(pecaId: Id): Peca;
  alvo(em: Vetor2, opcoes?: OpcoesDeBusca): Alvo | null;
  snap(em: Vetor2, mod: Modificadores, opcoes?: OpcoesDeSnap): Snap | null;
  /** Desenho provisorio do gesto. NAO entra no log. `null` limpa. */
  previsualizar(pecaId: Id, base: Peca | null): void;
  mostrarCota(cota: Cota | null): void;
  /** Unico caminho para mudar o documento. Um `emitir` = um passo de undo. */
  emitir(...gestos: readonly Gesto[]): void;
  /** Roda a acao; se o motor recusar, guarda o erro e devolve `null`. */
  tentar<T>(acao: () => T): T | null;
}

export interface Ferramenta {
  readonly nome: string;
  readonly atalho: string;
  aoEntrar?(ctx: Contexto): void;
  aoApontar?(ctx: Contexto, em: Vetor2, mod: Modificadores): void;
  aoArrastar?(ctx: Contexto, em: Vetor2, mod: Modificadores): void;
  aoSoltar?(ctx: Contexto, em: Vetor2, mod: Modificadores): void;
  aoTecla?(ctx: Contexto, tecla: string, mod: Modificadores): void;
  /** Entrada numerica exata (E10): dx, dy, angulo, raio, s... em MILIMETRO. */
  aoNumero?(ctx: Contexto, campos: Readonly<Record<string, number>>): void;
  aoSair?(ctx: Contexto): void;
}

export class Editor {
  readonly sessao: Sessao;
  readonly cena: Cena;
  readonly camadas = new Camadas();
  readonly selecao = new Selecao();
  readonly camera: Camera;

  readonly #ferramentas = new Map<string, Ferramenta>();
  #ativa: Ferramenta;
  #arrastando = false;
  #previa: { pecaId: Id; peca: Peca } | null = null;
  #cota: Cota | null = null;
  #recusa: ErroMotor | null = null;

  constructor(sessao: Sessao, ferramentas: readonly Ferramenta[], larguraPx = 1280, alturaPx = 800) {
    if (ferramentas.length === 0) {
      throw new Error('O editor precisa de pelo menos uma ferramenta para poder abrir.');
    }
    this.sessao = sessao;
    this.cena = new Cena(sessao);
    this.camera = new Camera(larguraPx, alturaPx);
    for (const ferramenta of ferramentas) this.#ferramentas.set(ferramenta.nome, ferramenta);
    this.#ativa = ferramentas[0]!;
    this.#ativa.aoEntrar?.(this.#contexto());
  }

  // ------------------------------------------------------------- estado

  get ferramenta(): string {
    return this.#ativa.nome;
  }

  /** A previa do gesto em curso, ja graduada para o tamanho na tela. */
  get previsualizacao(): { pecaId: Id; peca: Peca } | null {
    return this.#previa;
  }

  get cota(): Cota | null {
    return this.#cota;
  }

  /** A ultima recusa do motor. E o que a interface mostra ao modelista (E7). */
  get recusa(): ErroMotor | null {
    return this.#recusa;
  }

  get arrastando(): boolean {
    return this.#arrastando;
  }

  /** Raio de captura em UM, derivado do zoom. */
  get raioUM(): number {
    return RAIO_DE_CAPTURA_PX * this.camera.umPorPixel;
  }

  // ------------------------------------------------------------- comandos

  usar(nome: string): void {
    const proxima = this.#ferramentas.get(nome);
    if (proxima === undefined) {
      throw new Error(
        `Ferramenta "${nome}" nao existe. Disponiveis: ${[...this.#ferramentas.keys()].join(', ')}.`,
      );
    }
    if (proxima === this.#ativa) return;
    this.#ativa.aoSair?.(this.#contexto());
    this.#limparGesto();
    this.#ativa = proxima;
    this.#ativa.aoEntrar?.(this.#contexto());
  }

  apontar(em: Vetor2, mod: Modificadores = SEM_MODIFICADOR): void {
    this.#recusa = null;
    this.#arrastando = true;
    this.#ativa.aoApontar?.(this.#contexto(), em, mod);
  }

  arrastar(em: Vetor2, mod: Modificadores = SEM_MODIFICADOR): void {
    if (!this.#arrastando) return;
    this.#ativa.aoArrastar?.(this.#contexto(), em, mod);
  }

  soltar(em: Vetor2, mod: Modificadores = SEM_MODIFICADOR): void {
    if (!this.#arrastando) return;
    this.#arrastando = false;
    this.#ativa.aoSoltar?.(this.#contexto(), em, mod);
    this.#previa = null;
  }

  tecla(tecla: string, mod: Modificadores = SEM_MODIFICADOR): void {
    if (tecla === 'Escape') {
      // Cancela o gesto SEM emitir nada. Se nao havia gesto, limpa a selecao.
      const haviaGesto = this.#arrastando || this.#previa !== null;
      this.#arrastando = false;
      this.#limparGesto();
      if (!haviaGesto) this.selecao.limpar();
      return;
    }
    this.#ativa.aoTecla?.(this.#contexto(), tecla, mod);
  }

  numero(campos: Readonly<Record<string, number>>): void {
    this.#ativa.aoNumero?.(this.#contexto(), campos);
    this.#arrastando = false;
    this.#previa = null;
  }

  // ------------------------------------------------------- pelo ponteiro

  apontarEmPixels(px: Pixel, mod: Modificadores = SEM_MODIFICADOR): void {
    this.apontar(this.camera.paraMundo(px), mod);
  }
  arrastarEmPixels(px: Pixel, mod: Modificadores = SEM_MODIFICADOR): void {
    this.arrastar(this.camera.paraMundo(px), mod);
  }
  soltarEmPixels(px: Pixel, mod: Modificadores = SEM_MODIFICADOR): void {
    this.soltar(this.camera.paraMundo(px), mod);
  }

  // ------------------------------------------------------------- interno

  #limparGesto(): void {
    this.#previa = null;
    this.#cota = null;
  }

  #contexto(): Contexto {
    const editor = this;
    return {
      cena: this.cena,
      camadas: this.camadas,
      camera: this.camera,
      selecao: this.selecao,
      get modelo() {
        return editor.cena.modelo;
      },
      base(pecaId: Id): Peca {
        const peca = editor.cena.modelo.pecas[pecaId];
        if (peca === undefined) {
          throw new Error(`A peca "${pecaId}" nao existe no modelo.`);
        }
        return peca;
      },
      alvo: (em, opcoes) => acharAlvo(this.cena, this.camadas, em, this.raioUM, opcoes),
      snap: (em, mod, opcoes) =>
        acharSnap(this.cena, this.camadas, em, this.camera.umPorPixel, mod, opcoes),
      previsualizar: (pecaId, base) => {
        if (base === null) {
          editor.#previa = null;
          return;
        }
        // Gradua a previa para o tamanho na tela, exatamente como o resultado
        // final sera graduado. Sem isto, a previa mentiria no modo proporcional.
        const modelo = editor.cena.modelo;
        const comEdicao: Modelo = { ...modelo, pecas: { ...modelo.pecas, [pecaId]: base } };
        const graduada = editor.#tentar(() => aplicarGraduacao(comEdicao, pecaId, editor.cena.tamanho));
        editor.#previa = graduada === null ? null : { pecaId, peca: graduada };
      },
      mostrarCota: (cota) => {
        editor.#cota = cota;
      },
      emitir: (...gestos) => {
        const feito = editor.#tentar(() => editor.sessao.aplicar(...gestos));
        if (feito === null) return;
        editor.#limparGesto();
        editor.selecao.podar(editor.cena);
      },
      tentar: (acao) => editor.#tentar(acao),
    };
  }

  #tentar<T>(acao: () => T): T | null {
    try {
      return acao();
    } catch (erro) {
      if (!(erro instanceof ErroMotor)) throw erro;
      this.#recusa = erro;
      this.#previa = null;
      return null;
    }
  }
}
