/**
 * Teste 3 (medir arco de raio e angulo conhecidos) e teste 15 (pique por
 * comprimento de arco) da Parte 5, mais a propriedade de monotonicidade de `s`.
 *
 * O verb aparece so como ORACULO: `rationalCurveArcLength` (Gauss-Legendre) e
 * `rationalCurveClosestParam` conferem, por um caminho totalmente diferente, o
 * que a tabela de comprimento acumulado do motor produziu.
 */
import { describe, expect, it } from 'vitest';
// Entry-point padrao do verb toca `window`; o build ES roda headless no Node.
import verb from 'verb-nurbs/build/js/verb.es.js';

import { ErroMotor } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import { pontoEmT } from '../src/geometria/bezier.js';
import { medirAresta, pontoEmS, tabelaArcoDaAresta } from '../src/geometria/medir.js';
import type { Bezier } from '../src/geometria/bezier.js';
import type { Peca, Vetor2 } from '../src/tipos.js';
import { MM, TOLERANCIA_MEDICAO_UM } from '../src/unidades.js';
import {
  KAPPA_90,
  logCurvaAssimetrica,
  logQuartoDeCirculo,
  PECA_ID,
} from './fixtures.js';

function curvaVerb(bezier: Bezier) {
  return new verb.geom.BezierCurve(bezier.map((p) => [p.x, p.y, 0])).asNurbs();
}

function arcoDoVerb(bezier: Bezier, ate?: number): number {
  return ate === undefined
    ? verb.eval.Analyze.rationalCurveArcLength(curvaVerb(bezier))
    : verb.eval.Analyze.rationalCurveArcLength(curvaVerb(bezier), ate);
}

/** Comprimento de arco, medido pelo verb, do inicio da curva ate o ponto `p`. */
function arcoDoVerbAteOPonto(bezier: Bezier, p: Vetor2): number {
  const t = verb.eval.Analyze.rationalCurveClosestParam(curvaVerb(bezier), [p.x, p.y, 0]);
  return arcoDoVerb(bezier, t);
}

function arcoBezier(raioUM: number): Bezier {
  const K = Math.round(KAPPA_90 * raioUM);
  return [
    { x: raioUM, y: 0 },
    { x: raioUM, y: K },
    { x: K, y: raioUM },
    { x: 0, y: raioUM },
  ];
}

/** Curva deliberadamente assimetrica: sobe quase reto e depois deita. */
const CONTROLES_ASSIMETRICOS: readonly [Vetor2, Vetor2] = [
  { x: 0, y: 90 * MM },
  { x: 60 * MM, y: 100 * MM },
];
const FIM_ASSIMETRICO: Vetor2 = { x: 150 * MM, y: 100 * MM };
const ASSIMETRICA: Bezier = [
  { x: 0, y: 0 },
  CONTROLES_ASSIMETRICOS[0],
  CONTROLES_ASSIMETRICOS[1],
  FIM_ASSIMETRICO,
];

function pecaAssimetrica(): Peca {
  return reconstruir(logCurvaAssimetrica(CONTROLES_ASSIMETRICOS, FIM_ASSIMETRICO)).pecas[PECA_ID]!;
}

describe('Teste 3 — medir comprimento de aresta', () => {
  it('aresta reta mede o valor exato, sem erro de ponto flutuante', () => {
    const peca = reconstruir(logQuartoDeCirculo(10 * MM)).pecas[PECA_ID]!;
    // ar-vertical vai de (0, 10 mm) a (0,0): 10 mm cravados.
    const medido = medirAresta(peca, 'ar-vertical');
    console.log(`--- TESTE 3a (reta) --- ar-vertical: ${medido} UM | esperado ${10 * MM} UM`);
    expect(medido).toBe(10 * MM);
  });

  it('quarto de circulo bate com o arco analitico e com o comprimento do verb', () => {
    console.log('--- TESTE 3b (arco de raio e angulo conhecidos) ---');
    for (const raioMM of [10, 100]) {
      const raioUM = raioMM * MM;
      const peca = reconstruir(logQuartoDeCirculo(raioUM)).pecas[PECA_ID]!;
      const medido = medirAresta(peca, 'ar-arco');

      const circuloIdeal = (Math.PI / 2) * raioUM;
      const bezierDoVerb = arcoDoVerb(arcoBezier(raioUM));

      const erroVerb = medido - bezierDoVerb;
      const erroCirculo = medido - circuloIdeal;
      console.log(
        `R = ${String(raioMM).padStart(3)} mm | motor ${medido} UM | ` +
          `verb (mesma Bezier) ${bezierDoVerb.toFixed(3)} UM | circulo exato ${circuloIdeal.toFixed(3)} UM`,
      );
      console.log(
        `          erro vs verb ${erroVerb.toFixed(3)} UM (${((erroVerb / bezierDoVerb) * 100).toFixed(4)}%) | ` +
          `erro vs circulo ${erroCirculo.toFixed(3)} UM (${((erroCirculo / circuloIdeal) * 100).toFixed(4)}%)`,
      );

      // Contra o verb: e a mesma curva, entao so pode diferir pela tesselacao.
      expect(Math.abs(erroVerb)).toBeLessThanOrEqual(TOLERANCIA_MEDICAO_UM);
      // Contra o circulo ideal: sobra o erro da propria aproximacao de D1
      // (Bezier cubica aproximando arco), aceito em ~0,027% do raio.
      expect(Math.abs(erroCirculo / circuloIdeal)).toBeLessThan(0.0005);
    }
  });
});

describe('Teste 15 — posicao de pique por comprimento de arco, nunca pelo t de Bezier', () => {
  it('s = 0,5 divide a curva em dois comprimentos iguais; t = 0,5 nao', () => {
    const peca = pecaAssimetrica();
    const comprimento = medirAresta(peca, 'ar-curva');
    const porS = pontoEmS(peca, 'ar-curva', 0.5);
    const porTBruto = pontoEmT(ASSIMETRICA, 0.5);
    const porT: Vetor2 = { x: Math.round(porTBruto.x), y: Math.round(porTBruto.y) };

    const total = arcoDoVerb(ASSIMETRICA);
    const arcoAteS = arcoDoVerbAteOPonto(ASSIMETRICA, porS);
    const arcoAteT = arcoDoVerb(ASSIMETRICA, 0.5);

    console.log('--- TESTE 15 (s por arco x t de Bezier) ---');
    console.log(`comprimento da aresta: motor ${comprimento} UM | verb ${total.toFixed(3)} UM`);
    console.log(`ponto em s = 0,5 -> (${porS.x}, ${porS.y})`);
    console.log(`ponto em t = 0,5 -> (${porT.x}, ${porT.y})`);
    console.log(
      `distancia entre os dois pontos: ${Math.hypot(porS.x - porT.x, porS.y - porT.y).toFixed(1)} UM ` +
        `(${(Math.hypot(porS.x - porT.x, porS.y - porT.y) / MM).toFixed(2)} mm)`,
    );
    console.log(
      `arco ate o ponto de s=0,5 (verb): ${arcoAteS.toFixed(3)} UM | primeira metade ${(total / 2).toFixed(3)} UM | ` +
        `segunda metade ${(total - arcoAteS).toFixed(3)} UM`,
    );
    console.log(
      `arco ate o ponto de t=0,5 (verb): ${arcoAteT.toFixed(3)} UM -> as duas metades ficariam ` +
        `${arcoAteT.toFixed(1)} e ${(total - arcoAteT).toFixed(1)} UM`,
    );

    // As duas metades cortadas em s = 0,5 batem entre si.
    expect(Math.abs(arcoAteS - (total - arcoAteS))).toBeLessThanOrEqual(2 * TOLERANCIA_MEDICAO_UM);
    // E o corte em t = 0,5 NAO bate: se batesse, a tabela de arco nao estaria em uso.
    expect(Math.abs(arcoAteT - (total - arcoAteT))).toBeGreaterThan(1 * MM);
    expect(porS).not.toEqual(porT);
  });

  it('s = 0 e s = 1 caem exatamente nos pontos notaveis da aresta', () => {
    const peca = pecaAssimetrica();
    const inicio = pontoEmS(peca, 'ar-curva', 0);
    const fim = pontoEmS(peca, 'ar-curva', 1);
    console.log(`s=0 -> (${inicio.x}, ${inicio.y}) | s=1 -> (${fim.x}, ${fim.y})`);
    expect(inicio).toEqual({ x: 0, y: 0 });
    expect(fim).toEqual(FIM_ASSIMETRICO);
  });

  it('propriedade: s crescente produz arco acumulado crescente (monotonicidade)', () => {
    const peca = pecaAssimetrica();
    const tabela = tabelaArcoDaAresta(peca, 'ar-curva');
    const passos = 200;
    let anterior = -1;
    let piorDesvio = 0;
    let regressoes = 0;

    for (let i = 0; i <= passos; i++) {
      const s = i / passos;
      const ponto = pontoEmS(peca, 'ar-curva', s);
      const arco = arcoDoVerbAteOPonto(ASSIMETRICA, ponto);
      if (arco < anterior - 1e-6) regressoes++;
      anterior = arco;
      piorDesvio = Math.max(piorDesvio, Math.abs(arco - s * tabela.comprimento));
    }

    console.log(
      `--- PROPRIEDADE: s monotonico --- ${passos + 1} amostras | regressoes: ${regressoes} | ` +
        `maior desvio entre arco medido pelo verb e s*L: ${piorDesvio.toFixed(3)} UM`,
    );
    expect(regressoes).toBe(0);
    expect(piorDesvio).toBeLessThanOrEqual(2 * TOLERANCIA_MEDICAO_UM);
  });

  it('recusa s fora de [0, 1] em vez de extrapolar a aresta', () => {
    const peca = pecaAssimetrica();
    for (const s of [-0.001, 1.5, Number.NaN]) {
      let codigo: string | null = null;
      try {
        pontoEmS(peca, 'ar-curva', s);
      } catch (erro) {
        codigo = erro instanceof ErroMotor ? erro.codigo : 'OUTRO';
      }
      console.log(`s = ${String(s).padEnd(7)} -> ${String(codigo)}`);
      expect(codigo).toBe('S_FORA_DA_FAIXA');
    }
  });
});
