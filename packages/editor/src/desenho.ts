/**
 * A CENA DE DESENHO: a lista de comandos que descreve o quadro.
 *
 * Esta e a fronteira testavel do render (Parte 5). `montarCena` e uma funcao pura:
 * entra o estado do editor, sai uma lista de comandos. O `@cad/editor-pixi` so
 * traduz cada comando em `Graphics`; o teste implementa o mesmo contrato gravando
 * as chamadas. E o que torna verificavel, sem navegador, a frase "o pique e
 * desenhado na linha de corte, entrando para dentro".
 *
 * ## Cor e NOME DE TOKEN, nao hexadecimal
 * O comando diz `cor: 'costura'`, nao `#1f5fd0`. Quem resolve e a camada de render,
 * contra a paleta do tema — e por isso o mesmo comando serve para claro e escuro
 * sem uma segunda tabela para sair de sincronia.
 *
 * ## Espessura em PIXELS (E6)
 * O comando carrega `espessuraPx`. Converter para o mundo e trabalho do pintor,
 * com `larguraNoMundo`. Assim a linha de costura tem 1,6 px em qualquer zoom, e o
 * teste da regressao e uma comparacao de numero, nao um olhar na tela.
 */
import {
  ErroMotor,
  MM,
  anelDoContorno,
  offsetMargem,
  projetarPique,
  type Id,
  type Papel,
  type Peca,
  type PiqueProjetado,
  type Vetor2,
} from '@cad/motor';

import type { Camada } from './camadas.js';
import { PASSO_DA_GRADE_UM, type Snap } from './snap.js';
import { seTocam, type Caixa } from './camera.js';
import type { Cota, Editor } from './ferramenta.js';
import { chaveDa, referenciaDe, type Referencia } from './selecao.js';

/** Nome de token de cor. Quem resolve para hexadecimal e a camada de render. */
export type Tinta =
  | 'grade'
  | 'costura'
  | 'corte'
  | 'fio'
  | 'pique'
  | 'recorte'
  | 'gradePoint'
  | 'fantasma'
  | 'selecao'
  | 'fraco'
  | 'tinta';

export interface Estilo {
  readonly cor: Tinta;
  readonly espessuraPx: number;
  readonly tracejado?: boolean;
}

export type Comando =
  | {
      readonly forma: 'linha';
      readonly camada: Camada;
      readonly pontos: readonly Vetor2[];
      readonly fechada: boolean;
      readonly estilo: Estilo;
    }
  | {
      readonly forma: 'marca';
      readonly camada: Camada;
      readonly em: Vetor2;
      readonly raioPx: number;
      readonly cor: Tinta;
      readonly preenchida: boolean;
    }
  | {
      readonly forma: 'texto';
      readonly camada: 'texto' | 'overlay';
      readonly em: Vetor2;
      readonly conteudo: string;
      readonly tamanhoPx: number;
      readonly cor: Tinta;
    };

/** Espessura de cada linha, em pixels (E6). Constante na tela, em qualquer zoom. */
export const ESPESSURA_PX = Object.freeze({
  costura: 1.6,
  corte: 1.2,
  interna: 1.2,
  pique: 1.0,
  grade: 0.5,
  fantasma: 1.0,
  overlay: 1.4,
});

export const RAIO_DA_ALCA_PX = 4;
export const RAIO_DO_VERTICE_PX = 3;

/** Converte a espessura de tela para o mundo. E a conta inteira da E6. */
export function larguraNoMundo(espessuraPx: number, umPorPixel: number): number {
  return espessuraPx * umPorPixel;
}

export interface OpcoesDaCena {
  /** Desenhar os outros tamanhos da grade por baixo. */
  readonly encaixe?: boolean;
  /** Marquee em curso, para o overlay. */
  readonly marquee?: { readonly de: Vetor2; readonly ate: Vetor2 } | null;
  /** Snap ativo, para a realimentacao visual. */
  readonly snap?: Snap | null;
  /** Segmentos com alca de controle a mostra. */
  readonly comControleVisivel?: ReadonlySet<Id>;
}

/**
 * Monta o quadro inteiro. Pura: nao toca no editor, so le.
 *
 * A ordem de emissao e a ordem de desenho, de baixo para cima — o pintor pode
 * empilhar direto, sem reordenar.
 */
export function montarCena(editor: Editor, opcoes: OpcoesDaCena = {}): Comando[] {
  const comandos: Comando[] = [];
  const { cena, camadas, camera, selecao } = editor;
  const vista = camera.vista;

  if (camadas.visivel('grade')) comandos.push(...grade(vista));
  if (camadas.visivel('grade')) comandos.push(...limiteDoPapel(cena.modelo.papel, vista));

  const selecionados = new Set(selecao.itens.map(chaveDa));
  const previa = editor.previsualizacao;

  for (const pecaId of cena.pecas) {
    const derivados = cena.derivados(pecaId);
    const emPrevia = previa !== null && previa.pecaId === pecaId;

    // Durante um arrasto, a peca desenhada e a PREVIA — nao o que esta no log. E
    // ela e derivada por inteiro: contorno, corte e piques.
    //
    // Antes daqui, a previa desenhava so o contorno, e a linha de corte e os piques
    // sumiam no meio do gesto. Pior: o culling usava a caixa da peca do LOG, entao
    // arrastar a peca para fora da vista antiga fazia ela desaparecer da tela —
    // exatamente onde o modelista estava olhando.
    const peca = emPrevia ? previa.peca : derivados.peca;
    const doQuadro = emPrevia ? derivarParaODesenho(peca, derivados) : derivados;

    if (!seTocam(vista, doQuadro.caixa)) continue;

    if (opcoes.encaixe === true && camadas.visivel('fantasma') && !emPrevia) {
      for (const tamanho of cena.modelo.tamanhos) {
        if (tamanho === cena.tamanho) continue;
        const outro = cena.derivadosDoTamanho(pecaId, tamanho);
        if (outro === null) continue;
        comandos.push({
          forma: 'linha',
          camada: 'fantasma',
          pontos: outro.contorno,
          fechada: true,
          estilo: { cor: 'fantasma', espessuraPx: ESPESSURA_PX.fantasma, tracejado: true },
        });
      }
    }

    if (camadas.visivel('corte') && doQuadro.corte.length > 0) {
      comandos.push({
        forma: 'linha',
        camada: 'corte',
        pontos: doQuadro.corte,
        fechada: true,
        estilo: { cor: 'corte', espessuraPx: ESPESSURA_PX.corte },
      });
    }

    if (camadas.visivel('costura')) {
      comandos.push({
        forma: 'linha',
        camada: 'costura',
        pontos: doQuadro.contorno,
        fechada: true,
        estilo: { cor: 'costura', espessuraPx: ESPESSURA_PX.costura },
      });
      for (const ponto of Object.values(peca.pontos)) {
        if (ponto.tipo !== 'contorno') continue;
        const escolhido = selecionados.has(chaveDa({ tipo: 'ponto', pecaId, pontoId: ponto.id }));
        comandos.push({
          forma: 'marca',
          camada: 'costura',
          em: { x: ponto.x, y: ponto.y },
          raioPx: escolhido ? RAIO_DA_ALCA_PX : RAIO_DO_VERTICE_PX,
          cor: escolhido ? 'selecao' : 'costura',
          preenchida: true,
        });
      }
    }

    if (camadas.visivel('recorte')) {
      for (const recorte of Object.values(peca.recortes)) {
        comandos.push({
          forma: 'linha',
          camada: 'recorte',
          pontos: recorte.pontos.map((id) => coordenada(peca.pontos[id])),
          fechada: true,
          estilo: { cor: 'recorte', espessuraPx: ESPESSURA_PX.interna },
        });
      }
    }

    if (camadas.visivel('interna')) {
      for (const linha of Object.values(peca.linhasInternas)) {
        const escolhida = selecionados.has(chaveDa({ tipo: 'interna', pecaId, linhaId: linha.id }));
        comandos.push({
          forma: 'linha',
          camada: 'interna',
          pontos: linha.pontos.map((id) => coordenada(peca.pontos[id])),
          fechada: false,
          estilo: {
            cor: escolhida ? 'selecao' : 'fio',
            espessuraPx: ESPESSURA_PX.interna,
          },
        });
      }
    }

    if (camadas.visivel('pique')) {
      for (const [piqueId, projetado] of doQuadro.piques) {
        const pique = peca.piques[piqueId]!;
        const escolhido = selecionados.has(chaveDa({ tipo: 'pique', pecaId, piqueId }));
        comandos.push(...marcaDoPique(pique.tipo, pique.alturaUM, pique.larguraUM, projetado, escolhido));
      }
    }

    if (camadas.visivel('gradePoint')) {
      for (const gp of Object.values(peca.gradePoints)) {
        const ponto = peca.pontos[gp.pontoId];
        if (ponto === undefined) continue;
        comandos.push({
          forma: 'marca',
          camada: 'gradePoint',
          em: { x: ponto.x, y: ponto.y },
          raioPx: RAIO_DO_VERTICE_PX + 2,
          cor: 'gradePoint',
          preenchida: false,
        });
      }
    }

    if (camadas.visivel('texto')) {
      comandos.push({
        forma: 'texto',
        camada: 'texto',
        em: { x: derivados.caixa.minX, y: derivados.caixa.maxY },
        conteudo: `${peca.metadados.nome} · ${cena.tamanho}`,
        tamanhoPx: 12,
        cor: 'tinta',
      });
    }
  }

  comandos.push(...overlay(editor, opcoes));
  return comandos;
}

function coordenada(ponto: { x: number; y: number } | undefined): Vetor2 {
  return ponto === undefined ? { x: 0, y: 0 } : { x: ponto.x, y: ponto.y };
}

/** O que o quadro precisa de uma peca: contorno, corte, piques e caixa. */
interface ParaODesenho {
  readonly contorno: readonly Vetor2[];
  readonly corte: readonly Vetor2[];
  readonly piques: readonly (readonly [Id, PiqueProjetado])[];
  readonly caixa: Caixa;
}

/**
 * Deriva a peca em previa do jeito que o desenho precisa, sem passar pelo cache —
 * a previa nao tem versao, e cachear ela seria guardar lixo a cada quadro.
 *
 * Tudo aqui e "melhor esforco": se o motor recusar no meio do gesto, cai no ultimo
 * bom em vez de piscar em branco. O editor nao pode fechar (Parte 0), e um gesto em
 * curso passa por estados invalidos o tempo todo — e normal, nao e erro a relatar.
 */
function derivarParaODesenho(peca: Peca, ultimoBom: ParaODesenho): ParaODesenho {
  let contorno = ultimoBom.contorno;
  try {
    contorno = anelDoContorno(peca);
  } catch (falha) {
    if (!(falha instanceof ErroMotor)) throw falha;
  }

  let corte: readonly Vetor2[] = [];
  try {
    corte = offsetMargem(peca).pontos;
  } catch (falha) {
    if (!(falha instanceof ErroMotor)) throw falha;
  }

  const piques: (readonly [Id, PiqueProjetado])[] = [];
  if (corte.length > 0) {
    for (const pique of Object.values(peca.piques)) {
      if (peca.arestas[pique.arestaId] === undefined) continue;
      try {
        piques.push([pique.id, projetarPique(peca, pique.id)] as const);
      } catch (falha) {
        if (!(falha instanceof ErroMotor)) throw falha;
      }
    }
  }

  const todos = corte.length > 0 ? [...contorno, ...corte] : contorno;
  const caixa: Caixa =
    todos.length === 0
      ? ultimoBom.caixa
      : {
          minX: Math.min(...todos.map((p) => p.x)),
          maxX: Math.max(...todos.map((p) => p.x)),
          minY: Math.min(...todos.map((p) => p.y)),
          maxY: Math.max(...todos.map((p) => p.y)),
        };

  return { contorno, corte, piques, caixa };
}

/**
 * As duas bordas uteis do rolo do plotter.
 *
 * A largura util e `largura - 2 x margem de seguranca` — nenhuma plotadora imprime
 * ate o fio do papel. Peca que cruza essas linhas nao sai inteira, e ver isso
 * enquanto se desenha vale mais que descobrir na hora de plotar.
 */
function limiteDoPapel(papel: Papel | null, vista: Caixa): Comando[] {
  if (papel === null) return [];
  const util = papel.larguraUM - 2 * papel.margemDeSegurancaUM;
  const estilo: Estilo = { cor: 'fraco', espessuraPx: 1, tracejado: true };
  const linha = (x: number): Comando => ({
    forma: 'linha',
    camada: 'grade',
    pontos: [
      { x, y: vista.minY },
      { x, y: vista.maxY },
    ],
    fechada: false,
    estilo,
  });
  return [
    linha(0),
    linha(util),
    {
      forma: 'texto',
      camada: 'texto',
      em: { x: util, y: vista.maxY },
      conteudo: `papel ${papel.nome} · ${(util / MM).toFixed(0)} mm úteis`,
      tamanhoPx: 11,
      cor: 'fraco',
    },
  ];
}

/** Papel quadriculado de 5 cm, so na parte visivel. */
function grade(vista: Caixa): Comando[] {
  const comandos: Comando[] = [];
  const de = (v: number) => Math.floor(v / PASSO_DA_GRADE_UM) * PASSO_DA_GRADE_UM;
  const estilo: Estilo = { cor: 'grade', espessuraPx: ESPESSURA_PX.grade };
  for (let x = de(vista.minX); x <= vista.maxX; x += PASSO_DA_GRADE_UM) {
    comandos.push({
      forma: 'linha',
      camada: 'grade',
      pontos: [
        { x, y: vista.minY },
        { x, y: vista.maxY },
      ],
      fechada: false,
      estilo,
    });
  }
  for (let y = de(vista.minY); y <= vista.maxY; y += PASSO_DA_GRADE_UM) {
    comandos.push({
      forma: 'linha',
      camada: 'grade',
      pontos: [
        { x: vista.minX, y },
        { x: vista.maxX, y },
      ],
      fechada: false,
      estilo,
    });
  }
  return comandos;
}

/**
 * O pique desenhado onde ele e cortado: na LINHA DE CORTE, entrando para dentro.
 * A haste pontilhada e a projecao perpendicular ate a costura.
 */
function marcaDoPique(
  tipo: string,
  alturaUM: number,
  larguraUM: number,
  projetado: { pontoDaCostura: Vetor2; pontoDoCorte: Vetor2; paraDentro: { x: number; y: number } },
  escolhido: boolean,
): Comando[] {
  const dentro = projetado.paraDentro;
  const lado = { x: -dentro.y, y: dentro.x };
  const b = projetado.pontoDoCorte;
  const em = (fundo: number, atravessado: number): Vetor2 => ({
    x: Math.round(b.x + dentro.x * fundo + lado.x * atravessado),
    y: Math.round(b.y + dentro.y * fundo + lado.y * atravessado),
  });
  const w = larguraUM;
  const h = alturaUM;

  const forma: Vetor2[] =
    tipo === 'V'
      ? [em(0, -w), em(h, 0), em(0, w)]
      : tipo === 'T'
        ? [em(0, 0), em(h, 0)]
        : [em(0, 0), em(h, 0)];

  const comandos: Comando[] = [
    {
      forma: 'linha',
      camada: 'pique',
      pontos: [projetado.pontoDaCostura, b],
      fechada: false,
      estilo: { cor: 'fraco', espessuraPx: ESPESSURA_PX.pique * 0.6, tracejado: true },
    },
    {
      forma: 'linha',
      camada: 'pique',
      pontos: forma,
      fechada: false,
      estilo: { cor: escolhido ? 'selecao' : 'pique', espessuraPx: ESPESSURA_PX.pique },
    },
  ];
  if (tipo === 'T') {
    comandos.push({
      forma: 'linha',
      camada: 'pique',
      pontos: [em(h, -w * 1.8), em(h, w * 1.8)],
      fechada: false,
      estilo: { cor: escolhido ? 'selecao' : 'pique', espessuraPx: ESPESSURA_PX.pique },
    });
  }
  return comandos;
}

/** Alcas, marquee, snap e cota. Tudo em pixels, no overlay (E5). */
function overlay(editor: Editor, opcoes: OpcoesDaCena): Comando[] {
  const comandos: Comando[] = [];
  const { cena, selecao } = editor;

  // Alcas de controle da Bezier, so nos segmentos selecionados.
  const visiveis = opcoes.comControleVisivel;
  if (visiveis !== undefined && visiveis.size > 0) {
    for (const pecaId of cena.pecas) {
      const peca = cena.derivados(pecaId).peca;
      for (const segmento of Object.values(peca.segmentos)) {
        if (!visiveis.has(segmento.id) || segmento.controles === undefined) continue;
        const de = coordenada(peca.pontos[segmento.de]);
        const para = coordenada(peca.pontos[segmento.para]);
        comandos.push(
          {
            forma: 'linha',
            camada: 'overlay',
            pontos: [de, segmento.controles[0], segmento.controles[1], para],
            fechada: false,
            estilo: { cor: 'fraco', espessuraPx: 1, tracejado: true },
          },
          ...segmento.controles.map(
            (c): Comando => ({
              forma: 'marca',
              camada: 'overlay',
              em: c,
              raioPx: RAIO_DA_ALCA_PX,
              cor: 'selecao',
              preenchida: true,
            }),
          ),
        );
      }
    }
  }

  const marquee = opcoes.marquee;
  if (marquee !== undefined && marquee !== null) {
    const { de, ate } = marquee;
    comandos.push({
      forma: 'linha',
      camada: 'overlay',
      pontos: [de, { x: ate.x, y: de.y }, ate, { x: de.x, y: ate.y }],
      fechada: true,
      estilo: {
        cor: 'selecao',
        espessuraPx: ESPESSURA_PX.overlay,
        // Cruzamento e tracejado; janela e cheio. E a convencao de CAD.
        tracejado: ate.x < de.x,
      },
    });
  }

  const snap = opcoes.snap;
  if (snap !== undefined && snap !== null) {
    comandos.push(
      { forma: 'marca', camada: 'overlay', em: snap.ponto, raioPx: 6, cor: 'selecao', preenchida: false },
      {
        forma: 'texto',
        camada: 'overlay',
        em: snap.ponto,
        conteudo: snap.tipo,
        tamanhoPx: 10,
        cor: 'fraco',
      },
    );
  }

  const cota = editor.cota;
  if (cota !== null) comandos.push(...desenharCota(cota));

  void selecao;
  return comandos;
}

function desenharCota(cota: Cota): Comando[] {
  const meio: Vetor2 = {
    x: Math.round((cota.de.x + cota.ate.x) / 2),
    y: Math.round((cota.de.y + cota.ate.y) / 2),
  };
  const comandos: Comando[] = [
    {
      forma: 'texto',
      camada: 'overlay',
      em: meio,
      conteudo: `${cota.rotulo}: ${(cota.valorUM / MM).toFixed(1)} mm`,
      tamanhoPx: 12,
      cor: 'tinta',
    },
  ];
  if (cota.de.x !== cota.ate.x || cota.de.y !== cota.ate.y) {
    comandos.unshift({
      forma: 'linha',
      camada: 'overlay',
      pontos: [cota.de, cota.ate],
      fechada: false,
      estilo: { cor: 'selecao', espessuraPx: ESPESSURA_PX.overlay, tracejado: true },
    });
  }
  return comandos;
}

/** Reexportado para o pintor saber o que uma referencia selecionada e. */
export { referenciaDe, type Referencia };
