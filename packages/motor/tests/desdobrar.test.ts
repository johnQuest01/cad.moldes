/**
 * Desdobrar (materializar): a meia-peça vira a peça inteira, editável.
 *
 * O que precisa ficar provado com número:
 *  - a área DOBRA exatamente (2,0000x, a menos do arredondamento);
 *  - margem da aresta espelhada = margem da irmã;
 *  - pique espelhado no MESMO lugar físico (s -> 1-s, e a projeção prova);
 *  - a curva Bézier espelhada é o espelho de verdade (controles trocados);
 *  - meia-peça mal apoiada no eixo é RECUSADA com o motivo.
 */
import { describe, expect, it } from 'vitest';

import {
  MM,
  anelDoContorno,
  area,
  areaComSinal,
  desdobrarPeca,
  medirAresta,
  offsetMargem,
  projetarPique,
  reconstruir,
  umParaMM,
  validarInconsistencias,
  type Evento,
  type Modelo,
  type Peca,
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
  id: `01DES${String(n++).padStart(5, '0')}`,
  tenantId: 't',
  modeloId: 'm',
  pecaId,
  timestamp: '2026-09-13T12:00:00.000Z',
  autor: 'fixture',
  versaoSchema: 1,
});

/**
 * Meia-frente: lateral da dobra deitada no eixo x = 0 (de (0,0) a (0,300)),
 * ombro em cima, CAVA EM BÉZIER na lateral de fora, margens diferentes por
 * aresta e um pique na barra.
 */
function meiaFrente(): Modelo {
  n = 0;
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    { ...envelope('p'), tipo: 'CriarPeca', payload: { nome: 'MEIA FRENTE', encaixe: ENCAIXE } } as Evento,
  ];
  const pontos: [string, number, number][] = [
    ['pt-0', 0, 0], // barra, na dobra
    ['pt-1', 200 * MM, 0], // barra, fora
    ['pt-2', 180 * MM, 300 * MM], // ombro fora
    ['pt-3', 0, 300 * MM], // ombro na dobra
  ];
  for (const [id, x, y] of pontos) {
    eventos.push({
      ...envelope('p'),
      tipo: 'CriarPonto',
      payload: { pontoId: id, x, y, tipo: 'contorno' },
    } as Evento);
  }
  const arestas: [string, string, string][] = [
    ['ar-barra', 'pt-0', 'pt-1'],
    ['ar-lateral', 'pt-1', 'pt-2'],
    ['ar-ombro', 'pt-2', 'pt-3'],
    ['ar-dobra', 'pt-3', 'pt-0'],
  ];
  for (const [id, de, para] of arestas) {
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirAresta',
      payload: { arestaId: id, pontoInicioId: de, pontoFimId: para },
    } as Evento);
  }
  for (const [i, [aresta, de, para]] of ([
    ['ar-barra', 'pt-0', 'pt-1'],
    ['ar-lateral', 'pt-1', 'pt-2'],
    ['ar-ombro', 'pt-2', 'pt-3'],
    ['ar-dobra', 'pt-3', 'pt-0'],
  ] as [string, string, string][]).entries()) {
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: aresta,
        de,
        para,
        // A lateral e uma CAVA: Bezier puxada para dentro.
        ...(aresta === 'ar-lateral'
          ? {
              tipo: 'curva',
              controles: [
                { x: 160 * MM, y: 100 * MM },
                { x: 150 * MM, y: 220 * MM },
              ],
            }
          : { tipo: 'reta' }),
      },
    } as Evento);
  }
  for (const [aresta, mm] of [
    ['ar-barra', 30],
    ['ar-lateral', 10],
    ['ar-ombro', 12],
    ['ar-dobra', 0], // margem zero na dobra, como manda o oficio
  ] as [string, number][]) {
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirMargem',
      payload: { arestaId: aresta, margemUM: mm * MM },
    } as Evento);
  }
  eventos.push({
    ...envelope('p'),
    tipo: 'DefinirEixoDobra',
    payload: {
      eixoId: 'eixo-1',
      p1: { x: 0, y: 0 },
      p2: { x: 0, y: 300 * MM },
      direcao: 'dentro',
    },
  } as Evento);
  eventos.push({
    ...envelope('p'),
    tipo: 'AdicionarPique',
    payload: {
      piqueId: 'pq-barra',
      arestaId: 'ar-barra',
      s: 0.25,
      tipo: 'V',
      alturaUM: 6350,
      larguraUM: 1590,
      anguloGraus: 0,
    },
  } as Evento);
  return reconstruir(eventos);
}

describe('Desdobrar materializa a peça inteira', () => {
  it('a área dobra, o contorno fecha CCW e o validador não acha nada', () => {
    const meia = meiaFrente().pecas['p']!;
    const inteira = desdobrarPeca(meia, 'eixo-1', 'des');

    const areaMeia = area(anelDoContorno(meia));
    const areaInteira = area(anelDoContorno(inteira));
    console.log('--- meia-frente com cava em Bezier ---');
    console.log(
      `area: ${(areaMeia / 1e8).toFixed(2)} -> ${(areaInteira / 1e8).toFixed(2)} cm2 ` +
        `(razao ${(areaInteira / areaMeia).toFixed(5)})`,
    );
    const modelo = meiaFrente();
    const problemas = validarInconsistencias({ ...modelo, pecas: { p: inteira } }, 'p');
    console.log(`validador: ${problemas.length} problema(s)`);
    for (const p of problemas.slice(0, 3)) console.log(`  ${p.codigo}: ${p.mensagem}`);

    expect(areaInteira / areaMeia).toBeGreaterThan(1.999);
    expect(areaInteira / areaMeia).toBeLessThan(2.001);
    expect(areaComSinal(anelDoContorno(inteira))).toBeGreaterThan(0);
    expect(problemas.filter((p) => p.gravidade === 'erro')).toHaveLength(0);
    // A lateral da dobra foi consumida; as outras 3 arestas ganharam irmas.
    expect(Object.keys(inteira.arestas)).toHaveLength(6);
    expect(inteira.eixosDobra['eixo-1']).toBeUndefined();
  });

  it('margens copiadas: barra 30, lateral 10, ombro 12 — dos DOIS lados', () => {
    const inteira = desdobrarPeca(meiaFrente().pecas['p']!, 'eixo-1', 'des');
    const margens = Object.entries(inteira.margens)
      .map(([id, um]) => `${id}=${umParaMM(um)}`)
      .sort()
      .join(' ');
    console.log(`margens: ${margens}`);
    expect(umParaMM(inteira.margens['des-ar-0'] ?? -1)).toBe(30); // irma da barra
    expect(umParaMM(inteira.margens['des-ar-1'] ?? -1)).toBe(10); // irma da lateral
    expect(umParaMM(inteira.margens['des-ar-2'] ?? -1)).toBe(12); // irma do ombro
    // E a linha de corte da peca inteira sai sem erro:
    const corte = offsetMargem(inteira);
    expect(corte.pontos.length).toBeGreaterThan(3);
  });

  it('o pique espelhado cai no lugar físico espelhado (x -> -x)', () => {
    const meia = meiaFrente().pecas['p']!;
    const inteira = desdobrarPeca(meia, 'eixo-1', 'des');
    const original = projetarPique(inteira, 'pq-barra');
    const espelhado = projetarPique(inteira, 'des-pq-0');
    console.log(
      `pique original em x=${umParaMM(original.pontoDaCostura.x).toFixed(1)} mm | ` +
        `espelhado em x=${umParaMM(espelhado.pontoDaCostura.x).toFixed(1)} mm`,
    );
    expect(umParaMM(original.pontoDaCostura.x)).toBeCloseTo(50, 0);
    expect(umParaMM(espelhado.pontoDaCostura.x)).toBeCloseTo(-50, 0);
    expect(Math.abs(original.pontoDaCostura.y - espelhado.pontoDaCostura.y)).toBeLessThan(3);
  });

  it('a cava espelhada mede o MESMO que a original', () => {
    const inteira = desdobrarPeca(meiaFrente().pecas['p']!, 'eixo-1', 'des');
    const original = medirAresta(inteira, 'ar-lateral');
    const espelhada = medirAresta(inteira, 'des-ar-1');
    console.log(
      `cava original ${umParaMM(original).toFixed(2)} mm | espelhada ${umParaMM(espelhada).toFixed(2)} mm | ` +
        `diferenca ${umParaMM(Math.abs(original - espelhada)).toFixed(3)} mm`,
    );
    expect(Math.abs(original - espelhada)).toBeLessThan(50); // 0,05 mm de arredondamento
  });

  it('o EVENTO DesdobrarPeca reconstrói pelo log', () => {
    const modelo = meiaFrente();
    void modelo;
    n = 999;
    const eventos = [
      {
        ...envelope('p'),
        tipo: 'DesdobrarPeca',
        payload: { eixoDobraId: 'eixo-1', prefixoId: 'des' },
      } as Evento,
    ];
    const remontada = reconstruir([...logDe(), ...eventos]).pecas['p']!;
    const direta = desdobrarPeca(meiaFrente().pecas['p']!, 'eixo-1', 'des');
    expect(JSON.stringify(anelDoContorno(remontada))).toBe(
      JSON.stringify(anelDoContorno(direta)),
    );
    console.log('fold x funcao direta: identicos');
  });

  it('RECUSA quando a lateral da dobra não está no eixo, com o motivo', () => {
    const modelo = meiaFrente();
    const peca: Peca = modelo.pecas['p']!;
    // Um eixo deslocado 50 mm para dentro: atravessa a peca.
    const comEixoTorto: Peca = {
      ...peca,
      eixosDobra: {
        ...peca.eixosDobra,
        'eixo-torto': {
          id: 'eixo-torto',
          p1: { x: 50 * MM, y: 0 },
          p2: { x: 50 * MM, y: 300 * MM },
          direcao: 'dentro',
        },
      },
    };
    expect(() => desdobrarPeca(comEixoTorto, 'eixo-torto', 'des')).toThrow(/ATRAVESSA/);
    console.log('eixo atravessando a peca -> EIXO_DOBRA_ATRAVESSA_A_PECA');
  });
});

function logDe(): Evento[] {
  // O mesmo log do fixture (reconstruido do zero para os ids baterem).
  const m = meiaFrente();
  void m;
  n = 0;
  const eventos: Evento[] = [];
  const modelo = meiaFrente();
  void modelo;
  // meiaFrente ja reseta n=0 e monta a lista; para o log, basta reconstruir igual:
  n = 0;
  return montarLog();
}

function montarLog(): Evento[] {
  // Reaproveita meiaFrente reconstruindo os eventos identicos.
  const capturados: Evento[] = [];
  const original = reconstruir;
  void original;
  // fixture identico ao de meiaFrente:
  n = 0;
  const eventos: Evento[] = [];
  void capturados;
  const m = meiaFrenteEventos();
  eventos.push(...m);
  return eventos;
}

function meiaFrenteEventos(): Evento[] {
  n = 0;
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    { ...envelope('p'), tipo: 'CriarPeca', payload: { nome: 'MEIA FRENTE', encaixe: ENCAIXE } } as Evento,
  ];
  const pontos: [string, number, number][] = [
    ['pt-0', 0, 0],
    ['pt-1', 200 * MM, 0],
    ['pt-2', 180 * MM, 300 * MM],
    ['pt-3', 0, 300 * MM],
  ];
  for (const [id, x, y] of pontos) {
    eventos.push({
      ...envelope('p'),
      tipo: 'CriarPonto',
      payload: { pontoId: id, x, y, tipo: 'contorno' },
    } as Evento);
  }
  const arestas: [string, string, string][] = [
    ['ar-barra', 'pt-0', 'pt-1'],
    ['ar-lateral', 'pt-1', 'pt-2'],
    ['ar-ombro', 'pt-2', 'pt-3'],
    ['ar-dobra', 'pt-3', 'pt-0'],
  ];
  for (const [id, de, para] of arestas) {
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirAresta',
      payload: { arestaId: id, pontoInicioId: de, pontoFimId: para },
    } as Evento);
  }
  for (const [i, [aresta, de, para]] of arestas.entries()) {
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: aresta,
        de,
        para,
        ...(aresta === 'ar-lateral'
          ? {
              tipo: 'curva',
              controles: [
                { x: 160 * MM, y: 100 * MM },
                { x: 150 * MM, y: 220 * MM },
              ],
            }
          : { tipo: 'reta' }),
      },
    } as Evento);
  }
  for (const [aresta, mm] of [
    ['ar-barra', 30],
    ['ar-lateral', 10],
    ['ar-ombro', 12],
    ['ar-dobra', 0],
  ] as [string, number][]) {
    eventos.push({
      ...envelope('p'),
      tipo: 'DefinirMargem',
      payload: { arestaId: aresta, margemUM: mm * MM },
    } as Evento);
  }
  eventos.push({
    ...envelope('p'),
    tipo: 'DefinirEixoDobra',
    payload: {
      eixoId: 'eixo-1',
      p1: { x: 0, y: 0 },
      p2: { x: 0, y: 300 * MM },
      direcao: 'dentro',
    },
  } as Evento);
  eventos.push({
    ...envelope('p'),
    tipo: 'AdicionarPique',
    payload: {
      piqueId: 'pq-barra',
      arestaId: 'ar-barra',
      s: 0.25,
      tipo: 'V',
      alturaUM: 6350,
      larguraUM: 1590,
      anguloGraus: 0,
    },
  } as Evento);
  return eventos;
}
