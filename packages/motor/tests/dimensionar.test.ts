/**
 * Dimensionar / Encolhimento — a escala por eixo que faltava para malha.
 *
 * O que precisa ficar provado com número:
 *  - a medida sai EXATA (103% de 400 mm são 412,00 mm, não "perto disso");
 *  - o pique fica na MESMA fração da aresta — é assim que ele sobrevive;
 *  - margem e faca do pique NÃO escalam, de propósito;
 *  - fator negativo, zero e absurdo são recusados com o motivo.
 */
import { describe, expect, it } from 'vitest';

import {
  MM,
  anelDoContorno,
  area,
  dimensionarPeca,
  medirAresta,
  offsetMargem,
  projetarPique,
  reconstruir,
  umParaMM,
  type Evento,
  type Modelo,
  type Vetor2,
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
  id: `01DIM${String(n++).padStart(5, '0')}`,
  tenantId: 't',
  modeloId: 'm',
  pecaId,
  timestamp: '2026-09-13T12:00:00.000Z',
  autor: 'fixture',
  versaoSchema: 1,
});

/** Retângulo 400 × 200 mm com margem de 10 mm e um pique a 30% da aresta de baixo. */
function modeloComPique(): Modelo {
  n = 0;
  const cantos: Vetor2[] = [
    { x: 0, y: 0 },
    { x: 400 * MM, y: 0 },
    { x: 400 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    { ...envelope('p'), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } } as Evento,
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
        tipo: 'reta',
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
  eventos.push({
    ...envelope('p'),
    tipo: 'AdicionarPique',
    payload: {
      piqueId: 'pq-1',
      arestaId: 'ar-0',
      s: 0.3,
      tipo: 'V',
      alturaUM: 6350,
      larguraUM: 1590,
      anguloGraus: 0,
    },
  } as Evento);
  return reconstruir(eventos);
}

const caixa = (anel: readonly Vetor2[]) => ({
  largura: Math.max(...anel.map((p) => p.x)) - Math.min(...anel.map((p) => p.x)),
  altura: Math.max(...anel.map((p) => p.y)) - Math.min(...anel.map((p) => p.y)),
});

describe('Dimensionar por eixo', () => {
  it('103% em X e 102% em Y saem EXATOS, e a área acompanha o produto', () => {
    const peca = modeloComPique().pecas['p']!;
    const antes = caixa(anelDoContorno(peca));
    const depois = dimensionarPeca(peca, { x: 0, y: 0 }, 1.03, 1.02);
    const c = caixa(anelDoContorno(depois));

    console.log('--- encolhimento de malha: compensar 3% x 2% ---');
    console.log(
      `antes  ${umParaMM(antes.largura)} × ${umParaMM(antes.altura)} mm | ` +
        `depois ${umParaMM(c.largura)} × ${umParaMM(c.altura)} mm`,
    );
    const areaAntes = area(anelDoContorno(peca));
    const areaDepois = area(anelDoContorno(depois));
    console.log(
      `area: ${(areaAntes / 1e8).toFixed(2)} -> ${(areaDepois / 1e8).toFixed(2)} cm2 ` +
        `(razao ${(areaDepois / areaAntes).toFixed(6)}, esperado ${(1.03 * 1.02).toFixed(6)})`,
    );

    expect(umParaMM(c.largura)).toBe(412);
    expect(umParaMM(c.altura)).toBe(204);
    expect(areaDepois / areaAntes).toBeCloseTo(1.03 * 1.02, 6);
  });

  it('o pique continua na MESMA fração da aresta, e a posição em mm escala junto', () => {
    const peca = modeloComPique().pecas['p']!;
    const antes = projetarPique(peca, 'pq-1');
    const depois = dimensionarPeca(peca, { x: 0, y: 0 }, 1.1, 1.0);
    const projetado = projetarPique(depois, 'pq-1');

    console.log('--- o pique sobrevive a escala ---');
    console.log(
      `aresta de baixo: ${umParaMM(medirAresta(peca, 'ar-0'))} -> ` +
        `${umParaMM(medirAresta(depois, 'ar-0'))} mm`,
    );
    console.log(
      `pique em x = ${umParaMM(antes.pontoDaCostura.x).toFixed(1)} mm -> ` +
        `${umParaMM(projetado.pontoDaCostura.x).toFixed(1)} mm (30% de 400 -> 30% de 440)`,
    );
    expect(depois.piques['pq-1']!.s).toBe(0.3);
    expect(umParaMM(projetado.pontoDaCostura.x)).toBeCloseTo(132, 0);
    // A faca do notcher nao muda com o tecido.
    expect(depois.piques['pq-1']!.alturaUM).toBe(6350);
    expect(depois.piques['pq-1']!.larguraUM).toBe(1590);
  });

  it('a margem de costura NÃO escala — 1 cm de costura continua 1 cm', () => {
    const peca = modeloComPique().pecas['p']!;
    const depois = dimensionarPeca(peca, { x: 0, y: 0 }, 1.03, 1.02);
    const corte = caixa(offsetMargem(depois).pontos);
    const contorno = caixa(anelDoContorno(depois));
    console.log(
      `corte - contorno na largura: ${umParaMM(corte.largura - contorno.largura)} mm (esperado 20: 10 de cada lado)`,
    );
    expect(umParaMM(corte.largura - contorno.largura)).toBe(20);
    expect(umParaMM(corte.altura - contorno.altura)).toBe(20);
  });

  it('o centro importa: escalar em torno do centro da peça não a empurra pela mesa', () => {
    const peca = modeloComPique().pecas['p']!;
    const centro = { x: 200 * MM, y: 100 * MM };
    const depois = dimensionarPeca(peca, centro, 1.1, 1.1);
    const anel = anelDoContorno(depois);
    const minX = Math.min(...anel.map((p) => p.x));
    console.log(`centro no meio: minX ${umParaMM(minX)} mm (cresceu 20 mm para cada lado)`);
    expect(umParaMM(minX)).toBe(-20);
  });

  it('recusa fator zero, negativo e fora da faixa, dizendo o que fazer', () => {
    const peca = modeloComPique().pecas['p']!;
    for (const fator of [0, -1.03, 5, 0.03]) {
      expect(() => dimensionarPeca(peca, { x: 0, y: 0 }, fator, 1)).toThrow();
    }
    console.log('0, -1,03, 5 e 0,03 -> recusados (0,03 e o engano classico de "3%" digitado como fator)');
  });

  it('o EVENTO reconstrói: DimensionarPeca no log dá o mesmo estado', () => {
    const modelo = modeloComPique();
    const eventos: Evento[] = [
      {
        ...envelope('p'),
        tipo: 'DimensionarPeca',
        payload: { centro: { x: 0, y: 0 }, fatorX: 1.03, fatorY: 1.02 },
      } as Evento,
    ];
    // O log de origem mais o evento novo tem que dar o mesmo que a funcao direta.
    n = 0;
    const doLog = reconstruir([...logDoModelo(), ...eventos]).pecas['p']!;
    const direto = dimensionarPeca(modelo.pecas['p']!, { x: 0, y: 0 }, 1.03, 1.02);
    console.log(
      `fold x funcao direta: ${JSON.stringify(anelDoContorno(doLog)) === JSON.stringify(anelDoContorno(direto)) ? 'identicos' : 'DIFERENTES'}`,
    );
    expect(JSON.stringify(anelDoContorno(doLog))).toBe(JSON.stringify(anelDoContorno(direto)));
  });
});

/** O mesmo log do fixture, para o teste do fold. */
function logDoModelo(): Evento[] {
  const m = modeloComPique();
  void m;
  n = 0;
  const cantos: Vetor2[] = [
    { x: 0, y: 0 },
    { x: 400 * MM, y: 0 },
    { x: 400 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    { ...envelope('p'), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } } as Evento,
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
        tipo: 'reta',
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
  eventos.push({
    ...envelope('p'),
    tipo: 'AdicionarPique',
    payload: {
      piqueId: 'pq-1',
      arestaId: 'ar-0',
      s: 0.3,
      tipo: 'V',
      alturaUM: 6350,
      larguraUM: 1590,
      anguloGraus: 0,
    },
  } as Evento);
  return eventos;
}
