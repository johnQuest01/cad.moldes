/**
 * Bloco 4 — a maquina de ferramentas e as seis essenciais (Parte 4).
 *
 * Para cada ferramenta, os tres testes que a Parte 4 exige:
 *   1. o gesto emite o evento certo, com o payload numerico esperado;
 *   2. a recusa do motor NAO emite nada e nao suja o documento;
 *   3. `Esc` no meio cancela.
 * Mais, por ferramenta, o que ela tem de particular.
 *
 * Tudo pelo harness de ponteiro: entra coordenada em UM, sai evento. Sem navegador.
 */
import { describe, expect, it } from 'vitest';

import { MM, anelDoContorno, medirAresta, umParaMM, type Vetor2 } from '@cad/motor';

import {
  Editor,
  SEM_MODIFICADOR,
  ferramentaMedir,
  ferramentaMoverPeca,
  ferramentaMoverPonto,
  ferramentaPique,
  ferramentaSelecionar,
  ferramentasEssenciais,
} from '../src/index.js';

import { PECA, VERTICES, sessaoDaBlusa } from './fixtures.js';

const SHIFT = { ...SEM_MODIFICADOR, shift: true };
const ALT = { ...SEM_MODIFICADOR, alt: true };

function novoEditor(): Editor {
  const editor = new Editor(sessaoDaBlusa(), ferramentasEssenciais(), 1280, 800);
  // Zoom de trabalho: 1 px por mm, para o raio de captura ser 10 mm.
  editor.camera.definirZoom(1);
  return editor;
}

const tipos = (editor: Editor): string[] => editor.sessao.pendentes.map((e) => e.tipo);

const carga = (editor: Editor, i = 0): Record<string, unknown> =>
  editor.sessao.pendentes[i]!.payload as Record<string, unknown>;

const largura = (editor: Editor): number => {
  const anel = anelDoContorno(editor.cena.derivados(PECA).peca);
  return Math.max(...anel.map((p) => p.x)) - Math.min(...anel.map((p) => p.x));
};

const OMBRO = VERTICES[3]!; // (150, 430) mm
const NA_LATERAL: Vetor2 = { x: 186 * MM, y: 150 * MM };

describe('A maquina de ferramentas', () => {
  it('troca de ferramenta, e recusa nome que nao existe', () => {
    const editor = novoEditor();
    console.log('--- ferramentas ---');
    console.log(`ativa ao abrir: ${editor.ferramenta}`);
    editor.usar('pique');
    console.log(`depois de usar("pique"): ${editor.ferramenta}`);
    expect(editor.ferramenta).toBe('pique');
    expect(() => editor.usar('nao-existe')).toThrow(/nao existe/);
  });

  it('Esc no meio do gesto cancela: nem evento, nem previa, nem versao nova', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    const versao = editor.sessao.versao;

    editor.apontar(OMBRO);
    editor.arrastar({ x: OMBRO.x + 30 * MM, y: OMBRO.y });
    const tinhaPrevia = editor.previsualizacao !== null;
    editor.tecla('Escape');

    console.log('--- Esc ---');
    console.log(
      `arrastou 30 mm (previa: ${tinhaPrevia}) e apertou Esc -> ` +
        `${editor.sessao.pendentes.length} eventos, versao ${versao} -> ${editor.sessao.versao}, ` +
        `previa ${editor.previsualizacao === null ? 'limpa' : 'pendurada'}`,
    );
    expect(tinhaPrevia).toBe(true);
    expect(editor.sessao.pendentes).toHaveLength(0);
    expect(editor.sessao.versao).toBe(versao);
    expect(editor.previsualizacao).toBeNull();
  });

  it('a previa e calculada na peca BASE e graduada — nao mente no modo proporcional', () => {
    const editor = new Editor(
      sessaoDaBlusa(),
      [ferramentaMoverPonto({ modo: 'proporcional', nVizinhos: 2 })],
      1280,
      800,
    );
    editor.camera.definirZoom(1);
    editor.cena.tamanho = 'G';

    editor.apontar(editor.cena.derivados(PECA).peca.pontos['pt-3']!);
    editor.arrastar({
      x: editor.cena.derivados(PECA).peca.pontos['pt-3']!.x + 20 * MM,
      y: editor.cena.derivados(PECA).peca.pontos['pt-3']!.y,
    });
    const previa = editor.previsualizacao!.peca.pontos['pt-3']!;
    editor.soltar({
      x: editor.cena.derivados(PECA).peca.pontos['pt-3']!.x + 20 * MM,
      y: editor.cena.derivados(PECA).peca.pontos['pt-3']!.y,
    });
    const resultado = editor.cena.derivados(PECA).peca.pontos['pt-3']!;

    console.log('--- previa x resultado, no tamanho G, modo proporcional ---');
    console.log(`previa    (${umParaMM(previa.x)}, ${umParaMM(previa.y)}) mm`);
    console.log(`resultado (${umParaMM(resultado.x)}, ${umParaMM(resultado.y)}) mm`);
    expect(resultado).toEqual(previa);
  });
});

describe('Selecionar', () => {
  it('clique seleciona; arrasto vira marquee', () => {
    const editor = novoEditor();
    editor.apontar(OMBRO);
    editor.soltar(OMBRO);
    const porClique = editor.selecao.tamanho;

    editor.apontar({ x: -20 * MM, y: 250 * MM });
    editor.arrastar({ x: 210 * MM, y: 480 * MM });
    editor.soltar({ x: 210 * MM, y: 480 * MM });

    console.log('--- selecionar ---');
    console.log(`clique -> ${porClique} item | marquee -> ${editor.selecao.tamanho} itens`);
    expect(porClique).toBe(1);
    expect(editor.selecao.tamanho).toBeGreaterThan(1);
    expect(editor.sessao.pendentes).toHaveLength(0);
  });

  it('um arrasto menor que o limiar continua sendo clique', () => {
    const editor = new Editor(sessaoDaBlusa(), [ferramentaSelecionar()], 1280, 800);
    editor.camera.definirZoom(1);
    editor.apontar(OMBRO);
    editor.arrastar({ x: OMBRO.x + 1000, y: OMBRO.y }); // 1 mm = 1 px, abaixo do limiar
    editor.soltar({ x: OMBRO.x + 1000, y: OMBRO.y });
    console.log(`tremida de 1 px -> ${editor.selecao.tamanho} item (clique, nao marquee)`);
    expect(editor.selecao.tamanho).toBe(1);
    expect(editor.selecao.doTipo('ponto')).toHaveLength(1);
  });
});

describe('Mover ponto', () => {
  it('o gesto emite UM ModificarPonto com o delta total', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    const antes = largura(editor);

    editor.apontar(OMBRO);
    for (let i = 1; i <= 5; i++) editor.arrastar({ x: OMBRO.x + i * 4 * MM, y: OMBRO.y + i * 2 * MM });
    editor.soltar({ x: OMBRO.x + 20 * MM, y: OMBRO.y + 10 * MM }, ALT);

    console.log('--- mover ponto ---');
    console.log(
      `5 quadros de arrasto -> ${tipos(editor).length} evento: ${tipos(editor).join(', ')}`,
    );
    console.log(
      `dx = ${umParaMM(Number(carga(editor)['dx']))} mm, dy = ${umParaMM(Number(carga(editor)['dy']))} mm ` +
        `| modo ${String(carga(editor)['modo'])}, ${String(carga(editor)['nVizinhos'])} vizinhos`,
    );
    console.log(`largura ${umParaMM(antes)} -> ${umParaMM(largura(editor))} mm`);

    expect(tipos(editor)).toEqual(['ModificarPonto']);
    expect(carga(editor)['dx']).toBe(20 * MM);
    expect(carga(editor)['dy']).toBe(10 * MM);
  });

  it('Shift prende no eixo mais forte', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    editor.apontar(OMBRO);
    editor.arrastar({ x: OMBRO.x + 30 * MM, y: OMBRO.y + 4 * MM }, { ...SHIFT, alt: true });
    editor.soltar({ x: OMBRO.x + 30 * MM, y: OMBRO.y + 4 * MM }, { ...SHIFT, alt: true });
    console.log(
      `arrastou (30, 4) mm com Shift -> dx ${umParaMM(Number(carga(editor)['dx']))} mm, ` +
        `dy ${umParaMM(Number(carga(editor)['dy']))} mm`,
    );
    expect(carga(editor)['dx']).toBe(30 * MM);
    expect(carga(editor)['dy']).toBe(0);
  });

  it('valor digitado ganha do ultimo pixel (E10)', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    editor.apontar(OMBRO);
    editor.arrastar({ x: OMBRO.x + 17_321, y: OMBRO.y + 4_567 }, ALT);
    editor.numero({ dx: 20, dy: 0 });

    console.log('--- entrada numerica ---');
    console.log(
      `cursor parou em dx = 17.321 mm; digitou 20 -> evento com dx = ` +
        `${umParaMM(Number(carga(editor)['dx']))} mm exato`,
    );
    expect(carga(editor)['dx']).toBe(20 * MM);
    expect(carga(editor)['dy']).toBe(0);
  });

  it('arrasto de zero nao emite evento nenhum', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    editor.apontar(OMBRO);
    editor.soltar(OMBRO);
    console.log(`apontou e soltou no mesmo lugar -> ${editor.sessao.pendentes.length} eventos`);
    expect(editor.sessao.pendentes).toHaveLength(0);
  });

  it('recusa do motor nao emite e a mensagem chega na interface (E7)', () => {
    const editor = new Editor(
      sessaoDaBlusa(),
      [ferramentaMoverPonto({ modo: 'proporcional', nVizinhos: 99 })],
      1280,
      800,
    );
    editor.camera.definirZoom(1);
    const versao = editor.sessao.versao;

    editor.apontar(OMBRO);
    editor.arrastar({ x: OMBRO.x + 20 * MM, y: OMBRO.y }, ALT);
    editor.soltar({ x: OMBRO.x + 20 * MM, y: OMBRO.y }, ALT);

    console.log('--- recusa ---');
    console.log(
      `99 vizinhos num contorno de 6 pontos -> ${editor.recusa?.codigo} | ` +
        `${editor.sessao.pendentes.length} eventos | versao ${versao} -> ${editor.sessao.versao}`,
    );
    expect(editor.recusa?.codigo).toBe('N_VIZINHOS_EXCEDE_CONTORNO');
    expect(editor.sessao.pendentes).toHaveLength(0);
    expect(editor.sessao.versao).toBe(versao);
  });
});

describe('Mover peca', () => {
  it('arrasta a peca e emite TransladarPeca', () => {
    const editor = novoEditor();
    editor.usar('moverPeca');
    const dentro: Vetor2 = { x: 60 * MM, y: 200 * MM };

    editor.apontar(dentro);
    editor.arrastar({ x: dentro.x + 100 * MM, y: dentro.y + 50 * MM });
    editor.soltar({ x: dentro.x + 100 * MM, y: dentro.y + 50 * MM });

    const anel = anelDoContorno(editor.cena.derivados(PECA).peca);
    console.log('--- mover peca ---');
    console.log(
      `${tipos(editor).join(', ')} dx = ${umParaMM(Number(carga(editor)['dx']))} mm | ` +
        `a peca comeca agora em x = ${umParaMM(Math.min(...anel.map((p) => p.x)))} mm`,
    );
    expect(tipos(editor)).toEqual(['TransladarPeca']);
    expect(carga(editor)['dx']).toBe(100 * MM);
  });

  it('com varias pecas selecionadas, um gesto e UM passo de undo', () => {
    const editor = new Editor(sessaoDaBlusa(), [ferramentaMoverPeca()], 1280, 800);
    editor.camera.definirZoom(1);
    // Duplica a frente para ter duas pecas, e seleciona as duas.
    editor.sessao.aplicar({
      tipo: 'DuplicarPeca',
      pecaId: PECA,
      payload: { novoPecaId: 'pec-costas', prefixoId: 'cp', dx: 400 * MM, dy: 0, comGraduacao: true },
    });
    editor.sessao.selar();
    editor.selecao.selecionarTudo(editor.cena, editor.camadas);

    const dentro: Vetor2 = { x: 60 * MM, y: 200 * MM };
    editor.apontar(dentro, SHIFT);
    editor.arrastar({ x: dentro.x, y: dentro.y + 60 * MM });
    editor.soltar({ x: dentro.x, y: dentro.y + 60 * MM });

    const passos = editor.sessao.passos;
    const eventos = editor.sessao.pendentes.length;
    editor.sessao.desfazer();

    console.log(
      `2 pecas movidas -> ${eventos} eventos em ${passos} passo | ` +
        `1 desfazer -> ${editor.sessao.pendentes.length} eventos`,
    );
    expect(eventos).toBe(2);
    expect(passos).toBe(1);
    expect(editor.sessao.pendentes).toHaveLength(0);
  });
});

describe('Pique', () => {
  it('clique no contorno crava; arrastar desliza; Delete tira', () => {
    const editor = novoEditor();
    editor.usar('pique');

    editor.apontar(NA_LATERAL);
    editor.soltar(NA_LATERAL);
    const aoCravar = { ...carga(editor) };

    const piqueId = String(aoCravar['piqueId']);
    const onde = editor.cena.derivados(PECA).piques.find(([id]) => id === piqueId)![1].pontoDaCostura;
    editor.apontar(onde);
    editor.arrastar({ x: onde.x + 2 * MM, y: onde.y + 80 * MM }, ALT);
    editor.soltar({ x: onde.x + 2 * MM, y: onde.y + 80 * MM }, ALT);

    editor.tecla('Delete');

    console.log('--- pique ---');
    console.log(
      `cravado: ${String(aoCravar['tipo'])} em ${String(aoCravar['arestaId'])}, ` +
        `s = ${Number(aoCravar['s']).toFixed(3)}, ` +
        `${umParaMM(Number(aoCravar['alturaUM']))} x ${umParaMM(Number(aoCravar['larguraUM']))} mm`,
    );
    console.log(`eventos: ${tipos(editor).join(', ')}`);
    console.log(
      `s: ${Number(aoCravar['s']).toFixed(3)} -> ${Number(carga(editor, 1)['s']).toFixed(3)} | ` +
        `piques na peca no fim: ${Object.keys(editor.cena.derivados(PECA).peca.piques).length}`,
    );

    expect(tipos(editor)).toEqual(['AdicionarPique', 'MoverPique', 'RemoverPique']);
    expect(aoCravar['alturaUM']).toBe(6350);
    expect(aoCravar['larguraUM']).toBe(1590);
    expect(Object.keys(editor.cena.derivados(PECA).peca.piques)).toHaveLength(0);
  });

  it('arrastar um pique para OUTRA aresta nao faz nada', () => {
    const editor = novoEditor();
    editor.usar('pique');
    editor.apontar(NA_LATERAL);
    editor.soltar(NA_LATERAL);

    const piqueId = String(carga(editor)['piqueId']);
    const onde = editor.cena.derivados(PECA).piques.find(([id]) => id === piqueId)![1].pontoDaCostura;
    const sAntes = Number(carga(editor)['s']);

    editor.apontar(onde);
    // Puxa para a bainha, que e outra aresta.
    editor.arrastar({ x: 90 * MM, y: 1 * MM }, ALT);
    editor.soltar({ x: 90 * MM, y: 1 * MM }, ALT);

    const pique = editor.cena.derivados(PECA).peca.piques[piqueId]!;
    console.log(
      `puxou o pique da lateral para a bainha -> ${tipos(editor).join(', ')} | ` +
        `continua em ${pique.arestaId} com s = ${pique.s.toFixed(3)} (era ${sAntes.toFixed(3)})`,
    );
    expect(tipos(editor)).toEqual(['AdicionarPique']);
    expect(pique.arestaId).toBe('ar-lateral');
  });

  it('a profundidade digitada vale, e o validador avisa quando passa da margem', () => {
    const editor = new Editor(
      sessaoDaBlusa(),
      [ferramentaPique({ tipo: 'T', profundidadeMM: 20, larguraMM: 1.59 })],
      1280,
      800,
    );
    editor.camera.definirZoom(1);
    // A lateral tem margem de 12 mm; um pique de 20 mm passa da linha de costura.
    editor.apontar(NA_LATERAL);
    editor.soltar(NA_LATERAL);

    const avisos = editor.cena.problemas.filter((p) => p.codigo === 'PIQUE_MAIS_FUNDO_QUE_A_MARGEM');
    console.log(
      `pique T de 20 mm numa aresta de margem 12 mm -> ${avisos.length} aviso ` +
        `[${avisos[0]?.gravidade}] ${avisos[0]?.codigo}`,
    );
    expect(carga(editor)['tipo']).toBe('T');
    expect(carga(editor)['alturaUM']).toBe(20 * MM);
    expect(avisos).toHaveLength(1);
  });

  it('clique fora do contorno nao crava nada', () => {
    const editor = novoEditor();
    editor.usar('pique');
    editor.apontar({ x: 60 * MM, y: 200 * MM });
    editor.soltar({ x: 60 * MM, y: 200 * MM });
    console.log(`clique no meio do tecido -> ${editor.sessao.pendentes.length} eventos`);
    expect(editor.sessao.pendentes).toHaveLength(0);
  });
});

describe('Inserir e excluir ponto', () => {
  it('clique no contorno insere; Alt+clique num ponto exclui', () => {
    const editor = novoEditor();
    editor.usar('inserirPonto');
    const antes = Object.keys(editor.cena.derivados(PECA).peca.pontos).length;

    editor.apontar({ x: 90 * MM, y: 1 * MM }); // na bainha
    editor.soltar({ x: 90 * MM, y: 1 * MM });
    const depoisDeInserir = Object.keys(editor.cena.derivados(PECA).peca.pontos).length;

    const novo = Object.values(editor.cena.derivados(PECA).peca.pontos).find((p) =>
      p.id.startsWith('ins-'),
    )!;
    editor.apontar(novo, ALT);
    editor.soltar(novo, ALT);

    console.log('--- inserir e excluir ---');
    console.log(`pontos: ${antes} -> ${depoisDeInserir} -> ` +
      `${Object.keys(editor.cena.derivados(PECA).peca.pontos).length}`);
    console.log(`eventos: ${tipos(editor).join(', ')}`);
    console.log(
      `s no segmento: ${Number(carga(editor)['s']).toFixed(4)} | ` +
        `bainha continua com ${umParaMM(medirAresta(editor.cena.derivados(PECA).peca, 'ar-bainha'))} mm`,
    );
    expect(tipos(editor)).toEqual(['InserirPonto', 'ExcluirPonto']);
    expect(depoisDeInserir).toBe(antes + 1);
    expect(Object.keys(editor.cena.derivados(PECA).peca.pontos)).toHaveLength(antes);
  });

  it('excluir um ponto NOTAVEL e recusado, e nada e emitido', () => {
    const editor = novoEditor();
    editor.usar('inserirPonto');
    const versao = editor.sessao.versao;
    editor.apontar(OMBRO, ALT);
    editor.soltar(OMBRO, ALT);
    console.log(
      `Alt+clique num vertice do contorno -> ${editor.recusa?.codigo} | ` +
        `${editor.sessao.pendentes.length} eventos, versao ${versao} -> ${editor.sessao.versao}`,
    );
    expect(editor.recusa).not.toBeNull();
    expect(editor.sessao.pendentes).toHaveLength(0);
  });
});

describe('Medir — a regua que nao muda nada', () => {
  it('clicar numa aresta da o comprimento MEDIDO pelo motor', () => {
    const editor = new Editor(sessaoDaBlusa(), [ferramentaMedir()], 1280, 800);
    editor.camera.definirZoom(1);
    editor.apontar(NA_LATERAL);

    const doMotor = medirAresta(editor.cena.derivados(PECA).peca, 'ar-lateral');
    console.log('--- medir ---');
    console.log(
      `cota "${editor.cota?.rotulo}": ${umParaMM(editor.cota!.valorUM)} mm | ` +
        `medirAresta do motor: ${umParaMM(doMotor)} mm`,
    );
    expect(editor.cota?.valorUM).toBe(doMotor);
    expect(editor.sessao.pendentes).toHaveLength(0);
  });

  it('dois cliques dao a distancia reta, e o snap prende nos vertices', () => {
    const editor = new Editor(sessaoDaBlusa(), [ferramentaMedir()], 1280, 800);
    editor.camera.definirZoom(1);
    // Perto dos dois cantos da bainha: o snap de vertice prende exato.
    editor.apontar({ x: 2 * MM, y: 2 * MM });
    editor.apontar({ x: 178 * MM, y: 2 * MM });

    const esperado = Math.hypot(VERTICES[1]!.x - VERTICES[0]!.x, VERTICES[1]!.y - VERTICES[0]!.y);
    console.log(
      `clicou 2 mm dentro dos dois cantos da bainha -> ${umParaMM(editor.cota!.valorUM)} mm ` +
        `(a bainha em linha reta mede ${umParaMM(esperado)} mm)`,
    );
    expect(editor.cota?.valorUM).toBe(Math.round(esperado));
    expect(editor.sessao.pendentes).toHaveLength(0);
  });
});

// ===========================================================================
// Mover a AREA: o gesto que o uso real pediu
// ===========================================================================

describe('Mover um grupo de pontos — o "mover a area" do ateliê', () => {
  it('com varios pontos selecionados, o arrasto move TODOS, num passo so', () => {
    const editor = novoEditor();
    // Marquee sobre a metade de cima: pega o ombro, o decote e a cava.
    editor.apontar({ x: -20 * MM, y: 250 * MM });
    editor.arrastar({ x: 210 * MM, y: 480 * MM });
    editor.soltar({ x: 210 * MM, y: 480 * MM });
    const selecionados = editor.selecao.doTipo('ponto');

    const antes = selecionados.map((ref) => ({
      ...editor.cena.derivados(PECA).peca.pontos[ref.pontoId]!,
    }));

    editor.usar('moverPonto');
    const pegar = antes[0]!;
    editor.apontar({ x: pegar.x, y: pegar.y });
    editor.arrastar({ x: pegar.x + 15 * MM, y: pegar.y + 5 * MM }, ALT);
    editor.soltar({ x: pegar.x + 15 * MM, y: pegar.y + 5 * MM }, ALT);

    const depois = selecionados.map((ref) => editor.cena.derivados(PECA).peca.pontos[ref.pontoId]!);
    const deltas = depois.map((p, i) => ({
      dx: umParaMM(p.x - antes[i]!.x),
      dy: umParaMM(p.y - antes[i]!.y),
    }));

    console.log('--- mover a area ---');
    console.log(`${selecionados.length} pontos selecionados pelo marquee`);
    console.log(`deltas: ${deltas.map((d) => `(${d.dx}, ${d.dy})`).join(' ')}`);
    console.log(
      `${editor.sessao.pendentes.length} eventos em ${editor.sessao.passos} passo | ` +
        `modo no payload: ${String(carga(editor)['modo'])}`,
    );

    expect(selecionados.length).toBeGreaterThan(1);
    // Grupo anda RIGIDO: todo mundo o mesmo delta, sem decaimento composto.
    for (const d of deltas) {
      expect(d.dx).toBeCloseTo(15, 6);
      expect(d.dy).toBeCloseTo(5, 6);
    }
    expect(editor.sessao.pendentes).toHaveLength(selecionados.length);
    expect(editor.sessao.passos).toBe(1);
    expect(carga(editor)['modo']).toBe('discreto');
  });

  it('um desfazer devolve o grupo inteiro ao lugar', () => {
    const editor = novoEditor();
    editor.apontar({ x: -20 * MM, y: 250 * MM });
    editor.arrastar({ x: 210 * MM, y: 480 * MM });
    editor.soltar({ x: 210 * MM, y: 480 * MM });

    const ombro = editor.cena.derivados(PECA).peca.pontos['pt-3']!;
    const antes = { x: ombro.x, y: ombro.y };
    editor.usar('moverPonto');
    editor.apontar(antes);
    editor.arrastar({ x: antes.x + 15 * MM, y: antes.y }, ALT);
    editor.soltar({ x: antes.x + 15 * MM, y: antes.y }, ALT);
    const movido = editor.cena.derivados(PECA).peca.pontos['pt-3']!.x;

    editor.sessao.desfazer();
    const voltou = editor.cena.derivados(PECA).peca.pontos['pt-3']!.x;
    console.log(
      `ombro: ${umParaMM(antes.x)} -> ${umParaMM(movido)} -> desfazer -> ${umParaMM(voltou)} mm`,
    );
    expect(voltou).toBe(antes.x);
  });

  it('clicar num ponto FORA da selecao recomeca: move so ele', () => {
    const editor = novoEditor();
    editor.apontar({ x: -20 * MM, y: 250 * MM });
    editor.arrastar({ x: 210 * MM, y: 480 * MM });
    editor.soltar({ x: 210 * MM, y: 480 * MM });
    const antes = editor.selecao.doTipo('ponto').length;

    // pt-0 fica na bainha, fora do marquee de cima.
    const bainha = editor.cena.derivados(PECA).peca.pontos['pt-0']!;
    editor.usar('moverPonto');
    editor.apontar(bainha);
    editor.arrastar({ x: bainha.x + 10 * MM, y: bainha.y }, ALT);
    editor.soltar({ x: bainha.x + 10 * MM, y: bainha.y }, ALT);

    console.log(
      `${antes} selecionados; clicou num ponto de fora -> ` +
        `${editor.sessao.pendentes.length} evento, modo ${String(carga(editor)['modo'])}`,
    );
    expect(editor.sessao.pendentes).toHaveLength(1);
    expect(carga(editor)['modo']).toBe('proporcional');
  });
});

describe('O gesto vale onde o botao foi SOLTO', () => {
  it('mover ponto: um pointerup adiante do ultimo movimento commita a posicao final', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    editor.apontar(OMBRO);
    // O ultimo `pointermove` para em 10 mm...
    editor.arrastar({ x: OMBRO.x + 10 * MM, y: OMBRO.y }, ALT);
    // ...e o botao e solto em 25 mm. E o que acontece o tempo todo com o mouse.
    editor.soltar({ x: OMBRO.x + 25 * MM, y: OMBRO.y }, ALT);

    console.log('--- soltura adiante do ultimo movimento ---');
    console.log(
      `ultimo pointermove em 10 mm, pointerup em 25 mm -> evento com dx = ` +
        `${umParaMM(Number(carga(editor)['dx']))} mm`,
    );
    expect(carga(editor)['dx']).toBe(25 * MM);
  });

  it('mover peca: idem — a peca fica onde foi largada', () => {
    const editor = novoEditor();
    editor.usar('moverPeca');
    const dentro: Vetor2 = { x: 60 * MM, y: 200 * MM };
    editor.apontar(dentro);
    editor.arrastar({ x: dentro.x + 10 * MM, y: dentro.y });
    editor.soltar({ x: dentro.x + 70 * MM, y: dentro.y });

    const anel = anelDoContorno(editor.cena.derivados(PECA).peca);
    console.log(
      `movimento parou em 10 mm, soltou em 70 mm -> dx do evento ` +
        `${umParaMM(Number(carga(editor)['dx']))} mm | a peca comeca em ` +
        `${umParaMM(Math.min(...anel.map((p) => p.x)))} mm`,
    );
    expect(carga(editor)['dx']).toBe(70 * MM);
  });
});

// ===========================================================================
// Arrumar linha torta: o pique nao pode criar zona morta
// ===========================================================================

describe('Mover a LINHA, e nao so o vertice', () => {
  it('arrastar em cima da aresta faz nascer o ponto e ja o move — um passo de undo', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    const antes = Object.keys(editor.cena.derivados(PECA).peca.pontos).length;

    // Meio da lateral: nao ha vertice nenhum aqui.
    const naLinha: Vetor2 = { x: 185 * MM, y: 150 * MM };
    editor.apontar(naLinha);
    editor.arrastar({ x: naLinha.x + 12 * MM, y: naLinha.y }, ALT);
    editor.soltar({ x: naLinha.x + 12 * MM, y: naLinha.y }, ALT);

    const depois = Object.keys(editor.cena.derivados(PECA).peca.pontos).length;
    console.log('--- arrumar linha torta ---');
    console.log(
      `arrastou 12 mm em cima da lateral -> ${tipos(editor).join(', ')} | ` +
        `pontos ${antes} -> ${depois} | ${editor.sessao.passos} passo de undo`,
    );

    expect(tipos(editor)).toEqual(['InserirPonto', 'ModificarPonto']);
    expect(depois).toBe(antes + 1);
    expect(editor.sessao.passos).toBe(1);

    editor.sessao.desfazer();
    console.log(
      `um desfazer -> ${Object.keys(editor.cena.derivados(PECA).peca.pontos).length} pontos ` +
        `(o ponto que nasceu no gesto vai junto)`,
    );
    expect(Object.keys(editor.cena.derivados(PECA).peca.pontos)).toHaveLength(antes);
  });

  it('o pique NAO cria zona morta: com moverPonto, a linha continua pegavel', () => {
    const editor = novoEditor();
    // Crava um pique bem no meio da lateral.
    editor.usar('pique');
    const naLinha: Vetor2 = { x: 185 * MM, y: 150 * MM };
    editor.apontar(naLinha);
    editor.soltar(naLinha);
    const noPique = editor.cena.derivados(PECA).piques[0]![1].pontoDaCostura;

    // Agora tenta arrumar a linha EXATAMENTE onde o pique esta.
    editor.usar('moverPonto');
    const antes = editor.sessao.pendentes.length;
    editor.apontar(noPique);
    editor.arrastar({ x: noPique.x + 10 * MM, y: noPique.y }, ALT);
    editor.soltar({ x: noPique.x + 10 * MM, y: noPique.y }, ALT);
    const novos = editor.sessao.pendentes.slice(antes).map((e) => e.tipo);

    console.log('--- em cima do pique ---');
    console.log(
      `arrastou em cima do pique cravado -> ${novos.join(', ') || 'NADA (zona morta)'}`,
    );
    expect(novos).toEqual(['InserirPonto', 'ModificarPonto']);
  });

  it('o pique continua sendo pego pela ferramenta DELE', () => {
    const editor = novoEditor();
    editor.usar('pique');
    const naLinha: Vetor2 = { x: 185 * MM, y: 150 * MM };
    editor.apontar(naLinha);
    editor.soltar(naLinha);
    const noPique = editor.cena.derivados(PECA).piques[0]![1].pontoDaCostura;

    editor.apontar(noPique);
    editor.arrastar({ x: noPique.x + 2 * MM, y: noPique.y + 60 * MM }, ALT);
    editor.soltar({ x: noPique.x + 2 * MM, y: noPique.y + 60 * MM }, ALT);

    console.log(`com a ferramenta de pique, o mesmo lugar -> ${tipos(editor).join(', ')}`);
    expect(tipos(editor)).toEqual(['AdicionarPique', 'MoverPique']);
  });
});
