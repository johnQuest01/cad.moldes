/**
 * Pence no contorno.
 *
 * O que precisa ficar provado com número:
 *  - a área REMOVIDA é o triângulo da pence (abertura × profundidade / 2) —
 *    numa boca reta, exato;
 *  - a boca mede a abertura pedida EM ARCO, mesmo em cava curva;
 *  - o ápice aponta para DENTRO em qualquer orientação da aresta (as 4 bordas);
 *  - boca em cima de canto e boca que não cabe são RECUSADAS com o motivo;
 *  - o evento reconstrói pelo log.
 */
import { describe, expect, it } from 'vitest';

import {
  MM,
  abrirPence,
  anelDoContorno,
  area,
  medirAresta,
  reconstruir,
  umParaMM,
  validarInconsistencias,
  type Evento,
  type Modelo,
} from '../src/index.js';

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: '180' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

let n = 0;
const envelope = (pecaId: string | null) => ({
  id: `01PEN${String(n++).padStart(5, '0')}`,
  tenantId: 't',
  modeloId: 'm',
  pecaId,
  timestamp: '2026-09-13T12:00:00.000Z',
  autor: 'fixture',
  versaoSchema: 1,
});

/** Retângulo 400 × 300 mm; a aresta 1 (direita) pode virar curva. */
function eventosDaPeca(lateralCurva: boolean): Evento[] {
  n = 0;
  const cantos = [
    { x: 0, y: 0 },
    { x: 400 * MM, y: 0 },
    { x: 400 * MM, y: 300 * MM },
    { x: 0, y: 300 * MM },
  ];
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    { ...envelope('p'), tipo: 'CriarPeca', payload: { nome: 'COSTAS', encaixe: ENCAIXE } } as Evento,
  ];
  cantos.forEach((c, i) =>
    eventos.push({
      ...envelope('p'),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirAresta',
      payload: { arestaId: `ar-${i}`, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % 4}`,
        ...(lateralCurva && i === 1
          ? {
              tipo: 'curva',
              controles: [
                { x: 430 * MM, y: 100 * MM },
                { x: 430 * MM, y: 200 * MM },
              ],
            }
          : { tipo: 'reta' }),
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM: 10 * MM },
    } as Evento),
  );
  return eventos;
}

const modeloReto = (): Modelo => reconstruir(eventosDaPeca(false));
const modeloCurvo = (): Modelo => reconstruir(eventosDaPeca(true));

describe('Pence no contorno', () => {
  it('a área removida é o triângulo da pence, exata na boca reta', () => {
    const peca = modeloReto().pecas['p']!;
    // Pence clássica de cintura: boca 30 mm, profundidade 120 mm, no meio da barra.
    const aberta = abrirPence(peca, 'ar-0', 0.5, 30 * MM, 120 * MM, 'pn1');

    const antes = area(anelDoContorno(peca));
    const depois = area(anelDoContorno(aberta));
    const removida = antes - depois;
    const triangulo = (30 * MM * (120 * MM)) / 2;
    console.log('--- pence 30 x 120 mm na barra reta ---');
    console.log(
      `area removida ${(removida / 1e8).toFixed(3)} cm2 | triangulo teorico ` +
        `${(triangulo / 1e8).toFixed(3)} cm2 | razao ${(removida / triangulo).toFixed(5)}`,
    );
    expect(removida / triangulo).toBeGreaterThan(0.999);
    expect(removida / triangulo).toBeLessThan(1.001);

    const problemas = validarInconsistencias(
      { ...modeloReto(), pecas: { p: aberta } },
      'p',
    ).filter((p) => p.gravidade === 'erro');
    console.log(`validador: ${problemas.length} erro(s)`);
    expect(problemas).toHaveLength(0);
  });

  it('a aresta cresce exatamente pelas duas pernas menos a boca', () => {
    const peca = modeloReto().pecas['p']!;
    const abertura = 30 * MM;
    const profundidade = 120 * MM;
    const aberta = abrirPence(peca, 'ar-0', 0.5, abertura, profundidade, 'pn1');
    const antes = medirAresta(peca, 'ar-0');
    const depois = medirAresta(aberta, 'ar-0');
    const perna = Math.hypot(abertura / 2, profundidade);
    const esperado = antes - abertura + 2 * perna;
    console.log(
      `aresta: ${umParaMM(antes)} -> ${umParaMM(depois).toFixed(2)} mm | ` +
        `esperado ${umParaMM(esperado).toFixed(2)} mm`,
    );
    expect(Math.abs(depois - esperado)).toBeLessThan(100); // 0,1 mm
  });

  it('na CAVA CURVA a boca mede a abertura pedida em arco', () => {
    const peca = modeloCurvo().pecas['p']!;
    const aberta = abrirPence(peca, 'ar-1', 0.5, 40 * MM, 100 * MM, 'pn1');
    // Os dois pontos da boca existem e distam ~40 mm EM ARCO na curva original:
    const a = aberta.pontos['pn1a-p']!;
    const b = aberta.pontos['pn1b-p']!;
    const corda = Math.hypot(b.x - a.x, b.y - a.y);
    console.log('--- pence na cava curva ---');
    console.log(`corda da boca: ${umParaMM(corda).toFixed(2)} mm (arco pedido: 40,00)`);
    // Em curva a corda e MENOR que o arco; aqui a curvatura e suave, entao perto.
    expect(umParaMM(corda)).toBeGreaterThan(38);
    expect(umParaMM(corda)).toBeLessThanOrEqual(40.2);
    // E a area diminuiu:
    expect(area(anelDoContorno(aberta))).toBeLessThan(area(anelDoContorno(peca)));
  });

  it('o ápice aponta para DENTRO nas quatro bordas do retângulo', () => {
    for (const aresta of ['ar-0', 'ar-1', 'ar-2', 'ar-3']) {
      const peca = modeloReto().pecas['p']!;
      const aberta = abrirPence(peca, aresta, 0.5, 30 * MM, 80 * MM, 'pn1');
      const apice = aberta.pontos['pn1q-p']!;
      const dentro =
        apice.x > 0 && apice.x < 400 * MM && apice.y > 0 && apice.y < 300 * MM;
      console.log(
        `${aresta}: apice em (${umParaMM(apice.x).toFixed(0)}, ${umParaMM(apice.y).toFixed(0)}) mm -> ${dentro ? 'DENTRO' : 'FORA'}`,
      );
      expect(dentro).toBe(true);
    }
  });

  it('RECUSA boca em cima de canto e boca que não cabe, com o motivo', () => {
    const peca = modeloReto().pecas['p']!;
    // s=0.99: passa a menos de 2% do vertice.
    expect(() => abrirPence(peca, 'ar-0', 0.99, 30 * MM, 80 * MM, 'x')).toThrow(/nao cabe|2%/);
    // abertura maior que a aresta inteira:
    expect(() => abrirPence(peca, 'ar-0', 0.5, 500 * MM, 80 * MM, 'x')).toThrow(/nao cabe|2%/);
    // profundidade zero:
    expect(() => abrirPence(peca, 'ar-0', 0.5, 30 * MM, 0, 'x')).toThrow(/positiv/);
    console.log('canto, boca gigante e profundidade zero -> recusados');
  });

  it('o EVENTO AbrirPence reconstrói pelo log', () => {
    const direta = abrirPence(modeloReto().pecas['p']!, 'ar-0', 0.5, 30 * MM, 120 * MM, 'pn1');
    n = 500;
    const eventos: Evento[] = [
      {
        ...envelope('p'),
        tipo: 'AbrirPence',
        payload: {
          arestaId: 'ar-0',
          s: 0.5,
          aberturaUM: 30 * MM,
          profundidadeUM: 120 * MM,
          prefixoId: 'pn1',
        },
      } as Evento,
    ];
    const doLog = reconstruir([...eventosDaPeca(false), ...eventos]).pecas['p']!;
    expect(JSON.stringify(anelDoContorno(doLog))).toBe(JSON.stringify(anelDoContorno(direta)));
    console.log('fold x funcao direta: identicos');
  });
});
