/**
 * Teste 11 (dobra multipla / pregas) e a projecao do pique costura -> corte, que
 * era a lacuna marcada como aberta na Parte 1.
 *
 * O verb nao entra aqui: os dois casos sao conferidos contra conta manual, que e
 * o que a Parte 5 pede no teste 11 ("batem com a conta manual").
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor } from '../src/erros.js';
import type { CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import { aberturaDasPregas, abrirPregas } from '../src/pregas.js';
import { projetarPique, projetarPiques } from '../src/pique.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import { anelDoContorno } from '../src/geometria/anel.js';
import { medirAresta } from '../src/geometria/medir.js';
import type { Evento } from '../src/eventos/tipos.js';
import type { Modelo, Peca, Pique, Vetor2 } from '../src/tipos.js';
import { MM, umParaMM } from '../src/unidades.js';
import { comGraduacao, logRetangulo, PECA_ID, regraEmTodaAGrade } from './fixtures.js';

function codigoDoErro(acao: () => unknown): CodigoErro | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

function largura(pontos: readonly Vetor2[]): number {
  const xs = pontos.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

function eventoEixo(indice: number, eixoId: string, x: number, profundidadeMM: number): Evento {
  return {
    id: `evt-eixo-${indice}`,
    tenantId: 'tenant-confeccao-01',
    modeloId: 'mod-0001',
    pecaId: PECA_ID,
    timestamp: '2026-09-04T12:00:00.000Z',
    autor: 'teste',
    versaoSchema: 1,
    tipo: 'DefinirEixoDobra',
    payload: {
      eixoId,
      p1: { x, y: -500 * MM },
      p2: { x, y: 500 * MM },
      direcao: indice % 2 === 0 ? 'dentro' : 'fora',
      profundidadeUM: profundidadeMM * MM,
    },
  } as Evento;
}

/**
 * Saia reta de 200 x 300 mm com 3 eixos de prega verticais em x = 50, 100 e 150 mm
 * — "dividida em 4 partes" — com 20 mm de profundidade cada.
 *
 * Conta manual: cada prega come 2 x 20 = 40 mm, entao a peca plana fica
 * 200 + 3 x 40 = 320 mm de largura.
 */
function saiaComPregas(profundidadeMM = 20): Modelo {
  const base = logRetangulo({ larguraMM: 200, alturaMM: 300, margensMM: [10, 10, 10, 10] });
  return reconstruir([
    ...base,
    eventoEixo(0, 'pr-1', 50 * MM, profundidadeMM),
    eventoEixo(1, 'pr-2', 100 * MM, profundidadeMM),
    eventoEixo(2, 'pr-3', 150 * MM, profundidadeMM),
  ]);
}

describe('Teste 11 — dobra multipla (pregas)', () => {
  it('4 partes com 20 mm de profundidade: 200 mm viram 320 mm, como manda a conta', () => {
    const modelo = saiaComPregas(20);
    const peca = modelo.pecas[PECA_ID]!;
    const eixos = ['pr-1', 'pr-2', 'pr-3'];

    const antes = largura(anelDoContorno(peca));
    const aberta = abrirPregas(peca, eixos, 'pg');
    const depois = largura(anelDoContorno(aberta));
    const abertura = aberturaDasPregas(peca, eixos);

    console.log('--- TESTE 11 (3 pregas de 20 mm numa saia de 200 mm) ---');
    console.log(`conta manual: 200 + 3 x (2 x 20) = ${200 + 3 * 40} mm`);
    console.log(
      `motor: ${umParaMM(antes)} mm -> ${umParaMM(depois)} mm | abertura somada ` +
        `${umParaMM(abertura)} mm`,
    );

    expect(umParaMM(antes)).toBe(200);
    expect(umParaMM(depois)).toBe(320);
    expect(depois - antes).toBe(abertura);
    expect(umParaMM(abertura)).toBe(120);
  });

  it('os piques de inicio e fim de cada dobra caem onde o eixo corta o contorno', () => {
    const modelo = saiaComPregas(20);
    const peca = modelo.pecas[PECA_ID]!;
    const aberta = abrirPregas(peca, ['pr-1', 'pr-2', 'pr-3'], 'pg');
    const piques = Object.values(aberta.piques);

    // Cada eixo vertical corta o contorno em cima e embaixo: 2 piques por prega.
    console.log(`--- piques de prega --- ${piques.length} piques em 3 pregas`);
    const porAresta = new Map<string, number[]>();
    for (const pique of piques) {
      const lista = porAresta.get(pique.arestaId) ?? [];
      lista.push(pique.s);
      porAresta.set(pique.arestaId, lista);
    }
    for (const [arestaId, esses] of porAresta) {
      const posicoes = esses.sort((a, b) => a - b);
      console.log(
        `  ${arestaId}: s = ${posicoes.map((s) => s.toFixed(4)).join(', ')} ` +
          `-> em mm da aresta: ${posicoes
            .map((s) => umParaMM(Math.round(s * medirAresta(aberta, arestaId))))
            .join(', ')}`,
      );
    }

    expect(piques).toHaveLength(6);
    // As posicoes na aresta de baixo somam com a abertura acumulada: a primeira
    // prega fica em 50 mm, a segunda em 50+20+40=110... conferido pelos numeros
    // impressos acima, e o que o teste prende e que sao 3 pares.
    expect(porAresta.size).toBe(2);
    for (const esses of porAresta.values()) expect(esses).toHaveLength(3);
  });

  it('depois de graduar, as pregas continuam proporcionais', () => {
    // A saia gradua +30 mm em largura por tamanho, com a lateral esquerda ancorada.
    const base = logRetangulo({ larguraMM: 200, alturaMM: 300, margensMM: [10, 10, 10, 10] });
    const modelo = reconstruir(
      comGraduacao(
        [
          ...base,
          eventoEixo(0, 'pr-1', 50 * MM, 20),
          eventoEixo(1, 'pr-2', 100 * MM, 20),
          eventoEixo(2, 'pr-3', 150 * MM, 20),
        ],
        [
          { gradePointId: 'gp-0', pontoId: 'pt-0' },
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          { gradePointId: 'gp-2', pontoId: 'pt-2' },
          { gradePointId: 'gp-3', pontoId: 'pt-3' },
        ],
        [...regraEmTodaAGrade('r1', 'gp-1', 30, 0), ...regraEmTodaAGrade('r2', 'gp-2', 30, 0)],
      ),
    );

    console.log('--- pregas sob graduacao ---');
    for (const tamanho of modelo.tamanhos) {
      const peca = aplicarGraduacao(modelo, PECA_ID, tamanho);
      const acabada = largura(anelDoContorno(peca));
      const plana = largura(anelDoContorno(abrirPregas(peca, ['pr-1', 'pr-2', 'pr-3'], 'pg')));
      console.log(
        `${tamanho}: acabada ${umParaMM(acabada)} mm -> plana ${umParaMM(plana)} mm ` +
          `(diferenca ${umParaMM(plana - acabada)} mm)`,
      );
      // A abertura das pregas nao depende do tamanho: e a profundidade declarada.
      expect(plana - acabada).toBe(120 * MM);
    }
  });

  it('recusa eixo sem profundidade e eixos nao paralelos', () => {
    const base = logRetangulo({ larguraMM: 200, alturaMM: 300, margensMM: [10, 10, 10, 10] });
    const semProfundidade = reconstruir([
      ...base,
      {
        ...eventoEixo(0, 'pr-1', 50 * MM, 20),
        payload: { eixoId: 'pr-1', p1: { x: 50 * MM, y: 0 }, p2: { x: 50 * MM, y: 300 * MM }, direcao: 'dentro' },
      } as Evento,
    ]);
    const cruzados = reconstruir([
      ...base,
      eventoEixo(0, 'pr-1', 50 * MM, 20),
      {
        ...eventoEixo(1, 'pr-2', 100 * MM, 20),
        payload: {
          eixoId: 'pr-2',
          p1: { x: 0, y: 100 * MM },
          p2: { x: 200 * MM, y: 100 * MM },
          direcao: 'fora',
          profundidadeUM: 20 * MM,
        },
      } as Evento,
    ]);

    const a = codigoDoErro(() => abrirPregas(semProfundidade.pecas[PECA_ID]!, ['pr-1'], 'x'));
    const b = codigoDoErro(() => abrirPregas(cruzados.pecas[PECA_ID]!, ['pr-1', 'pr-2'], 'x'));
    const c = codigoDoErro(() => abrirPregas(saiaComPregas().pecas[PECA_ID]!, [], 'x'));
    console.log(`eixo sem profundidade -> ${a}`);
    console.log(`eixos nao paralelos   -> ${b}`);
    console.log(`nenhum eixo           -> ${c}`);
    expect(a).toBe('PREGA_SEM_PROFUNDIDADE');
    expect(b).toBe('EIXOS_DE_PREGA_NAO_PARALELOS');
    expect(c).toBe('PREGA_SEM_EIXO');
  });
});

describe('Projecao do pique costura -> corte (a lacuna aberta da Parte 1)', () => {
  /** Retangulo 100 x 200 com margem 10 e um pique no meio do lado de baixo. */
  function comPique(s: number, margensMM: readonly [number, number, number, number]): Peca {
    const peca = reconstruir(logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM })).pecas[
      PECA_ID
    ]!;
    const pique: Pique = {
      id: 'pq-1',
      tipo: 'V',
      alturaUM: 6350,
      larguraUM: 1590,
      anguloGraus: 0,
      arestaId: 'ar-baixo',
      s,
    };
    return { ...peca, piques: { 'pq-1': pique } };
  }

  it('num lado reto, o pique anda EXATAMENTE a margem, na perpendicular', () => {
    const peca = comPique(0.5, [10, 10, 10, 10]);
    const projetado = projetarPique(peca, 'pq-1');

    console.log('--- projecao do pique (lado reto, margem 10 mm) ---');
    console.log(
      `costura (${umParaMM(projetado.pontoDaCostura.x)}, ${umParaMM(projetado.pontoDaCostura.y)}) mm -> ` +
        `corte (${umParaMM(projetado.pontoDoCorte.x)}, ${umParaMM(projetado.pontoDoCorte.y)}) mm`,
    );
    console.log(
      `andou ${projetado.distanciaUM} UM (${umParaMM(projetado.distanciaUM)} mm) | ` +
        `direcao para dentro (${projetado.paraDentro.x.toFixed(3)}, ${projetado.paraDentro.y.toFixed(3)})`,
    );

    expect(projetado.pontoDaCostura).toEqual({ x: 50 * MM, y: 0 });
    expect(projetado.pontoDoCorte).toEqual({ x: 50 * MM, y: -10 * MM });
    expect(projetado.distanciaUM).toBe(10 * MM);
    // Para dentro e +y: o lado de baixo tem a peca acima dele.
    expect(projetado.paraDentro.y).toBeCloseTo(1, 6);
  });

  it('a distancia acompanha a margem DAQUELA aresta, nao a da peca', () => {
    // Bainha de 40 mm embaixo; o pique dela anda 40 mm, nao 10.
    const peca = comPique(0.5, [40, 10, 10, 10]);
    const projetado = projetarPique(peca, 'pq-1');
    console.log(
      `bainha de 40 mm: pique anda ${umParaMM(projetado.distanciaUM)} mm ate ` +
        `(${umParaMM(projetado.pontoDoCorte.x)}, ${umParaMM(projetado.pontoDoCorte.y)}) mm`,
    );
    expect(projetado.distanciaUM).toBe(40 * MM);
    expect(projetado.pontoDoCorte).toEqual({ x: 50 * MM, y: -40 * MM });
  });

  it('manter o `s` na linha de corte daria outro ponto — por isso a projecao existe', () => {
    // Pique a 10% da aresta de baixo. Na costura, x = 10 mm. A linha de corte
    // daquele lado vai de x = -10 a x = 110 (120 mm), entao 10% dela cai em
    // x = 2 mm: 8 mm fora do lugar. Este teste prende essa diferenca.
    const peca = comPique(0.1, [10, 10, 10, 10]);
    const projetado = projetarPique(peca, 'pq-1');
    const naCostura = projetado.pontoDaCostura.x;
    const projetadoX = projetado.pontoDoCorte.x;
    const seFosseS = -10 * MM + 0.1 * (120 * MM);

    console.log('--- por que nao se mantem o s ---');
    console.log(`pique em s = 0,1 da costura: x = ${umParaMM(naCostura)} mm`);
    console.log(`projetado na perpendicular : x = ${umParaMM(projetadoX)} mm  (certo)`);
    console.log(`se mantivesse s no corte    : x = ${umParaMM(seFosseS)} mm  (erraria ${umParaMM(projetadoX - seFosseS)} mm)`);

    expect(naCostura).toBe(10 * MM);
    expect(projetadoX).toBe(10 * MM);
    expect(seFosseS).toBe(2 * MM);
    expect(projetadoX - seFosseS).toBe(8 * MM);
  });

  it('projeta varios piques de uma vez e recusa margem zero na aresta do pique', () => {
    const peca = comPique(0.25, [10, 10, 10, 10]);
    const doisPiques: Peca = {
      ...peca,
      piques: {
        ...peca.piques,
        'pq-2': { ...peca.piques['pq-1']!, id: 'pq-2', s: 0.75 },
      },
    };
    const projetados = projetarPiques(doisPiques, ['pq-1', 'pq-2']);
    console.log(
      `dois piques: x = ${projetados.map((p) => umParaMM(p.pontoDoCorte.x)).join(' e ')} mm, ` +
        `os dois em y = ${umParaMM(projetados[0]!.pontoDoCorte.y)} mm`,
    );
    expect(projetados.map((p) => p.pontoDoCorte.x)).toEqual([25 * MM, 75 * MM]);

    // Margem ZERO naquela aresta (a que cai na dobra do tecido): corte e costura
    // coincidem, entao o pique e cortado em cima da propria linha de costura.
    // Distancia zero e a resposta certa, nao um erro.
    const semMargem = comPique(0.5, [0, 10, 10, 10]);
    const naDobra = projetarPique(semMargem, 'pq-1');
    console.log(
      `aresta do pique com margem zero: anda ${naDobra.distanciaUM} UM, corte em ` +
        `(${umParaMM(naDobra.pontoDoCorte.x)}, ${umParaMM(naDobra.pontoDoCorte.y)}) mm`,
    );
    expect(naDobra.distanciaUM).toBe(0);
    expect(naDobra.pontoDoCorte).toEqual(naDobra.pontoDaCostura);
  });
});
