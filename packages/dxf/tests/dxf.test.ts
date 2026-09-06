/**
 * Fase 3 — DXF-AAMA/ASTM.
 *
 * O teste que carrega a fase e o ROUND-TRIP (F7): exportar e reimportar tem que
 * devolver as mesmas medidas, com o numero colado. E os cinco tipos de pique
 * (camadas 4, 80, 81, 82, 83) tem que sobreviver sem colapsar num tipo so — o
 * teste que a Parte 7 da Fase 1 deixou marcado para quando esta fase chegasse.
 */
import { describe, expect, it } from 'vitest';

import {
  MM,
  anelDoContorno,
  area,
  criarGeradorMonotonico,
  medirAresta,
  reconstruir,
  umParaMM,
  type Evento,
  type Modelo,
  type Peca,
  type Vetor2,
} from '@cad/motor';

import { CAMADA, exportarDxf, importarDxf, lerPares, nomeDeBloco, paraUM } from '../src/index.js';

const TENANT = 'confeccao-a';
const MODELO = 'mod-1';
const PECA = 'pec-frente';

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: 'livre' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

/** Uma frente de blusa: seis lados, margens diferentes, fio, eixo e grade points. */
function logDaBlusa(): Evento[] {
  const vertices: Vetor2[] = [
    { x: 0, y: 0 },
    { x: 180 * MM, y: 0 },
    { x: 190 * MM, y: 300 * MM },
    { x: 150 * MM, y: 430 * MM },
    { x: 60 * MM, y: 450 * MM },
    { x: 0, y: 400 * MM },
  ];
  const margens = [40, 12, 10, 12, 8, 0];
  let n = 0;
  const envelope = (pecaId: string | null) => ({
    id: `01JXDXF${String(n++).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO,
    pecaId,
    timestamp: '2026-09-06T12:00:00.000Z',
    autor: 'fixture',
    versaoSchema: 1,
  });

  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Blusa', tamanhos: ['M'], tamanhoBase: 'M' },
    },
    { ...envelope(PECA), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } },
  ] as Evento[];

  vertices.forEach((v, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
    } as Evento),
  );
  vertices.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: `ar-${i}`,
        pontoInicioId: `pt-${i}`,
        pontoFimId: `pt-${(i + 1) % vertices.length}`,
      },
    } as Evento),
  );
  vertices.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % vertices.length}`,
        tipo: 'reta',
      },
    } as Evento),
  );
  margens.forEach((mm, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM: mm * MM },
    } as Evento),
  );

  eventos.push(
    {
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: 'fio-a', x: 90 * MM, y: 40 * MM, tipo: 'interno' },
    } as Evento,
    {
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: 'fio-b', x: 90 * MM, y: 360 * MM, tipo: 'interno' },
    } as Evento,
    {
      ...envelope(PECA),
      tipo: 'AdicionarLinhaInterna',
      payload: { linhaId: 'li-fio', tipo: 'fio', pontoIds: ['fio-a', 'fio-b'] },
    } as Evento,
    {
      ...envelope(PECA),
      tipo: 'DefinirEixoDobra',
      payload: { eixoId: 'dobra', p1: { x: 0, y: 0 }, p2: { x: 0, y: 450 * MM }, direcao: 'dentro' },
    } as Evento,
  );
  vertices.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'MarcarGradePoint',
      payload: { gradePointId: `gp-${i}`, pontoId: `pt-${i}` },
    } as Evento),
  );
  return eventos;
}

const modeloDaBlusa = (): Modelo => reconstruir(logDaBlusa());

function opcoes() {
  const gerar = criarGeradorMonotonico();
  let t = 0;
  return {
    tenantId: TENANT,
    modeloId: 'mod-importado',
    autor: 'importador',
    gerarId: () => gerar(),
    agora: () => new Date(Date.UTC(2026, 8, 6, 13, 0, t++)).toISOString(),
  };
}

const perimetro = (anel: readonly Vetor2[]): number => {
  let total = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
};

const primeiraPeca = (m: Modelo): Peca => Object.values(m.pecas)[0]!;

// ===========================================================================

describe('O formato', () => {
  it('milimetro com TRES casas e exatamente 1 UM: ida e volta sem perda (F2)', () => {
    const casos = [0, 1, 999, 1000, 6350, 190_000, -45_678];
    console.log('--- UM -> mm -> UM ---');
    for (const um of casos) {
      const mm = (um / 1000).toFixed(3);
      const volta = paraUM(mm);
      console.log(`${String(um).padStart(8)} UM -> ${mm.padStart(9)} mm -> ${volta} UM`);
      expect(volta).toBe(um);
    }
  });

  it('nome de bloco e saneado, e nome vazio nao vira bloco sem nome', () => {
    const casos: [string, string][] = [
      ['FRENTE', 'FRENTE'],
      ['Frente Direita', 'FRENTE_DIREITA'],
      ['Manga (cópia)', 'MANGA_COPIA'],
      ['   ', 'PECA'],
    ];
    console.log('--- nome de bloco ---');
    for (const [entrada, esperado] of casos) {
      console.log(`"${entrada}" -> ${nomeDeBloco(entrada)}`);
      expect(nomeDeBloco(entrada)).toBe(esperado);
    }
  });

  it('arquivo truncado estoura em vez de ler o que der', () => {
    expect(() => lerPares('0\nSECTION\n2')).toThrow(/truncado/);
  });
});

describe('Exportar', () => {
  it('sai R12, em milimetro, com um BLOCK por peca e um INSERT', () => {
    const { dxf, problemas } = exportarDxf(modeloDaBlusa());
    const pares = lerPares(dxf);
    const de = (valor: string) => pares.filter((p) => p.codigo === 0 && p.valor === valor).length;

    console.log('--- o arquivo ---');
    console.log(
      `${pares.length} pares | ${de('BLOCK')} BLOCK, ${de('INSERT')} INSERT, ` +
        `${de('POLYLINE')} POLYLINE, ${de('POINT')} POINT, ${de('LINE')} LINE, ${de('TEXT')} TEXT`,
    );
    console.log(
      `versao ${pares[pares.findIndex((p) => p.valor === '$ACADVER') + 1]!.valor} | ` +
        `INSUNITS ${pares[pares.findIndex((p) => p.valor === '$INSUNITS') + 1]!.valor} (4 = mm)`,
    );
    console.log(`problemas: ${problemas.length}`);

    expect(de('BLOCK')).toBe(1);
    expect(de('INSERT')).toBe(1);
    expect(de('ENDBLK')).toBe(1);
    expect(pares[pares.length - 1]).toEqual({ codigo: 0, valor: 'EOF' });
    expect(problemas).toHaveLength(0);
  });

  it('as camadas saem onde a norma manda', () => {
    const { dxf } = exportarDxf(modeloDaBlusa());
    const pares = lerPares(dxf);
    const camadasDe = (entidade: string): number[] => {
      const achadas: number[] = [];
      for (let i = 0; i < pares.length; i++) {
        if (pares[i]!.codigo === 0 && pares[i]!.valor === entidade) {
          const camada = pares.slice(i + 1, i + 4).find((p) => p.codigo === 8);
          if (camada !== undefined) achadas.push(Number(camada.valor));
        }
      }
      return [...new Set(achadas)].sort((a, b) => a - b);
    };

    console.log('--- camadas ---');
    console.log(`POLYLINE: ${camadasDe('POLYLINE').join(', ')}  (1 corte, 7 fio, 14 costura)`);
    console.log(`POINT:    ${camadasDe('POINT').join(', ')}  (2 turn, 5 grade point)`);
    console.log(`LINE:     ${camadasDe('LINE').join(', ')}  (6 eixo de dobra)`);
    console.log(`TEXT:     ${camadasDe('TEXT').join(', ')}  (15 anotacao)`);

    expect(camadasDe('POLYLINE')).toContain(CAMADA.COSTURA);
    expect(camadasDe('POLYLINE')).toContain(CAMADA.CORTE);
    expect(camadasDe('POINT')).toContain(CAMADA.TURN_POINT);
    expect(camadasDe('POINT')).toContain(CAMADA.GRADE_POINT);
    expect(camadasDe('LINE')).toContain(CAMADA.EIXO_DOBRA);
    expect(camadasDe('TEXT')).toEqual([CAMADA.TEXTO]);
  });

  it('duas pecas com nomes que saneiam igual NAO compartilham bloco (F3)', () => {
    const log = logDaBlusa();
    const modelo = reconstruir([
      ...log,
      {
        id: '01JXDXFZZZ0',
        tenantId: TENANT,
        modeloId: MODELO,
        pecaId: PECA,
        timestamp: '2026-09-06T12:00:00.000Z',
        autor: 'fixture',
        versaoSchema: 1,
        tipo: 'DuplicarPeca',
        payload: { novoPecaId: 'pec-2', prefixoId: 'cp', dx: 400 * MM, dy: 0, comGraduacao: false },
      } as Evento,
      {
        id: '01JXDXFZZZ1',
        tenantId: TENANT,
        modeloId: MODELO,
        pecaId: 'pec-2',
        timestamp: '2026-09-06T12:00:00.000Z',
        autor: 'fixture',
        versaoSchema: 1,
        tipo: 'DefinirMetadados',
        payload: { nome: 'FRENTE' },
      } as Evento,
    ]);

    const pares = lerPares(exportarDxf(modelo).dxf);
    const nomes = pares
      .map((p, i) => (p.codigo === 0 && p.valor === 'BLOCK' ? pares[i + 2]!.valor : null))
      .filter((v): v is string => v !== null);
    console.log(`duas pecas chamadas "FRENTE" -> blocos ${nomes.join(', ')}`);
    expect(new Set(nomes).size).toBe(2);
  });
});

describe('Round-trip: exportar e reimportar (F7)', () => {
  it('perimetro, area e comprimento por aresta batem', () => {
    const original = modeloDaBlusa();
    const { dxf } = exportarDxf(original);
    const { eventos, problemas, margensMedidasUM } = importarDxf(dxf, opcoes());
    const voltou = reconstruir(eventos);

    const a = primeiraPeca(original);
    const b = primeiraPeca(voltou);
    const anelA = anelDoContorno(a);
    const anelB = anelDoContorno(b);

    console.log('--- round-trip ---');
    console.log(
      `perimetro ${umParaMM(perimetro(anelA)).toFixed(2)} -> ` +
        `${umParaMM(perimetro(anelB)).toFixed(2)} mm`,
    );
    console.log(
      `area ${(area(anelA) / 1e8).toFixed(2)} -> ${(area(anelB) / 1e8).toFixed(2)} cm2`,
    );
    console.log(`pontos ${anelA.length} -> ${anelB.length} | avisos: ${problemas.length}`);

    expect(umParaMM(perimetro(anelB))).toBeCloseTo(umParaMM(perimetro(anelA)), 2);
    expect(area(anelB)).toBe(area(anelA));

    console.log('margens medidas contra a linha de corte (F6):');
    const arestas = Object.keys(b.arestas).sort();
    for (const arestaId of arestas) {
      console.log(
        `  ${arestaId}: medida ${umParaMM(margensMedidasUM[arestaId] ?? 0).toFixed(2)} mm ` +
          `-> gravada ${umParaMM(b.margens[arestaId] ?? 0)} mm`,
      );
    }
    // As margens do original, na ordem das arestas: 40, 12, 10, 12, 8, 0.
    const gravadas = arestas.map((id) => umParaMM(b.margens[id] ?? 0));
    expect(gravadas).toEqual([40, 12, 10, 12, 8, 0]);
  });

  it('o comprimento de cada aresta sobrevive', () => {
    const original = modeloDaBlusa();
    const { eventos } = importarDxf(exportarDxf(original).dxf, opcoes());
    const voltou = reconstruir(eventos);
    const a = primeiraPeca(original);
    const b = primeiraPeca(voltou);

    console.log('--- comprimento por aresta ---');
    const antes = Object.keys(a.arestas)
      .sort()
      .map((id) => umParaMM(medirAresta(a, id)));
    const depois = Object.keys(b.arestas)
      .sort()
      .map((id) => umParaMM(medirAresta(b, id)));
    console.log(`antes:  ${antes.map((v) => v.toFixed(1)).join(', ')} mm`);
    console.log(`depois: ${depois.map((v) => v.toFixed(1)).join(', ')} mm`);
    expect(depois).toEqual(antes);
  });

  it('o fio, o eixo de dobra e os grade points voltam', () => {
    const { eventos } = importarDxf(exportarDxf(modeloDaBlusa()).dxf, opcoes());
    const peca = primeiraPeca(reconstruir(eventos));
    console.log(
      `linhas internas: ${Object.values(peca.linhasInternas).map((l) => l.tipo).join(', ')} | ` +
        `eixos de dobra: ${Object.keys(peca.eixosDobra).length} | ` +
        `grade points: ${Object.keys(peca.gradePoints).length}`,
    );
    expect(Object.values(peca.linhasInternas).some((l) => l.tipo === 'fio')).toBe(true);
    expect(Object.keys(peca.eixosDobra)).toHaveLength(1);
    expect(Object.keys(peca.gradePoints)).toHaveLength(6);
  });
});

describe('Os cinco tipos de pique sobrevivem — o teste que a Parte 7 deixou marcado', () => {
  it('camadas 4, 80, 81, 82 e 83 nao colapsam num tipo so', () => {
    const tipos = ['V', 'T', 'MX', 'CHECK', 'U'] as const;
    const log = logDaBlusa();
    let n = 900;
    tipos.forEach((tipo, i) =>
      log.push({
        id: `01JXDXFPQ${String(n++)}`,
        tenantId: TENANT,
        modeloId: MODELO,
        pecaId: PECA,
        timestamp: '2026-09-06T12:00:00.000Z',
        autor: 'fixture',
        versaoSchema: 1,
        tipo: 'AdicionarPique',
        payload: {
          piqueId: `pq-${i}`,
          arestaId: 'ar-1',
          s: 0.15 + i * 0.17,
          tipo,
          alturaUM: 6350,
          larguraUM: 1590,
          anguloGraus: 0,
        },
      } as Evento),
    );

    const modelo = reconstruir(log);
    const { dxf } = exportarDxf(modelo);
    const pares = lerPares(dxf);

    const camadasDosPiques: number[] = [];
    for (let i = 0; i < pares.length; i++) {
      if (pares[i]!.codigo === 0 && pares[i]!.valor === 'POINT') {
        const camada = Number(pares[i + 1]!.valor);
        if ([4, 80, 81, 82, 83].includes(camada)) camadasDosPiques.push(camada);
      }
    }

    const { eventos } = importarDxf(dxf, opcoes());
    const devolta = Object.values(primeiraPeca(reconstruir(eventos)).piques);

    console.log('--- os cinco piques ---');
    console.log(`no arquivo, camadas: ${camadasDosPiques.sort((a, b) => a - b).join(', ')}`);
    console.log(
      `de volta: ${devolta.map((p) => `${p.tipo}@${p.s.toFixed(3)}`).sort().join(', ')}`,
    );

    expect([...new Set(camadasDosPiques)].sort((a, b) => a - b)).toEqual([4, 80, 81, 82, 83]);
    expect(new Set(devolta.map((p) => p.tipo)).size).toBe(5);
  });
});

describe('O importador RELATA (F8)', () => {
  it('sem camada 1, as margens entram zero e ele avisa', () => {
    const { dxf } = exportarDxf(modeloDaBlusa());
    // Tira a polilinha de corte do arquivo, deixando so a costura.
    const semCorte = dxf.replace(/0\nPOLYLINE\n8\n1\n[\s\S]*?0\nSEQEND\n8\n1\n/, '');
    const { eventos, problemas } = importarDxf(semCorte, opcoes());
    const peca = primeiraPeca(reconstruir(eventos));
    const margens = Object.values(peca.margens).map(umParaMM);

    console.log('--- sem a camada 1 ---');
    console.log(`margens: ${margens.join(', ')} mm`);
    console.log(`  ${problemas.map((p) => `[${p.gravidade}] ${p.codigo}`).join(', ')}`);
    expect(new Set(margens)).toEqual(new Set([0]));
    expect(problemas.map((p) => p.codigo)).toContain('MARGEM_AUSENTE');
  });

  it('sem turn points, entra uma aresta por corda — e avisa', () => {
    const { dxf } = exportarDxf(modeloDaBlusa());
    const semTurnPoints = dxf.replace(/0\nPOINT\n8\n2\n10\n[^\n]*\n20\n[^\n]*\n30\n[^\n]*\n/g, '');
    const { eventos, problemas } = importarDxf(semTurnPoints, opcoes());
    const peca = primeiraPeca(reconstruir(eventos));
    console.log(
      `sem camada 2 -> ${Object.keys(peca.arestas).length} arestas ` +
        `(uma por corda) | ${problemas.filter((p) => p.codigo === 'ARESTA_SEM_SEGMENTOS').length} aviso`,
    );
    expect(problemas.map((p) => p.codigo)).toContain('ARESTA_SEM_SEGMENTOS');
  });

  it('SPLINE e ignorada com aviso — a D1 fechou a curva em Bezier', () => {
    const { dxf } = exportarDxf(modeloDaBlusa());
    const comSpline = dxf.replace('0\nENDBLK', '0\nSPLINE\n8\n14\n0\nENDBLK');
    const { problemas } = importarDxf(comSpline, opcoes());
    console.log(
      `SPLINE no arquivo -> ${problemas.filter((p) => p.codigo === 'CURVA_SEM_CONTROLES').length} aviso`,
    );
    expect(problemas.map((p) => p.codigo)).toContain('CURVA_SEM_CONTROLES');
  });

  it('bloco sem contorno e pulado, e o arquivo continua sendo lido', () => {
    const { dxf } = exportarDxf(modeloDaBlusa());
    const comBlocoVazio = dxf.replace(
      '0\nSECTION\n2\nBLOCKS\n',
      '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n8\n1\n2\nVAZIO\n70\n0\n0\nENDBLK\n8\n1\n',
    );
    const { eventos, problemas } = importarDxf(comBlocoVazio, opcoes());
    const modelo = reconstruir(eventos);
    console.log(
      `arquivo com 1 bloco vazio + 1 bom -> ${Object.keys(modelo.pecas).length} peca | ` +
        `${problemas.filter((p) => p.codigo === 'CONTORNO_VAZIO').length} aviso`,
    );
    expect(Object.keys(modelo.pecas)).toHaveLength(1);
    expect(problemas.map((p) => p.codigo)).toContain('CONTORNO_VAZIO');
  });
});
