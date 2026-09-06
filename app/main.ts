/**
 * O editor de moldes.
 *
 * Esta camada nao decide nada: monta a tela, liga os paineis e repassa. Toda a
 * decisao mora em `@cad/editor` (puro, 89 testes headless) e toda a geometria em
 * `@cad/motor` (187 testes). Se a tela mostrar algo errado, o erro esta la embaixo
 * — e ha um teste que o pega.
 */
import {
  Editor,
  ferramentasAvancadas,
  ferramentaMoverPonto,
  ferramentaPique,
  ferramentaInserirPonto,
  ferramentaMedir,
  ferramentaMoverPeca,
  ferramentaSelecionar,
  Sessao,
  type Ferramenta,
  type OpcoesDeMover,
  type OpcoesDePique,
  type OpcoesDeCanto,
  type OpcoesDeDividir,
  type OpcoesDeLinha,
  type OpcoesDePar,
} from '@cad/editor';
import { PALETA_CLARA, PALETA_ESCURA, Tela, ligarEntrada } from '@cad/editor-pixi';
import {
  ALTURA_PADRAO_DO_PIQUE_UM,
  type Id,
  LARGURA_PADRAO_DO_PIQUE_UM,
  MM,
  criarGeradorMonotonico,
  medirAresta,
  umParaMM,
  type TipoPique,
} from '@cad/motor';

import { ARESTAS, MODELO, PECA, TENANT, logDaBlusa } from './peca.js';

// ------------------------------------------------------------------ estado

const opcoesDeMover: OpcoesDeMover = { modo: 'proporcional', nVizinhos: 2 };
const opcoesDePique: OpcoesDePique = {
  tipo: 'V',
  profundidadeMM: umParaMM(ALTURA_PADRAO_DO_PIQUE_UM),
  larguraMM: umParaMM(LARGURA_PADRAO_DO_PIQUE_UM),
};

const gerar = criarGeradorMonotonico();
const sessao = new Sessao(logDaBlusa(), {
  tenantId: TENANT,
  modeloId: MODELO,
  autor: 'modelista',
  gerarId: () => gerar(),
});

const opcoesDeCanto: OpcoesDeCanto = { medidaMM: 20 };
const opcoesDeDividir: OpcoesDeDividir = { margemMM: 10 };
const opcoesDePar: OpcoesDePar = { embebidoMM: 0 };
const opcoesDeLinha: OpcoesDeLinha = { tipo: 'fio' };
/** Segmentos com as alcas da Bezier a mostra. A ferramenta enche, a cena le. */
const segmentosAbertos = new Set<Id>();

const ferramentas: Ferramenta[] = [
  ferramentaSelecionar(),
  ferramentaMoverPonto(opcoesDeMover),
  ferramentaMoverPeca(),
  ferramentaPique(opcoesDePique),
  ferramentaInserirPonto(),
  ferramentaMedir(),
  ...ferramentasAvancadas({
    segmentosAbertos,
    canto: opcoesDeCanto,
    dividir: opcoesDeDividir,
    par: opcoesDePar,
    linha: opcoesDeLinha,
  }),
];

const editor = new Editor(sessao, ferramentas);
const estado = { encaixe: false };

// ------------------------------------------------------------------ tela

const escuro = (): boolean => globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
const tema = () => (escuro() ? { fundo: 0x0e1116, paleta: PALETA_ESCURA } : { fundo: 0xf4f6f8, paleta: PALETA_CLARA });

const palco = document.querySelector('#palco') as HTMLElement;
const tela = new Tela(editor, tema());
await tela.iniciar(palco);

editor.camera.enquadrar(editor.cena.caixa(), 48);

function redesenhar(): void {
  tela.render({ encaixe: estado.encaixe, comControleVisivel: segmentosAbertos }, true);
  atualizarPaineis();
}

ligarEntrada(palco, editor, redesenhar);
globalThis.addEventListener('resize', () => {
  tela.ajustar();
  conferirCamera();
  redesenhar();
});

/**
 * A camera tem que ter EXATAMENTE o tamanho do canvas.
 *
 * Ja esteve 20% menor numa tela com escala de 125% do Windows, e o efeito era
 * traicoeiro: o cursor mirava num lugar diferente do que a pessoa via, errando
 * mais quanto mais longe do centro. Nao da para testar isso headless — nao ha
 * canvas —, entao fica esta conferencia em desenvolvimento, que grita no console
 * em vez de deixar o defeito voltar em silencio.
 */
function conferirCamera(): void {
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV !== true) return;
  const erroX = Math.abs(editor.camera.largura - palco.clientWidth);
  const erroY = Math.abs(editor.camera.altura - palco.clientHeight);
  if (erroX > 1 || erroY > 1) {
    console.error(
      `A camera (${editor.camera.largura} x ${editor.camera.altura}) nao bate com o canvas ` +
        `(${palco.clientWidth} x ${palco.clientHeight}). O cursor vai mirar errado.`,
    );
  }
}
globalThis
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => tela.trocarTema(tema()));

// ------------------------------------------------------------------ paineis

const em = (seletor: string) => document.querySelector(seletor) as HTMLElement;
const mm = (um: number) => umParaMM(Math.round(um)).toFixed(1);

function atualizarPaineis(): void {
  const peca = editor.cena.derivados(PECA).peca;

  // Ficha: todo numero sai de uma funcao de medida do motor, nunca de conta daqui.
  const linhas: [string, string][] = [
    ['Tamanho', editor.cena.tamanho],
    ['Peças', String(editor.cena.pecas.length)],
    ['Piques', String(Object.keys(peca.piques).length)],
  ];

  // Largura de CORTE contra a util do papel: e ela que vai para o plotter.
  const corte = editor.cena.derivados(PECA).corte;
  if (corte.length > 0) {
    const largura = Math.max(...corte.map((p) => p.x)) - Math.min(...corte.map((p) => p.x));
    const papel = editor.cena.modelo.papel;
    linhas.push([
      'Largura do corte',
      papel === null
        ? `${mm(largura)} mm`
        : `${mm(largura)} / ${mm(papel.larguraUM - 2 * papel.margemDeSegurancaUM)} mm`,
    ]);
  }
  for (const aresta of ARESTAS) {
    if (peca.arestas[aresta.id] === undefined) continue;
    linhas.push([aresta.nome, `${mm(medirAresta(peca, aresta.id))} mm`]);
  }
  em('#ficha').innerHTML = linhas
    .map(([r, v]) => `<div class="linha"><span>${r}</span><b>${v}</b></div>`)
    .join('');

  // Conferencia (E14).
  const problemas = editor.cena.problemas;
  const alerta = em('#alerta');
  if (editor.recusa !== null) {
    alerta.className = 'alerta erro';
    alerta.textContent = `[${editor.recusa.codigo}] ${editor.recusa.message}`;
  } else if (problemas.length > 0) {
    alerta.className = 'alerta aviso';
    alerta.innerHTML = problemas.map((p) => `[${p.gravidade}] ${p.codigo}`).join('<br>');
  } else {
    alerta.className = 'alerta ok';
    alerta.textContent = 'Validador: nenhuma inconsistência.';
  }

  // Log de eventos: o que o mouse produziu, em ordem.
  const eventos = sessao.pendentes;
  em('#log').innerHTML =
    eventos.length === 0
      ? '<p class="nota">Nada ainda. Cada gesto entra aqui como evento — o desenho é o <em>fold</em> desta lista.</p>'
      : [...eventos]
          .map(
            (e, i) =>
              `<div class="evt"><span class="n">${String(i + 1).padStart(2, '0')}</span>` +
              `<span class="t">${e.tipo}</span></div>`,
          )
          .reverse()
          .join('');

  (em('#desfazer') as HTMLButtonElement).disabled = !sessao.podeDesfazer;
  (em('#refazer') as HTMLButtonElement).disabled = !sessao.podeRefazer;
  em('#opcoes-mover').hidden = editor.ferramenta !== 'moverPonto';
  em('#opcoes-pique').hidden = editor.ferramenta !== 'pique';
  em('#opcoes-canto').hidden = !['fillet', 'chanfro'].includes(editor.ferramenta);
  em('#opcoes-linha').hidden = editor.ferramenta !== 'linhaInterna';
  em('#opcoes-par').hidden = editor.ferramenta !== 'parCostura';
  em('#dica').textContent = DICAS[editor.ferramenta] ?? '';
  em('#contagem').textContent = `${editor.selecao.tamanho} selecionado(s)`;
}

// ------------------------------------------------------------- controles

const ATALHOS: Readonly<Record<string, string>> = {
  v: 'selecionar',
  m: 'moverPonto',
  g: 'moverPeca',
  n: 'pique',
  i: 'inserirPonto',
  l: 'medir',
  b: 'controle',
  c: 'converter',
  f: 'fillet',
  h: 'chanfro',
  r: 'rotacionar',
  e: 'espelhar',
  d: 'dividir',
  x: 'eixoDobra',
  p: 'parCostura',
  t: 'linhaInterna',
  k: 'gradePoint',
};

function marcarFerramenta(): void {
  document.querySelectorAll('#ferramentas button, #ferramentas-2 button').forEach((botao) => {
    botao.setAttribute(
      'aria-pressed',
      String((botao as HTMLElement).dataset['ferramenta'] === editor.ferramenta),
    );
  });
}

for (const barra of ['#ferramentas', '#ferramentas-2']) {
  em(barra).addEventListener('click', (ev) => {
    const botao = (ev.target as HTMLElement).closest('button');
    if (botao === null) return;
    editor.usar(botao.dataset['ferramenta']!);
    marcarFerramenta();
    redesenhar();
  });
}

globalThis.addEventListener('keydown', (ev) => {
  const foco = ev.target as HTMLElement | null;
  if (foco?.tagName === 'INPUT' || foco?.tagName === 'SELECT') return;
  const nome = ATALHOS[ev.key.toLowerCase()];
  if (nome !== undefined && !ev.ctrlKey && !ev.metaKey) {
    editor.usar(nome);
    marcarFerramenta();
    redesenhar();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) sessao.refazer();
    else sessao.desfazer();
    editor.selecao.podar(editor.cena);
    redesenhar();
  }
  if (ev.key === '0') {
    editor.camera.enquadrar(editor.cena.caixa(), 48);
    redesenhar();
  }
});

em('#desfazer').addEventListener('click', () => {
  sessao.desfazer();
  editor.selecao.podar(editor.cena);
  redesenhar();
});
em('#refazer').addEventListener('click', () => {
  sessao.refazer();
  redesenhar();
});
em('#enquadrar').addEventListener('click', () => {
  editor.camera.enquadrar(editor.cena.caixa(), 48);
  redesenhar();
});

// Tamanhos
const tamanhos = em('#tamanhos');
tamanhos.innerHTML = editor.cena.modelo.tamanhos
  .map((t) => `<button data-tamanho="${t}" aria-pressed="${t === editor.cena.tamanho}">${t}</button>`)
  .join('');
tamanhos.addEventListener('click', (ev) => {
  const botao = (ev.target as HTMLElement).closest('button');
  if (botao === null) return;
  editor.cena.tamanho = botao.dataset['tamanho']!;
  tamanhos.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset['tamanho'] === editor.cena.tamanho));
  });
  redesenhar();
});

// Camadas
const CAMADAS_NO_PAINEL = ['grade', 'corte', 'costura', 'interna', 'pique', 'gradePoint', 'texto'] as const;
em('#camadas').innerHTML = CAMADAS_NO_PAINEL.map(
  (c) => `
  <label class="opcao">
    <input type="checkbox" data-camada="${c}" checked> ${c}
    <input type="checkbox" data-travar="${c}" title="travar">
  </label>`,
).join('');
em('#camadas').addEventListener('change', (ev) => {
  const alvo = ev.target as HTMLInputElement;
  const camada = alvo.dataset['camada'] ?? alvo.dataset['travar'];
  if (camada === undefined) return;
  if (alvo.dataset['camada'] !== undefined) {
    editor.camadas.mostrar(camada as never, alvo.checked);
  } else {
    editor.camadas.travar(camada as never, alvo.checked);
  }
  redesenhar();
});

// Opcoes das ferramentas
(em('#modo') as HTMLSelectElement).addEventListener('change', (ev) => {
  opcoesDeMover.modo = (ev.target as HTMLSelectElement).value as 'discreto' | 'proporcional';
});
(em('#vizinhos') as HTMLInputElement).addEventListener('input', (ev) => {
  opcoesDeMover.nVizinhos = Number((ev.target as HTMLInputElement).value);
  em('#valor-vizinhos').textContent = `${opcoesDeMover.nVizinhos} de cada lado`;
});
(em('#tipo-pique') as HTMLSelectElement).addEventListener('change', (ev) => {
  opcoesDePique.tipo = (ev.target as HTMLSelectElement).value as TipoPique;
});
(em('#profundidade') as HTMLInputElement).addEventListener('input', (ev) => {
  opcoesDePique.profundidadeMM = Number((ev.target as HTMLInputElement).value);
  em('#valor-profundidade').textContent = `${opcoesDePique.profundidadeMM} mm`;
});
(em('#medida-canto') as HTMLInputElement).addEventListener('input', (ev) => {
  opcoesDeCanto.medidaMM = Number((ev.target as HTMLInputElement).value);
  em('#valor-canto').textContent = `${opcoesDeCanto.medidaMM} mm`;
});
(em('#tipo-linha') as HTMLSelectElement).addEventListener('change', (ev) => {
  opcoesDeLinha.tipo = (ev.target as HTMLSelectElement).value as OpcoesDeLinha['tipo'];
});
(em('#embebido') as HTMLInputElement).addEventListener('input', (ev) => {
  opcoesDePar.embebidoMM = Number((ev.target as HTMLInputElement).value);
  em('#valor-embebido').textContent = `${opcoesDePar.embebidoMM} mm`;
});
(em('#encaixe') as HTMLInputElement).addEventListener('change', (ev) => {
  estado.encaixe = (ev.target as HTMLInputElement).checked;
  redesenhar();
});

/** A frase que diz o que fazer com a ferramenta ativa. */
const DICAS: Readonly<Record<string, string>> = {
  selecionar: 'Clique, ou arraste uma caixa. Esquerda→direita pega o que está inteiro dentro; direita→esquerda pega o que a caixa toca.',
  moverPonto: 'Arraste um vértice. Com vários selecionados, o grupo anda junto e rígido.',
  moverPeca: 'Arraste a peça. Com várias selecionadas, todas andam num passo só.',
  pique: 'Clique no contorno para cravar. Arraste um pique para deslizá-lo na aresta; Delete tira.',
  inserirPonto: 'Clique no contorno: nasce um ponto. Alt+clique num ponto do meio exclui.',
  medir: 'Clique numa aresta para o comprimento dela, ou em dois lugares para a distância.',
  controle: 'Clique numa aresta para abrir as alças da curva; arraste uma alça para dar forma.',
  converter: 'Clique numa aresta: reta vira curva e curva vira reta. Converter não muda medida.',
  fillet: 'Clique num vértice para arredondar. O raio está aqui do lado.',
  chanfro: 'Clique num vértice para chanfrar. A distância está aqui do lado.',
  rotacionar: 'Arraste em volta da peça. Shift prende de 15 em 15 graus.',
  espelhar: 'Dois cliques definem o eixo do espelho.',
  dividir: 'Dois cliques definem por onde cortar. A peça vira duas, cada uma com margem nova.',
  eixoDobra: 'Dois cliques marcam o eixo de dobra.',
  parCostura: 'Clique em duas arestas de peças DIFERENTES para declarar que costuram juntas.',
  linhaInterna: 'Dois cliques e nasce a linha. Ela gradua junto com a peça.',
  gradePoint: 'Clique num vértice para marcar ou desmarcar o grade point.',
};

// Papel do plotter. O rolo e da casa, entao e evento de MODELO (pecaId null).
const MARGEM_DO_PLOTTER_MM = 10;
function aplicarPapel(larguraMM: number): void {
  sessao.aplicar({
    tipo: 'DefinirPapel',
    pecaId: null,
    payload: {
      papelId: 'papel',
      nome: `${larguraMM} mm`,
      larguraUM: Math.round(larguraMM * MM),
      margemDeSegurancaUM: Math.round(MARGEM_DO_PLOTTER_MM * MM),
    },
  });
  em('#valor-util').textContent = `${larguraMM - 2 * MARGEM_DO_PLOTTER_MM} mm úteis`;
}
(em('#papel') as HTMLSelectElement).addEventListener('change', (ev) => {
  aplicarPapel(Number((ev.target as HTMLSelectElement).value));
  redesenhar();
});
aplicarPapel(Number((em('#papel') as HTMLSelectElement).value));

// Entrada numerica (E10): o valor digitado ganha do ultimo pixel.
em('#exato').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const dx = Number((em('#dx') as HTMLInputElement).value);
  const dy = Number((em('#dy') as HTMLInputElement).value);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  editor.numero({ dx, dy });
  redesenhar();
});

// Margem por aresta, para a selecao de arestas.
em('#margem').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const valor = Number((em('#valor-margem') as HTMLInputElement).value);
  const arestas = editor.selecao.doTipo('aresta');
  if (arestas.length === 0 || !Number.isFinite(valor)) return;
  sessao.aplicar(
    ...arestas.map((ref) => ({
      tipo: 'DefinirMargem',
      pecaId: ref.pecaId,
      payload: { arestaId: ref.arestaId, margemUM: Math.round(valor * MM) },
    })),
  );
  redesenhar();
});

// Em desenvolvimento, o editor fica acessivel no console. Serve para conferir
// coordenada e estado sem adivinhar pixel — e some no build de producao.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV === true) {
  (globalThis as unknown as Record<string, unknown>)['editor'] = editor;
  (globalThis as unknown as Record<string, unknown>)['redesenhar'] = redesenhar;
}

marcarFerramenta();
conferirCamera();
redesenhar();
