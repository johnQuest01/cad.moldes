/**
 * Fase 4 — HPGL.
 *
 * O que precisa ficar provado: a conversao para unidade de plotter, a fila ao
 * longo do rolo, a recusa de quem nao cabe na LARGURA, e que o arquivo comeca e
 * termina como a maquina espera.
 */
import { describe, expect, it } from 'vitest';

import { MM, reconstruir, umParaMM, type Evento, type Modelo, type Vetor2 } from '@cad/motor';

import {
  CANETA,
  UM_POR_UNIDADE_DE_PLOTTER,
  VAO_ENTRE_PECAS_UM,
  gerarHpgl,
  paraUnidades,
} from '../src/index.js';

const TENANT = 'confeccao-a';
const MODELO = 'mod-1';

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: 'livre' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

let contador = 0;
function envelope(pecaId: string | null) {
  return {
    id: `01JXHPGL${String(contador++).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO,
    pecaId,
    timestamp: '2026-09-06T12:00:00.000Z',
    autor: 'fixture',
    versaoSchema: 1,
  };
}

/** Um retangulo `larguraMM x alturaMM` com margem uniforme. */
function retangulo(pecaId: string, nome: string, larguraMM: number, alturaMM: number, margemMM: number): Evento[] {
  const cantos: Vetor2[] = [
    { x: 0, y: 0 },
    { x: larguraMM * MM, y: 0 },
    { x: larguraMM * MM, y: alturaMM * MM },
    { x: 0, y: alturaMM * MM },
  ];
  const eventos: Evento[] = [
    { ...envelope(pecaId), tipo: 'CriarPeca', payload: { nome, encaixe: ENCAIXE } } as Evento,
  ];
  cantos.forEach((c, i) =>
    eventos.push({
      ...envelope(pecaId),
      tipo: 'CriarPonto',
      payload: { pontoId: `${pecaId}-pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(pecaId),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: `${pecaId}-ar-${i}`,
        pontoInicioId: `${pecaId}-pt-${i}`,
        pontoFimId: `${pecaId}-pt-${(i + 1) % 4}`,
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(pecaId),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `${pecaId}-sg-${i}`,
        arestaId: `${pecaId}-ar-${i}`,
        de: `${pecaId}-pt-${i}`,
        para: `${pecaId}-pt-${(i + 1) % 4}`,
        tipo: 'reta',
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(pecaId),
      tipo: 'DefinirMargem',
      payload: { arestaId: `${pecaId}-ar-${i}`, margemUM: margemMM * MM },
    } as Evento),
  );
  return eventos;
}

function modeloCom(
  pecas: readonly (readonly [string, string, number, number, number])[],
  papel?: { larguraMM: number; margemMM: number },
): Modelo {
  contador = 0;
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Modelo', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
  ];
  for (const [id, nome, l, a, m] of pecas) eventos.push(...retangulo(id, nome, l, a, m));
  if (papel !== undefined) {
    eventos.push({
      ...envelope(null),
      tipo: 'DefinirPapel',
      payload: {
        papelId: 'pl',
        nome: `${papel.larguraMM} mm`,
        larguraUM: papel.larguraMM * MM,
        margemDeSegurancaUM: papel.margemMM * MM,
      },
    } as Evento);
  }
  return reconstruir(eventos);
}

/** Extrai os pares (x, y) de um comando PU/PD. */
function coordenadas(comando: string): [number, number][] {
  const numeros = comando.replace(/^[A-Z]+/, '').replace(/;$/, '');
  if (numeros === '') return [];
  const partes = numeros.split(',').map(Number);
  const pares: [number, number][] = [];
  for (let i = 0; i + 1 < partes.length; i += 2) pares.push([partes[i]!, partes[i + 1]!]);
  return pares;
}

describe('A unidade do plotter', () => {
  it('1 unidade = 0,025 mm = 25 UM, e a resolucao cabe na tolerancia do motor', () => {
    console.log('--- UM -> unidade de plotter ---');
    for (const um of [0, 25, 100, 1000, 190_000]) {
      console.log(`${String(um).padStart(7)} UM = ${umParaMM(um).toFixed(3)} mm -> ${paraUnidades(um)} un`);
    }
    console.log(
      `resolucao da maquina ${UM_POR_UNIDADE_DE_PLOTTER} UM | tolerancia de tesselacao 100 UM ` +
        `-> folga de ${100 / UM_POR_UNIDADE_DE_PLOTTER}x`,
    );
    expect(paraUnidades(1000)).toBe(40);
    expect(paraUnidades(25)).toBe(1);
    expect(UM_POR_UNIDADE_DE_PLOTTER).toBeLessThan(100);
  });
});

describe('O arquivo', () => {
  it('comeca e termina como a maquina espera', () => {
    const { hpgl } = gerarHpgl(modeloCom([['p1', 'FRENTE', 100, 200, 10]]));
    const linhas = hpgl.trim().split('\n');
    console.log('--- inicio e fim ---');
    console.log(`${linhas.slice(0, 3).join(' ')}   ...   ${linhas.slice(-3).join(' ')}`);
    console.log(`${linhas.length} comandos`);
    expect(linhas.slice(0, 3)).toEqual(['IN;', 'SP1;', 'PA;']);
    expect(linhas.slice(-3)).toEqual(['PU;', 'SP0;', 'IN;']);
  });

  it('a linha de corte sai na caneta 1, fechada, nas coordenadas certas', () => {
    // Retangulo 100 x 200 com margem 10: o corte e 120 x 220, encostado na origem.
    const { hpgl } = gerarHpgl(modeloCom([['p1', 'FRENTE', 100, 200, 10]]));
    const linhas = hpgl.trim().split('\n');
    // O cabecalho tambem tem um `SP1;`: procura o que vem antes de um caminho.
    const iCaneta = linhas.findIndex(
      (l, i) => l === `SP${CANETA.CORTE};` && linhas[i + 1]?.startsWith('PU') === true,
    );
    const pu = linhas[iCaneta + 1]!;
    const pd = linhas[iCaneta + 2]!;
    const pontos = [...coordenadas(pu), ...coordenadas(pd)];

    console.log('--- a linha de corte ---');
    console.log(`${pu}  ${pd.slice(0, 60)}...`);
    console.log(
      `${pontos.length} pontos (4 do retangulo + 1 fechando) | ` +
        `extensao ${Math.max(...pontos.map((p) => p[0]))} x ${Math.max(...pontos.map((p) => p[1]))} un ` +
        `= ${(Math.max(...pontos.map((p) => p[0])) * 0.025).toFixed(0)} x ` +
        `${(Math.max(...pontos.map((p) => p[1])) * 0.025).toFixed(0)} mm`,
    );

    expect(pu.startsWith('PU')).toBe(true);
    expect(pd.startsWith('PD')).toBe(true);
    expect(pontos).toHaveLength(5);
    expect(pontos[0]).toEqual(pontos[4]);
    expect(Math.max(...pontos.map((p) => p[0]))).toBe(paraUnidades(120 * MM));
    expect(Math.max(...pontos.map((p) => p[1]))).toBe(paraUnidades(220 * MM));
  });

  it('cada tipo de linha vai na sua caneta', () => {
    const modelo = modeloCom([['p1', 'FRENTE', 100, 200, 10]]);
    const { hpgl } = gerarHpgl(modelo, { comCostura: true });
    const canetas = [...new Set(hpgl.match(/SP\d;/g) ?? [])].sort();
    console.log(`canetas usadas: ${canetas.join(' ')} (1 corte, 2 costura, 0 guardar)`);
    expect(canetas).toContain(`SP${CANETA.CORTE};`);
    expect(canetas).toContain(`SP${CANETA.COSTURA};`);
  });
});

describe('A fila ao longo do rolo', () => {
  it('as pecas saem uma depois da outra, com o vao entre elas', () => {
    const modelo = modeloCom([
      ['p1', 'FRENTE', 100, 200, 10],
      ['p2', 'COSTAS', 100, 150, 10],
    ]);
    const saida = gerarHpgl(modelo);
    const linhas = saida.hpgl.trim().split('\n');
    const inicios = linhas.filter((l) => l.startsWith('PU') && l !== 'PU;').map((l) => coordenadas(l)[0]!);

    console.log('--- a fila ---');
    console.log(`${saida.pecasPlotadas} pecas | inicios em y = ${inicios.map((p) => p[1]).join(', ')} un`);
    console.log(
      `consumo de rolo: ${umParaMM(saida.comprimentoUsadoUM)} mm ` +
        `(220 + ${umParaMM(VAO_ENTRE_PECAS_UM)} de vao + 170)`,
    );
    expect(saida.pecasPlotadas).toBe(2);
    // 220 (corte da primeira) + 10 de vao + 170 (corte da segunda) = 400 mm.
    expect(umParaMM(saida.comprimentoUsadoUM)).toBe(400);
  });

  it('peca mais larga que o rolo, mas que cabe DEITADA, e girada — e avisa', () => {
    // Rolo de 900 mm (util 880). Peca 900 x 300 -> corte 920 x 320: so cabe deitada.
    const modelo = modeloCom([['p1', 'LARGA', 900, 300, 10]], { larguraMM: 900, margemMM: 10 });
    const saida = gerarHpgl(modelo);
    const avisos = saida.problemas.filter((p) => p.codigo === 'PECA_SO_CABE_GIRADA');

    const linhas = saida.hpgl.trim().split('\n');
    const todos = linhas.filter((l) => l.startsWith('PD')).flatMap(coordenadas);
    const larguraNoRolo = Math.max(...todos.map((p) => p[0])) - Math.min(...todos.map((p) => p[0]));

    console.log('--- girada para caber ---');
    console.log(
      `corte 920 x 320 mm num rolo util de 880 -> ${avisos.length} aviso | ` +
        `no papel ela ocupa ${(larguraNoRolo * 0.025).toFixed(0)} mm de LARGURA`,
    );
    expect(avisos).toHaveLength(1);
    expect(larguraNoRolo * 0.025).toBeCloseTo(320, 0);
  });

  it('peca que nao cabe em direcao nenhuma NAO e plotada, e o erro e explicito', () => {
    const modelo = modeloCom([
      ['p1', 'BOA', 100, 200, 10],
      ['p2', 'ENORME', 2000, 2000, 10],
    ], { larguraMM: 900, margemMM: 10 });
    const saida = gerarHpgl(modelo);
    const erros = saida.problemas.filter((p) => p.gravidade === 'erro');
    console.log(
      `2 pecas, uma de 2 m num rolo de 90 cm -> ${saida.pecasPlotadas} plotada(s), ` +
        `${erros.length} erro: ${erros[0]?.codigo}`,
    );
    expect(saida.pecasPlotadas).toBe(1);
    expect(erros.map((p) => p.codigo)).toContain('PECA_MAIS_LARGA_QUE_O_PAPEL');
  });

  it('sem papel declarado, nada e recusado por largura', () => {
    const modelo = modeloCom([['p1', 'ENORME', 2000, 2000, 10]]);
    const saida = gerarHpgl(modelo);
    console.log(`sem rolo declarado -> ${saida.pecasPlotadas} plotada, ${saida.problemas.length} problemas`);
    expect(saida.pecasPlotadas).toBe(1);
    expect(saida.problemas).toHaveLength(0);
  });
});

describe('Piques e linhas internas', () => {
  it('o pique sai como um risco da borda para dentro, com a profundidade do notcher', () => {
    const base = modeloCom([['p1', 'FRENTE', 100, 200, 10]]);
    const modelo = reconstruir([
      ...logDe(base),
      {
        ...envelope('p1'),
        tipo: 'AdicionarPique',
        payload: {
          piqueId: 'pq-1',
          arestaId: 'p1-ar-1',
          s: 0.5,
          tipo: 'V',
          alturaUM: 6350,
          larguraUM: 1590,
          anguloGraus: 0,
        },
      } as Evento,
    ]);

    const { hpgl } = gerarHpgl(modelo);
    const linhas = hpgl.trim().split('\n');
    const i = linhas.indexOf(`SP${CANETA.PIQUE};`);
    const de = coordenadas(linhas[i + 1]!)[0]!;
    const ate = coordenadas(linhas[i + 2]!)[0]!;
    const fundo = Math.hypot(ate[0] - de[0], ate[1] - de[1]) * UM_POR_UNIDADE_DE_PLOTTER;

    console.log('--- o pique no papel ---');
    console.log(`${linhas[i + 1]}  ${linhas[i + 2]}`);
    console.log(
      `da borda para dentro: ${umParaMM(Math.round(fundo)).toFixed(2)} mm ` +
        `(o notcher padrao corta 6.35)`,
    );
    expect(umParaMM(Math.round(fundo))).toBeCloseTo(6.35, 1);
  });
});

/** Devolve os eventos que reconstruiriam este modelo. Atalho de teste. */
function logDe(modelo: Modelo): Evento[] {
  contador = 0;
  const pecas = Object.entries(modelo.pecas).map(
    ([id, p]) => [id, p.metadados.nome, 100, 200, 10] as const,
  );
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Modelo', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
  ];
  for (const [id, nome, l, a, m] of pecas) eventos.push(...retangulo(id, nome, l, a, m));
  return eventos;
}
