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
  apagarRascunho,
  armazemDoNavegador,
  definirRegraGraduacao,
  duplicarPeca,
  ferramentasAvancadas,
  guardarRascunho,
  lerRascunho,
  passosDaGrade,
  removerPeca,
  renomearPeca,
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
import { exportarDxf } from '@cad/dxf';
import { gerarHpgl } from '@cad/plotter';
import { aplicarEncaixe, encaixar, encaixarBuscando, type Encaixe } from '@cad/encaixe';
import { calibrarComObjeto, digitalizar, objetoConhecidoMM, type Calibracao } from '@cad/foto';
import {
  CATALOGO,
  INSTRUCOES,
  PROVEDORES,
  acharFerramenta,
  SEM_LICENCA,
  acharProvedor,
  conferirIntegridade,
  contextoEmTexto,
  impressaoDoModelo,
  type Provedor,
  type Resposta,
  type Resultado,
  type Turno,
} from '@cad/ia';
import {
  ALTURA_PADRAO_DO_PIQUE_UM,
  type Id,
  LARGURA_PADRAO_DO_PIQUE_UM,
  MM,
  criarGeradorMonotonico,
  type Evento,
  medirAresta,
  offsetMargem,
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
const armazem = armazemDoNavegador(globalThis.localStorage);

/**
 * Abre com o log do modelo mais o RASCUNHO guardado.
 *
 * O rascunho e o que ficou pendente da ultima sessao: um travamento do navegador
 * nao pode custar a manha do modelista. Ele volta como pendente — nao como se ja
 * estivesse salvo —, porque salvo mesmo so depois que o servidor confirmar (E2).
 */
const guardado = lerRascunho(armazem, TENANT, MODELO);

/**
 * O log de abertura: o da blusa de exemplo, ou o que veio de uma foto.
 *
 * Digitalizar troca o modelo INTEIRO, e trocar em pe seria reconstruir sessao,
 * editor, camera, cena e todos os paineis. Guardar o log e recarregar faz o mesmo
 * pelo caminho que ja existe e ja e testado.
 */
function logDeAbertura(): Evento[] {
  const digitalizado = globalThis.localStorage.getItem('cad.moldes:log-digitalizado');
  if (digitalizado === null) return logDaBlusa();
  try {
    const eventos = JSON.parse(digitalizado) as Evento[];
    if (Array.isArray(eventos) && eventos.length > 0) return eventos;
  } catch {
    // Log guardado ilegivel: cai no exemplo em vez de abrir a tela em branco.
  }
  return logDaBlusa();
}

const sessao = new Sessao(logDeAbertura(), {
  tenantId: TENANT,
  modeloId: MODELO,
  autor: 'modelista',
  gerarId: () => gerar(),
});
if (guardado.length > 0) {
  sessao.aplicar(
    ...guardado.map((e) => ({ tipo: e.tipo, pecaId: e.pecaId, payload: e.payload })),
  );
}

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

const em = <T extends HTMLElement = HTMLElement>(seletor: string): T =>
  document.querySelector(seletor) as T;
const mm = (um: number) => umParaMM(Math.round(um)).toFixed(1);

function atualizarPaineis(): void {
  const alvo = editor.cena.pecas.includes(pecaAtiva) ? pecaAtiva : (editor.cena.pecas[0] ?? PECA);
  const peca = editor.cena.derivados(alvo).peca;

  // Ficha: todo numero sai de uma funcao de medida do motor, nunca de conta daqui.
  const linhas: [string, string][] = [
    ['Tamanho', editor.cena.tamanho],
    ['Peças', String(editor.cena.pecas.length)],
    ['Piques', String(Object.keys(peca.piques).length)],
  ];

  // Largura de CORTE contra a util do papel: e ela que vai para o plotter.
  const corte = editor.cena.derivados(alvo).corte;
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
    // Erro e ERRO: vermelho, com a mensagem inteira e na frente da lista. Estava
    // tudo saindo amarelo, e um contorno que dobra sobre si mesmo — a peca nao vai
    // para o corte assim — aparecia com a mesma cara de um aviso de rotina.
    const erros = problemas.filter((p) => p.gravidade === 'erro');
    const avisos = problemas.filter((p) => p.gravidade !== 'erro');
    alerta.className = erros.length > 0 ? 'alerta erro' : 'alerta aviso';
    alerta.innerHTML = [
      ...erros.map((p) => `<b>[erro] ${p.codigo}</b><br>${p.mensagem}`),
      ...avisos.map((p) => `[aviso] ${p.codigo}`),
    ].join('<br>');
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

  atualizarPecas();
  atualizarGraduacao();
  guardarEAvisar();
}

/** Lista de pecas, com a ativa marcada. */
let pecaAtiva = PECA;
function atualizarPecas(): void {
  const pecas = editor.cena.pecas;
  if (!pecas.includes(pecaAtiva)) pecaAtiva = pecas[0] ?? PECA;
  em('#pecas').innerHTML = pecas
    .map((id) => {
      const nome = editor.cena.modelo.pecas[id]!.metadados.nome;
      return `<div class="linha" data-peca="${id}" style="cursor:pointer">
        <span>${id === pecaAtiva ? '▸ ' : ''}${nome}</span><b>${id}</b></div>`;
    })
    .join('');
}
em('#pecas').addEventListener('click', (ev) => {
  const linha = (ev.target as HTMLElement).closest('[data-peca]') as HTMLElement | null;
  if (linha === null) return;
  pecaAtiva = linha.dataset['peca']!;
  redesenhar();
});

/**
 * A tabela de graduacao: uma linha por grade point, uma coluna por PASSO da grade.
 *
 * O incremento e entre tamanhos consecutivos (D8), e grade point sem regra e a
 * ancora (D7) — por isso a celula vazia e um estado legitimo, nao um erro.
 */
function atualizarGraduacao(): void {
  const modelo = editor.cena.modelo;
  const peca = modelo.pecas[pecaAtiva];
  if (peca === undefined) {
    em('#graduacao').innerHTML = '';
    return;
  }
  const passos = passosDaGrade(modelo);
  const linhas = Object.values(peca.gradePoints).map((gp) => {
    const celulas = passos
      .map(([de, para]) => {
        const regra = Object.values(modelo.regrasGraduacao).find(
          (r) => r.pontoGraduacaoId === gp.id && r.deTamanho === de && r.paraTamanho === para,
        );
        const dx = regra === undefined ? '' : umParaMM(regra.dx).toFixed(0);
        const dy = regra === undefined ? '' : umParaMM(regra.dy).toFixed(0);
        return (
          `<input type="number" step="0.5" placeholder="dx" value="${dx}" ` +
          `data-gp="${gp.id}" data-de="${de}" data-para="${para}" data-eixo="x" style="width:52px">` +
          `<input type="number" step="0.5" placeholder="dy" value="${dy}" ` +
          `data-gp="${gp.id}" data-de="${de}" data-para="${para}" data-eixo="y" style="width:52px">`
        );
      })
      .join(' ');
    return `<div class="linha"><span>${gp.pontoId}</span><b>${celulas}</b></div>`;
  });
  em('#graduacao').innerHTML =
    `<div class="linha"><span>ponto</span><b>${passos.map(([a, b]) => `${a}→${b}`).join('&nbsp;&nbsp;&nbsp;&nbsp;')}</b></div>` +
    linhas.join('');
}

em('#graduacao').addEventListener('change', (ev) => {
  const campo = ev.target as HTMLInputElement;
  const gp = campo.dataset['gp'];
  if (gp === undefined) return;
  const de = campo.dataset['de']!;
  const para = campo.dataset['para']!;
  const irmao = em('#graduacao').querySelector<HTMLInputElement>(
    `input[data-gp="${gp}"][data-de="${de}"][data-eixo="${campo.dataset['eixo'] === 'x' ? 'y' : 'x'}"]`,
  );
  const meu = Number(campo.value);
  const outro = Number(irmao?.value ?? '0');
  const dx = campo.dataset['eixo'] === 'x' ? meu : outro;
  const dy = campo.dataset['eixo'] === 'x' ? outro : meu;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  sessao.aplicar(
    ...definirRegraGraduacao(sessao.modelo, gp, de, para, dx, dy, `${gp}-${de}-${sessao.versao}`),
  );
  redesenhar();
});

// --------------------------------------------------------------- arquivo

/** Guarda o rascunho a cada mudanca e conta para a interface como esta. */
function guardarEAvisar(): void {
  const guardou = guardarRascunho(armazem, TENANT, MODELO, sessao.pendentes);
  const quantos = sessao.pendentes.length;
  em('#estado-salvo').textContent =
    quantos === 0
      ? 'Nada pendente.'
      : guardou
        ? `${quantos} evento(s) pendente(s), guardados no navegador.`
        : `${quantos} pendente(s) — NAO foi possivel guardar no navegador.`;
}

em('#salvar').addEventListener('click', () => {
  // Sem backend configurado, "salvar" e selar o que ja esta guardado localmente.
  // O caminho de rede (`salvar` do @cad/editor) entra quando houver API e token.
  sessao.selar();
  apagarRascunho(armazem, TENANT, MODELO);
  redesenhar();
});
em('#descartar').addEventListener('click', () => {
  while (sessao.podeDesfazer) sessao.desfazer();
  editor.selecao.podar(editor.cena);
  apagarRascunho(armazem, TENANT, MODELO);
  redesenhar();
});

/**
 * Baixa um arquivo de texto.
 *
 * Enquanto nao ha o wrap Tauri (Fase 4), quem manda para a maquina e o operador,
 * pela ferramenta que ele ja usa. Navegador nao tem porta serial confiavel no chao
 * de fabrica, e fingir que tem seria pior que baixar o arquivo.
 */
function baixar(nome: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

em('#exportar-dxf').addEventListener('click', () => {
  const { dxf, problemas } = exportarDxf(sessao.modelo, { tamanho: editor.cena.tamanho });
  baixar(`${MODELO}-${editor.cena.tamanho}.dxf`, dxf);
  if (problemas.length > 0) {
    em('#estado-salvo').textContent = `DXF gerado com ${problemas.length} problema(s): ${problemas[0]!.codigo}`;
  }
});

em('#exportar-hpgl').addEventListener('click', () => {
  const saida = gerarHpgl(sessao.modelo, { tamanho: editor.cena.tamanho, comCostura: true });
  baixar(`${MODELO}-${editor.cena.tamanho}.plt`, saida.hpgl);
  em('#estado-salvo').textContent =
    `HPGL: ${saida.pecasPlotadas} peça(s), ${mm(saida.comprimentoUsadoUM)} mm de rolo` +
    (saida.problemas.length > 0 ? ` | ${saida.problemas.length} problema(s)` : '');
});

/**
 * O encaixe da vez. Guardado porque as tres acoes do painel — a conta, o risco e o
 * HPGL — tem que falar do MESMO encaixe: recalcular a cada clique daria tres
 * arranjos parecidos e diferentes, e o operador cortaria por um enquanto olha outro.
 */
let encaixeAtual: Encaixe | null = null;

/**
 * Adota um encaixe como o da vez e conta na tela.
 *
 * Separado de `rodarEncaixe` porque o encaixe pode vir de dois lugares — do botão
 * ou da busca que a IA dispara — e os dois têm que alimentar o MESMO encaixe. Se
 * cada um guardasse o seu, o risco na tela e o HPGL baixado seriam arranjos
 * diferentes, e o operador cortaria por um olhando o outro.
 */
function guardarEncaixe(e: Encaixe): Encaixe {
  encaixeAtual = e;
  const erros = e.problemas.filter((p) => p.gravidade === 'erro');
  em('#estado-encaixe').textContent =
    e.colocacoes.length === 0
      ? `Nada encaixado: ${e.problemas[0]?.mensagem ?? 'sem peças.'}`
      : `${e.colocacoes.length} peça(s) em ${mm(e.comprimentoUsadoUM)} mm de ` +
        `rolo (${mm(e.larguraUtilUM)} mm úteis) | aproveitamento ` +
        `${(e.aproveitamento * 100).toFixed(1)}%` +
        (erros.length > 0 ? ` | ${erros.length} peça(s) recusada(s): ${erros[0]!.mensagem}` : '');
  return e;
}

function rodarEncaixe(): Encaixe {
  return guardarEncaixe(encaixar(sessao.modelo, { tamanho: editor.cena.tamanho }));
}

const encaixeVigente = (): Encaixe => encaixeAtual ?? rodarEncaixe();

/**
 * O risco em SVG: a faixa do tecido e a linha de CORTE de cada peca, onde o
 * encaixe a pos. E o desenho que o corte confere antes de gastar o rolo.
 */
function svgDoRisco(encaixe: Encaixe): string {
  const postas = aplicarEncaixe(sessao.modelo, encaixe, editor.cena.tamanho);
  const larguraMM = encaixe.larguraUtilUM / MM;
  const comprimentoMM = Math.max(1, encaixe.comprimentoUsadoUM / MM);
  const caminhos = postas
    .map(({ peca }) => {
      const corte = offsetMargem(peca).pontos;
      const d = corte.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x / MM).toFixed(1)},${(p.y / MM).toFixed(1)}`).join(' ');
      const cx = corte.reduce((s, p) => s + p.x, 0) / corte.length / MM;
      const cy = corte.reduce((s, p) => s + p.y, 0) / corte.length / MM;
      return (
        `<path d="${d} Z" fill="#e8eef6" stroke="#1b3a5c" stroke-width="1.2"/>` +
        `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-size="14" text-anchor="middle" ` +
        `fill="#1b3a5c">${peca.metadados.nome}</text>`
      );
    })
    .join('\n');
  // O SVG e desenhado em MILIMETROS, com y para baixo: e como o risco sai no papel.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${larguraMM.toFixed(0)}mm" ` +
    `height="${comprimentoMM.toFixed(0)}mm" viewBox="0 0 ${larguraMM.toFixed(1)} ${comprimentoMM.toFixed(1)}">\n` +
    `<rect x="0" y="0" width="${larguraMM.toFixed(1)}" height="${comprimentoMM.toFixed(1)}" ` +
    `fill="#fff" stroke="#c33" stroke-width="1.5" stroke-dasharray="8 6"/>\n${caminhos}\n</svg>\n`
  );
}

em('#encaixar').addEventListener('click', () => {
  rodarEncaixe();
});

/**
 * O risco aparece POR CIMA do editor, e nao numa aba nova.
 *
 * Aba nova morre em bloqueador de popup, e vai morrer de novo dentro do wrap
 * Tauri, onde nao ha aba nenhuma. O operador que quer o arquivo tem o botao de
 * baixar ali do lado.
 */
em('#ver-risco').addEventListener('click', () => {
  const encaixe = encaixeVigente();
  em('#risco-papel').innerHTML = svgDoRisco(encaixe);
  em('#risco-conta').textContent =
    `${encaixe.colocacoes.length} peça(s) · ${mm(encaixe.larguraUtilUM)} × ` +
    `${mm(encaixe.comprimentoUsadoUM)} mm · aproveitamento ` +
    `${(encaixe.aproveitamento * 100).toFixed(1)}%`;
  em('#risco').hidden = false;
});

const fecharRisco = (): void => {
  em('#risco').hidden = true;
  em('#risco-papel').innerHTML = '';
};
em('#risco-fechar').addEventListener('click', fecharRisco);
em('#risco').addEventListener('click', (evento) => {
  if (evento.target === em('#risco') || evento.target === em('#risco-papel')) fecharRisco();
});
em('#risco-baixar').addEventListener('click', () => {
  baixar(`${MODELO}-${editor.cena.tamanho}-risco.svg`, svgDoRisco(encaixeVigente()));
});

em('#exportar-hpgl-encaixe').addEventListener('click', () => {
  const encaixe = encaixeVigente();
  const postas = aplicarEncaixe(sessao.modelo, encaixe, editor.cena.tamanho).map((c) => c.peca);
  const saida = gerarHpgl(sessao.modelo, {
    tamanho: editor.cena.tamanho,
    comCostura: true,
    pecasPostas: postas,
  });
  baixar(`${MODELO}-${editor.cena.tamanho}-encaixado.plt`, saida.hpgl);
  em('#estado-encaixe').textContent =
    `HPGL encaixado: ${saida.pecasPlotadas} peça(s), ${mm(saida.comprimentoUsadoUM)} mm de rolo` +
    (saida.problemas.length > 0 ? ` | ${saida.problemas.length} problema(s)` : '');
});

// ------------------------------------------------------- digitalizar por foto

/**
 * O log digitalizado, guardado no navegador entre recargas.
 *
 * Trocar o modelo inteiro em pé é reconstruir sessão, editor, câmera, cena e todos
 * os painéis. Guardar o log e recarregar a página faz a mesma coisa com uma linha e
 * sem um caminho paralelo para dar manutenção — e o caminho de abrir já existe e
 * está testado.
 */
const CHAVE_DIGITALIZADO = 'cad.moldes:log-digitalizado';

function calibracaoDaTela(): Calibracao {
  const ler = (id: string): number => Math.round(Number(em<HTMLInputElement>(id).value) * MM);
  return {
    id: 'cal-atelie',
    tenantId: TENANT,
    nome: 'quadro do ateliê',
    larguraUM: ler('#cal-largura'),
    alturaUM: ler('#cal-altura'),
    diagonal1UM: ler('#cal-diag1'),
    diagonal2UM: ler('#cal-diag2'),
  };
}

/** Decodifica a foto pelo navegador: o pacote `@cad/foto` não lê JPEG de propósito. */
async function lerImagem(arquivo: File): Promise<{
  largura: number;
  altura: number;
  dados: Uint8ClampedArray;
}> {
  const bitmap = await createImageBitmap(arquivo);
  // As medidas saem ANTES do `close`: bitmap fechado devolve zero, e a foto
  // inteira virava uma imagem 0 × 0 sem um erro sequer pelo caminho — a
  // digitalização só dizia "nenhuma marca de borda encontrada".
  const largura = bitmap.width;
  const altura = bitmap.height;
  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const ctx = tela.getContext('2d');
  if (ctx === null) throw new Error('O navegador não deu contexto 2D para ler a foto.');
  ctx.drawImage(bitmap, 0, 0);
  const dados = ctx.getImageData(0, 0, largura, altura);
  bitmap.close();
  return { largura, altura, dados: dados.data };
}

em('#digitalizar').addEventListener('click', () => {
  const entrada = em<HTMLInputElement>('#foto-arquivo');
  const arquivo = entrada.files?.[0];
  if (arquivo === undefined) {
    em('#estado-foto').textContent = 'Escolha a foto primeiro.';
    return;
  }
  em('#estado-foto').textContent = 'Lendo a foto…';

  void (async () => {
    try {
      const imagem = await lerImagem(arquivo);
      // Guardada para `redigitalizar_foto`: quando a pessoa disser "a borda ficou
      // estranha", a IA tenta de novo na MESMA foto com outros ajustes, sem obrigar
      // ninguém a procurar o arquivo outra vez.
      ultimaFoto = imagem;
      const d = digitalizar(imagem, {
        tenantId: TENANT,
        modeloId: MODELO,
        autor: 'modelista',
        gerarId: () => gerar(),
        calibracao: calibracaoDaTela(),
      });

      const erros = d.problemas.filter((p) => p.gravidade === 'erro');
      if (erros.length > 0 || d.eventos.length === 0) {
        // Recusa é o comportamento certo (I9): nada entra pela metade.
        em('#estado-foto').textContent = `Recusado. ${erros[0]?.mensagem ?? 'Sem peças na foto.'}`;
        return;
      }

      globalThis.localStorage.setItem(CHAVE_DIGITALIZADO, JSON.stringify(d.eventos));
      apagarRascunho(armazem, TENANT, MODELO);
      const avisos = d.problemas.filter((p) => p.gravidade === 'aviso');
      em('#estado-foto').textContent =
        `${d.pecas.length} peça(s), ${mm(d.umPorPixel)} mm por pixel` +
        (avisos.length > 0 ? ` | ${avisos.length} aviso(s)` : '') +
        ' — recarregando…';
      globalThis.setTimeout(() => globalThis.location.reload(), 400);
    } catch (erro) {
      em('#estado-foto').textContent = `Não deu para ler a foto: ${String(erro)}`;
    }
  })();
});

/**
 * A calibração fica guardada no navegador porque ela é do ATELIÊ, não do modelo
 * (decisão I8): vale para toda foto tirada naquele quadro, hoje e daqui a um ano.
 */
const CHAVE_CALIBRACAO = 'cad.moldes:calibracao';

function guardarCalibracao(c: Calibracao): void {
  globalThis.localStorage.setItem(CHAVE_CALIBRACAO, JSON.stringify(c));
  em<HTMLInputElement>('#cal-largura').value = (c.larguraUM / MM).toFixed(0);
  em<HTMLInputElement>('#cal-altura').value = (c.alturaUM / MM).toFixed(0);
  em<HTMLInputElement>('#cal-diag1').value = (c.diagonal1UM / MM).toFixed(0);
  em<HTMLInputElement>('#cal-diag2').value = (c.diagonal2UM / MM).toFixed(0);
}

// Ao abrir, a calibração guardada volta para os campos.
{
  const guardada = globalThis.localStorage.getItem(CHAVE_CALIBRACAO);
  if (guardada !== null) {
    try {
      guardarCalibracao(JSON.parse(guardada) as Calibracao);
    } catch {
      // Calibração ilegível: fica o padrão da tela, e o operador refaz.
    }
  }
}

em('#calibrar').addEventListener('click', () => {
  const arquivo = em<HTMLInputElement>('#foto-arquivo').files?.[0];
  if (arquivo === undefined) {
    em('#estado-foto').textContent = 'Escolha primeiro a foto do objeto de calibração.';
    return;
  }
  const numero = (id: string): number => Number(em<HTMLInputElement>(id).value);
  em('#estado-foto').textContent = 'Calibrando…';

  void (async () => {
    try {
      const imagem = await lerImagem(arquivo);
      const c = calibrarComObjeto(
        imagem,
        objetoConhecidoMM(numero('#obj-largura'), numero('#obj-altura'), numero('#obj-diag')),
        { tenantId: TENANT },
      );
      if (c.calibracao === null) {
        em('#estado-foto').textContent =
          `Calibração recusada. ${c.problemas.find((p) => p.gravidade === 'erro')?.mensagem ?? ''}`;
        return;
      }
      guardarCalibracao(c.calibracao);
      em('#estado-foto').textContent =
        `Quadro: ${mm(c.calibracao.larguraUM)} × ${mm(c.calibracao.alturaUM)} mm | ` +
        `conferência da diagonal: ${c.erroDaDiagonalUM === null ? 'não medida' : `${mm(c.erroDaDiagonalUM)} mm de erro`} | ` +
        `${mm(c.umPorPixel)} mm por pixel`;
    } catch (erro) {
      em('#estado-foto').textContent = `Não deu para ler a foto: ${String(erro)}`;
    }
  })();
});

em('#voltar-exemplo').addEventListener('click', () => {
  globalThis.localStorage.removeItem(CHAVE_DIGITALIZADO);
  apagarRascunho(armazem, TENANT, MODELO);
  globalThis.location.reload();
});

em('#duplicar').addEventListener('click', () => {
  sessao.aplicar(...duplicarPeca(sessao.modelo, pecaAtiva, `cp${sessao.versao}`));
  redesenhar();
});
em('#renomear').addEventListener('click', () => {
  const atual = sessao.modelo.pecas[pecaAtiva]?.metadados.nome ?? '';
  const nome = globalThis.prompt('Nome da peça', atual);
  if (nome === null || nome.trim() === '') return;
  sessao.aplicar(...renomearPeca(sessao.modelo, pecaAtiva, nome.trim()));
  redesenhar();
});
em('#remover-peca').addEventListener('click', () => {
  if (editor.cena.pecas.length <= 1) return;
  sessao.aplicar(...removerPeca(sessao.modelo, pecaAtiva));
  editor.selecao.podar(editor.cena);
  redesenhar();
});

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
  moverPonto: 'Arraste um vértice — ou arraste em cima da linha, e o ponto nasce ali. Com vários selecionados, o grupo anda junto e rígido.',
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
  const larguraUM = Math.round(larguraMM * MM);
  const margemUM = Math.round(MARGEM_DO_PLOTTER_MM * MM);
  const atual = sessao.modelo.papel;
  // Ja e esse rolo: nao emite. Sem isto, cada recarga da pagina acrescentava um
  // `DefinirPapel` identico ao log — inofensivo no fold, mas lixo que so cresce.
  if (atual !== null && atual.larguraUM === larguraUM && atual.margemDeSegurancaUM === margemUM) {
    em('#valor-util').textContent = `${larguraMM - 2 * MARGEM_DO_PLOTTER_MM} mm úteis`;
    return;
  }
  sessao.aplicar({
    tipo: 'DefinirPapel',
    pecaId: null,
    payload: {
      papelId: 'papel',
      nome: `${larguraMM} mm`,
      larguraUM,
      margemDeSegurancaUM: margemUM,
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


// ------------------------------------------------------------------------ IA

/**
 * O assistente.
 *
 * ## Onde a segurança mora
 * Tudo o que a IA faz vira **gesto**, e todo gesto passa pela mesma `sessao.aplicar`
 * que o mouse usa — que reconstrói o log inteiro antes de aceitar. Uma ação errada
 * dela falha alto, com a mensagem do próprio motor, e essa mensagem volta para o
 * modelo como resultado da ferramenta: ele lê, entende e corrige. Não existe atalho
 * para o estado; se existisse, as garantias das seis fases valeriam só para o mouse.
 *
 * E porque é gesto, `Ctrl+Z` desfaz o que ela fez exatamente como desfaz o que a
 * pessoa fez.
 *
 * ## A chave e o provedor
 * A conversa é guardada em `Turno[]`, que não é o formato de provedor nenhum: cada
 * um serializa a conversa inteira do seu jeito na hora de mandar. Trocar de modelo
 * no meio da conversa funciona de graça.
 *
 * A chave é do cliente, fica no navegador dele, e viaja só para o provedor
 * escolhido. Não há servidor nosso no caminho.
 */
const CHAVE_API = 'cad.moldes:chave-ia';
const CHAVE_PROVEDOR = 'cad.moldes:provedor-ia';
const CHAVE_MODELO_IA = 'cad.moldes:modelo-ia';
const CHAVE_BASE = 'cad.moldes:base-ia';

const conversa: Turno[] = [];
/** A última foto lida, para `redigitalizar_foto` poder tentar de novo com outros ajustes. */
let ultimaFoto: { largura: number; altura: number; dados: Uint8ClampedArray } | null = null;

const iaEstado = (t: string): void => {
  em('#ia-estado').textContent = t;
};

function falar(quem: string, corpo: string, classe = ''): void {
  const div = document.createElement('div');
  div.className = `ia-fala ${classe}`;
  div.innerHTML = `<span class="quem"></span><div class="corpo"></div>`;
  (div.querySelector('.quem') as HTMLElement).textContent = quem;
  (div.querySelector('.corpo') as HTMLElement).textContent = corpo;
  em('#ia-conversa').append(div);
  em('#ia-conversa').scrollTop = em('#ia-conversa').scrollHeight;
}

function anotarFerramenta(texto: string, falhou = false): void {
  const div = document.createElement('div');
  div.className = `ia-ferramenta${falhou ? ' falhou' : ''}`;
  div.textContent = texto;
  em('#ia-conversa').append(div);
  em('#ia-conversa').scrollTop = em('#ia-conversa').scrollHeight;
}

const provedorAtual = (): Provedor =>
  acharProvedor(globalThis.localStorage.getItem(CHAVE_PROVEDOR) ?? 'anthropic') ?? PROVEDORES[0]!;

/** Executa o que a ferramenta devolveu, e diz ao modelo o que aconteceu. */
/** A ferramenta que esta sendo executada — e a licenca dela que a guarda usa. */
let ferramentaAtual: { licenca?: typeof SEM_LICENCA } | null = null;

function executarResultado(r: Resultado): { texto: string; falhou: boolean } {
  const aplicar = (
    gestos: readonly { tipo: string; pecaId: string | null; payload: unknown }[],
    resumo: string,
  ) => {
    // A impressão digital de cada peça ANTES: é com ela que se prova, depois, que a
    // IA não adulterou molde para caber melhor no tecido.
    const antes = impressaoDoModelo(sessao.modelo);
    const nomes = Object.fromEntries(
      Object.entries(sessao.modelo.pecas).map(([id, p]) => [id, p.metadados.nome]),
    );

    try {
      sessao.aplicar(...gestos);
    } catch (e) {
      // A mensagem do motor volta INTEIRA: é ela que ensina o modelo a corrigir.
      return { texto: `O motor recusou: ${String(e)}`, falhou: true };
    }

    // A GUARDA. Se a ação mudou a FORMA de alguma peça sem ter licença para isso,
    // ela é DESFEITA — não avisada e mantida.
    //
    // "Otimize o espaço" tem, para um modelo de linguagem, uma saída tentadora e
    // catastrófica: encolher a peça. Cortar 5 mm da cava economiza tecido e a roupa
    // não fecha. Instrução no prompt é pedido; o que impede é invariante.
    const violacoes = conferirIntegridade(
      antes,
      impressaoDoModelo(sessao.modelo),
      ferramentaAtual?.licenca ?? SEM_LICENCA,
      nomes,
    );
    if (violacoes.length > 0) {
      sessao.desfazer();
      editor.selecao.podar(editor.cena);
      redesenhar();
      return {
        texto:
          `RECUSADO e desfeito. ${violacoes.join(' ')} ` +
          `Molde não se altera para caber no tecido: quem decide forma é a pessoa.`,
        falhou: true,
      };
    }

    editor.selecao.podar(editor.cena);
    redesenhar();
    return { texto: `Feito. ${resumo}`, falhou: false };
  };

  switch (r.tipo) {
    case 'leitura':
      return { texto: r.texto, falhou: false };
    case 'erro':
      return { texto: r.mensagem, falhou: true };
    case 'gestos':
      return aplicar(r.gestos, r.resumo);
    case 'confirmar':
      return globalThis.confirm(r.pergunta)
        ? aplicar(r.gestos, r.resumo)
        : { texto: 'A pessoa NÃO confirmou. Nada foi alterado.', falhou: false };
    case 'acao':
      return executarAcao(r);
  }
}

/** As ações que são da aplicação, não do modelo. */
function executarAcao(r: Extract<Resultado, { tipo: 'acao' }>): { texto: string; falhou: boolean } {
  try {
    switch (r.acao) {
      case 'enquadrar':
        editor.camera.enquadrar(editor.cena.caixa(), 48);
        redesenhar();
        return { texto: 'Vista enquadrada.', falhou: false };

      case 'mostrar_tamanho': {
        const alvo = String(r.argumentos.tamanho ?? '');
        if (!sessao.modelo.tamanhos.includes(alvo)) {
          return {
            texto: `Não existe o tamanho "${alvo}". Os tamanhos são: ${sessao.modelo.tamanhos.join(', ')}.`,
            falhou: true,
          };
        }
        editor.cena.tamanho = alvo;
        redesenhar();
        return { texto: `A tela mostra agora o tamanho ${alvo}.`, falhou: false };
      }

      case 'desfazer': {
        const quantos = Math.max(1, Math.floor(Number(r.argumentos.quantos ?? 1)));
        let feitos = 0;
        while (feitos < quantos && sessao.podeDesfazer) {
          sessao.desfazer();
          feitos++;
        }
        editor.selecao.podar(editor.cena);
        redesenhar();
        return {
          texto:
            feitos === 0
              ? 'Não havia nada para desfazer.'
              : `Voltei ${feitos} passo(s).${feitos < quantos ? ' Não havia mais para voltar.' : ''}`,
          falhou: false,
        };
      }

      case 'refazer': {
        if (!sessao.podeRefazer) return { texto: 'Não havia nada para refazer.', falhou: false };
        sessao.refazer();
        editor.selecao.podar(editor.cena);
        redesenhar();
        return { texto: 'Refeito.', falhou: false };
      }

      case 'descartar_alteracoes': {
        if (!globalThis.confirm('Jogar fora TODAS as alterações e voltar ao desenho original?')) {
          return { texto: 'A pessoa NÃO confirmou. Nada foi descartado.', falhou: false };
        }
        em<HTMLButtonElement>('#descartar').click();
        return { texto: 'Tudo descartado; o desenho voltou ao original.', falhou: false };
      }

      case 'redigitalizar_foto': {
        if (ultimaFoto === null) {
          return {
            texto:
              'Não há foto carregada nesta sessão. Peça à pessoa para escolher a foto no ' +
              'painel "Digitalizar foto" e clicar em digitalizar uma vez.',
            falhou: true,
          };
        }
        const tolMM = Number(r.argumentos.tolerancia_mm);
        const cor = Number(r.argumentos.sensibilidade_cor);
        const d = digitalizar(ultimaFoto, {
          tenantId: TENANT,
          modeloId: MODELO,
          autor: 'ia',
          gerarId: () => gerar(),
          calibracao: calibracaoDaTela(),
          ...(Number.isFinite(tolMM) && tolMM > 0 ? { toleranciaUM: Math.round(tolMM * MM) } : {}),
          ...(Number.isFinite(cor) && cor > 0 ? { limiarCroma: Math.round(cor) } : {}),
        });
        const erros = d.problemas.filter((p) => p.gravidade === 'erro');
        if (erros.length > 0 || d.eventos.length === 0) {
          return { texto: erros[0]?.mensagem ?? 'Nada foi lido da foto.', falhou: true };
        }
        globalThis.localStorage.setItem(CHAVE_DIGITALIZADO, JSON.stringify(d.eventos));
        apagarRascunho(armazem, TENANT, MODELO);
        globalThis.setTimeout(() => globalThis.location.reload(), 600);
        return {
          texto:
            `Li a foto de novo: ${d.pecas.length} peça(s), tolerância ` +
            `${mm(d.toleranciaUM)} mm. A tela vai recarregar com o resultado.`,
          falhou: false,
        };
      }

      case 'encaixar': {
        const e = rodarEncaixe();
        if (e.colocacoes.length === 0) {
          return { texto: e.problemas[0]?.mensagem ?? 'Nada encaixado.', falhou: true };
        }
        return {
          texto:
            `${e.colocacoes.length} peça(s) em ${mm(e.comprimentoUsadoUM)} mm de rolo ` +
            `(largura útil ${mm(e.larguraUtilUM)} mm), aproveitamento ` +
            `${(e.aproveitamento * 100).toFixed(1)}%.`,
          falhou: false,
        };
      }

      case 'otimizar_encaixe': {
        const tentativas = Math.max(1, Math.floor(Number(r.argumentos.tentativas ?? 12)));
        const simples = encaixar(sessao.modelo, { tamanho: editor.cena.tamanho });
        if (simples.colocacoes.length === 0) {
          return { texto: simples.problemas[0]?.mensagem ?? 'Nada encaixado.', falhou: true };
        }
        const busca = encaixarBuscando(sessao.modelo, { tamanho: editor.cena.tamanho }, tentativas);
        guardarEncaixe(busca.melhor);
        const ganho =
          ((simples.comprimentoUsadoUM - busca.melhor.comprimentoUsadoUM) /
            simples.comprimentoUsadoUM) *
          100;
        return {
          texto:
            `Testei ${busca.tentadas} arranjos. O normal gasta ${mm(simples.comprimentoUsadoUM)} mm ` +
            `de rolo; o melhor gasta ${mm(busca.melhor.comprimentoUsadoUM)} mm — ` +
            `${ganho <= 0.05 ? 'não deu para melhorar neste molde' : `${ganho.toFixed(1)}% de economia`}. ` +
            `Aproveitamento ${(busca.melhor.aproveitamento * 100).toFixed(1)}%.`,
          falhou: false,
        };
      }

      case 'exportar': {
        const formato = String(r.argumentos.formato ?? '');
        if (formato === 'dxf') {
          em<HTMLButtonElement>('#exportar-dxf').click();
          return { texto: 'DXF baixado.', falhou: false };
        }
        if (formato === 'risco') {
          em<HTMLButtonElement>('#ver-risco').click();
          return { texto: 'Risco aberto na tela.', falhou: false };
        }
        if (formato === 'hpgl') {
          const encaixado = r.argumentos.encaixado !== false;
          em<HTMLButtonElement>(encaixado ? '#exportar-hpgl-encaixe' : '#exportar-hpgl').click();
          return {
            texto: `HPGL ${encaixado ? 'encaixado' : 'enfileirado'} baixado.`,
            falhou: false,
          };
        }
        return { texto: `Formato "${formato}" não existe. Use dxf, hpgl ou risco.`, falhou: true };
      }

      default:
        return { texto: `Ação "${r.acao}" não existe nesta tela.`, falhou: true };
    }
  } catch (e) {
    return { texto: `Falhou: ${String(e)}`, falhou: true };
  }
}

/** Uma chamada ao provedor escolhido. */
async function chamarModelo(chave: string): Promise<Resposta> {
  const provedor = provedorAtual();
  const pedido = {
    modelo: em<HTMLInputElement>('#ia-modelo-id').value.trim(),
    instrucoes: `${INSTRUCOES}\n\n${contextoEmTexto({
      tamanho: editor.cena.tamanho,
      pecaAtiva: sessao.modelo.pecas[pecaAtiva]?.metadados.nome ?? null,
    })}`,
    ferramentas: CATALOGO.map((f) => ({
      nome: f.nome,
      descricao: f.descricao,
      esquema: f.esquema,
    })),
    conversa,
  };
  const base = globalThis.localStorage.getItem(CHAVE_BASE) ?? undefined;
  const resposta = await fetch(provedor.url(pedido, chave, base), {
    method: 'POST',
    headers: provedor.cabecalhos(chave),
    body: JSON.stringify(provedor.corpo(pedido)),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`${provedor.nome} respondeu ${resposta.status}: ${corpo.slice(0, 300)}`);
  }
  return provedor.ler(await resposta.json());
}

/**
 * A rodada: manda, e enquanto o modelo pedir ferramenta, executa e devolve.
 *
 * O limite de voltas existe porque um modelo confuso entra em ciclo, e ciclo aqui
 * gasta o dinheiro do cliente. Oito é folgado para qualquer pedido real.
 */
async function rodada(chave: string): Promise<void> {
  for (let volta = 0; volta < 8; volta++) {
    const r = await chamarModelo(chave);
    conversa.push({ papel: 'assistente', texto: r.texto, chamadas: r.chamadas });
    if (r.texto !== '') falar('assistente', r.texto);
    if (r.chamadas.length === 0) return;

    const resultados = r.chamadas.map((c) => {
      const ferramenta = acharFerramenta(c.nome);
      if (ferramenta === null) {
        anotarFerramenta(`${c.nome} — não existe`, true);
        return { id: c.id, nome: c.nome, texto: `Não existe a ferramenta "${c.nome}".`, falhou: true };
      }
      ferramentaAtual = ferramenta;
      const saida = executarResultado(ferramenta.executar(sessao.modelo, c.argumentos));
      ferramentaAtual = null;
      anotarFerramenta(`${c.nome}: ${saida.texto.split('\n')[0]}`, saida.falhou);
      return { id: c.id, nome: c.nome, texto: saida.texto, falhou: saida.falhou };
    });
    conversa.push({ papel: 'ferramenta', resultados });
  }
  falar('assistente', 'Dei muitas voltas sem chegar a uma resposta. Tente pedir de outro jeito.');
}

// ------------------------------------------------------------- tela da IA

function preencherProvedores(): void {
  const alvo = em<HTMLSelectElement>('#ia-provedor');
  alvo.innerHTML = PROVEDORES.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
  alvo.value = globalThis.localStorage.getItem(CHAVE_PROVEDOR) ?? 'anthropic';
  aoTrocarProvedor();
}

function aoTrocarProvedor(): void {
  const p = provedorAtual();
  const lista = em<HTMLSelectElement>('#ia-modelo');
  lista.innerHTML = p.modelos.map((m) => `<option value="${m.id}">${m.nome}</option>`).join('');
  const guardado = globalThis.localStorage.getItem(`${CHAVE_MODELO_IA}:${p.id}`);
  const escolhido = guardado ?? p.modelos[0]!.id;
  lista.value = p.modelos.some((m) => m.id === escolhido) ? escolhido : p.modelos[0]!.id;
  em<HTMLInputElement>('#ia-modelo-id').value = escolhido;
  em('#ia-linha-base').hidden = !p.exigeBase;
  em<HTMLInputElement>('#ia-base').value = globalThis.localStorage.getItem(CHAVE_BASE) ?? '';
  em('#ia-observacao').textContent = `Chave em ${p.ondePegarAChave}. ${p.observacao}`;
}

function mostrarChave(): void {
  const tem = globalThis.localStorage.getItem(CHAVE_API) !== null;
  em('#ia-linha-chave').hidden = tem;
  em('#ia-trocar-chave').hidden = !tem;
  em('#ia-texto').hidden = !tem;
  em('#ia-enviar').hidden = !tem;
  if (!tem) iaEstado('Escolha o provedor e cole a chave. Ela fica só neste navegador.');
}

em('#ia-provedor').addEventListener('change', () => {
  globalThis.localStorage.setItem(CHAVE_PROVEDOR, em<HTMLSelectElement>('#ia-provedor').value);
  aoTrocarProvedor();
});
em('#ia-modelo').addEventListener('change', () => {
  const id = em<HTMLSelectElement>('#ia-modelo').value;
  em<HTMLInputElement>('#ia-modelo-id').value = id;
  globalThis.localStorage.setItem(`${CHAVE_MODELO_IA}:${provedorAtual().id}`, id);
});
em('#ia-modelo-id').addEventListener('change', () => {
  globalThis.localStorage.setItem(
    `${CHAVE_MODELO_IA}:${provedorAtual().id}`,
    em<HTMLInputElement>('#ia-modelo-id').value.trim(),
  );
});
em('#ia-base').addEventListener('change', () => {
  globalThis.localStorage.setItem(CHAVE_BASE, em<HTMLInputElement>('#ia-base').value.trim());
});

em('#ia-abrir').addEventListener('click', () => {
  em('#ia').hidden = false;
  preencherProvedores();
  mostrarChave();
  if (em('#ia-conversa').childElementCount === 0) {
    falar(
      'assistente',
      'Oi. Eu opero este programa para você — pode falar como falaria com uma colega.\n\n' +
        'Exemplos: "quantas peças tem aqui?", "põe 1 cm de costura na frente", ' +
        '"a manga sai em par, 2 vezes", "otimiza para gastar menos tecido", ' +
        '"a borda dessa peça ficou tremida, melhora", "não gostei, desfaz".\n\n' +
        'Não vou chutar medida: se faltar um número, eu pergunto. E tudo o que eu fizer ' +
        'você desfaz com Ctrl+Z.',
    );
  }
  em<HTMLTextAreaElement>('#ia-texto').focus();
});

const fecharIa = (): void => {
  em('#ia').hidden = true;
};
em('#ia-fechar').addEventListener('click', fecharIa);
em('#ia').addEventListener('click', (evento) => {
  if (evento.target === em('#ia')) fecharIa();
});

em('#ia-guardar-chave').addEventListener('click', () => {
  const chave = em<HTMLInputElement>('#ia-chave').value.trim();
  if (chave === '') return;
  globalThis.localStorage.setItem(CHAVE_API, chave);
  em<HTMLInputElement>('#ia-chave').value = '';
  mostrarChave();
  iaEstado('Conectado. Tudo o que ela fizer some com Ctrl+Z.');
});

em('#ia-trocar-chave').addEventListener('click', () => {
  globalThis.localStorage.removeItem(CHAVE_API);
  mostrarChave();
});

async function enviar(): Promise<void> {
  const chave = globalThis.localStorage.getItem(CHAVE_API);
  if (chave === null) return;
  const caixa = em<HTMLTextAreaElement>('#ia-texto');
  const pedido = caixa.value.trim();
  if (pedido === '') return;

  caixa.value = '';
  falar('você', pedido, 'pessoa');
  conversa.push({ papel: 'pessoa', texto: pedido });
  em<HTMLButtonElement>('#ia-enviar').disabled = true;
  iaEstado('Pensando…');
  try {
    await rodada(chave);
    iaEstado('Tudo o que ela fizer some com Ctrl+Z.');
  } catch (e) {
    falar('assistente', `Não consegui falar com o modelo. ${String(e)}`);
    iaEstado('Falhou. Confira a chave, o nome do modelo e a internet.');
  } finally {
    em<HTMLButtonElement>('#ia-enviar').disabled = false;
  }
}

em('#ia-enviar').addEventListener('click', () => void enviar());
em('#ia-texto').addEventListener('keydown', (evento) => {
  // Enter manda, Shift+Enter quebra linha: é o que todo mundo já espera de um chat.
  if (evento.key === 'Enter' && !evento.shiftKey) {
    evento.preventDefault();
    void enviar();
  }
});
