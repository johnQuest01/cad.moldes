/**
 * Demonstração: o motor rodando ao vivo no navegador, com o cursor.
 *
 * Nada aqui é maquete. Cada linha desenhada sai de `@cad/motor` — o mesmo pacote
 * que os 164 testes exercitam — e cada número do painel é medido, não digitado.
 * Se o motor estiver errado, a tela mostra errado.
 *
 * ## O gesto vira EVENTO, não mutação
 * Arrastar um ponto, cravar um pique ou inserir um ponto no meio de um segmento
 * não altera objeto nenhum: acrescenta um evento ao log, e o modelo é o `fold` do
 * log inteiro. É por isso que "desfazer" é um `pop()` e o painel de baixo mostra,
 * em ordem, exatamente o que o mouse produziu. É a mesma regra do backend
 * (Parte 4) — a tela não tem um caminho paralelo.
 *
 * A edição vai sempre para o TAMANHO BASE e a graduação recalcula por cima. Como
 * a regra de graduação é aditiva, o ponto arrastado segue o cursor mesmo com P ou
 * G na tela.
 */
import {
  ALTURA_PADRAO_DO_PIQUE_UM,
  LARGURA_PADRAO_DO_PIQUE_UM,
  MM,
  anelDoContorno,
  aplicarGraduacao,
  area,
  areaDesdobrada,
  arredondarVertice,
  contornoDesdobrado,
  dividirPeca,
  localizarNoContorno,
  medirAresta,
  modificarPonto,
  moverPique,
  offsetMargem,
  projetarPiques,
  reconstruir,
  tesselarContorno,
  umParaMM,
  validarInconsistencias,
  type Evento,
  type Modelo,
  type Peca,
  type PiqueProjetado,
  type Problema,
  type TipoPique,
  type Vetor2,
} from '@cad/motor';

import { ARESTAS, logDaBlusa, MODELO, PECA, TAMANHOS, TAMANHO_BASE, TENANT } from './peca.js';

type Ferramenta = 'mover' | 'pique' | 'inserir';
type Selecao = { readonly tipo: 'ponto' | 'pique'; readonly id: string } | null;
type Arrasto =
  | { readonly tipo: 'ponto'; readonly id: string; dx: number; dy: number }
  | { readonly tipo: 'pique'; readonly id: string; s: number }
  | null;

interface Estado {
  tamanho: string;
  margens: number[];
  mostrarCorte: boolean;
  mostrarVertices: boolean;
  mostrarEncaixe: boolean;
  desdobrar: boolean;
  filletMM: number;
  dividirEm: number | null;
  ferramenta: Ferramenta;
  modo: 'discreto' | 'proporcional';
  nVizinhos: number;
  tipoPique: TipoPique;
  profundidadeMM: number;
  extras: Evento[];
  selecao: Selecao;
  arrasto: Arrasto;
}

const estado: Estado = {
  tamanho: TAMANHO_BASE,
  margens: ARESTAS.map((a) => a.margemMM),
  mostrarCorte: true,
  mostrarVertices: true,
  mostrarEncaixe: false,
  desdobrar: false,
  filletMM: 0,
  dividirEm: null,
  ferramenta: 'mover',
  modo: 'proporcional',
  nVizinhos: 2,
  tipoPique: 'V',
  profundidadeMM: umParaMM(ALTURA_PADRAO_DO_PIQUE_UM),
  extras: [],
  selecao: null,
  arrasto: null,
};

/**
 * As cores saem dos tokens do CSS, nao de literais: assim o desenho acompanha o
 * tema claro/escuro do leitor sem uma segunda tabela de cores para sair de sincronia.
 */
const cor = (nome: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

const CORES = {
  get costura() { return cor('--costura'); },
  get corte() { return cor('--corte'); },
  get fantasma() { return cor('--fantasma'); },
  get fio() { return cor('--fio'); },
  get desdobrada() { return cor('--desdobrada'); },
  get parte() { return cor('--parte'); },
  get pique() { return cor('--pique'); },
  get selecao() { return cor('--selecao'); },
  get fraco() { return cor('--fraco'); },
};

// ---------------------------------------------------------------- eventos

/** Envelope do evento. A entropia vem daqui, de fora do fold (D2). */
function evento(tipo: string, payload: unknown): Evento {
  return {
    id: `01JXEDIT${String(estado.extras.length).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO,
    pecaId: PECA,
    timestamp: new Date().toISOString(),
    autor: 'cursor',
    versaoSchema: 1,
    tipo,
    payload,
  } as Evento;
}

function registrar(evt: Evento): void {
  estado.extras.push(evt);
  render();
}

const logAtual = (): Evento[] => [...logDaBlusa(estado.margens), ...estado.extras];

// ---------------------------------------------------------------- geometria

interface Camada {
  readonly pontos: readonly Vetor2[];
  readonly cor: string;
  readonly rotulo?: string;
  readonly tracejado?: boolean;
  readonly vertices?: boolean;
  readonly aberta?: boolean;
}

interface Quadro {
  readonly camadas: readonly Camada[];
  readonly medidas: readonly (readonly [string, string])[];
  readonly problemas: readonly Problema[];
  readonly erro: string | null;
  /** A peça como está na tela: é contra ela que o cursor mira. */
  readonly peca: Peca | null;
  readonly piques: readonly (readonly [string, PiqueProjetado])[];
  readonly editavel: boolean;
}

function montar(): Quadro {
  const camadas: Camada[] = [];
  const medidas: [string, string][] = [];
  let problemas: readonly Problema[] = [];
  let exibida: Peca | null = null;
  let piques: (readonly [string, PiqueProjetado])[] = [];

  try {
    const modelo: Modelo = reconstruir(logAtual());

    // O arrasto em curso é PREVIEW: mexe na peça base, ainda sem virar evento.
    let base = modelo.pecas[PECA]!;
    if (estado.arrasto?.tipo === 'ponto') {
      base = modificarPonto(
        base,
        estado.arrasto.id,
        estado.arrasto.dx,
        estado.arrasto.dy,
        estado.modo,
        estado.nVizinhos,
      );
    } else if (estado.arrasto?.tipo === 'pique') {
      base = moverPique(base, estado.arrasto.id, estado.arrasto.s);
    }
    const editado: Modelo = { ...modelo, pecas: { ...modelo.pecas, [PECA]: base } };

    // Encaixe: as outras gradações por baixo, como no molde encaixado de verdade.
    if (estado.mostrarEncaixe) {
      for (const tamanho of TAMANHOS) {
        if (tamanho === estado.tamanho) continue;
        camadas.push({
          pontos: tesselarContorno(aplicarGraduacao(editado, PECA, tamanho)),
          cor: CORES.fantasma,
          tracejado: true,
          rotulo: `tamanho ${tamanho}`,
        });
      }
    }

    let peca: Peca = aplicarGraduacao(editado, PECA, estado.tamanho);

    if (estado.filletMM > 0) {
      // pt-1 é o canto entre a bainha e a lateral — duas arestas diferentes, o que
      // faz o arco ser partido ao meio e virar a nova fronteira entre elas (D3).
      peca = arredondarVertice(peca, 'pt-1', Math.round(estado.filletMM * MM), 'fil');
    }

    problemas = validarInconsistencias({ ...modelo, pecas: { [PECA]: peca } }, PECA);
    exibida = peca;

    if (estado.dividirEm !== null) {
      const eixo = {
        p1: { x: -1000 * MM, y: Math.round(estado.dividirEm * MM) },
        p2: { x: 1000 * MM, y: Math.round(estado.dividirEm * MM) },
      };
      const [parte1, parte2] = dividirPeca(peca, eixo, 10 * MM, 'dv');
      const cortes = [parte1, parte2].map((p) => offsetMargem(p).pontos);
      camadas.push(
        { pontos: anelDoContorno(parte1), cor: CORES.parte, rotulo: 'parte de cima' },
        { pontos: anelDoContorno(parte2), cor: CORES.parte, rotulo: 'parte de baixo' },
      );
      if (estado.mostrarCorte) {
        for (const corte of cortes) camadas.push({ pontos: corte, cor: CORES.corte });
      }
      const somaCortes = cortes.reduce((soma, c) => soma + area(c), 0);
      medidas.push(
        ['Partes', '2 (cada uma com margem própria no corte novo)'],
        ['Tecido a mais', `${cm2(somaCortes - area(offsetMargem(peca).pontos))} cm²`],
      );
    } else if (estado.desdobrar) {
      const contorno = contornoDesdobrado(peca, 'dobra').pontos;
      camadas.push(
        { pontos: contorno, cor: CORES.desdobrada, rotulo: 'peça desdobrada' },
        {
          pontos: anelDoContorno(peca),
          cor: CORES.costura,
          tracejado: true,
          rotulo: 'a metade desenhada',
        },
      );
      medidas.push(
        ['Largura desdobrada', `${mm(larguraDe(contorno))} mm (o dobro da metade)`],
        ['Área para o consumo', `${cm2(areaDesdobrada(peca, 'dobra'))} cm²`],
      );
    } else {
      const costura = anelDoContorno(peca);
      if (estado.mostrarCorte) {
        camadas.push({
          pontos: offsetMargem(peca).pontos,
          cor: CORES.corte,
          rotulo: 'linha de corte',
        });
      }
      camadas.push({ pontos: costura, cor: CORES.costura, rotulo: 'linha de costura' });
      // Pique órfão (o fillet pode ter comido a aresta) fica para o validador
      // acusar; projetar um deles estouraria e derrubaria o desenho inteiro.
      const vivos = Object.values(peca.piques)
        .filter((p) => peca.arestas[p.arestaId] !== undefined)
        .map((p) => p.id);
      if (vivos.length > 0) {
        const projetados = projetarPiques(peca, vivos);
        piques = vivos.map((id, i) => [id, projetados[i]!] as const);
      }
    }

    // O fio do tecido, que gradua junto (D10).
    const fio = peca.linhasInternas['li-fio'];
    if (fio !== undefined && !estado.desdobrar) {
      camadas.push({
        pontos: fio.pontos.map((id) => ({ x: peca.pontos[id]!.x, y: peca.pontos[id]!.y })),
        cor: CORES.fio,
        rotulo: 'fio do tecido',
        aberta: true,
        vertices: true,
      });
    }

    const costura = anelDoContorno(peca);
    const corte = offsetMargem(peca).pontos;
    medidas.unshift(
      ['Tamanho', estado.tamanho],
      ['Costura', `${mm(larguraDe(costura))} × ${mm(alturaDe(costura))} mm`],
      ['Corte', `${mm(larguraDe(corte))} × ${mm(alturaDe(corte))} mm`],
      ['Área da costura', `${cm2(area(costura))} cm²`],
      ['Perímetro', `${mm(perimetro(costura))} mm`],
      ['Piques', String(Object.keys(peca.piques).length)],
    );
    for (const aresta of ARESTAS) {
      if (peca.arestas[aresta.id] === undefined) continue;
      medidas.push([aresta.nome, `${mm(medirAresta(peca, aresta.id))} mm`]);
    }

    return {
      camadas,
      medidas,
      problemas,
      erro: null,
      peca,
      piques,
      editavel: !estado.desdobrar && estado.dividirEm === null,
    };
  } catch (erro) {
    return {
      camadas,
      medidas,
      problemas,
      erro: erro instanceof Error ? erro.message : String(erro),
      peca: exibida,
      piques,
      editavel: false,
    };
  }
}

const mm = (um: number) => umParaMM(Math.round(um)).toFixed(1);
const cm2 = (um2: number) => (um2 / 100_000_000).toFixed(1);
const larguraDe = (p: readonly Vetor2[]) =>
  Math.max(...p.map((v) => v.x)) - Math.min(...p.map((v) => v.x));
const alturaDe = (p: readonly Vetor2[]) =>
  Math.max(...p.map((v) => v.y)) - Math.min(...p.map((v) => v.y));
function perimetro(anel: readonly Vetor2[]): number {
  let total = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// ---------------------------------------------------------------- desenho

/** Grade de 5 cm em escala real, como o papel de molde. */
function grade(minX: number, maxX: number, minY: number, maxY: number, traco: number): string {
  const passo = 50 * MM;
  const linhas: string[] = [];
  const de = (v: number) => Math.floor(v / passo) * passo;
  for (let x = de(minX); x <= maxX; x += passo) {
    linhas.push(`<line x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}"/>`);
  }
  for (let y = de(minY); y <= maxY; y += passo) {
    linhas.push(`<line x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}"/>`);
  }
  return `<g stroke="${cor('--grade')}" stroke-width="${traco * 0.4}" fill="none">${linhas.join('')}</g>`;
}

/** Barra de escala: sem ela, um desenho vetorial nao diz de que tamanho e a peca. */
function escala(minX: number, minY: number, traco: number, fonte: number): string {
  const cem = 100 * MM;
  const y = minY - fonte * 1.6;
  const t = CORES.fraco;
  return (
    `<g stroke="${t}" stroke-width="${traco * 0.7}" fill="none">` +
    `<line x1="${minX}" y1="${y}" x2="${minX + cem}" y2="${y}"/>` +
    `<line x1="${minX}" y1="${y - fonte * 0.3}" x2="${minX}" y2="${y + fonte * 0.3}"/>` +
    `<line x1="${minX + cem}" y1="${y - fonte * 0.3}" x2="${minX + cem}" y2="${y + fonte * 0.3}"/>` +
    `</g><text x="${minX + cem / 2}" y="${y - fonte * 0.55}" fill="${t}" font-size="${fonte}" ` +
    `font-family="ui-monospace,monospace" text-anchor="middle" transform="scale(1 -1)" ` +
    `transform-origin="${minX + cem / 2} ${y - fonte * 0.55}">100 mm</text>`
  );
}

/**
 * O pique desenhado onde ele é cortado: na LINHA DE CORTE, entrando para dentro.
 *
 * A haste pontilhada que liga a costura ao corte é a projeção perpendicular — o
 * pique é ancorado na costura (é lá que as duas peças se encontram), mas a tesoura
 * passa no corte. Sem essa projeção o pique sairia deslocado na peça cortada.
 */
function marcasDosPiques(quadro: Quadro, traco: number): string {
  if (quadro.peca === null) return '';
  const partes: string[] = [];

  for (const [id, proj] of quadro.piques) {
    const pique = quadro.peca.piques[id]!;
    const dentro = proj.paraDentro;
    const lado = { x: -dentro.y, y: dentro.x };
    const b = proj.pontoDoCorte;
    const h = pique.alturaUM;
    const w = Math.max(pique.larguraUM, traco * 0.9);
    const em = (fundo: number, atravessado: number) =>
      `${b.x + dentro.x * fundo + lado.x * atravessado} ` +
      `${b.y + dentro.y * fundo + lado.y * atravessado}`;

    let d: string;
    switch (pique.tipo) {
      case 'V':
        d = `M${em(0, -w)} L${em(h, 0)} L${em(0, w)}`;
        break;
      case 'T':
        d = `M${em(0, 0)} L${em(h, 0)} M${em(h, -w * 1.8)} L${em(h, w * 1.8)}`;
        break;
      case 'U':
        d = `M${em(0, -w)} L${em(h - w, -w)} A${w} ${w} 0 0 0 ${em(h - w, w)} L${em(0, w)}`;
        break;
      default:
        d = `M${em(0, 0)} L${em(h, 0)}`;
    }

    const escolhido = estado.selecao?.tipo === 'pique' && estado.selecao.id === id;
    partes.push(
      `<path d="M${proj.pontoDaCostura.x} ${proj.pontoDaCostura.y} L${b.x} ${b.y}" fill="none" ` +
        `stroke="${CORES.fraco}" stroke-width="${traco * 0.35}" ` +
        `stroke-dasharray="${traco} ${traco}"/>` +
        `<path d="${d}" fill="none" stroke="${CORES.pique}" stroke-width="${traco * 0.6}" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${proj.pontoDaCostura.x}" cy="${proj.pontoDaCostura.y}" ` +
        `r="${traco * (escolhido ? 2.4 : 1.5)}" fill="${escolhido ? CORES.selecao : CORES.pique}"/>`,
    );
  }
  return partes.join('');
}

/** Y-up do núcleo → Y-down do SVG: inverte só no render, como manda a D4. */
function desenhar(quadro: Quadro): string {
  const todos = quadro.camadas.flatMap((c) => c.pontos);
  if (todos.length === 0) return '';
  const minX = Math.min(...todos.map((p) => p.x));
  const maxX = Math.max(...todos.map((p) => p.x));
  const minY = Math.min(...todos.map((p) => p.y));
  const maxY = Math.max(...todos.map((p) => p.y));
  const folga = Math.max(maxX - minX, maxY - minY) * 0.08;
  const largura = maxX - minX + 2 * folga;
  const altura = maxY - minY + 2 * folga + folga * 0.6;
  const traco = Math.max(largura, altura) * 0.0042;
  const fonte = Math.max(largura, altura) * 0.026;

  const fundo =
    grade(minX - folga, maxX + folga, minY - folga, maxY + folga, traco) +
    escala(minX - folga * 0.4, minY - folga * 0.35, traco, fonte);

  const conteudo = quadro.camadas
    .map((camada) => {
      const d =
        camada.pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') +
        (camada.aberta === true ? '' : ' Z');
      const dash = camada.tracejado === true ? ` stroke-dasharray="${traco * 4} ${traco * 3}"` : '';
      const bolinhas =
        camada.vertices === true
          ? camada.pontos
              .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${traco * 1.8}" fill="${camada.cor}"/>`)
              .join('')
          : '';
      return (
        `<path d="${d}" fill="none" stroke="${camada.cor}" stroke-width="${traco}" ` +
        `stroke-linejoin="round"${dash}/>${bolinhas}`
      );
    })
    .join('');

  // Os vértices são os `Ponto` da peça — NÃO os pontos da poligonal tesselada, que
  // são centenas e não têm identidade. A alça oca só aparece quando dá para arrastar.
  let alcas = '';
  const alcaViva = quadro.editavel && estado.ferramenta === 'mover';
  if (quadro.peca !== null && (estado.mostrarVertices || alcaViva)) {
    for (const ponto of Object.values(quadro.peca.pontos)) {
      if (ponto.tipo !== 'contorno') continue;
      const escolhido = estado.selecao?.tipo === 'ponto' && estado.selecao.id === ponto.id;
      alcas += alcaViva
        ? `<circle cx="${ponto.x}" cy="${ponto.y}" r="${traco * (escolhido ? 3.2 : 2.4)}" ` +
          `fill="${escolhido ? CORES.selecao : 'transparent'}" stroke="${CORES.costura}" ` +
          `stroke-width="${traco * 0.7}"/>`
        : `<circle cx="${ponto.x}" cy="${ponto.y}" r="${traco * 1.8}" fill="${CORES.costura}"/>`;
    }
  }

  return (
    `<svg viewBox="${minX - folga} ${-(maxY + folga)} ${largura} ${altura}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" ` +
    `aria-label="Molde da frente: linha de costura, linha de corte e piques">` +
    `<g transform="scale(1 -1)">${fundo}${conteudo}` +
    `${marcasDosPiques(quadro, traco)}${alcas}</g></svg>`
  );
}

// ---------------------------------------------------------------- cursor

const areaDesenho = document.querySelector('#desenho') as HTMLElement;
let ultimoQuadro: Quadro | null = null;
let origemDoArrasto: Vetor2 = { x: 0, y: 0 };

/** Ponto do mouse em UM. O CTM do grupo já traz o `scale(1 -1)` do render. */
function emUM(ev: PointerEvent): Vetor2 | null {
  const grupo = areaDesenho.querySelector('svg > g');
  if (grupo === null) return null;
  const ctm = (grupo as SVGGraphicsElement).getScreenCTM();
  if (ctm === null) return null;
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Quantos UM vale um pixel de tela agora — é daí que sai o raio de captura. */
function umPorPixel(): number {
  const grupo = areaDesenho.querySelector('svg > g');
  const ctm = grupo === null ? null : (grupo as SVGGraphicsElement).getScreenCTM();
  return ctm === null || ctm.a === 0 ? 1000 : Math.abs(1 / ctm.a);
}

function pontoMaisProximo(peca: Peca, alvo: Vetor2, raio: number): string | null {
  let melhor: { id: string; d: number } | null = null;
  for (const ponto of Object.values(peca.pontos)) {
    if (ponto.tipo !== 'contorno') continue;
    const d = Math.hypot(ponto.x - alvo.x, ponto.y - alvo.y);
    if (d <= raio && (melhor === null || d < melhor.d)) melhor = { id: ponto.id, d };
  }
  return melhor === null ? null : melhor.id;
}

function piqueMaisProximo(quadro: Quadro, alvo: Vetor2, raio: number): string | null {
  let melhor: { id: string; d: number } | null = null;
  for (const [id, proj] of quadro.piques) {
    const d = Math.hypot(proj.pontoDaCostura.x - alvo.x, proj.pontoDaCostura.y - alvo.y);
    if (d <= raio && (melhor === null || d < melhor.d)) melhor = { id, d };
  }
  return melhor === null ? null : melhor.id;
}

areaDesenho.addEventListener('pointerdown', (ev) => {
  const quadro = ultimoQuadro;
  if (quadro === null || quadro.peca === null || !quadro.editavel) return;
  const alvo = emUM(ev);
  if (alvo === null) return;
  const raio = umPorPixel() * 12;

  // Um pique já cravado ganha do resto: é o alvo menor, e o mais fácil de perder.
  const piqueId = piqueMaisProximo(quadro, alvo, raio);
  if (piqueId !== null) {
    estado.selecao = { tipo: 'pique', id: piqueId };
    estado.arrasto = { tipo: 'pique', id: piqueId, s: quadro.peca.piques[piqueId]!.s };
    areaDesenho.setPointerCapture(ev.pointerId);
    render();
    return;
  }

  if (estado.ferramenta === 'mover') {
    const pontoId = pontoMaisProximo(quadro.peca, alvo, raio);
    if (pontoId === null) {
      estado.selecao = null;
      render();
      return;
    }
    estado.selecao = { tipo: 'ponto', id: pontoId };
    estado.arrasto = { tipo: 'ponto', id: pontoId, dx: 0, dy: 0 };
    origemDoArrasto = alvo;
    areaDesenho.setPointerCapture(ev.pointerId);
    render();
    return;
  }

  const lugar = localizarNoContorno(quadro.peca, alvo);
  if (lugar.distanciaUM > raio * 3) return;

  if (estado.ferramenta === 'pique') {
    const id = `pq-${estado.extras.length}`;
    registrar(
      evento('AdicionarPique', {
        piqueId: id,
        arestaId: lugar.arestaId,
        s: lugar.s,
        tipo: estado.tipoPique,
        alturaUM: Math.round(estado.profundidadeMM * MM),
        larguraUM: LARGURA_PADRAO_DO_PIQUE_UM,
        anguloGraus: 0,
      }),
    );
    estado.selecao = { tipo: 'pique', id };
    render();
  } else {
    // `inserirPonto` recusa s = 0 e s = 1: os extremos do segmento já são pontos.
    const s = Math.min(0.98, Math.max(0.02, lugar.sNoSegmento));
    registrar(
      evento('InserirPonto', {
        segmentoId: lugar.segmentoId,
        s,
        prefixoId: `ins-${estado.extras.length}`,
      }),
    );
  }
});

areaDesenho.addEventListener('pointermove', (ev) => {
  if (estado.arrasto === null) return;
  const quadro = ultimoQuadro;
  if (quadro === null || quadro.peca === null) return;
  const alvo = emUM(ev);
  if (alvo === null) return;

  if (estado.arrasto.tipo === 'ponto') {
    estado.arrasto.dx = alvo.x - origemDoArrasto.x;
    estado.arrasto.dy = alvo.y - origemDoArrasto.y;
  } else {
    const pique = quadro.peca.piques[estado.arrasto.id]!;
    const lugar = localizarNoContorno(quadro.peca, alvo);
    // Arrastar desliza o pique NA MESMA aresta; puxar para outra aresta seria
    // apagar e recravar, e isso o modelista faz de propósito, não por engano.
    if (lugar.arestaId === pique.arestaId) estado.arrasto.s = lugar.s;
  }
  render();
});

function encerrarArrasto(): void {
  const arrasto = estado.arrasto;
  if (arrasto === null) return;
  estado.arrasto = null;

  if (arrasto.tipo === 'ponto') {
    if (arrasto.dx === 0 && arrasto.dy === 0) {
      render();
      return;
    }
    registrar(
      evento('ModificarPonto', {
        pontoId: arrasto.id,
        dx: arrasto.dx,
        dy: arrasto.dy,
        modo: estado.modo,
        nVizinhos: estado.nVizinhos,
      }),
    );
  } else {
    registrar(evento('MoverPique', { piqueId: arrasto.id, s: arrasto.s }));
  }
}

areaDesenho.addEventListener('pointerup', encerrarArrasto);
areaDesenho.addEventListener('pointercancel', encerrarArrasto);

window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
  const foco = ev.target as HTMLElement;
  if (foco.tagName === 'INPUT' || foco.tagName === 'SELECT') return;
  if (estado.selecao === null) return;
  ev.preventDefault();
  const { tipo, id } = estado.selecao;
  estado.selecao = null;
  registrar(
    tipo === 'pique' ? evento('RemoverPique', { piqueId: id }) : evento('ExcluirPonto', { pontoId: id }),
  );
});

// ---------------------------------------------------------------- interface

const DICAS: Readonly<Record<Ferramenta, string>> = {
  mover:
    'Arraste um vértice do contorno. No modo proporcional os vizinhos acompanham com ' +
    'decaimento (1+cos)/2 — é a conta que não deixa bico na curva.',
  pique: 'Clique no contorno para cravar. Arraste um pique para deslizá-lo na aresta; Delete tira.',
  inserir: 'Clique no contorno: nasce um ponto ali, e o segmento vira dois.',
};

function render(): void {
  const quadro = montar();
  ultimoQuadro = quadro;

  areaDesenho.innerHTML =
    quadro.erro !== null && quadro.camadas.length === 0 ? '' : desenhar(quadro);
  areaDesenho.dataset['ferramenta'] = quadro.editavel ? estado.ferramenta : 'travado';

  const legenda = quadro.camadas
    .filter((c) => c.rotulo !== undefined)
    .map((c) => `<span class="chip"><i style="background:${c.cor}"></i>${c.rotulo}</span>`)
    .join('');
  document.querySelector('#legenda')!.innerHTML =
    legenda +
    (quadro.piques.length > 0
      ? `<span class="chip"><i style="background:${CORES.pique}"></i>` +
        `${quadro.piques.length} pique${quadro.piques.length > 1 ? 's' : ''}</span>`
      : '');

  document.querySelector('#medidas')!.innerHTML = quadro.medidas
    .map(([rotulo, valor]) => `<div class="linha"><span>${rotulo}</span><b>${valor}</b></div>`)
    .join('');

  const alerta = document.querySelector('#alerta') as HTMLElement;
  if (quadro.erro !== null) {
    alerta.className = 'alerta erro';
    alerta.innerHTML = `<b>O motor recusou.</b><br>${quadro.erro}`;
  } else if (quadro.problemas.length > 0) {
    alerta.className = 'alerta aviso';
    alerta.innerHTML =
      `<b>${quadro.problemas.length} do validador:</b><br>` +
      quadro.problemas.map((p) => `[${p.gravidade}] ${p.codigo}`).join('<br>');
  } else {
    alerta.className = 'alerta ok';
    alerta.textContent = 'Validador: nenhuma inconsistência.';
  }

  renderLog();
  document.querySelector('#dica')!.textContent = quadro.editavel
    ? DICAS[estado.ferramenta]
    : 'Desdobrar e dividir mostram geometria derivada: para editar, desligue os dois.';
  (document.querySelector('#desfazer') as HTMLButtonElement).disabled = estado.extras.length === 0;
  (document.querySelector('#limpar') as HTMLButtonElement).disabled = estado.extras.length === 0;
  (document.querySelector('#opcoes-mover') as HTMLElement).hidden = estado.ferramenta !== 'mover';
  (document.querySelector('#opcoes-pique') as HTMLElement).hidden = estado.ferramenta !== 'pique';
}

function resumoDoEvento(evt: Evento): string {
  const p = evt.payload as Record<string, unknown>;
  switch (evt.tipo) {
    case 'ModificarPonto':
      return (
        `${String(p['pontoId'])} · ${mm(Number(p['dx']))}, ${mm(Number(p['dy']))} mm · ` +
        `${String(p['modo'])}`
      );
    case 'AdicionarPique':
      return `${String(p['tipo'])} em ${String(p['arestaId'])} · s = ${Number(p['s']).toFixed(3)}`;
    case 'MoverPique':
      return `${String(p['piqueId'])} · s = ${Number(p['s']).toFixed(3)}`;
    case 'RemoverPique':
      return String(p['piqueId']);
    case 'InserirPonto':
      return `${String(p['segmentoId'])} · s = ${Number(p['s']).toFixed(3)}`;
    case 'ExcluirPonto':
      return String(p['pontoId']);
    default:
      return '';
  }
}

function renderLog(): void {
  const alvo = document.querySelector('#log')!;
  if (estado.extras.length === 0) {
    alvo.innerHTML =
      '<p class="nota">Nada ainda. Cada gesto do mouse entra aqui como evento — o desenho ' +
      'é o <em>fold</em> desta lista sobre o molde original.</p>';
    return;
  }
  alvo.innerHTML = estado.extras
    .map(
      (evt, i) =>
        `<div class="evt"><span class="n">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="t">${evt.tipo}</span><span class="p">${resumoDoEvento(evt)}</span></div>`,
    )
    .reverse()
    .join('');
}

function montarControles(): void {
  const tamanhos = document.querySelector('#tamanhos')!;
  tamanhos.innerHTML = TAMANHOS.map(
    (t) => `<button data-tamanho="${t}" aria-pressed="${t === estado.tamanho}">${t}</button>`,
  ).join('');

  document.querySelector('#margens')!.innerHTML = ARESTAS.map(
    (aresta, i) => `
      <label class="margem">
        <span>${aresta.nome}</span>
        <b id="valor-margem-${i}">${estado.margens[i]} mm</b>
        <input type="range" min="0" max="50" step="1" value="${estado.margens[i]}" data-margem="${i}">
      </label>`,
  ).join('');
}

function marcarFerramenta(): void {
  document.querySelectorAll('#ferramentas button').forEach((botao) => {
    const qual = (botao as HTMLElement).dataset['ferramenta'];
    botao.setAttribute('aria-pressed', String(qual === estado.ferramenta));
  });
}

function ligar(seletor: string, ao: (elemento: HTMLInputElement) => void): void {
  document.querySelector(seletor)!.addEventListener('input', (ev) => {
    ao(ev.target as HTMLInputElement);
    render();
  });
}

document.querySelector('#tamanhos')!.addEventListener('click', (ev) => {
  const alvo = (ev.target as HTMLElement).closest('button');
  if (alvo === null) return;
  estado.tamanho = alvo.dataset['tamanho']!;
  document.querySelectorAll('#tamanhos button').forEach((b) => {
    b.setAttribute('aria-pressed', String((b as HTMLElement).dataset['tamanho'] === estado.tamanho));
  });
  render();
});

document.querySelector('#ferramentas')!.addEventListener('click', (ev) => {
  const alvo = (ev.target as HTMLElement).closest('button');
  if (alvo === null) return;
  estado.ferramenta = alvo.dataset['ferramenta'] as Ferramenta;
  estado.selecao = null;
  marcarFerramenta();
  render();
});

document.querySelector('#margens')!.addEventListener('input', (ev) => {
  const alvo = ev.target as HTMLInputElement;
  const indice = Number(alvo.dataset['margem']);
  estado.margens[indice] = Number(alvo.value);
  document.querySelector(`#valor-margem-${indice}`)!.textContent = `${alvo.value} mm`;
  render();
});

ligar('#corte', (e) => (estado.mostrarCorte = e.checked));
ligar('#vertices', (e) => (estado.mostrarVertices = e.checked));
ligar('#encaixe', (e) => (estado.mostrarEncaixe = e.checked));
ligar('#desdobrar', (e) => {
  estado.desdobrar = e.checked;
  if (e.checked) estado.dividirEm = null;
  (document.querySelector('#dividir') as HTMLInputElement).checked = false;
  (document.querySelector('#altura-divisao') as HTMLElement).hidden = true;
});
ligar('#dividir', (e) => {
  estado.dividirEm = e.checked ? 200 : null;
  if (e.checked) estado.desdobrar = false;
  (document.querySelector('#desdobrar') as HTMLInputElement).checked = false;
  (document.querySelector('#altura-divisao') as HTMLElement).hidden = !e.checked;
});
ligar('#altura', (e) => {
  estado.dividirEm = Number(e.value);
  document.querySelector('#valor-altura')!.textContent = `${e.value} mm`;
});
ligar('#fillet', (e) => {
  estado.filletMM = Number(e.value);
  document.querySelector('#valor-fillet')!.textContent =
    estado.filletMM === 0 ? 'sem fillet' : `${estado.filletMM} mm`;
});
ligar('#modo', (e) => (estado.modo = e.value === 'proporcional' ? 'proporcional' : 'discreto'));
ligar('#vizinhos', (e) => {
  estado.nVizinhos = Number(e.value);
  document.querySelector('#valor-vizinhos')!.textContent = `${e.value} de cada lado`;
});
ligar('#tipo-pique', (e) => (estado.tipoPique = e.value as TipoPique));
ligar('#profundidade', (e) => {
  estado.profundidadeMM = Number(e.value);
  document.querySelector('#valor-profundidade')!.textContent = `${e.value} mm`;
});

document.querySelector('#desfazer')!.addEventListener('click', () => {
  estado.extras.pop();
  estado.selecao = null;
  render();
});
document.querySelector('#limpar')!.addEventListener('click', () => {
  estado.extras = [];
  estado.selecao = null;
  render();
});

montarControles();
marcarFerramenta();
render();

// O desenho le as cores dos tokens, entao precisa ser refeito quando o tema muda.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
