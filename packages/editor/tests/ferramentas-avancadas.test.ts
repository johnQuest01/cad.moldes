/**
 * Bloco 7 — as ferramentas que faltavam.
 *
 * Mesmas tres regras da Parte 4 (um gesto = um evento; recusa do motor cancela;
 * `Esc` cancela), mais o que cada uma tem de particular. Tudo pelo harness de
 * ponteiro: entra coordenada em UM, sai evento.
 */
import { describe, expect, it } from 'vitest';

import { MM, anelDoContorno, area, medirAresta, umParaMM, type Id, type Vetor2 } from '@cad/motor';

import {
  Editor,
  SEM_MODIFICADOR,
  ferramentaChanfro,
  ferramentaControle,
  ferramentaConverter,
  ferramentaDividir,
  ferramentaEixoDobra,
  ferramentaEspelhar,
  ferramentaFillet,
  ferramentaGradePoint,
  ferramentaLinhaInterna,
  ferramentaParCostura,
  ferramentaRotacionar,
  ferramentasAvancadas,
  ferramentasEssenciais,
  montarCena,
  type Ferramenta,
} from '../src/index.js';

import { PECA, sessaoDaBlusa } from './fixtures.js';

const ALT = { ...SEM_MODIFICADOR, alt: true };
const SHIFT = { ...SEM_MODIFICADOR, shift: true };

function com(...ferramentas: readonly Ferramenta[]): Editor {
  const editor = new Editor(sessaoDaBlusa(), [...ferramentas], 1280, 800);
  editor.camera.definirZoom(1);
  return editor;
}

const tipos = (e: Editor): string[] => e.sessao.pendentes.map((ev) => ev.tipo);
const carga = (e: Editor, i = 0): Record<string, unknown> =>
  e.sessao.pendentes[i]!.payload as Record<string, unknown>;
const peca = (e: Editor) => e.cena.derivados(PECA).peca;

/** Um ponto no meio da lateral, longe de vertice. */
const NA_LATERAL: Vetor2 = { x: 185 * MM, y: 150 * MM };

// ===========================================================================

describe('Converter reta <-> curva', () => {
  it('converter nao muda medida nenhuma — e depois o controle e que da forma', () => {
    const editor = com(ferramentaConverter());
    const antes = medirAresta(peca(editor), 'ar-bainha');

    // A bainha e reta: clique converte para curva.
    editor.apontar({ x: 90 * MM, y: 0 });
    editor.soltar({ x: 90 * MM, y: 0 });
    const depois = medirAresta(peca(editor), 'ar-bainha');

    console.log('--- converter ---');
    console.log(
      `bainha reta ${umParaMM(antes)} mm -> convertida em curva ${umParaMM(depois)} mm ` +
        `| evento ${tipos(editor).join(', ')} para "${String(carga(editor)['para'])}"`,
    );
    expect(tipos(editor)).toEqual(['ConverterSegmento']);
    expect(carga(editor)['para']).toBe('curva');
    expect(depois).toBe(antes);
  });

  it('clicar de novo volta para reta', () => {
    const editor = com(ferramentaConverter());
    editor.apontar({ x: 90 * MM, y: 0 });
    editor.soltar({ x: 90 * MM, y: 0 });
    editor.apontar({ x: 90 * MM, y: 0 });
    editor.soltar({ x: 90 * MM, y: 0 });
    console.log(`dois cliques -> ${tipos(editor).join(', ')} (${carga(editor, 1)['para']})`);
    expect(tipos(editor)).toEqual(['ConverterSegmento', 'ConverterSegmento']);
    expect(carga(editor, 1)['para']).toBe('reta');
  });
});

describe('Controle da curva — o gesto que desenha cava e decote', () => {
  it('clicar na aresta abre as alcas; arrastar uma delas emite MoverControle', () => {
    const abertos = new Set<Id>();
    const editor = com(ferramentaControle(abertos));
    const antes = medirAresta(peca(editor), 'ar-cava');

    // Clique na cava (que ja e Bezier) poe as alcas a mostra.
    const naCava: Vetor2 = { x: 186 * MM, y: 350 * MM };
    editor.apontar(naCava);
    editor.soltar(naCava);
    const abriu = [...abertos];

    // Agora arrasta o controle 0 do segmento aberto.
    const controle = peca(editor).segmentos[abriu[0]!]!.controles![0];
    editor.apontar(controle);
    editor.arrastar({ x: controle.x + 25 * MM, y: controle.y });
    editor.soltar({ x: controle.x + 25 * MM, y: controle.y });

    const depois = medirAresta(peca(editor), 'ar-cava');
    const extremos = [peca(editor).pontos['pt-2']!, peca(editor).pontos['pt-3']!];

    console.log('--- controle da curva ---');
    console.log(`clique na cava -> alcas abertas em: ${abriu.join(', ')}`);
    console.log(
      `arrastou o controle 25 mm -> ${tipos(editor).join(', ')} | ` +
        `cava ${umParaMM(antes)} -> ${umParaMM(depois)} mm`,
    );
    console.log(
      `extremos intactos: (${umParaMM(extremos[0]!.x)}, ${umParaMM(extremos[0]!.y)}) e ` +
        `(${umParaMM(extremos[1]!.x)}, ${umParaMM(extremos[1]!.y)}) mm`,
    );

    expect(abriu).toHaveLength(1);
    expect(tipos(editor)).toEqual(['MoverControle']);
    expect(carga(editor)['dx']).toBe(25 * MM);
    expect(depois).not.toBe(antes);
    expect(extremos[0]).toEqual({ id: 'pt-2', x: 190 * MM, y: 300 * MM, tipo: 'contorno' });
  });

  it('as alcas abertas aparecem no overlay da cena', () => {
    const abertos = new Set<Id>();
    const editor = com(ferramentaControle(abertos));
    const semAlcas = montarCena(editor, { comControleVisivel: abertos }).filter(
      (c) => c.camada === 'overlay',
    ).length;

    editor.apontar({ x: 186 * MM, y: 350 * MM });
    editor.soltar({ x: 186 * MM, y: 350 * MM });
    const comAlcas = montarCena(editor, { comControleVisivel: abertos }).filter(
      (c) => c.camada === 'overlay',
    ).length;

    console.log(`overlay: ${semAlcas} comandos sem alcas -> ${comAlcas} com o segmento aberto`);
    expect(comAlcas).toBeGreaterThan(semAlcas);
  });
});

describe('Fillet e chanfro', () => {
  it('fillet arredonda o canto e o perimetro ENCURTA', () => {
    const editor = com(ferramentaFillet({ medidaMM: 25 }));
    const perimetro = (e: Editor) => {
      const anel = anelDoContorno(peca(e));
      let total = 0;
      for (let i = 0; i < anel.length; i++) {
        const a = anel[i]!;
        const b = anel[(i + 1) % anel.length]!;
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return total;
    };
    const antes = perimetro(editor);

    // pt-1: o canto entre a bainha e a lateral.
    const canto = peca(editor).pontos['pt-1']!;
    editor.apontar(canto);
    editor.soltar(canto);

    console.log('--- fillet ---');
    console.log(
      `raio 25 mm no canto da bainha -> ${tipos(editor).join(', ')} ` +
        `(raio ${umParaMM(Number(carga(editor)['raioUM']))} mm)`,
    );
    console.log(
      `perimetro ${umParaMM(antes).toFixed(1)} -> ${umParaMM(perimetro(editor)).toFixed(1)} mm ` +
        `| bainha ${umParaMM(medirAresta(peca(editor), 'ar-bainha')).toFixed(1)} mm`,
    );
    expect(tipos(editor)).toEqual(['ArredondarVertice']);
    expect(carga(editor)['raioUM']).toBe(25 * MM);
    expect(perimetro(editor)).toBeLessThan(antes);
  });

  it('raio que nao cabe e RECUSADO, e nada e emitido', () => {
    const editor = com(ferramentaFillet({ medidaMM: 5000 }));
    const canto = peca(editor).pontos['pt-1']!;
    const versao = editor.sessao.versao;
    editor.apontar(canto);
    editor.soltar(canto);
    console.log(
      `raio de 5 m num canto de blusa -> ${editor.recusa?.codigo} | ` +
        `${editor.sessao.pendentes.length} eventos, versao ${versao} -> ${editor.sessao.versao}`,
    );
    expect(editor.recusa?.codigo).toBe('FILLET_NAO_CABE');
    expect(editor.sessao.pendentes).toHaveLength(0);
  });

  it('chanfrar consome o vertice: digitar de novo nele e recusado, e nada e emitido', () => {
    const editor = com(ferramentaChanfro({ medidaMM: 10 }));
    const canto = peca(editor).pontos['pt-1']!;
    editor.apontar(canto);
    editor.soltar(canto);
    const doClique = tipos(editor).length;

    // O chanfro TROCA o canto por dois pontos novos: `pt-1` nao existe mais.
    editor.numero({ medida: 30 });

    console.log('--- chanfro ---');
    console.log(
      `clique com 10 mm -> ${doClique} evento (${umParaMM(Number(carga(editor)['distanciaUM']))} mm)`,
    );
    console.log(
      `pt-1 ainda existe: ${peca(editor).pontos['pt-1'] !== undefined} | ` +
        `digitar 30 nele -> ${editor.recusa?.codigo}, ${tipos(editor).length} evento no total`,
    );
    expect(doClique).toBe(1);
    expect(carga(editor)['distanciaUM']).toBe(10 * MM);
    expect(peca(editor).pontos['pt-1']).toBeUndefined();
    expect(editor.recusa?.codigo).toBe('PONTO_INEXISTENTE');
    expect(tipos(editor)).toHaveLength(1);
  });

  it('o caminho numerico vale para um canto que ainda existe', () => {
    const editor = com(ferramentaChanfro({ medidaMM: 10 }));
    // Seleciona o canto sem clicar com a ferramenta, e digita a distancia.
    const canto = peca(editor).pontos['pt-1']!;
    editor.selecao.clicar(
      { tipo: 'ponto', pecaId: PECA, pontoId: 'pt-1', ponto: canto },
      SEM_MODIFICADOR,
    );
    editor.numero({ distancia: 30 });
    console.log(
      `sem clicar, so digitando 30 no canto selecionado -> ${tipos(editor).join(', ')} ` +
        `com ${umParaMM(Number(carga(editor)['distanciaUM']))} mm`,
    );
    expect(tipos(editor)).toEqual(['ChanfrarVertice']);
    expect(carga(editor)['distanciaUM']).toBe(30 * MM);
  });
});

describe('Rotacionar e espelhar', () => {
  it('rotacionar mostra o angulo e Shift prende de 15 em 15', () => {
    const editor = com(ferramentaRotacionar());
    const caixa = editor.cena.derivados(PECA).caixa;
    const centro = { x: (caixa.minX + caixa.maxX) / 2, y: (caixa.minY + caixa.maxY) / 2 };

    // Pega DENTRO da peca: rotacionar precisa de um alvo para saber qual peca gira.
    editor.apontar({ x: 60 * MM, y: 200 * MM });
    const de = { x: 60 * MM, y: 200 * MM };
    const raio = Math.hypot(de.x - centro.x, de.y - centro.y);
    const anguloDe = Math.atan2(de.y - centro.y, de.x - centro.x);
    const ate = {
      x: Math.round(centro.x + Math.cos(anguloDe + Math.PI / 6) * raio),
      y: Math.round(centro.y + Math.sin(anguloDe + Math.PI / 6) * raio),
    };
    editor.arrastar(ate, SHIFT);
    const cota = editor.cota?.rotulo;
    editor.soltar(ate, SHIFT);

    console.log('--- rotacionar ---');
    console.log(`cota ao vivo "${cota}" -> evento com ${String(carga(editor)['anguloGraus'])} graus`);
    expect(tipos(editor)).toEqual(['RotacionarPeca']);
    expect(Number(carga(editor)['anguloGraus']) % 15).toBe(0);
  });

  it('rotacionar por valor digitado, sem arrastar', () => {
    const editor = com(ferramentaRotacionar());
    editor.selecao.clicar({ tipo: 'peca', pecaId: PECA, ponto: { x: 0, y: 0 } }, SEM_MODIFICADOR);
    editor.numero({ angulo: 90 });
    const anel = anelDoContorno(peca(editor));
    const largura = Math.max(...anel.map((p) => p.x)) - Math.min(...anel.map((p) => p.x));
    console.log(`girou 90 graus -> largura da peca ${umParaMM(largura)} mm (era 190)`);
    expect(carga(editor)['anguloGraus']).toBe(90);
    expect(umParaMM(largura)).toBeCloseTo(450, 0);
  });

  it('espelhar: dois cliques definem o eixo, e a area nao muda', () => {
    const editor = com(ferramentaEspelhar());
    const antes = area(anelDoContorno(peca(editor)));
    editor.apontar({ x: 0, y: 0 });
    editor.soltar({ x: 0, y: 0 });
    editor.apontar({ x: 0, y: 450 * MM });
    editor.soltar({ x: 0, y: 450 * MM });

    const anel = anelDoContorno(peca(editor));
    console.log('--- espelhar ---');
    console.log(
      `eixo em x = 0 -> ${tipos(editor).join(', ')} | a peca foi de x>=0 para x<=0: ` +
        `maxX = ${umParaMM(Math.max(...anel.map((p) => p.x)))} mm | ` +
        `area ${(antes / 1e8).toFixed(1)} -> ${(area(anel) / 1e8).toFixed(1)} cm2`,
    );
    expect(tipos(editor)).toEqual(['EspelharPeca']);
    // Espelhar ARREDONDA cada coordenada para UM inteiro (D1), entao a area muda
    // por uma fracao minuscula. Exigir igualdade exata seria exigir que o motor
    // guardasse float de milimetro, que e justamente o que a D1 proibe.
    expect(Math.abs(area(anel) - antes) / antes).toBeLessThan(1e-6);
    expect(Math.max(...anel.map((p) => p.x))).toBe(0);
  });
});

describe('Dividir e eixo de dobra', () => {
  it('dividir com dois cliques troca a peca por duas', () => {
    const editor = com(ferramentaDividir({ margemMM: 10 }));
    editor.apontar({ x: -100 * MM, y: 200 * MM });
    editor.soltar({ x: -100 * MM, y: 200 * MM });
    editor.apontar({ x: 300 * MM, y: 200 * MM });
    editor.soltar({ x: 300 * MM, y: 200 * MM });

    console.log('--- dividir ---');
    console.log(
      `${tipos(editor).join(', ')} -> pecas: ${editor.cena.pecas.join(', ')} ` +
        `(a original sumiu: ${editor.cena.modelo.pecas[PECA] === undefined})`,
    );
    expect(tipos(editor)).toEqual(['DividirPeca']);
    expect(editor.cena.pecas).toHaveLength(2);
    expect(editor.cena.modelo.pecas[PECA]).toBeUndefined();
  });

  it('eixo de dobra: dois cliques e ele existe na peca', () => {
    const editor = com(ferramentaEixoDobra());
    const antes = Object.keys(peca(editor).eixosDobra).length;
    editor.apontar({ x: 0, y: 20 * MM });
    editor.soltar({ x: 0, y: 20 * MM });
    editor.apontar({ x: 0, y: 380 * MM });
    editor.soltar({ x: 0, y: 380 * MM });
    console.log(
      `eixos de dobra: ${antes} -> ${Object.keys(peca(editor).eixosDobra).length} | ` +
        `${tipos(editor).join(', ')}`,
    );
    expect(tipos(editor)).toEqual(['DefinirEixoDobra']);
    expect(Object.keys(peca(editor).eixosDobra)).toHaveLength(antes + 1);
  });
});

describe('Linha interna e grade point', () => {
  it('o fio nasce de dois cliques, com Ponto de verdade (D10)', () => {
    const editor = com(ferramentaLinhaInterna({ tipo: 'pence' }));
    const antesPontos = Object.keys(peca(editor).pontos).length;
    editor.apontar({ x: 60 * MM, y: 100 * MM });
    editor.soltar({ x: 60 * MM, y: 100 * MM });
    editor.apontar({ x: 60 * MM, y: 260 * MM });
    editor.soltar({ x: 60 * MM, y: 260 * MM });

    console.log('--- linha interna ---');
    console.log(
      `${tipos(editor).join(', ')} | pontos ${antesPontos} -> ` +
        `${Object.keys(peca(editor).pontos).length} | linhas internas: ` +
        `${Object.values(peca(editor).linhasInternas).map((l) => l.tipo).join(', ')}`,
    );
    expect(tipos(editor)).toEqual(['CriarPonto', 'CriarPonto', 'AdicionarLinhaInterna']);
    expect(Object.keys(peca(editor).pontos)).toHaveLength(antesPontos + 2);
  });

  it('grade point: clique marca, clique de novo desmarca — e a regra fica orfa', () => {
    const editor = com(ferramentaGradePoint());
    // pt-0 ja e grade point na fixture (a ancora, sem regra).
    const gp = Object.values(peca(editor).gradePoints).find((g) => g.pontoId === 'pt-1')!;
    const ponto = peca(editor).pontos['pt-1']!;

    editor.apontar(ponto);
    editor.soltar(ponto);
    const depoisDeDesmarcar = Object.keys(peca(editor).gradePoints).length;
    const orfas = editor.cena.problemas.filter((p) => p.codigo === 'REGRA_SEM_GRADE_POINT');

    editor.apontar(ponto);
    editor.soltar(ponto);

    console.log('--- grade point ---');
    console.log(
      `desmarcou ${gp.id} -> ${depoisDeDesmarcar} grade points, ` +
        `${orfas.length} regra(s) orfa(s) acusada(s)`,
    );
    console.log(`marcou de novo -> ${tipos(editor).join(', ')}`);
    expect(tipos(editor)).toEqual(['DesmarcarGradePoint', 'MarcarGradePoint']);
    expect(orfas.length).toBeGreaterThan(0);
  });
});

describe('Par de costura', () => {
  it('duas arestas de pecas DIFERENTES, com embebido (D9)', () => {
    const editor = new Editor(
      sessaoDaBlusa(),
      [ferramentaParCostura({ embebidoMM: 25 })],
      1280,
      800,
    );
    editor.camera.definirZoom(1);
    editor.sessao.aplicar({
      tipo: 'DuplicarPeca',
      pecaId: PECA,
      payload: { novoPecaId: 'pec-costas', prefixoId: 'cp', dx: 400 * MM, dy: 0, comGraduacao: true },
    });

    // Clica a cava da frente e a aresta correspondente da copia.
    editor.apontar({ x: 186 * MM, y: 350 * MM });
    editor.soltar({ x: 186 * MM, y: 350 * MM });
    editor.apontar({ x: 586 * MM, y: 350 * MM });
    editor.soltar({ x: 586 * MM, y: 350 * MM });

    const pares = Object.values(editor.cena.modelo.paresCostura);
    console.log('--- par de costura ---');
    console.log(
      `${pares.length} par | ${pares[0]?.arestaA} + ${pares[0]?.arestaB} | ` +
        `embebido ${umParaMM(pares[0]?.embebidoUM ?? 0)} mm (D9)`,
    );
    expect(pares).toHaveLength(1);
    expect(pares[0]!.arestaA).not.toBe(pares[0]!.arestaB);
    expect(pares[0]!.embebidoUM).toBe(25 * MM);
  });
});

describe('As dezessete juntas', () => {
  it('o editor aceita as seis essenciais mais as onze avancadas', () => {
    const abertos = new Set<Id>();
    const todas = [
      ...ferramentasEssenciais(),
      ...ferramentasAvancadas({
        segmentosAbertos: abertos,
        canto: { medidaMM: 20 },
        dividir: { margemMM: 10 },
        par: { embebidoMM: 0 },
        linha: { tipo: 'fio' },
      }),
    ];
    const editor = new Editor(sessaoDaBlusa(), todas, 1280, 800);
    const nomes = todas.map((f) => f.nome);
    console.log(`${nomes.length} ferramentas: ${nomes.join(', ')}`);

    for (const nome of nomes) {
      editor.usar(nome);
      expect(editor.ferramenta).toBe(nome);
    }
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes).toHaveLength(17);
  });
});
