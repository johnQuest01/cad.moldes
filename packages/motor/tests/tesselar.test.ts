/**
 * Bloco 3 — tesselacao (Parte 2, operacao 2).
 *
 * O verb entra aqui como ORACULO INDEPENDENTE: a poligonal e produzida pelo motor
 * e conferida contra `verb.eval.Eval.rationalCurvePoint`, que e a avaliacao exata
 * da curva. Se o motor errasse a subdivisao, o desvio contra o verb apareceria.
 *
 * Tambem esta aqui a prova do motivo pelo qual a tesselacao NAO sai do amostrador
 * adaptativo do verb: ele nao e deterministico.
 */
import { describe, expect, it } from 'vitest';
// O entry-point padrao do verb (verbHaxe.js) toca `window` e quebra no Node; o
// build ES roda headless. O verb so aparece em TESTE, como oraculo independente.
import verb from 'verb-nurbs/build/js/verb.es.js';

import { ErroMotor } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import {
  limiteDesvioDaCorda,
  parametroEmS,
  pontoEmT,
  subdividirEmT,
  tesselarBezier,
} from '../src/geometria/bezier.js';
import { tesselarContorno, tesselarSegmento } from '../src/geometria/tesselar.js';
import type { Bezier } from '../src/geometria/bezier.js';
import type { Peca, Vetor2 } from '../src/tipos.js';
import { MM, TOLERANCIA_TESSELACAO_UM } from '../src/unidades.js';
import { KAPPA_90, logQuartoDeCirculo, PECA_ID } from './fixtures.js';

const RAIO: number = 10 * MM;
const K: number = Math.round(KAPPA_90 * RAIO);

/** O mesmo quarto de circulo do fixture, como Bezier crua. */
const ARCO: Bezier = [
  { x: RAIO, y: 0 },
  { x: RAIO, y: K },
  { x: K, y: RAIO },
  { x: 0, y: RAIO },
];

function pecaDoArco(): Peca {
  return reconstruir(logQuartoDeCirculo(RAIO)).pecas[PECA_ID]!;
}

/** Curva do verb equivalente, para servir de oraculo. */
function curvaVerb(bezier: Bezier) {
  return new verb.geom.BezierCurve(bezier.map((p) => [p.x, p.y, 0])).asNurbs();
}

/** Maior distancia de um ponto da curva ate a poligonal (desvio real, medido). */
function desvioMaximoContraVerb(bezier: Bezier, poligonal: readonly Vetor2[], amostras = 4000) {
  const curva = curvaVerb(bezier);
  let maior = 0;
  for (let i = 0; i <= amostras; i++) {
    const p = verb.eval.Eval.rationalCurvePoint(curva, i / amostras);
    maior = Math.max(maior, distanciaAPoligonal({ x: p[0]!, y: p[1]! }, poligonal));
  }
  return maior;
}

function distanciaAPoligonal(p: Vetor2, poligonal: readonly Vetor2[]): number {
  let menor = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poligonal.length - 1; i++) {
    menor = Math.min(menor, distanciaAoSegmento(p, poligonal[i]!, poligonal[i + 1]!));
  }
  return menor;
}

function distanciaAoSegmento(p: Vetor2, a: Vetor2, b: Vetor2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const comprimento2 = vx * vx + vy * vy;
  if (comprimento2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / comprimento2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

describe('Bloco 3 — tesselacao deterministica dentro da tolerancia', () => {
  it('o amostrador adaptativo do verb NAO e deterministico (por isso nao e usado)', () => {
    const curva = curvaVerb(ARCO);
    const assinatura = () => {
      const pts: number[][] = verb.eval.Tess.rationalCurveAdaptiveSample(curva, 100, false);
      let comprimento = 0;
      for (let i = 1; i < pts.length; i++) {
        comprimento += Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!);
      }
      return `${pts.length} pontos / ${comprimento.toFixed(9)} UM`;
    };

    // Curvas aleatorias: e nelas que o sorteio interno do verb aparece.
    let instaveis = 0;
    for (let n = 0; n < 200; n++) {
      const controles = Array.from({ length: 4 }, () => [
        Math.round(Math.random() * 200000 - 100000),
        Math.round(Math.random() * 200000 - 100000),
        0,
      ]);
      const c = new verb.geom.BezierCurve(controles).asNurbs();
      const medir = () => verb.eval.Tess.rationalCurveAdaptiveSample(c, 100, false).length;
      if (new Set([medir(), medir(), medir()]).size > 1) instaveis++;
    }

    console.log('--- POR QUE NAO USAMOS verb.eval.Tess.rationalCurveAdaptiveSample ---');
    console.log(`verb, mesmo arco, 3 chamadas: ${assinatura()} | ${assinatura()} | ${assinatura()}`);
    console.log(`verb, 200 curvas aleatorias x 3 chamadas -> instaveis: ${instaveis}/200`);
    expect(instaveis).toBeGreaterThan(0);
  });

  it('a tesselacao do motor e byte-identica em chamadas repetidas', () => {
    const peca = pecaDoArco();
    const assinaturas = new Set<string>();
    for (let i = 0; i < 20; i++) {
      assinaturas.add(JSON.stringify(tesselarSegmento(peca, 'sg-0')));
    }
    const pontos = tesselarSegmento(peca, 'sg-0');
    console.log('--- TESSELACAO DO MOTOR (deterministica) ---');
    console.log(`20 chamadas -> ${assinaturas.size} resultado(s) distinto(s)`);
    console.log(`quarto de circulo R=10 mm @ tol 100 UM -> ${pontos.length} pontos`);
    expect(assinaturas.size).toBe(1);
  });

  it('o desvio real contra a curva do verb fica abaixo da tolerancia', () => {
    const peca = pecaDoArco();
    console.log('--- DESVIO MEDIDO CONTRA O ORACULO (verb) ---');
    for (const tolerancia of [1000, TOLERANCIA_TESSELACAO_UM, 10, 1]) {
      const pontos = tesselarSegmento(peca, 'sg-0', tolerancia);
      const desvio = desvioMaximoContraVerb(ARCO, pontos);
      console.log(
        `tol ${String(tolerancia).padStart(4)} UM -> ${String(pontos.length).padStart(3)} pontos | ` +
          `desvio real ${desvio.toFixed(4)} UM | limite provado na corda inteira ${limiteDesvioDaCorda(ARCO).toFixed(1)} UM`,
      );
      // 0,5 UM de folga: o arredondamento dos vertices para inteiro (inegociavel 1).
      expect(desvio).toBeLessThanOrEqual(tolerancia + 0.5);
    }
  });

  it('a poligonal encosta exatamente nos pontos do modelo nos dois extremos', () => {
    const peca = pecaDoArco();
    const pontos = tesselarSegmento(peca, 'sg-0');
    const primeiro = pontos[0]!;
    const ultimo = pontos[pontos.length - 1]!;
    console.log(
      `extremos: (${primeiro.x}, ${primeiro.y}) e (${ultimo.x}, ${ultimo.y}) | ` +
        `modelo: (${RAIO}, 0) e (0, ${RAIO})`,
    );
    expect(primeiro).toEqual({ x: RAIO, y: 0 });
    expect(ultimo).toEqual({ x: 0, y: RAIO });
  });

  it('o contorno com curva fecha e nao repete o ponto de emenda', () => {
    const peca = pecaDoArco();
    const anel = tesselarContorno(peca);
    const duplicados = anel.filter(
      (p, i) => i > 0 && p.x === anel[i - 1]!.x && p.y === anel[i - 1]!.y,
    );
    console.log(
      `anel do contorno: ${anel.length} vertices | duplicados consecutivos: ${duplicados.length}`,
    );
    expect(duplicados).toHaveLength(0);
    expect(anel).toContainEqual({ x: 0, y: 0 });
  });

  it('o limite de desvio e cota SUPERIOR: nunca subestima o desvio real', () => {
    // Propriedade: para qualquer Bezier, o desvio real medido <= limite provado.
    let piorRazao = 0;
    for (let n = 0; n < 120; n++) {
      const bezier: Bezier = [
        { x: 0, y: 0 },
        { x: Math.random() * 100000 - 50000, y: Math.random() * 100000 - 50000 },
        { x: Math.random() * 100000 - 50000, y: Math.random() * 100000 - 50000 },
        { x: Math.random() * 100000, y: Math.random() * 100000 },
      ];
      const limite = limiteDesvioDaCorda(bezier);
      if (limite === 0) continue;
      let real = 0;
      for (let i = 0; i <= 500; i++) {
        const p = pontoEmT(bezier, i / 500);
        real = Math.max(real, distanciaAoSegmento(p, bezier[0], bezier[3]));
      }
      expect(real).toBeLessThanOrEqual(limite + 1e-6);
      piorRazao = Math.max(piorRazao, real / limite);
    }
    console.log(
      `120 Beziers aleatorias: pior razao desvio_real/limite = ${piorRazao.toFixed(4)} (tem que ser <= 1)`,
    );
  });

  it('recusa tolerancia invalida em vez de tesselar de qualquer jeito', () => {
    for (const tolerancia of [0, -1, Number.NaN]) {
      let codigo: string | null = null;
      try {
        tesselarBezier(ARCO, tolerancia);
      } catch (erro) {
        codigo = erro instanceof ErroMotor ? erro.codigo : 'OUTRO';
      }
      console.log(`tolerancia ${String(tolerancia).padEnd(4)} -> ${String(codigo)}`);
      expect(codigo).toBe('TOLERANCIA_INVALIDA');
    }
  });

  it('recusa curva com os 4 pontos de controle colados (comprimento zero)', () => {
    const peca = pecaDoArco();
    const colada: Peca = {
      ...peca,
      pontos: { ...peca.pontos, 'pt-1': { ...peca.pontos['pt-1']!, x: RAIO, y: 0 } },
      segmentos: {
        ...peca.segmentos,
        'sg-0': {
          ...peca.segmentos['sg-0']!,
          controles: [
            { x: RAIO, y: 0 },
            { x: RAIO, y: 0 },
          ],
        },
      },
    };
    let codigo: string | null = null;
    try {
      tesselarSegmento(colada, 'sg-0');
    } catch (erro) {
      codigo = erro instanceof ErroMotor ? erro.codigo : 'OUTRO';
    }
    console.log(`curva de comprimento zero -> ${String(codigo)}`);
    expect(codigo).toBe('SEGMENTO_COMPRIMENTO_ZERO');
  });
});

describe('Subdivisao em t e conversao s -> t (base das operacoes 10 a 13)', () => {
  it('subdividir em t reproduz a curva original, ponto a ponto', () => {
    // Propriedade de de Casteljau: as duas partes SAO a curva de antes, nao uma
    // aproximacao. Se nao fosse exato, inserir um ponto no meio de uma curva
    // mudaria o desenho da peca sem ninguem pedir.
    let piorDesvio = 0;
    for (const t of [0.1, 0.25, 0.5, 0.73, 0.9]) {
      const [esquerda, direita] = subdividirEmT(ARCO, t);
      for (let i = 0; i <= 200; i++) {
        const u = i / 200;
        const original = pontoEmT(ARCO, u);
        const parte =
          u <= t ? pontoEmT(esquerda, u / t) : pontoEmT(direita, (u - t) / (1 - t));
        piorDesvio = Math.max(piorDesvio, Math.hypot(original.x - parte.x, original.y - parte.y));
      }
    }
    console.log(`--- subdividirEmT --- pior desvio contra a curva original: ${piorDesvio.toExponential(2)} UM`);
    expect(piorDesvio).toBeLessThan(1e-6);
  });

  it('parametroEmS acha o t que parte a curva em dois arcos iguais', () => {
    // Confere contra o verb: o comprimento de arco ate o t devolvido tem que ser
    // metade do total. Numa curva assimetrica, esse t nao e 0,5.
    const assimetrica: Bezier = [
      { x: 0, y: 0 },
      { x: 0, y: 90 * MM },
      { x: 60 * MM, y: 100 * MM },
      { x: 150 * MM, y: 100 * MM },
    ];
    const t = parametroEmS(assimetrica, 0.5, TOLERANCIA_TESSELACAO_UM);
    const curva = curvaVerb(assimetrica);
    const total = verb.eval.Analyze.rationalCurveArcLength(curva);
    const primeira = verb.eval.Analyze.rationalCurveArcLength(curva, t);

    console.log('--- parametroEmS ---');
    console.log(`t para s = 0,5: ${t.toFixed(6)} (t = 0,5 daria outro ponto)`);
    console.log(
      `arco total ${total.toFixed(1)} UM | primeira metade ${primeira.toFixed(1)} | ` +
        `segunda ${(total - primeira).toFixed(1)} | diferenca ${Math.abs(2 * primeira - total).toFixed(1)} UM`,
    );
    expect(Math.abs(primeira - (total - primeira))).toBeLessThanOrEqual(TOLERANCIA_TESSELACAO_UM);
    expect(Math.abs(t - 0.5)).toBeGreaterThan(0.02);
  });
});
