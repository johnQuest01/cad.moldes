/**
 * Bloco 5 (metade pura) — a cena de desenho.
 *
 * O renderizador de teste da Parte 5: em vez de olhar pixel, o teste le a LISTA DE
 * COMANDOS. Da para provar sem navegador que o pique e desenhado na linha de corte,
 * que camada desligada nao emite nada, que peca fora da vista e pulada e que a
 * espessura e constante na tela.
 */
import { describe, expect, it } from 'vitest';

import { MM, umParaMM, type Vetor2 } from '@cad/motor';

import {
  ESPESSURA_PX,
  Editor,
  ferramentasEssenciais,
  larguraNoMundo,
  montarCena,
  type Comando,
} from '../src/index.js';

import { PECA, sessaoDaBlusa } from './fixtures.js';

function novoEditor(): Editor {
  const editor = new Editor(sessaoDaBlusa(), ferramentasEssenciais(), 1280, 800);
  editor.camera.enquadrar(editor.cena.caixa(), 40);
  return editor;
}

const daCamada = (comandos: readonly Comando[], camada: string): Comando[] =>
  comandos.filter((c) => c.camada === camada);

const contar = (comandos: readonly Comando[]): string =>
  [...new Set(comandos.map((c) => c.camada))]
    .map((camada) => `${camada} ${daCamada(comandos, camada).length}`)
    .join(' | ');

describe('A cena de desenho', () => {
  it('sai com as camadas certas, na ordem de desenho', () => {
    const editor = novoEditor();
    const comandos = montarCena(editor);
    console.log('--- a cena ---');
    console.log(`${comandos.length} comandos: ${contar(comandos)}`);

    const ordem = [...new Set(comandos.map((c) => c.camada))];
    console.log(`ordem de emissao: ${ordem.join(' -> ')}`);
    expect(ordem[0]).toBe('grade');
    expect(ordem.indexOf('corte')).toBeLessThan(ordem.indexOf('costura'));
    expect(daCamada(comandos, 'costura').length).toBeGreaterThan(0);
  });

  it('camada desligada nao emite comando nenhum', () => {
    const editor = novoEditor();
    const comAntes = daCamada(montarCena(editor), 'corte').length;
    editor.camadas.mostrar('corte', false);
    const comDepois = daCamada(montarCena(editor), 'corte').length;
    console.log(`camada corte: ligada -> ${comAntes} comandos | desligada -> ${comDepois}`);
    expect(comAntes).toBeGreaterThan(0);
    expect(comDepois).toBe(0);
  });

  it('peca fora da vista e pulada — e o culling', () => {
    const editor = novoEditor();
    const dentro = montarCena(editor).filter((c) => c.camada === 'costura').length;
    // Leva a camera para 5 metros dali.
    editor.camera.mover(-100_000, 0);
    editor.camera.mover(-100_000, 0);
    const fora = montarCena(editor).filter((c) => c.camada === 'costura').length;
    console.log('--- culling ---');
    console.log(`peca na vista -> ${dentro} comandos de costura | fora da vista -> ${fora}`);
    expect(dentro).toBeGreaterThan(0);
    expect(fora).toBe(0);
  });

  it('o texto vai para as camadas de texto — nunca para o mundo espelhado (E5)', () => {
    const editor = novoEditor();
    const textos = montarCena(editor).filter((c) => c.forma === 'texto');
    console.log(
      `${textos.length} texto(s), todos em camada de texto: ` +
        `${textos.every((t) => t.camada === 'texto' || t.camada === 'overlay')}`,
    );
    console.log(`conteudo: ${textos.map((t) => (t.forma === 'texto' ? t.conteudo : '')).join(', ')}`);
    expect(textos.length).toBeGreaterThan(0);
    expect(textos.every((t) => t.camada === 'texto' || t.camada === 'overlay')).toBe(true);
  });
});

describe('O pique e desenhado na LINHA DE CORTE, entrando para dentro', () => {
  it('a haste liga a costura ao corte, e anda exatamente a margem da aresta', () => {
    const editor = novoEditor();
    editor.usar('pique');
    const naLateral: Vetor2 = { x: 186 * MM, y: 150 * MM };
    editor.apontar(naLateral);
    editor.soltar(naLateral);

    const doPique = daCamada(montarCena(editor), 'pique');
    const haste = doPique.find((c) => c.forma === 'linha' && c.estilo.tracejado === true);
    if (haste?.forma !== 'linha') throw new Error('a haste da projecao nao foi desenhada');

    const [naCostura, noCorte] = haste.pontos as [Vetor2, Vetor2];
    const andou = Math.hypot(noCorte.x - naCostura.x, noCorte.y - naCostura.y);

    console.log('--- o pique na cena ---');
    console.log(`${doPique.length} comandos na camada pique`);
    console.log(
      `haste: costura (${umParaMM(naCostura.x).toFixed(1)}, ${umParaMM(naCostura.y).toFixed(1)}) -> ` +
        `corte (${umParaMM(noCorte.x).toFixed(1)}, ${umParaMM(noCorte.y).toFixed(1)}) mm`,
    );
    console.log(`andou ${umParaMM(andou).toFixed(2)} mm — a margem da lateral e 12 mm`);
    expect(umParaMM(andou)).toBeCloseTo(12, 1);
  });
});

describe('Espessura constante na tela (E6)', () => {
  it('a mesma linha sai com a mesma espessura em PIXELS em qualquer zoom', () => {
    const editor = novoEditor();
    console.log('--- espessura ---');
    const emPixels: number[] = [];
    for (const zoom of [0.25, 1, 4, 16]) {
      editor.camera.definirZoom(zoom);
      const costura = daCamada(montarCena(editor), 'costura').find((c) => c.forma === 'linha');
      if (costura?.forma !== 'linha') throw new Error('a linha de costura sumiu da cena');
      const noMundo = larguraNoMundo(costura.estilo.espessuraPx, editor.camera.umPorPixel);
      emPixels.push(noMundo / editor.camera.umPorPixel);
      console.log(
        `zoom ${String(zoom).padStart(5)} px/mm -> ${umParaMM(noMundo).toFixed(3)} mm no mundo ` +
          `= ${(noMundo / editor.camera.umPorPixel).toFixed(2)} px na tela`,
      );
    }
    expect(new Set(emPixels.map((v) => v.toFixed(4))).size).toBe(1);
    expect(emPixels[0]).toBeCloseTo(ESPESSURA_PX.costura, 6);
  });
});

describe('O overlay', () => {
  it('o marquee de cruzamento sai tracejado; o de janela, cheio', () => {
    const editor = novoEditor();
    const de: Vetor2 = { x: 0, y: 0 };
    const janela = montarCena(editor, { marquee: { de, ate: { x: 100 * MM, y: 100 * MM } } });
    const cruzamento = montarCena(editor, { marquee: { de, ate: { x: -100 * MM, y: 100 * MM } } });

    const caixa = (comandos: readonly Comando[]) =>
      daCamada(comandos, 'overlay').find((c) => c.forma === 'linha' && c.fechada);

    const a = caixa(janela);
    const b = caixa(cruzamento);
    console.log('--- marquee no overlay ---');
    console.log(
      `janela: tracejado = ${a?.forma === 'linha' ? a.estilo.tracejado ?? false : '?'} | ` +
        `cruzamento: tracejado = ${b?.forma === 'linha' ? b.estilo.tracejado ?? false : '?'}`,
    );
    expect(a?.forma === 'linha' && a.estilo.tracejado).toBeFalsy();
    expect(b?.forma === 'linha' && b.estilo.tracejado).toBe(true);
  });

  it('o ponto selecionado sai maior e com a cor de selecao', () => {
    const editor = novoEditor();
    const semSelecao = daCamada(montarCena(editor), 'costura').filter((c) => c.forma === 'marca');
    editor.apontar(editor.cena.derivados(PECA).peca.pontos['pt-3']!);
    editor.soltar(editor.cena.derivados(PECA).peca.pontos['pt-3']!);
    const comSelecao = daCamada(montarCena(editor), 'costura').filter((c) => c.forma === 'marca');

    const destacadas = comSelecao.filter((c) => c.forma === 'marca' && c.cor === 'selecao');
    console.log(
      `${semSelecao.length} vertices desenhados | depois de clicar num: ` +
        `${destacadas.length} com a cor de selecao`,
    );
    expect(destacadas).toHaveLength(1);
  });

  it('o snap ativo aparece com simbolo e nome — snap sem realimentacao vira misterio', () => {
    const editor = novoEditor();
    const snap = { tipo: 'vertice' as const, ponto: { x: 0, y: 0 } };
    const overlay = daCamada(montarCena(editor, { snap }), 'overlay');
    const rotulo = overlay.find((c) => c.forma === 'texto');
    console.log(
      `snap ${snap.tipo} -> ${overlay.length} comandos no overlay, rotulo ` +
        `"${rotulo?.forma === 'texto' ? rotulo.conteudo : ''}"`,
    );
    expect(rotulo?.forma === 'texto' && rotulo.conteudo).toBe('vertice');
  });

  it('a cota da regua vira texto com o numero do motor', () => {
    const editor = novoEditor();
    editor.usar('medir');
    editor.apontar({ x: 186 * MM, y: 150 * MM });
    const texto = daCamada(montarCena(editor), 'overlay').find((c) => c.forma === 'texto');
    console.log(`cota no overlay: "${texto?.forma === 'texto' ? texto.conteudo : ''}"`);
    expect(texto?.forma === 'texto' && texto.conteudo).toContain('300.2 mm');
  });
});

describe('A previa entra na cena no lugar da peca do log', () => {
  it('durante o arrasto, a costura desenhada e a da previa', () => {
    const editor = novoEditor();
    editor.usar('moverPonto');
    const ombro = editor.cena.derivados(PECA).peca.pontos['pt-3']!;

    const antes = daCamada(montarCena(editor), 'costura').find((c) => c.forma === 'linha');
    editor.apontar(ombro);
    editor.arrastar({ x: ombro.x + 40 * MM, y: ombro.y }, { shift: false, ctrl: false, alt: true });
    const durante = daCamada(montarCena(editor), 'costura').find((c) => c.forma === 'linha');

    const larguraDe = (c: Comando | undefined): number => {
      if (c?.forma !== 'linha') return 0;
      return Math.max(...c.pontos.map((p) => p.x)) - Math.min(...c.pontos.map((p) => p.x));
    };
    console.log('--- previa na cena ---');
    console.log(
      `antes do arrasto ${umParaMM(larguraDe(antes))} mm | durante o arrasto ` +
        `${umParaMM(larguraDe(durante))} mm (a previa, nao o log)`,
    );
    expect(larguraDe(durante)).toBeGreaterThan(larguraDe(antes));
    expect(editor.sessao.pendentes).toHaveLength(0);
  });
});

// ===========================================================================
// Regressoes: os tres jeitos de a peca "sumir" que o uso real encontrou
// ===========================================================================

describe('A peca nao pode sumir da tela', () => {
  it('durante o arrasto, a linha de CORTE e os piques continuam desenhados', () => {
    const editor = novoEditor();
    editor.usar('pique');
    const naLateral: Vetor2 = { x: 186 * MM, y: 150 * MM };
    editor.apontar(naLateral);
    editor.soltar(naLateral);

    const parado = montarCena(editor);
    editor.usar('moverPonto');
    const ombro = editor.cena.derivados(PECA).peca.pontos['pt-3']!;
    editor.apontar(ombro);
    editor.arrastar({ x: ombro.x + 20 * MM, y: ombro.y }, { shift: false, ctrl: false, alt: true });
    const arrastando = montarCena(editor);

    const conta = (cs: readonly Comando[], camada: string) =>
      cs.filter((c) => c.camada === camada).length;

    console.log('--- durante o arrasto ---');
    console.log(
      `parado:     corte ${conta(parado, 'corte')} | pique ${conta(parado, 'pique')} | ` +
        `costura ${conta(parado, 'costura')}`,
    );
    console.log(
      `arrastando: corte ${conta(arrastando, 'corte')} | pique ${conta(arrastando, 'pique')} | ` +
        `costura ${conta(arrastando, 'costura')}`,
    );
    expect(conta(arrastando, 'corte')).toBeGreaterThan(0);
    expect(conta(arrastando, 'pique')).toBeGreaterThan(0);
  });

  it('a peca arrastada acompanha o cursor, e a caixa de culling vai junto', () => {
    const editor = novoEditor();
    editor.usar('moverPeca');
    const dentro: Vetor2 = { x: 60 * MM, y: 200 * MM };
    const xDe = (cs: readonly Comando[]): number => {
      const linha = cs.find((c) => c.camada === 'costura' && c.forma === 'linha');
      if (linha?.forma !== 'linha') return NaN;
      return Math.min(...linha.pontos.map((p) => p.x));
    };

    const parado = xDe(montarCena(editor));
    editor.apontar(dentro);
    editor.arrastar({ x: dentro.x + 60 * MM, y: dentro.y });
    const arrastando = xDe(montarCena(editor));

    console.log('--- a peca acompanha o arrasto ---');
    console.log(
      `borda esquerda: ${umParaMM(parado)} mm -> ${umParaMM(arrastando)} mm ` +
        `(arrastou 60 mm)`,
    );
    expect(umParaMM(arrastando - parado)).toBeCloseTo(60, 6);
  });

  it('arrastada para longe da vista, ela e culada — e isso e o certo', () => {
    const editor = novoEditor();
    editor.usar('moverPeca');
    const dentro: Vetor2 = { x: 60 * MM, y: 200 * MM };
    const largura = editor.camera.vista.maxX - editor.camera.vista.minX;
    editor.apontar(dentro);
    editor.arrastar({ x: dentro.x + largura * 2, y: dentro.y });

    const costura = montarCena(editor).filter((c) => c.camada === 'costura' && c.forma === 'linha');
    console.log(
      `arrastou ${umParaMM(largura * 2).toFixed(0)} mm — duas telas — ` +
        `-> ${costura.length} contorno(s): saiu de vista mesmo`,
    );
    expect(costura).toHaveLength(0);
  });

  it('vinte piques nao derrubam a peca — foi assim que o defeito apareceu no uso', () => {
    const editor = novoEditor();
    editor.usar('pique');
    const peca = () => editor.cena.derivados(PECA).peca;

    // Crava piques em todas as arestas com margem, varios por aresta.
    const arestas = Object.keys(peca().arestas).filter((id) => (peca().margens[id] ?? 0) > 0);
    let n = 0;
    for (const arestaId of arestas) {
      for (const s of [0.2, 0.4, 0.6, 0.8]) {
        editor.sessao.aplicar({
          tipo: 'AdicionarPique',
          pecaId: PECA,
          payload: {
            piqueId: `pq-${n++}`,
            arestaId,
            s,
            tipo: 'V',
            alturaUM: 6350,
            larguraUM: 1590,
            anguloGraus: 0,
          },
        });
      }
    }

    const cena = montarCena(editor);
    const costura = cena.filter((c) => c.camada === 'costura' && c.forma === 'linha');
    const projetados = editor.cena.derivados(PECA).piques.length;

    console.log('--- muitos piques ---');
    console.log(
      `${n} piques em ${arestas.length} arestas -> ${projetados} projetados, ` +
        `${costura.length} contorno(s) desenhado(s), ` +
        `${cena.filter((c) => c.camada === 'pique').length} comandos de pique`,
    );
    expect(n).toBe(20);
    expect(projetados).toBe(20);
    expect(costura.length).toBeGreaterThan(0);
  });
});
