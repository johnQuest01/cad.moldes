/**
 * @cad/editor-pixi — o render e a entrada. E so isto.
 *
 * Nao decide nada: recebe a lista de comandos que o `@cad/editor` monta e a
 * traduz em `Graphics`; traduz ponteiro e teclado em chamadas ao `Editor`. Toda
 * decisao — o que o cursor pegou, onde o snap prendeu, o que a ferramenta faz —
 * mora um andar abaixo, em codigo puro e testado headless (E3).
 *
 * ## A inversao do Y acontece AQUI, e so aqui (E4)
 * O container do mundo tem `scale.y` negativo. Nenhum codigo fora dele nega
 * coordenada. Como consequencia, texto e alcas de tamanho fixo NAO podem viver
 * nele — sairiam de cabeca para baixo e mudariam de tamanho com o zoom. Eles vao
 * no overlay, que e Y-down e sem escala (E5).
 *
 * ## Espessura em pixels (E6)
 * `larguraNoMundo(espessuraPx, umPorPixel)`. Como as `Graphics` do Pixi guardam a
 * geometria em coordenadas do mundo, mudar o zoom exige REDESENHAR — por isso o
 * redesenho e disparado por mudanca de camera, alem de por mudanca de versao.
 */
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

import {
  CAMADAS,
  larguraNoMundo,
  montarCena,
  type Camada,
  type Comando,
  type Editor,
  type OpcoesDaCena,
  type Tinta,
} from '@cad/editor';
import { MM, type Vetor2 } from '@cad/motor';

/** A paleta, por nome de token. E aqui que a cor deixa de ser nome e vira numero. */
export type Paleta = Readonly<Record<Tinta, number>>;

export const PALETA_CLARA: Paleta = Object.freeze({
  grade: 0xe5eaf0,
  costura: 0x1f5fd0,
  corte: 0xc6283c,
  fio: 0x6e4bb8,
  pique: 0xb3157a,
  recorte: 0xa8620a,
  gradePoint: 0x12784a,
  fantasma: 0xb9c2cd,
  selecao: 0xf0a202,
  fraco: 0x5c6672,
  tinta: 0x14181d,
});

export const PALETA_ESCURA: Paleta = Object.freeze({
  grade: 0x1d232c,
  costura: 0x6ea3ff,
  corte: 0xff8085,
  fio: 0xb795f0,
  pique: 0xff7ac6,
  recorte: 0xe0a94a,
  gradePoint: 0x46c58a,
  fantasma: 0x39424e,
  selecao: 0xffc247,
  fraco: 0x8d99a8,
  tinta: 0xe7edf4,
});

export interface OpcoesDaTela {
  readonly fundo: number;
  readonly paleta: Paleta;
}

/**
 * A tela: monta o Pixi, desenha a cena e devolve os gestos ao `Editor`.
 *
 * `render()` e idempotente e barato de chamar — ele so redesenha quando a versao
 * do documento, a camera ou a selecao mudaram (E8).
 */
export class Tela {
  readonly app = new Application();
  readonly #editor: Editor;
  readonly #mundo = new Container({ isRenderGroup: true });
  readonly #overlay = new Container({ isRenderGroup: true });
  readonly #camadas = new Map<Camada, Container>();
  readonly #textos: Text[] = [];
  #opcoes: OpcoesDaTela;
  #assinatura = '';

  constructor(editor: Editor, opcoes: OpcoesDaTela) {
    this.#editor = editor;
    this.#opcoes = opcoes;
    for (const camada of CAMADAS) {
      const container = new Container({ isRenderGroup: true });
      this.#camadas.set(camada, container);
      (camada === 'overlay' ? this.#overlay : this.#mundo).addChild(container);
    }
  }

  async iniciar(pai: HTMLElement): Promise<void> {
    await this.app.init({
      background: this.#opcoes.fundo,
      antialias: true,
      // Sem isto, o traco de 1 px fica borrado em tela retina — inaceitavel num CAD.
      resolution: globalThis.devicePixelRatio ?? 1,
      autoDensity: true,
      resizeTo: pai,
      preference: 'webgl',
    });
    pai.appendChild(this.app.canvas);
    this.app.stage.addChild(this.#mundo, this.#overlay);
    this.app.stage.eventMode = 'static';
    this.ajustar();
  }

  trocarTema(opcoes: OpcoesDaTela): void {
    this.#opcoes = opcoes;
    this.app.renderer.background.color = opcoes.fundo;
    this.#assinatura = '';
    this.render();
  }

  /** Acerta o tamanho da camera ao do canvas. Chame no resize. */
  ajustar(): void {
    const { width, height } = this.app.renderer;
    const escala = this.app.renderer.resolution;
    this.#editor.camera.redimensionar(width / escala, height / escala);
    this.#assinatura = '';
  }

  /** Redesenha se algo mudou. Devolve `true` quando redesenhou de verdade. */
  render(opcoes: OpcoesDaCena = {}, forcar = false): boolean {
    const camera = this.#editor.camera;
    const assinatura = [
      this.#editor.sessao.versao,
      this.#editor.cena.tamanho,
      camera.zoom.toFixed(6),
      camera.centro.x,
      camera.centro.y,
      this.#editor.selecao.itens.length,
      this.#editor.previsualizacao === null ? '' : 'previa',
      JSON.stringify(opcoes.marquee ?? null),
      opcoes.snap?.tipo ?? '',
      opcoes.encaixe === true ? 'e' : '',
    ].join('|');
    if (!forcar && assinatura === this.#assinatura) return false;
    this.#assinatura = assinatura;

    // O mundo carrega a escala e a INVERSAO do Y (E4). Uma vez, aqui.
    const escala = camera.zoom / MM;
    this.#mundo.scale.set(escala, -escala);
    this.#mundo.position.set(
      camera.largura / 2 - camera.centro.x * escala,
      camera.altura / 2 + camera.centro.y * escala,
    );

    for (const container of this.#camadas.values()) {
      for (const filho of container.removeChildren()) filho.destroy();
    }
    this.#textos.length = 0;

    const umPorPixel = camera.umPorPixel;
    for (const comando of montarCena(this.#editor, opcoes)) {
      this.#desenhar(comando, umPorPixel);
    }
    return true;
  }

  #desenhar(comando: Comando, umPorPixel: number): void {
    const container = this.#camadas.get(comando.camada)!;
    const cor = this.#opcoes.paleta[comando.forma === 'linha' ? comando.estilo.cor : comando.cor];

    if (comando.forma === 'texto') {
      // Texto vive no overlay, em PIXELS: dentro do mundo espelhado ele sairia de
      // cabeca para baixo e cresceria com o zoom (E5).
      const tela = this.#editor.camera.paraTela(comando.em);
      const texto = new Text({
        text: comando.conteudo,
        style: new TextStyle({
          fontFamily: 'ui-monospace, monospace',
          fontSize: comando.tamanhoPx,
          fill: this.#opcoes.paleta[comando.cor],
        }),
      });
      texto.position.set(tela.x + 6, tela.y - comando.tamanhoPx - 4);
      this.#camadas.get('overlay')!.addChild(texto);
      this.#textos.push(texto);
      return;
    }

    const g = new Graphics();
    if (comando.forma === 'marca') {
      // A marca tem raio em PIXELS: converte para o mundo, senao ela cresce.
      g.circle(comando.em.x, comando.em.y, comando.raioPx * umPorPixel);
      if (comando.preenchida) g.fill({ color: cor });
      else g.stroke({ color: cor, width: larguraNoMundo(1.4, umPorPixel) });
      container.addChild(g);
      return;
    }

    const pontos = comando.pontos;
    if (pontos.length < 2) return;
    if (comando.estilo.tracejado === true) {
      for (const [de, ate] of tracejar(pontos, comando.fechada, umPorPixel)) {
        g.moveTo(de.x, de.y).lineTo(ate.x, ate.y);
      }
    } else {
      g.moveTo(pontos[0]!.x, pontos[0]!.y);
      for (let i = 1; i < pontos.length; i++) g.lineTo(pontos[i]!.x, pontos[i]!.y);
      if (comando.fechada) g.closePath();
    }
    g.stroke({
      color: cor,
      width: larguraNoMundo(comando.estilo.espessuraPx, umPorPixel),
      join: 'round',
      cap: 'round',
    });
    container.addChild(g);
  }

  destruir(): void {
    this.app.destroy(true, { children: true });
  }
}

/**
 * Parte a poligonal em tracinhos.
 *
 * O Pixi 8 nao tem tracejado nativo, e a alternativa — textura repetida — nao
 * acompanha o zoom. Partir na mao mantem o traco de 4 px em qualquer escala, que e
 * o que a E6 pede.
 */
function tracejar(
  pontos: readonly Vetor2[],
  fechada: boolean,
  umPorPixel: number,
): [Vetor2, Vetor2][] {
  const traco = 4 * umPorPixel;
  const vao = 3 * umPorPixel;
  const pedacos: [Vetor2, Vetor2][] = [];
  const ultimo = fechada ? pontos.length : pontos.length - 1;
  let sobra = 0;
  let desenhando = true;

  for (let i = 0; i < ultimo; i++) {
    const a = pontos[i]!;
    const b = pontos[(i + 1) % pontos.length]!;
    const comprimento = Math.hypot(b.x - a.x, b.y - a.y);
    if (comprimento === 0) continue;
    const ux = (b.x - a.x) / comprimento;
    const uy = (b.y - a.y) / comprimento;

    let andado = 0;
    while (andado < comprimento) {
      const passo = sobra > 0 ? sobra : desenhando ? traco : vao;
      const ate = Math.min(andado + passo, comprimento);
      if (desenhando) {
        pedacos.push([
          { x: a.x + ux * andado, y: a.y + uy * andado },
          { x: a.x + ux * ate, y: a.y + uy * ate },
        ]);
      }
      sobra = andado + passo > comprimento ? andado + passo - comprimento : 0;
      if (sobra === 0) desenhando = !desenhando;
      andado = ate;
    }
  }
  return pedacos;
}

/**
 * Liga ponteiro, roda e teclado do elemento ao `Editor`.
 *
 * Aqui nao ha decisao nenhuma: converte pixel em UM pela camera e repassa. Quem
 * decide o que aquilo significa e a ferramenta ativa.
 */
export function ligarEntrada(
  alvo: HTMLElement,
  editor: Editor,
  aoMudar: () => void,
): () => void {
  const modificadores = (ev: PointerEvent | KeyboardEvent | WheelEvent) => ({
    shift: ev.shiftKey,
    ctrl: ev.ctrlKey || ev.metaKey,
    alt: ev.altKey,
  });
  const emPixels = (ev: PointerEvent | WheelEvent) => {
    const caixa = alvo.getBoundingClientRect();
    return { x: ev.clientX - caixa.left, y: ev.clientY - caixa.top };
  };

  let pan: { x: number; y: number } | null = null;

  const aoApontar = (ev: PointerEvent): void => {
    alvo.setPointerCapture(ev.pointerId);
    // Botao do meio, ou espaco segurado, e pan — nunca ferramenta.
    if (ev.button === 1) {
      pan = emPixels(ev);
      return;
    }
    if (ev.button !== 0) return;
    editor.apontarEmPixels(emPixels(ev), modificadores(ev));
    aoMudar();
  };
  const aoMover = (ev: PointerEvent): void => {
    if (pan !== null) {
      const agora = emPixels(ev);
      editor.camera.mover(agora.x - pan.x, agora.y - pan.y);
      pan = agora;
      aoMudar();
      return;
    }
    editor.arrastarEmPixels(emPixels(ev), modificadores(ev));
    aoMudar();
  };
  const aoSoltar = (ev: PointerEvent): void => {
    if (pan !== null) {
      pan = null;
      return;
    }
    editor.soltarEmPixels(emPixels(ev), modificadores(ev));
    aoMudar();
  };
  const aoRolar = (ev: WheelEvent): void => {
    ev.preventDefault();
    const fino = ev.ctrlKey ? 1.05 : 1.2;
    editor.camera.aproximarNoPonto(emPixels(ev), ev.deltaY < 0 ? fino : 1 / fino);
    aoMudar();
  };
  const aoTeclar = (ev: KeyboardEvent): void => {
    const foco = ev.target as HTMLElement | null;
    if (foco?.tagName === 'INPUT' || foco?.tagName === 'SELECT') return;
    editor.tecla(ev.key, modificadores(ev));
    aoMudar();
  };

  alvo.addEventListener('pointerdown', aoApontar);
  alvo.addEventListener('pointermove', aoMover);
  alvo.addEventListener('pointerup', aoSoltar);
  alvo.addEventListener('pointercancel', aoSoltar);
  alvo.addEventListener('wheel', aoRolar, { passive: false });
  globalThis.addEventListener('keydown', aoTeclar);

  return () => {
    alvo.removeEventListener('pointerdown', aoApontar);
    alvo.removeEventListener('pointermove', aoMover);
    alvo.removeEventListener('pointerup', aoSoltar);
    alvo.removeEventListener('pointercancel', aoSoltar);
    alvo.removeEventListener('wheel', aoRolar);
    globalThis.removeEventListener('keydown', aoTeclar);
  };
}
