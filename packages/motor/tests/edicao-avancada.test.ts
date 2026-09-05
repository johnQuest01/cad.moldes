/**
 * Testes 8, 16 e 17 da Parte 5, e as operacoes 10 a 13 da Parte 3.
 *
 *   8 — simplificacao: desvio maximo medido tem que ficar ABAIXO da tolerancia
 *  16 — fillet de 10 mm num vertice de 90 graus: desvio radial ~2,7 um
 *  17 — aresta com ID estavel: inserir e remover ponto nao mexe em `arestaId`,
 *       nem na margem por aresta, nem no ParCostura
 *
 * O verb entra de novo como oraculo independente: no teste 16 e ele que mede o
 * quanto a Bezier do fillet se afasta do arco de circulo ideal.
 */
import { describe, expect, it } from 'vitest';
// Entry-point padrao do verb toca `window`; o build ES roda headless no Node.
import verb from 'verb-nurbs/build/js/verb.es.js';

import { ErroMotor } from '../src/erros.js';
import type { CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import {
  arredondarVertice,
  chanfrarVertice,
  converterSegmento,
  excluirPonto,
  inserirPonto,
  simplificarContorno,
} from '../src/edicao.js';
import { medirAresta, medirSegmento } from '../src/geometria/medir.js';
import { tesselarContorno, tesselarSegmento } from '../src/geometria/tesselar.js';
import { offsetMargem } from '../src/offset.js';
import type { Peca, Vetor2 } from '../src/tipos.js';
import { MM, TOLERANCIA_TESSELACAO_UM, umParaMM } from '../src/unidades.js';
import { logPoligonoLivre, logQuartoDeCirculo, logRetanguloPadrao, PECA_ID } from './fixtures.js';

function codigoDoErro(acao: () => unknown): CodigoErro | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

function distanciaAoSegmento(p: Vetor2, a: Vetor2, b: Vetor2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const comprimento2 = vx * vx + vy * vy;
  if (comprimento2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / comprimento2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Maior distancia de cada ponto de `a` ate a poligonal fechada `b`. */
function maiorAfastamento(a: readonly Vetor2[], b: readonly Vetor2[]): number {
  let maior = 0;
  for (const ponto of a) {
    let menor = Number.POSITIVE_INFINITY;
    for (let i = 0; i < b.length; i++) {
      menor = Math.min(menor, distanciaAoSegmento(ponto, b[i]!, b[(i + 1) % b.length]!));
    }
    maior = Math.max(maior, menor);
  }
  return maior;
}

const RETANGULO = (): Peca => reconstruir(logRetanguloPadrao()).pecas[PECA_ID]!;

describe('Teste 17 — aresta com ID estavel sob insercao e remocao de ponto (D3)', () => {
  it('inserir um ponto no meio de um lado nao mexe em arestaId, margem nem ParCostura', () => {
    const antes = RETANGULO();
    const depois = inserirPonto(antes, 'sg-0', 0.5, 'novo');

    const arestasAntes = Object.keys(antes.arestas).sort();
    const arestasDepois = Object.keys(depois.arestas).sort();
    const arestaDosSegmentos = depois.contorno.map((id) => depois.segmentos[id]!.arestaId);

    console.log('--- TESTE 17a (inserir ponto) ---');
    console.log(`contorno: ${antes.contorno.length} -> ${depois.contorno.length} segmentos`);
    console.log(`arestas antes : ${arestasAntes.join(', ')}`);
    console.log(`arestas depois: ${arestasDepois.join(', ')}`);
    console.log(`aresta de cada segmento do contorno: ${arestaDosSegmentos.join(', ')}`);
    console.log(`margens: ${JSON.stringify(depois.margens)}`);

    expect(arestasDepois).toEqual(arestasAntes);
    expect(depois.margens).toEqual(antes.margens);
    // Os dois pedacos do lado de baixo continuam na MESMA aresta.
    expect(depois.segmentos['sg-0']!.arestaId).toBe('ar-baixo');
    expect(depois.segmentos['novo-s']!.arestaId).toBe('ar-baixo');
    expect(depois.contorno.length).toBe(antes.contorno.length + 1);
    // E a aresta continua declarando os mesmos extremos.
    expect(depois.arestas['ar-baixo']).toEqual(antes.arestas['ar-baixo']);
  });

  it('a peca nao muda de forma: o ponto novo cai sobre o contorno antigo', () => {
    const antes = RETANGULO();
    const depois = inserirPonto(antes, 'sg-0', 0.5, 'novo');
    const novo = depois.pontos['novo-p']!;

    console.log(
      `ponto inserido em s = 0,5 do lado de baixo (0,0)-(100,0): ` +
        `(${umParaMM(novo.x)}, ${umParaMM(novo.y)}) mm`,
    );
    console.log(
      `medida do lado: ${umParaMM(medirAresta(antes, 'ar-baixo'))} -> ` +
        `${umParaMM(medirAresta(depois, 'ar-baixo'))} mm`,
    );
    expect(novo).toEqual({ id: 'novo-p', x: 50 * MM, y: 0, tipo: 'contorno' });
    expect(medirAresta(depois, 'ar-baixo')).toBe(medirAresta(antes, 'ar-baixo'));
    // E a linha de corte sai igual.
    expect(offsetMargem(depois).pontos).toEqual(offsetMargem(antes).pontos);
  });

  it('inserir numa CURVA parte a Bezier sem mudar o desenho', () => {
    const antes = reconstruir(logQuartoDeCirculo(100 * MM)).pecas[PECA_ID]!;
    const depois = inserirPonto(antes, 'sg-0', 0.5, 'meio');

    const contornoAntes = tesselarContorno(antes);
    const contornoDepois = tesselarContorno(depois);
    const desvio = Math.max(
      maiorAfastamento(contornoAntes, contornoDepois),
      maiorAfastamento(contornoDepois, contornoAntes),
    );
    const arcoAntes = medirAresta(antes, 'ar-arco');
    const arcoDepois = medirAresta(depois, 'ar-arco');

    console.log('--- TESTE 17b (inserir ponto em curva) ---');
    console.log(`segmentos da cava: 1 -> 2, ambos na aresta "ar-arco"`);
    console.log(`arco medido: ${arcoAntes} -> ${arcoDepois} UM (diferenca ${arcoDepois - arcoAntes})`);
    console.log(`desvio de forma (Hausdorff): ${desvio.toFixed(3)} UM`);

    expect(depois.segmentos['sg-0']!.tipo).toBe('curva');
    expect(depois.segmentos['meio-s']!.tipo).toBe('curva');
    expect(depois.segmentos['meio-s']!.arestaId).toBe('ar-arco');
    // De Casteljau e exato; so o arredondamento para inteiro sobra.
    expect(desvio).toBeLessThanOrEqual(2);
    expect(Math.abs(arcoDepois - arcoAntes)).toBeLessThanOrEqual(2);
  });

  it('remover o ponto inserido devolve a peca ao estado anterior', () => {
    const antes = RETANGULO();
    const comPonto = inserirPonto(antes, 'sg-0', 0.5, 'novo');
    const devolta = excluirPonto(comPonto, 'novo-p');

    console.log('--- TESTE 17c (remover ponto) ---');
    console.log(`contorno: ${comPonto.contorno.length} -> ${devolta.contorno.length} segmentos`);
    console.log(`arestas: ${Object.keys(devolta.arestas).sort().join(', ')}`);
    expect(devolta.contorno).toEqual(antes.contorno);
    expect(devolta.pontos).toEqual(antes.pontos);
    expect(devolta.segmentos).toEqual(antes.segmentos);
    expect(devolta.arestas).toEqual(antes.arestas);
  });

  it('recusa remover ponto notavel, grade point e juncao com curva', () => {
    const retangulo = RETANGULO();
    const notavel = codigoDoErro(() => excluirPonto(retangulo, 'pt-1'));

    const comGrade: Peca = {
      ...inserirPonto(retangulo, 'sg-0', 0.5, 'novo'),
      gradePoints: { 'gp-x': { id: 'gp-x', pontoId: 'novo-p' } },
    };
    const gradePoint = codigoDoErro(() => excluirPonto(comGrade, 'novo-p'));

    const arco = reconstruir(logQuartoDeCirculo(100 * MM)).pecas[PECA_ID]!;
    const curva = codigoDoErro(() => excluirPonto(inserirPonto(arco, 'sg-0', 0.5, 'm'), 'm-p'));

    console.log(`remover ponto notavel (extremo de aresta) -> ${notavel}`);
    console.log(`remover ponto que e grade point           -> ${gradePoint}`);
    console.log(`remover juncao entre duas curvas          -> ${curva}`);
    expect(notavel).toBe('PONTO_NOTAVEL_NAO_REMOVIVEL');
    expect(gradePoint).toBe('GRADE_POINT_NAO_REMOVIVEL');
    expect(curva).toBe('MERGE_DE_CURVA_NAO_REPRESENTAVEL');
  });
});

describe('Operacao 12 — converter reta <-> curva', () => {
  it('reta -> curva nao muda o desenho: a Bezier resultante E a reta', () => {
    const antes = RETANGULO();
    const depois = converterSegmento(antes, 'sg-0', 'curva');
    const segmento = depois.segmentos['sg-0']!;

    console.log('--- converter reta -> curva ---');
    console.log(`controles: ${JSON.stringify(segmento.controles)}`);
    console.log(
      `medida do lado: ${medirSegmento(antes, 'sg-0')} -> ${medirSegmento(depois, 'sg-0')} UM`,
    );
    console.log(`area do contorno igual: ${JSON.stringify(offsetMargem(depois).pontos) === JSON.stringify(offsetMargem(antes).pontos)}`);

    // Controles a 1/3 e 2/3 da propria reta (0,0)-(100,0).
    expect(segmento.controles).toEqual([
      { x: Math.round((100 * MM) / 3), y: 0 },
      { x: Math.round((2 * 100 * MM) / 3), y: 0 },
    ]);
    expect(medirSegmento(depois, 'sg-0')).toBe(medirSegmento(antes, 'sg-0'));
    expect(offsetMargem(depois).pontos).toEqual(offsetMargem(antes).pontos);
  });

  it('curva -> reta descarta os controles e encurta o caminho', () => {
    const antes = reconstruir(logQuartoDeCirculo(100 * MM)).pecas[PECA_ID]!;
    const depois = converterSegmento(antes, 'sg-0', 'reta');
    const arco = medirAresta(antes, 'ar-arco');
    const corda = medirAresta(depois, 'ar-arco');

    console.log('--- converter curva -> reta ---');
    console.log(`arco ${arco} UM -> corda ${corda} UM (a corda tem que ser menor)`);
    expect(depois.segmentos['sg-0']!.tipo).toBe('reta');
    expect(depois.segmentos['sg-0']!.controles).toBeUndefined();
    expect(corda).toBeLessThan(arco);
    // Extremos preservados.
    expect(depois.pontos['pt-0']).toEqual(antes.pontos['pt-0']);
    expect(depois.pontos['pt-1']).toEqual(antes.pontos['pt-1']);
  });

  it('converter para o tipo que ja e nao faz nada', () => {
    const antes = RETANGULO();
    expect(converterSegmento(antes, 'sg-0', 'reta')).toBe(antes);
  });
});

describe('Teste 16 — fillet dentro da tolerancia (D1)', () => {
  it('fillet de raio 10 mm num vertice de 90 graus fica na ordem de 2,7 um do arco ideal', () => {
    const RAIO = 10 * MM;
    const antes = RETANGULO();
    const depois = arredondarVertice(antes, 'pt-1', RAIO, 'fil');

    // Vertice (100,0), lados chegando de (0,0) e indo para (100,200).
    // Angulo interno 90 graus -> recuo = R / tan(45) = R.
    const inicio = depois.pontos['fil-i']!;
    const fim = depois.pontos['fil-f']!;

    console.log('--- TESTE 16 (fillet de 10 mm em canto de 90 graus) ---');
    console.log(
      `tangencia: (${umParaMM(inicio.x)}, ${umParaMM(inicio.y)}) e (${umParaMM(fim.x)}, ${umParaMM(fim.y)}) mm` +
        `  | esperado (90, 0) e (100, 10)`,
    );

    expect(inicio).toMatchObject({ x: 90 * MM, y: 0 });
    expect(fim).toMatchObject({ x: 100 * MM, y: 10 * MM });

    // Centro do circulo inscrito: a R de cada lado -> (90, 10).
    const centro = { x: 90 * MM, y: 10 * MM };

    // pt-1 e fronteira entre ar-baixo e ar-direita, entao o arco saiu partido em
    // duas metades. Cada metade e medida com os SEUS proprios extremos: usar os
    // extremos do arco inteiro com os controles de uma metade daria outra curva.
    const metades = ['fil-s1', 'fil-s2'].filter((id) => depois.segmentos[id] !== undefined);
    let desvioVerb = 0;
    let desvioPoligonal = 0;

    for (const id of metades) {
      const segmento = depois.segmentos[id]!;
      const de = depois.pontos[segmento.de]!;
      const para = depois.pontos[segmento.para]!;
      const controles = segmento.controles!;

      // Oraculo independente: o verb avalia a mesma Bezier em 2000 parametros.
      const curva = new verb.geom.BezierCurve(
        [de, controles[0], controles[1], para].map((p) => [p.x, p.y, 0]),
      ).asNurbs();
      for (let i = 0; i <= 2000; i++) {
        const p = verb.eval.Eval.rationalCurvePoint(curva, i / 2000);
        desvioVerb = Math.max(
          desvioVerb,
          Math.abs(Math.hypot(p[0]! - centro.x, p[1]! - centro.y) - RAIO),
        );
      }
      for (const p of tesselarSegmento(depois, id, 1)) {
        desvioPoligonal = Math.max(
          desvioPoligonal,
          Math.abs(Math.hypot(p.x - centro.x, p.y - centro.y) - RAIO),
        );
      }
    }

    console.log(`arco partido em ${metades.length} metade(s): ${metades.join(', ')}`);
    console.log(`centro do circulo inscrito: (${umParaMM(centro.x)}, ${umParaMM(centro.y)}) mm`);
    console.log(
      `desvio radial maximo: ${desvioVerb.toFixed(4)} UM pelo verb | ` +
        `${desvioPoligonal.toFixed(4)} UM pela poligonal`,
    );
    console.log(
      `  esperado ~2,7 UM (0,027% de ${RAIO} UM) | tolerancia de tesselacao ${TOLERANCIA_TESSELACAO_UM} UM`,
    );

    // D1: erro radial de ~0,027% do raio num arco de 90 graus. O que sobra alem
    // disso e o arredondamento dos controles para micrometro inteiro.
    expect(desvioVerb).toBeGreaterThan(1);
    expect(desvioVerb).toBeLessThan(5);
    expect(desvioVerb).toBeLessThan(TOLERANCIA_TESSELACAO_UM);
  });

  it('o fillet num canto entre DUAS arestas parte o arco ao meio e mantem os dois ids (D3)', () => {
    // pt-1 e fim de "ar-baixo" e inicio de "ar-direita".
    const antes = RETANGULO();
    const depois = arredondarVertice(antes, 'pt-1', 10 * MM, 'fil');

    console.log('--- fillet na fronteira entre duas arestas ---');
    console.log(`arestas: ${Object.keys(depois.arestas).sort().join(', ')} (as mesmas 4)`);
    console.log(
      `ar-baixo: ${antes.arestas['ar-baixo']!.pontoInicioId} -> ${antes.arestas['ar-baixo']!.pontoFimId} ` +
        `vira ${depois.arestas['ar-baixo']!.pontoInicioId} -> ${depois.arestas['ar-baixo']!.pontoFimId}`,
    );
    console.log(`ponto do meio do arco: "fil-m" | margens intactas: ${JSON.stringify(depois.margens)}`);

    expect(Object.keys(depois.arestas).sort()).toEqual(Object.keys(antes.arestas).sort());
    expect(depois.margens).toEqual(antes.margens);
    // A fronteira entre as duas arestas passou a ser o meio do arco.
    expect(depois.arestas['ar-baixo']!.pontoFimId).toBe('fil-m');
    expect(depois.arestas['ar-direita']!.pontoInicioId).toBe('fil-m');
    expect(depois.segmentos['fil-s1']!.arestaId).toBe('ar-baixo');
    expect(depois.segmentos['fil-s2']!.arestaId).toBe('ar-direita');
    // O ponto antigo sumiu.
    expect(depois.pontos['pt-1']).toBeUndefined();
  });

  it('chanfro de 20 mm corta os dois lados na distancia pedida', () => {
    const antes = RETANGULO();
    const depois = chanfrarVertice(antes, 'pt-1', 20 * MM, 'cha');
    const inicio = depois.pontos['cha-i']!;
    const fim = depois.pontos['cha-f']!;
    const meio = depois.pontos['cha-m']!;

    console.log('--- chanfro de 20 mm ---');
    console.log(
      `(${umParaMM(inicio.x)}, ${umParaMM(inicio.y)}) -> (${umParaMM(meio.x)}, ${umParaMM(meio.y)}) -> ` +
        `(${umParaMM(fim.x)}, ${umParaMM(fim.y)}) mm  | esperado (80,0) -> (90,10) -> (100,20)`,
    );
    expect(inicio).toMatchObject({ x: 80 * MM, y: 0 });
    expect(fim).toMatchObject({ x: 100 * MM, y: 20 * MM });
    expect(meio).toMatchObject({ x: 90 * MM, y: 10 * MM });
    expect(depois.segmentos['cha-s1']!.tipo).toBe('reta');
  });

  it('recusa fillet que nao cabe, raio invalido e canto que envolve curva', () => {
    const retangulo = RETANGULO();
    // O lado de baixo tem 100 mm; raio 200 mm recua 200 mm de cada lado.
    const naoCabe = codigoDoErro(() => arredondarVertice(retangulo, 'pt-1', 200 * MM, 'x'));
    const raioZero = codigoDoErro(() => arredondarVertice(retangulo, 'pt-1', 0, 'x'));
    const arco = reconstruir(logQuartoDeCirculo(100 * MM)).pecas[PECA_ID]!;
    const emCurva = codigoDoErro(() => arredondarVertice(arco, 'pt-1', 5 * MM, 'x'));

    console.log(`fillet de 200 mm em lado de 100 mm -> ${naoCabe}`);
    console.log(`raio zero                          -> ${raioZero}`);
    console.log(`canto onde ja ha curva             -> ${emCurva}`);
    expect(naoCabe).toBe('FILLET_NAO_CABE');
    expect(raioZero).toBe('RAIO_INVALIDO');
    expect(emCurva).toBe('FILLET_EM_CURVA_NAO_SUPORTADO');
  });
});

describe('Teste 8 — simplificacao com desvio medido', () => {
  /**
   * Um lado "digitalizado": 41 pontos com ruido de ate 30 UM em cima de uma reta
   * de 200 mm, mais tres lados retos. Todos os 41 estao na MESMA aresta, entao a
   * simplificacao pode mexer neles.
   */
  function pecaRuidosa(): Peca {
    const vertices: Vetor2[] = [{ x: 0, y: 0 }];
    for (let i = 1; i <= 40; i++) {
      const x = Math.round((200 * MM * i) / 40);
      const ruido = Math.round(30 * Math.sin(i * 1.7));
      vertices.push({ x, y: ruido });
    }
    vertices.push({ x: 200 * MM, y: 120 * MM });
    vertices.push({ x: 0, y: 120 * MM });

    const peca = reconstruir(logPoligonoLivre(vertices, 0)).pecas[PECA_ID]!;
    // logPoligonoLivre da uma aresta por lado; junta os 40 primeiros numa aresta
    // so, que e como um lado digitalizado chega de verdade.
    const segmentos = { ...peca.segmentos };
    for (let i = 0; i < 40; i++) {
      segmentos[`sg-${i}`] = { ...segmentos[`sg-${i}`]!, arestaId: 'ar-0' };
    }
    const arestas = { ...peca.arestas };
    arestas['ar-0'] = { ...arestas['ar-0']!, pontoFimId: 'pt-40' };
    for (let i = 1; i < 40; i++) delete arestas[`ar-${i}`];
    const margens = { ...peca.margens };
    for (let i = 1; i < 40; i++) delete margens[`ar-${i}`];
    return { ...peca, segmentos, arestas, margens };
  }

  it('reduz pontos e o desvio maximo medido fica abaixo da tolerancia', () => {
    const antes = pecaRuidosa();
    const contornoAntes = tesselarContorno(antes);

    console.log('--- TESTE 8 (Douglas-Peucker do clipper2) ---');
    for (const toleranciaUM of [10, 50, TOLERANCIA_TESSELACAO_UM, 1000]) {
      const depois = simplificarContorno(antes, toleranciaUM);
      const contornoDepois = tesselarContorno(depois);
      const desvio = maiorAfastamento(contornoAntes, contornoDepois);

      console.log(
        `tol ${String(toleranciaUM).padStart(4)} UM -> ${String(contornoAntes.length).padStart(2)} ` +
          `vertices viram ${String(contornoDepois.length).padStart(2)} | ` +
          `desvio maximo medido ${desvio.toFixed(2)} UM`,
      );
      // "A peca simplificada NUNCA desvia da original alem da tolerancia."
      expect(desvio).toBeLessThanOrEqual(toleranciaUM);
      expect(contornoDepois.length).toBeLessThanOrEqual(contornoAntes.length);
    }
  });

  it('nao encosta em ponto notavel, grade point nem extremo de curva', () => {
    const antes = pecaRuidosa();
    // Marca um dos pontos ruidosos como grade point e outro como notavel.
    const comProtegidos: Peca = {
      ...antes,
      gradePoints: { 'gp-x': { id: 'gp-x', pontoId: 'pt-20' } },
    };
    const depois = simplificarContorno(comProtegidos, 1000);

    console.log('--- protegidos da simplificacao ---');
    console.log(`grade point pt-20 sobreviveu: ${depois.pontos['pt-20'] !== undefined}`);
    console.log(
      `pontos notaveis pt-0, pt-40, pt-41: ` +
        `${['pt-0', 'pt-40', 'pt-41'].map((id) => depois.pontos[id] !== undefined).join(', ')}`,
    );
    expect(depois.pontos['pt-20']).toBeDefined();
    for (const id of ['pt-0', 'pt-40', 'pt-41']) expect(depois.pontos[id]).toBeDefined();
    // As arestas continuam todas la, com os mesmos ids.
    expect(Object.keys(depois.arestas).sort()).toEqual(Object.keys(antes.arestas).sort());
  });

  it('nao mexe em contorno que ja e minimo, e recusa tolerancia invalida', () => {
    const retangulo = RETANGULO();
    console.log(
      `retangulo de 4 lados @ tol 1000 UM -> ${simplificarContorno(retangulo, 1000).contorno.length} segmentos`,
    );
    expect(simplificarContorno(retangulo, 1000)).toBe(retangulo);
    for (const tolerancia of [0, -5, Number.NaN]) {
      expect(codigoDoErro(() => simplificarContorno(retangulo, tolerancia))).toBe(
        'TOLERANCIA_INVALIDA',
      );
    }
  });
});
