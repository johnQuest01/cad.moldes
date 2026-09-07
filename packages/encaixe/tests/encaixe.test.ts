/**
 * Fase 5 — encaixe.
 *
 * O que precisa ficar provado, com numero:
 *  - as pecas NAO SE SOBREPOEM (e a unica coisa que nao pode falhar);
 *  - o fio manda na rotacao, e uma peca de tecido plano nao deita;
 *  - o aproveitamento e melhor que enfileirar, que e o que a Fase 4 faz;
 *  - o mesmo modelo da o mesmo encaixe (determinismo, para o log valer).
 */
import { FillRule, areaPaths, intersect } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';

import {
  MM,
  anelDoContorno,
  area,
  offsetMargem,
  reconstruir,
  umParaMM,
  type Evento,
  type Modelo,
  type Peca,
  type Vetor2,
} from '@cad/motor';

import { gerarHpgl } from '@cad/plotter';

import { aplicarEncaixe, encaixar, encaixarBuscando, rotacoesPermitidas, FOLGA_PADRAO_UM } from '../src/index.js';

const TENANT = 'confeccao-a';
const MODELO = 'mod-1';

let contador = 0;
const envelope = (pecaId: string | null) => ({
  id: `01JXENC${String(contador++).padStart(4, '0')}`,
  tenantId: TENANT,
  modeloId: MODELO,
  pecaId,
  timestamp: '2026-09-06T12:00:00.000Z',
  autor: 'fixture',
  versaoSchema: 1,
});

interface Molde {
  readonly id: string;
  readonly nome: string;
  readonly larguraMM: number;
  readonly alturaMM: number;
  readonly quantidade?: number;
  readonly giro?: 'forcar' | '180' | '90' | 'livre' | 'esquerda' | 'direita';
  readonly par?: boolean;
}

function retangulo(m: Molde): Evento[] {
  const cantos: Vetor2[] = [
    { x: 0, y: 0 },
    { x: m.larguraMM * MM, y: 0 },
    { x: m.larguraMM * MM, y: m.alturaMM * MM },
    { x: 0, y: m.alturaMM * MM },
  ];
  const encaixe = {
    quantidadePorModelo: m.quantidade ?? 1,
    giro: m.giro ?? '180',
    faixaGiroGraus: 0,
    par: m.par ?? false,
    espelhado: false,
    dobraHorizontal: false,
    dobraVertical: false,
  };
  const eventos: Evento[] = [
    { ...envelope(m.id), tipo: 'CriarPeca', payload: { nome: m.nome, encaixe } } as Evento,
  ];
  cantos.forEach((c, i) =>
    eventos.push({
      ...envelope(m.id),
      tipo: 'CriarPonto',
      payload: { pontoId: `${m.id}-pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(m.id),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: `${m.id}-ar-${i}`,
        pontoInicioId: `${m.id}-pt-${i}`,
        pontoFimId: `${m.id}-pt-${(i + 1) % 4}`,
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(m.id),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `${m.id}-sg-${i}`,
        arestaId: `${m.id}-ar-${i}`,
        de: `${m.id}-pt-${i}`,
        para: `${m.id}-pt-${(i + 1) % 4}`,
        tipo: 'reta',
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(m.id),
      tipo: 'DefinirMargem',
      payload: { arestaId: `${m.id}-ar-${i}`, margemUM: 10 * MM },
    } as Evento),
  );
  return eventos;
}

function modeloCom(moldes: readonly Molde[], larguraDoRoloMM = 1600): Modelo {
  contador = 0;
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Modelo', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
  ];
  for (const m of moldes) eventos.push(...retangulo(m));
  eventos.push({
    ...envelope(null),
    tipo: 'DefinirPapel',
    payload: {
      papelId: 'pl',
      nome: `${larguraDoRoloMM} mm`,
      larguraUM: larguraDoRoloMM * MM,
      margemDeSegurancaUM: 10 * MM,
    },
  } as Evento);
  return reconstruir(eventos);
}

/** A caixa do CORTE de uma peça já posta. */
function caixaDoCorte(peca: Peca): { minX: number; minY: number; maxX: number; maxY: number } {
  const corte = offsetMargem(peca).pontos;
  return {
    minX: Math.min(...corte.map((p) => p.x)),
    minY: Math.min(...corte.map((p) => p.y)),
    maxX: Math.max(...corte.map((p) => p.x)),
    maxY: Math.max(...corte.map((p) => p.y)),
  };
}

/**
 * Área da sobreposição entre os CORTES de duas peças postas, em UM².
 *
 * Caixa não serve mais. Enquanto o encaixe era ruim, caixa que não se toca era um
 * teste conservador que passava; agora que as peças se enfiam no vão umas das
 * outras, **as caixas se sobrepõem de propósito** — é isso que encaixe bom quer
 * dizer. Medir caixa aqui reprovaria justamente o bom resultado.
 *
 * O que não pode encostar é o polígono, e quem calcula interseção de polígono é o
 * clipper2 — a mesma regra de sempre: geometria de biblioteca testada.
 */
function sobreposicao(a: Peca, b: Peca): number {
  const anel = (peca: Peca) => [offsetMargem(peca).pontos.map((v) => ({ x: v.x, y: v.y }))];
  return Math.abs(areaPaths(intersect(anel(a), anel(b), FillRule.NonZero)));
}

describe('O fio manda na rotacao', () => {
  it('cada giro declarado libera exatamente os angulos que o oficio permite', () => {
    console.log('--- rotacoes por giro ---');
    const casos: [NonNullable<Molde['giro']>, number[]][] = [
      ['forcar', [0]],
      ['180', [0, 180]],
      ['90', [0, 90, 180, 270]],
      ['livre', [0, 90, 180, 270]],
    ];
    for (const [giro, esperado] of casos) {
      const peca = Object.values(modeloCom([{ id: 'p', nome: 'P', larguraMM: 100, alturaMM: 100, giro }]).pecas)[0]!;
      const angulos = rotacoesPermitidas(peca);
      console.log(`${String(giro).padEnd(8)} -> ${angulos.join(', ')} graus`);
      expect(angulos).toEqual(esperado);
    }
  });

  it('peca de tecido plano (giro 180) NAO deita para caber — e o encaixe recusa', () => {
    // A LARGURA do rolo e o eixo X, igual ao plotter. Rolo de 900 mm -> 880 uteis.
    // Peca 900 x 300 -> corte 920 x 320: em pe ela passa da largura util, e so
    // cabe DEITADA. Deitar e exatamente o que o fio do tecido plano proibe.
    const modelo = modeloCom([{ id: 'p1', nome: 'LARGA', larguraMM: 900, alturaMM: 300, giro: '180' }], 900);
    const comFio = encaixar(modelo);

    const semFio = encaixar(
      modeloCom([{ id: 'p1', nome: 'LARGA', larguraMM: 900, alturaMM: 300, giro: '90' }], 900),
    );

    console.log('--- o fio recusando ---');
    console.log(
      `corte 920 x 320 num rolo util de 880:\n` +
        `  giro "180" (tecido plano) -> ${comFio.colocacoes.length} colocada, ` +
        `${comFio.problemas.length} erro: ${comFio.problemas[0]?.codigo}\n` +
        `  giro "90"  (malha)        -> ${semFio.colocacoes.length} colocada, ` +
        `girada ${semFio.colocacoes[0]?.rotacaoGraus} graus`,
    );
    expect(comFio.colocacoes).toHaveLength(0);
    expect(comFio.problemas.map((p) => p.codigo)).toContain('PECA_MAIS_LARGA_QUE_O_PAPEL');
    expect(semFio.colocacoes).toHaveLength(1);
    expect([90, 270]).toContain(semFio.colocacoes[0]!.rotacaoGraus);
  });
});

describe('As pecas nao se sobrepoem — a unica coisa que nao pode falhar', () => {
  it('doze pecas num rolo de 1,60 m, nenhuma encostando na outra', () => {
    const modelo = modeloCom([
      { id: 'p1', nome: 'FRENTE', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p2', nome: 'COSTAS', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p3', nome: 'MANGA', larguraMM: 300, alturaMM: 500, quantidade: 2, par: true },
      { id: 'p4', nome: 'GOLA', larguraMM: 200, alturaMM: 100, quantidade: 4 },
      { id: 'p5', nome: 'PUNHO', larguraMM: 120, alturaMM: 90, quantidade: 2 },
    ]);
    const encaixe = encaixar(modelo);
    const postas = aplicarEncaixe(modelo, encaixe);

    let sobrepostas = 0;
    let piorArea = 0;
    for (let i = 0; i < postas.length; i++) {
      for (let j = i + 1; j < postas.length; j++) {
        const area = sobreposicao(postas[i]!.peca, postas[j]!.peca);
        if (area > 0) sobrepostas++;
        piorArea = Math.max(piorArea, area);
      }
    }

    console.log('--- doze pecas ---');
    console.log(
      `${encaixe.colocacoes.length} colocadas | faixa de ${umParaMM(encaixe.larguraUtilUM)} mm | ` +
        `consumo ${(umParaMM(encaixe.comprimentoUsadoUM) / 1000).toFixed(3)} m`,
    );
    console.log(`aproveitamento ${(encaixe.aproveitamento * 100).toFixed(1)}%`);
    console.log(
      `pares de CORTES se sobrepondo: ${sobrepostas} (pior area ${(piorArea / 1e6).toFixed(3)} mm2)`,
    );
    // Caixas se sobrepondo agora e ESPERADO: e o sinal de que as pecas se enfiaram
    // no vao umas das outras. O que nao pode e o corte encostar no corte.
    const caixas = postas.map((c) => caixaDoCorte(c.peca));
    let caixasCruzadas = 0;
    for (let i = 0; i < caixas.length; i++) {
      for (let j = i + 1; j < caixas.length; j++) {
        const a = caixas[i]!;
        const b = caixas[j]!;
        if (a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY) {
          caixasCruzadas++;
        }
      }
    }
    console.log(`pares de CAIXAS se sobrepondo: ${caixasCruzadas} — e assim que tem que ser`);

    expect(encaixe.colocacoes).toHaveLength(12);
    expect(sobrepostas).toBe(0);
    expect(encaixe.problemas).toHaveLength(0);
  });

  it('todas ficam DENTRO da faixa', () => {
    const modelo = modeloCom([
      { id: 'p1', nome: 'A', larguraMM: 400, alturaMM: 700, quantidade: 3 },
      { id: 'p2', nome: 'B', larguraMM: 300, alturaMM: 400, quantidade: 3 },
    ]);
    const encaixe = encaixar(modelo);
    const caixas = aplicarEncaixe(modelo, encaixe).map((p) => caixaDoCorte(p.peca));
    const foraDaFaixa = caixas.filter((c) => c.minX < 0 || c.maxX > encaixe.larguraUtilUM);
    console.log(
      `largura util 0..${umParaMM(encaixe.larguraUtilUM)} mm | ` +
        `x das pecas: ${caixas.map((c) => `${umParaMM(c.minX).toFixed(0)}-${umParaMM(c.maxX).toFixed(0)}`).join(', ')}`,
    );
    console.log(`fora da faixa: ${foraDaFaixa.length}`);
    expect(foraDaFaixa).toHaveLength(0);
  });
});

describe('Aproveitamento: o encaixe ganha da fila', () => {
  it('encaixar consome MENOS tecido que enfileirar', () => {
    const moldes: Molde[] = [
      { id: 'p1', nome: 'FRENTE', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p2', nome: 'MANGA', larguraMM: 300, alturaMM: 500, quantidade: 2 },
      { id: 'p3', nome: 'GOLA', larguraMM: 200, alturaMM: 120, quantidade: 4 },
    ];
    const modelo = modeloCom(moldes);
    const encaixe = encaixar(modelo);

    // A fila da Fase 4: uma peca atras da outra, com o mesmo vao.
    const emFila = moldes.reduce(
      (soma, m) =>
        soma + (m.quantidade ?? 1) * ((m.alturaMM + 20) * MM + umParaMM(FOLGA_PADRAO_UM) * MM),
      0,
    );

    console.log('--- encaixe x fila ---');
    console.log(
      `enfileirado (Fase 4): ${(umParaMM(emFila) / 1000).toFixed(3)} m de rolo\n` +
        `encaixado   (Fase 5): ${(umParaMM(encaixe.comprimentoUsadoUM) / 1000).toFixed(3)} m ` +
        `| aproveitamento ${(encaixe.aproveitamento * 100).toFixed(1)}%`,
    );
    console.log(
      `economia: ${(((emFila - encaixe.comprimentoUsadoUM) / emFila) * 100).toFixed(1)}% de tecido`,
    );
    expect(encaixe.comprimentoUsadoUM).toBeLessThan(emFila);
  });

  it('a area colocada bate com a soma das areas das pecas', () => {
    const modelo = modeloCom([
      { id: 'p1', nome: 'A', larguraMM: 400, alturaMM: 300, quantidade: 2 },
      { id: 'p2', nome: 'B', larguraMM: 200, alturaMM: 200, quantidade: 2 },
    ]);
    const encaixe = encaixar(modelo);
    const somaDasPecas = aplicarEncaixe(modelo, encaixe).reduce(
      (soma, p) => soma + area(offsetMargem(p.peca).pontos),
      0,
    );
    const areaDaFaixa = encaixe.comprimentoUsadoUM * encaixe.larguraUtilUM;

    console.log(
      `soma das pecas ${(somaDasPecas / 1e8).toFixed(0)} cm2 | faixa usada ` +
        `${(areaDaFaixa / 1e8).toFixed(0)} cm2 -> ${((somaDasPecas / areaDaFaixa) * 100).toFixed(1)}%`,
    );
    // O aproveitamento relatado usa o contorno inflado pela folga, entao e um
    // pouco maior que o das pecas nuas — nunca menor.
    expect(encaixe.aproveitamento).toBeGreaterThanOrEqual(somaDasPecas / areaDaFaixa - 0.001);
  });
});

describe('Determinismo — o log tem que reproduzir o encaixe', () => {
  it('o mesmo modelo da exatamente o mesmo encaixe, duas vezes', () => {
    const moldes: Molde[] = [
      { id: 'p1', nome: 'A', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p2', nome: 'B', larguraMM: 300, alturaMM: 500, quantidade: 2, par: true },
      { id: 'p3', nome: 'C', larguraMM: 200, alturaMM: 120, quantidade: 3 },
    ];
    const um = encaixar(modeloCom(moldes));
    const outro = encaixar(modeloCom(moldes));
    console.log(
      `duas execucoes: ${um.colocacoes.length} colocacoes cada | ` +
        `identicas: ${JSON.stringify(um.colocacoes) === JSON.stringify(outro.colocacoes)}`,
    );
    expect(JSON.stringify(outro.colocacoes)).toBe(JSON.stringify(um.colocacoes));
    expect(outro.comprimentoUsadoUM).toBe(um.comprimentoUsadoUM);
  });
});

describe('Par e quantidade', () => {
  it('peca marcada como PAR sai metade espelhada — manga direita e esquerda', () => {
    const modelo = modeloCom([
      { id: 'p1', nome: 'MANGA', larguraMM: 300, alturaMM: 500, quantidade: 2, par: true },
    ]);
    const encaixe = encaixar(modelo);
    const espelhadas = encaixe.colocacoes.filter((c) => c.espelhada).length;
    console.log(
      `manga com par=true, quantidade 2 -> ${encaixe.colocacoes.length} colocadas, ` +
        `${espelhadas} espelhada(s)`,
    );
    expect(encaixe.colocacoes).toHaveLength(2);
    expect(espelhadas).toBe(1);
  });

  it('conjuntos multiplicam o molde inteiro', () => {
    const moldes: Molde[] = [{ id: 'p1', nome: 'A', larguraMM: 300, alturaMM: 400, quantidade: 2 }];
    const um = encaixar(modeloCom(moldes));
    const tres = encaixar(modeloCom(moldes), { conjuntos: 3 });
    console.log(
      `1 conjunto -> ${um.colocacoes.length} pecas, ${(umParaMM(um.comprimentoUsadoUM) / 1000).toFixed(3)} m | ` +
        `3 conjuntos -> ${tres.colocacoes.length} pecas, ` +
        `${(umParaMM(tres.comprimentoUsadoUM) / 1000).toFixed(3)} m`,
    );
    expect(tres.colocacoes).toHaveLength(um.colocacoes.length * 3);
  });
});

describe('Sem faixa declarada, o encaixe recusa', () => {
  it('encaixar sem saber a largura do rolo nao quer dizer nada', () => {
    contador = 0;
    const eventos: Evento[] = [
      {
        ...envelope(null),
        tipo: 'CriarModelo',
        payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' },
      } as Evento,
      ...retangulo({ id: 'p1', nome: 'A', larguraMM: 100, alturaMM: 100 }),
    ];
    const encaixe = encaixar(reconstruir(eventos));
    console.log(`sem papel -> ${encaixe.problemas[0]?.codigo}, ${encaixe.colocacoes.length} colocacoes`);
    expect(encaixe.problemas.map((p) => p.codigo)).toContain('PAPEL_INVALIDO');
  });
});

/** Só para o linter não reclamar do import não usado em algum caminho. */
void anelDoContorno;

describe('O encaixe cai no HPGL sem conversao', () => {
  it('as pecas encaixadas saem plotadas onde o encaixe as pos', () => {
    // Este teste existe por um motivo so: e a costura entre duas fases, e uma
    // discordancia sobre QUAL EIXO e a largura do rolo nao apareceria em nenhum
    // teste de pacote isolado. Apareceria no papel, com meia peca cortada.
    const modelo = modeloCom([
      { id: 'p1', nome: 'FRENTE', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p2', nome: 'MANGA', larguraMM: 300, alturaMM: 500, quantidade: 2, par: true },
      { id: 'p3', nome: 'GOLA', larguraMM: 200, alturaMM: 120, quantidade: 4 },
    ]);
    const encaixe = encaixar(modelo);
    const postas = aplicarEncaixe(modelo, encaixe).map((p) => p.peca);

    const encaixado = gerarHpgl(modelo, { pecasPostas: postas });
    const enfileirado = gerarHpgl(modelo);

    console.log('--- encaixe -> HPGL ---');
    console.log(
      `encaixadas ${encaixado.pecasPlotadas} pecas em ` +
        `${(umParaMM(encaixado.comprimentoUsadoUM) / 1000).toFixed(3)} m de rolo | ` +
        `problemas: ${encaixado.problemas.length}`,
    );
    console.log(
      `enfileiradas ${enfileirado.pecasPlotadas} pecas (uma de cada: a fila nao repete copia) em ` +
        `${(umParaMM(enfileirado.comprimentoUsadoUM) / 1000).toFixed(3)} m de rolo`,
    );
    console.log(
      `o encaixe diz ${umParaMM(encaixe.comprimentoUsadoUM).toFixed(0)} mm; ` +
        `o HPGL mede ${umParaMM(encaixado.comprimentoUsadoUM).toFixed(0)} mm ` +
        `(diferenca de ${umParaMM(Math.abs(encaixe.comprimentoUsadoUM - encaixado.comprimentoUsadoUM)).toFixed(1)} mm, ` +
        `dentro da folga de ${umParaMM(FOLGA_PADRAO_UM)} mm)`,
    );

    expect(encaixado.pecasPlotadas).toBe(encaixe.colocacoes.length);
    expect(encaixado.problemas).toHaveLength(0);
    // O comprimento medido no HPGL bate com o que o encaixe prometeu: a diferenca
    // e so a meia folga que o encaixe inflou em volta de cada peca.
    expect(Math.abs(encaixe.comprimentoUsadoUM - encaixado.comprimentoUsadoUM)).toBeLessThanOrEqual(
      FOLGA_PADRAO_UM,
    );
    expect(encaixado.comprimentoUsadoUM).toBeLessThan(enfileirado.comprimentoUsadoUM);
  });
});

describe('Otimizar: tentar varias ordens e ficar com a melhor', () => {
  it('a busca nunca fica pior que a heuristica, e costuma ficar melhor', () => {
    const modelo = modeloCom([
      { id: 'p1', nome: 'FRENTE', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p2', nome: 'COSTAS', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p3', nome: 'MANGA', larguraMM: 300, alturaMM: 500, quantidade: 2, par: true },
      { id: 'p4', nome: 'GOLA', larguraMM: 200, alturaMM: 100, quantidade: 4 },
      { id: 'p5', nome: 'PUNHO', larguraMM: 120, alturaMM: 90, quantidade: 2 },
    ]);
    const heuristica = encaixar(modelo);
    const busca = encaixarBuscando(modelo, {}, 16);

    console.log('--- otimizar ---');
    console.log(
      `heuristica (maiores primeiro): ${(umParaMM(heuristica.comprimentoUsadoUM) / 1000).toFixed(3)} m, ` +
        `aproveitamento ${(heuristica.aproveitamento * 100).toFixed(1)}%`,
    );
    console.log(
      `melhor de ${busca.tentadas} ordens:        ` +
        `${(umParaMM(busca.melhor.comprimentoUsadoUM) / 1000).toFixed(3)} m, ` +
        `aproveitamento ${(busca.melhor.aproveitamento * 100).toFixed(1)}%`,
    );
    const economia =
      ((heuristica.comprimentoUsadoUM - busca.melhor.comprimentoUsadoUM) /
        heuristica.comprimentoUsadoUM) *
      100;
    console.log(`economia da busca: ${economia.toFixed(1)}% de rolo`);
    console.log(
      `tentativas (m): ${busca.comprimentos.map((c) => (umParaMM(c) / 1000).toFixed(3)).join(', ')}`,
    );

    expect(busca.melhor.colocacoes).toHaveLength(12);
    // A tentativa 0 E a heuristica: no pior caso, empata.
    expect(busca.melhor.comprimentoUsadoUM).toBeLessThanOrEqual(heuristica.comprimentoUsadoUM);
  });

  it('a busca e deterministica: duas execucoes dao o mesmo encaixe', () => {
    const moldes: Molde[] = [
      { id: 'p1', nome: 'A', larguraMM: 400, alturaMM: 700, quantidade: 2 },
      { id: 'p2', nome: 'B', larguraMM: 300, alturaMM: 500, quantidade: 3 },
      { id: 'p3', nome: 'C', larguraMM: 200, alturaMM: 120, quantidade: 4 },
    ];
    const um = encaixarBuscando(modeloCom(moldes), {}, 10);
    const outro = encaixarBuscando(modeloCom(moldes), {}, 10);
    console.log(
      `duas buscas de 10 ordens: ${(umParaMM(um.melhor.comprimentoUsadoUM) / 1000).toFixed(3)} m ` +
        `e ${(umParaMM(outro.melhor.comprimentoUsadoUM) / 1000).toFixed(3)} m | identicas: ` +
        `${JSON.stringify(um.melhor.colocacoes) === JSON.stringify(outro.melhor.colocacoes)}`,
    );
    expect(JSON.stringify(outro.melhor.colocacoes)).toBe(JSON.stringify(um.melhor.colocacoes));
  });
});

describe('Giro fino: onde ha folga de tecido de verdade', () => {
  it('peca de giro LIVRE ganha angulos, peca de giro 90 nao', () => {
    const livre = Object.values(
      modeloCom([{ id: 'p', nome: 'P', larguraMM: 100, alturaMM: 100, giro: 'livre' }]).pecas,
    )[0]!;
    const noventa = Object.values(
      modeloCom([{ id: 'p', nome: 'P', larguraMM: 100, alturaMM: 100, giro: '90' }]).pecas,
    )[0]!;
    console.log('--- passo de giro ---');
    console.log(`livre, passo 90: ${rotacoesPermitidas(livre, 90).join(', ')}`);
    console.log(`livre, passo 30: ${rotacoesPermitidas(livre, 30).join(', ')}`);
    console.log(`giro "90", passo 30: ${rotacoesPermitidas(noventa, 30).join(', ')} (nao muda)`);
    expect(rotacoesPermitidas(livre, 30)).toHaveLength(12);
    // "90" quer dizer que pode DEITAR, nao que pode ficar enviesada.
    expect(rotacoesPermitidas(noventa, 30)).toEqual([0, 90, 180, 270]);
  });

  it('angulo fino economiza rolo de verdade — 36% nesta tira', () => {
    // Duas tiras de 1700 x 100 mm num rolo de 1,58 m. De pe, lado a lado, cabem as
    // duas. Enviesadas a 30 graus, a caixa de cada uma encolhe — e a primeira ocupa
    // a faixa de um jeito que atravanca a segunda.
    const moldes: Molde[] = [
      { id: 'p1', nome: 'TIRA', larguraMM: 1700, alturaMM: 100, quantidade: 2, giro: 'livre' },
    ];
    const grosso = encaixar(modeloCom(moldes), { passoDeGiroGraus: 90 });
    const fino = encaixar(modeloCom(moldes), { passoDeGiroGraus: 30 });

    console.log('--- a tira de 1700 mm num rolo de 1580 uteis ---');
    console.log(
      'passo 90 (0, 90, 180, 270): ' + grosso.colocacoes.length + ' colocada(s)' +
        (grosso.problemas[0] ? ', ' + grosso.problemas[0].codigo : ''),
    );
    console.log(
      'passo 30: ' + fino.colocacoes.length + ' colocada(s), angulos ' +
        fino.colocacoes.map((c) => c.rotacaoGraus).join(' e ') + ' graus, ' +
        (umParaMM(fino.comprimentoUsadoUM) / 1000).toFixed(3) + ' m de rolo',
    );

    // Com a colocacao GULOSA e o candidato incompleto, esta medida dava o
    // contrario: 1,933 m no passo 30 contra 1,722 m no passo 90, e a conclusao
    // registrada era "angulo fino piora". Era artefato do defeito de colocacao, nao
    // verdade do problema. Com a regiao viavel exata as duas tiras se deitam
    // paralelas a 30 graus e o rolo cai 36%.
    expect(fino.comprimentoUsadoUM).toBeLessThan(grosso.comprimentoUsadoUM);

    // A busca continua sendo a rede: ela nunca fica pior que o melhor dos dois.
    const busca = encaixarBuscando(modeloCom(moldes), {}, 9);
    console.log(
      'busca (ordens x passos): ' + (umParaMM(busca.melhor.comprimentoUsadoUM) / 1000).toFixed(3) +
        ' m — nunca pior que o melhor dos dois',
    );
    expect(busca.melhor.comprimentoUsadoUM).toBeLessThanOrEqual(
      Math.min(grosso.comprimentoUsadoUM, fino.comprimentoUsadoUM),
    );
  });
});
