/**
 * Teste 5 (casamento de costuras em toda a grade) e a conferencia de perimetros
 * (Parte 2, operacoes 6 e 7).
 *
 * O fixture e proposital: a cava da FRENTE e a cava da MANGA sao a MESMA curva,
 * uma transladada da outra. Com os mesmos saltos de graduacao elas continuam com o
 * mesmo comprimento em toda a grade; com saltos diferentes, o motor tem que acusar.
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor } from '../src/erros.js';
import type { CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import { compararPerimetros, validarCasamento } from '../src/conferencia.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import { medirAresta } from '../src/geometria/medir.js';
import type { Modelo } from '../src/tipos.js';
import { MM, TOLERANCIA_CASAMENTO_UM, umParaCM, umParaMM } from '../src/unidades.js';
import {
  comGraduacao,
  logFrenteEManga,
  logRetangulo,
  PECA_FRENTE,
  PECA_ID,
  PECA_MANGA,
  regraEmTodaAGrade,
} from './fixtures.js';

function codigoDoErro(acao: () => unknown): CodigoErro | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

/** Cava de raio 100 mm nas duas pecas; os saltos vem de fora. */
function modeloCamisa(
  frente: readonly [{ dxMM: number; dyMM: number }, { dxMM: number; dyMM: number }],
  manga: readonly [{ dxMM: number; dyMM: number }, { dxMM: number; dyMM: number }],
): Modelo {
  return reconstruir(logFrenteEManga({ raioMM: 100, frente, manga }));
}

/** Os dois extremos da cava abrem: +8 mm em x no inicio, +5 mm em y no fim. */
const SALTO_QUE_CASA = [
  { dxMM: 8, dyMM: 0 },
  { dxMM: 0, dyMM: 5 },
] as const;

describe('Teste 5 — casamento de costuras em toda a grade', () => {
  it('cava da frente e da manga medem igual no base e continuam iguais em P, M e G', () => {
    const modelo = modeloCamisa(SALTO_QUE_CASA, SALTO_QUE_CASA);

    console.log('--- TESTE 5 (par de costura ar-cava-frente <-> ar-cava-manga) ---');
    for (const tamanho of modelo.tamanhos) {
      const frente = medirAresta(aplicarGraduacao(modelo, PECA_FRENTE, tamanho), 'ar-cava-frente');
      const manga = medirAresta(aplicarGraduacao(modelo, PECA_MANGA, tamanho), 'ar-cava-manga');
      console.log(
        `${tamanho}: frente ${frente} UM (${umParaCM(frente).toFixed(4)} cm) | ` +
          `manga ${manga} UM | diferenca ${frente - manga} UM`,
      );
      expect(frente - manga).toBe(0);
    }

    const problemas = validarCasamento(modelo);
    console.log(`validarCasamento -> ${problemas.length} problema(s)`);
    expect(problemas).toEqual([]);
  });

  it('a cava realmente cresce com a grade (senao o teste acima passaria a toa)', () => {
    const modelo = modeloCamisa(SALTO_QUE_CASA, SALTO_QUE_CASA);
    const medidas = modelo.tamanhos.map((t) =>
      medirAresta(aplicarGraduacao(modelo, PECA_FRENTE, t), 'ar-cava-frente'),
    );
    console.log(`cava da frente em P, M, G: ${medidas.join(' / ')} UM`);
    expect(medidas[0]!).toBeLessThan(medidas[1]!);
    expect(medidas[1]!).toBeLessThan(medidas[2]!);
  });

  it('regra que abre so a frente e acusada — e so nos tamanhos em que ja abriu', () => {
    // A manga nao gradua; a frente abre 8 mm em x por tamanho. No base as duas
    // ainda medem igual, entao o defeito so aparece em P e em G.
    const parado = [
      { dxMM: 0, dyMM: 0 },
      { dxMM: 0, dyMM: 0 },
    ] as const;
    const modelo = modeloCamisa(SALTO_QUE_CASA, parado);
    const problemas = validarCasamento(modelo);

    console.log('--- casamento quebrado pela graduacao ---');
    for (const tamanho of modelo.tamanhos) {
      const frente = medirAresta(aplicarGraduacao(modelo, PECA_FRENTE, tamanho), 'ar-cava-frente');
      const manga = medirAresta(aplicarGraduacao(modelo, PECA_MANGA, tamanho), 'ar-cava-manga');
      console.log(`${tamanho}: frente ${frente} | manga ${manga} | diferenca ${frente - manga} UM`);
    }
    for (const problema of problemas) console.log(`  ${problema.gravidade}: ${problema.mensagem}`);

    // Casa no base (M) e falha nos outros dois.
    expect(problemas).toHaveLength(2);
    expect(problemas.every((p) => p.gravidade === 'erro')).toBe(true);
    expect(problemas.every((p) => p.codigo === 'CASAMENTO_DIVERGENTE')).toBe(true);
    expect(problemas.map((p) => p.mensagem.includes('tamanho M'))).toEqual([false, false]);
  });

  it('diferenca abaixo da tolerancia de casamento nao vira problema', () => {
    // A manga abre 0,1 mm a mais por tamanho na ponta da cava. Deslocar um extremo
    // em 0,1 mm move o COMPRIMENTO DO ARCO bem menos que isso: em G da 63 UM,
    // abaixo dos 200 UM (0,02 cm) que a confeccao aceita e da mesma ordem do ruido
    // de medicao. Acusar aqui ensinaria o modelista a ignorar o alerta.
    const quaseIgual = [
      { dxMM: 8, dyMM: 0 },
      { dxMM: 0, dyMM: 5.1 },
    ] as const;
    const modelo = modeloCamisa(SALTO_QUE_CASA, quaseIgual);
    const problemas = validarCasamento(modelo);

    console.log('--- diferenca abaixo da tolerancia ---');
    for (const tamanho of modelo.tamanhos) {
      const frente = medirAresta(aplicarGraduacao(modelo, PECA_FRENTE, tamanho), 'ar-cava-frente');
      const manga = medirAresta(aplicarGraduacao(modelo, PECA_MANGA, tamanho), 'ar-cava-manga');
      console.log(
        `${tamanho}: frente ${frente} | manga ${manga} | diferenca ${frente - manga} UM ` +
          `(tolerancia ${TOLERANCIA_CASAMENTO_UM} UM)`,
      );
      expect(Math.abs(frente - manga)).toBeLessThanOrEqual(TOLERANCIA_CASAMENTO_UM);
    }
    console.log(`validarCasamento -> ${problemas.length} problema(s)`);
    expect(problemas).toEqual([]);
  });

  it('modelo sem par de costura declarado nao inventa par pela geometria', () => {
    // As duas cavas medem exatamente igual, mas sem DefinirParCostura nao ha par.
    const modelo = modeloCamisa(SALTO_QUE_CASA, SALTO_QUE_CASA);
    const semPar: Modelo = { ...modelo, paresCostura: {} };
    console.log(`sem ParCostura declarado -> ${validarCasamento(semPar).length} problema(s)`);
    expect(validarCasamento(semPar)).toEqual([]);
  });
});

describe('Comparar perimetros — a tabela tamanho x medida', () => {
  it('soma e subtracao com numeros exatos no retangulo graduado', () => {
    // Retangulo 100 x 200, base M, +6 mm em x nos cantos da direita e +4 mm em y
    // nos de cima. Em cada tamanho:
    //   ar-baixo = ar-cima (largura) | ar-direita = ar-esquerda (altura)
    //   P: 94 e 196 | M: 100 e 200 | G: 106 e 204
    const modelo = reconstruir(
      comGraduacao(
        logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
        [
          { gradePointId: 'gp-0', pontoId: 'pt-0' },
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          { gradePointId: 'gp-2', pontoId: 'pt-2' },
          { gradePointId: 'gp-3', pontoId: 'pt-3' },
        ],
        [
          ...regraEmTodaAGrade('r1', 'gp-1', 6, 0),
          ...regraEmTodaAGrade('r2', 'gp-2', 6, 4),
          ...regraEmTodaAGrade('r3', 'gp-3', 0, 4),
        ],
      ),
    );

    const tabela = compararPerimetros(modelo, ['ar-baixo', 'ar-cima'], ['ar-direita']);

    console.log('--- CONFERENCIA: (ar-baixo + ar-cima) - ar-direita ---');
    for (const tamanho of modelo.tamanhos) {
      const linha = tabela[tamanho]!;
      console.log(
        `${tamanho}: mais ${umParaMM(linha.mais)} mm | menos ${umParaMM(linha.menos)} mm | ` +
          `diferenca ${umParaMM(linha.dif)} mm`,
      );
    }

    expect(tabela['P']).toEqual({ mais: 188 * MM, menos: 196 * MM, dif: -8 * MM });
    expect(tabela['M']).toEqual({ mais: 200 * MM, menos: 200 * MM, dif: 0 });
    expect(tabela['G']).toEqual({ mais: 212 * MM, menos: 204 * MM, dif: 8 * MM });
  });

  it('atravessa pecas: a cava da frente menos a da manga fecha em zero na grade toda', () => {
    const modelo = modeloCamisa(SALTO_QUE_CASA, SALTO_QUE_CASA);
    const tabela = compararPerimetros(modelo, ['ar-cava-frente'], ['ar-cava-manga']);

    console.log('--- CONFERENCIA entre pecas: cava frente - cava manga ---');
    for (const tamanho of modelo.tamanhos) {
      const linha = tabela[tamanho]!;
      console.log(
        `${tamanho}: frente ${linha.mais} UM | manga ${linha.menos} UM | diferenca ${linha.dif} UM`,
      );
      expect(linha.dif).toBe(0);
    }
  });

  it('lado sem arestas e legitimo: serve para somar um perimetro', () => {
    const modelo = modeloCamisa(SALTO_QUE_CASA, SALTO_QUE_CASA);
    const tabela = compararPerimetros(
      modelo,
      ['ar-cava-frente', 'ar-f-vertical', 'ar-f-horizontal'],
      [],
    );
    console.log('--- perimetro da FRENTE por tamanho ---');
    for (const tamanho of modelo.tamanhos) {
      const linha = tabela[tamanho]!;
      console.log(`${tamanho}: ${linha.mais} UM (${umParaCM(linha.mais).toFixed(3)} cm)`);
      expect(linha.menos).toBe(0);
      expect(linha.dif).toBe(linha.mais);
    }
    expect(tabela['G']!.mais).toBeGreaterThan(tabela['P']!.mais);
  });

  it('recusa aresta que nao existe, em vez de somar zero em silencio', () => {
    const modelo = modeloCamisa(SALTO_QUE_CASA, SALTO_QUE_CASA);
    const codigo = codigoDoErro(() => compararPerimetros(modelo, ['ar-fantasma'], []));
    console.log(`aresta inexistente na conferencia -> ${codigo}`);
    expect(codigo).toBe('ARESTA_INEXISTENTE');
  });

  it('recusa conferencia sem nenhuma aresta dos dois lados', () => {
    const modelo = modeloCamisa(SALTO_QUE_CASA, SALTO_QUE_CASA);
    const codigo = codigoDoErro(() => compararPerimetros(modelo, [], []));
    console.log(`conferencia vazia                 -> ${codigo}`);
    expect(codigo).toBe('CONFERENCIA_SEM_ARESTAS');
  });

  it('a mesma aresta nos dois lados fecha em zero (conferencia trivial)', () => {
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
    );
    const tabela = compararPerimetros(modelo, ['ar-baixo'], ['ar-baixo']);
    console.log(`mesma aresta dos dois lados: dif = ${tabela['M']!.dif} UM`);
    expect(tabela['M']).toEqual({ mais: 100 * MM, menos: 100 * MM, dif: 0 });
    expect(modelo.pecas[PECA_ID]).toBeDefined();
  });
});
