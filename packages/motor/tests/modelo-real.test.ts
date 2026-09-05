/**
 * Testes dos achados da Parte 7 — o que a pesquisa em fonte externa mostrou que o
 * modelo nao cobria.
 *
 *  D9  — embebido da copa de manga: duas arestas que costuram juntas NAO precisam
 *        ter o mesmo comprimento. Sem isso o motor reprovaria toda peca de tecido
 *        plano, e os testes das Partes 5 e 6 passavam so porque os fixtures foram
 *        construidos com as duas cavas congruentes.
 *  ASTM — os dez tipos de pique cobrem as cinco camadas do DXF (4, 80, 81, 82, 83).
 *  ASTM — recorte interno (camada 11) existe no modelo, e as operacoes que nao
 *        sabem trata-lo RECUSAM em vez de devolver a peca sem o vazado.
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor } from '../src/erros.js';
import type { CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import { validarCasamento } from '../src/conferencia.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import { medirAresta } from '../src/geometria/medir.js';
import { offsetMargem } from '../src/offset.js';
import { CAMADA_ASTM_DO_PIQUE } from '../src/tipos.js';
import type { Modelo, Peca, TipoPique, Vetor2 } from '../src/tipos.js';
import { MM, TOLERANCIA_CASAMENTO_UM, umParaMM } from '../src/unidades.js';
import {
  comGraduacao,
  logFrenteEManga,
  logRetangulo,
  logRetanguloPadrao,
  MODELO_ID,
  PECA_FRENTE,
  PECA_ID,
  PECA_MANGA,
  regraEmTodaAGrade,
  TENANT,
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

const PARADO = [
  { dxMM: 0, dyMM: 0 },
  { dxMM: 0, dyMM: 0 },
] as const;

/**
 * Cava da frente com raio 150 mm; copa da manga com o raio que faz o arco ficar
 * `embebidoMM` mais comprido. Como o arco de 90 graus vale `pi*R/2`, um embebido de
 * E milimetros pede `R + E/(pi/2)` — a conta e analitica, nao ajustada ate passar.
 */
function camisaComEmbebido(embebidoMM: number): Modelo {
  const raioMM = 150;
  return reconstruir(
    logFrenteEManga({
      raioMM,
      raioMangaMM: raioMM + embebidoMM / (Math.PI / 2),
      frente: PARADO,
      manga: PARADO,
      embebidoMM,
    }),
  );
}

function sobraMedida(modelo: Modelo, tamanho = 'M'): number {
  return (
    medirAresta(aplicarGraduacao(modelo, PECA_MANGA, tamanho), 'ar-cava-manga') -
    medirAresta(aplicarGraduacao(modelo, PECA_FRENTE, tamanho), 'ar-cava-frente')
  );
}

describe('D9 — embebido da copa de manga', () => {
  it('blusa de manga montada: copa 25 mm maior que a cava passa, com o embebido declarado', () => {
    // Este e o caso que o motor REPROVAVA antes da D9: 25 mm = 25000 UM, 125 vezes
    // a tolerancia de casamento.
    const modelo = camisaComEmbebido(25);
    const sobra = sobraMedida(modelo);
    const problemas = validarCasamento(modelo);

    console.log('--- D9: blusa com embebido de 25 mm ---');
    console.log(
      `cava da frente ${medirAresta(modelo.pecas[PECA_FRENTE]!, 'ar-cava-frente')} UM | ` +
        `copa da manga ${medirAresta(modelo.pecas[PECA_MANGA]!, 'ar-cava-manga')} UM`,
    );
    console.log(
      `sobra medida ${sobra} UM (${umParaMM(sobra).toFixed(3)} mm) | embebido declarado ${25 * MM} UM | ` +
        `desvio ${sobra - 25 * MM} UM (tolerancia ${TOLERANCIA_CASAMENTO_UM})`,
    );
    console.log(`validarCasamento -> ${problemas.length} problema(s)`);

    expect(Math.abs(sobra - 25 * MM)).toBeLessThanOrEqual(TOLERANCIA_CASAMENTO_UM);
    expect(problemas).toEqual([]);
  });

  it('a MESMA geometria com embebido declarado zero e acusada — o campo e usado de verdade', () => {
    // Mesma copa 25 mm maior, mas o par diz "fecha exata". Tem que reprovar, senao
    // o embebidoUM estaria sendo ignorado e o teste acima passaria por acidente.
    const raioMM = 150;
    const modelo = reconstruir(
      logFrenteEManga({
        raioMM,
        raioMangaMM: raioMM + 25 / (Math.PI / 2),
        frente: PARADO,
        manga: PARADO,
        embebidoMM: 0,
      }),
    );
    const problemas = validarCasamento(modelo);
    console.log('--- mesma peca, embebido declarado 0 ---');
    for (const p of problemas) console.log(`  ${p.gravidade}: ${p.mensagem}`);
    // Um problema por tamanho da grade (P, M, G).
    expect(problemas).toHaveLength(3);
    expect(problemas[0]!.codigo).toBe('CASAMENTO_DIVERGENTE');
  });

  it('malha: embebido zero e copa igual a cava continua fechando', () => {
    // A D9 nao pode ter quebrado o caso antigo.
    const modelo = camisaComEmbebido(0);
    console.log(`malha (embebido 0): sobra ${sobraMedida(modelo)} UM -> ${validarCasamento(modelo).length} problema(s)`);
    expect(sobraMedida(modelo)).toBe(0);
    expect(validarCasamento(modelo)).toEqual([]);
  });

  it('embebido declarado mas ausente na geometria: a mensagem mostra os tres numeros', () => {
    // Copa igual a cava, mas o par declara 25 mm de embebido: a manga ficou sem
    // sobra e vai faltar volume no ombro.
    const raioMM = 150;
    const modelo = reconstruir(
      logFrenteEManga({ raioMM, frente: PARADO, manga: PARADO, embebidoMM: 25 }),
    );
    const problemas = validarCasamento(modelo);
    console.log('--- embebido declarado 25 mm, geometria sem sobra ---');
    console.log(`  ${problemas[0]!.mensagem}`);
    expect(problemas).toHaveLength(3);
    expect(problemas[0]!.mensagem).toContain('embebido declarado');
    expect(problemas[0]!.mensagem).toContain('sobra de 0 UM');
    expect(problemas[0]!.mensagem).toContain('25000 UM maior');
    expect(problemas[0]!.mensagem).toContain('-25000 UM fora');
  });

  it('embebido negativo e legitimo: diz apenas qual das duas arestas e a maior', () => {
    const raioMM = 150;
    const modelo = reconstruir(
      logFrenteEManga({
        raioMM,
        raioMangaMM: raioMM - 25 / (Math.PI / 2),
        frente: PARADO,
        manga: PARADO,
        embebidoMM: -25,
      }),
    );
    const sobra = sobraMedida(modelo);
    console.log(`embebido -25 mm: sobra medida ${sobra} UM -> ${validarCasamento(modelo).length} problema(s)`);
    expect(Math.abs(sobra + 25 * MM)).toBeLessThanOrEqual(TOLERANCIA_CASAMENTO_UM);
    expect(validarCasamento(modelo)).toEqual([]);
  });

  it('o embebido tem que ser micrometro inteiro, como toda coordenada', () => {
    const modelo = reconstruir(logRetanguloPadrao());
    const evento = {
      id: 'evt-par-float',
      tenantId: modelo.tenantId,
      modeloId: modelo.id,
      pecaId: null,
      timestamp: '2026-09-04T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
      tipo: 'DefinirParCostura' as const,
      payload: { parId: 'par-x', arestaA: 'ar-baixo', arestaB: 'ar-cima', embebidoUM: 25.5 },
    };
    const codigo = codigoDoErro(() => reconstruir([...logRetanguloPadrao(), evento]));
    console.log(`embebidoUM = 25,5 (float de mm vazando) -> ${codigo}`);
    expect(codigo).toBe('UM_NAO_INTEIRO');
  });
});

describe('DXF ASTM — os conceitos que faltavam no modelo', () => {
  it('os dez tipos de pique cobrem as cinco camadas da norma', () => {
    const todos: readonly TipoPique[] = [
      'I',
      'V',
      'V1',
      'V2',
      'T',
      'MX',
      'M+',
      'MX2',
      'CHECK',
      'U',
    ];
    console.log('--- mapeamento tipo de pique -> camada DXF ASTM ---');
    for (const tipo of todos) {
      console.log(`  ${tipo.padEnd(5)} -> camada ${CAMADA_ASTM_DO_PIQUE[tipo]}`);
    }

    // Todo tipo tem camada, e nenhuma camada da norma ficou sem tipo.
    expect(Object.keys(CAMADA_ASTM_DO_PIQUE).sort()).toEqual([...todos].sort());
    expect(new Set(Object.values(CAMADA_ASTM_DO_PIQUE))).toEqual(new Set([4, 80, 81, 82, 83]));

    // As duas que a pesquisa apontou como ausentes.
    expect(CAMADA_ASTM_DO_PIQUE['CHECK']).toBe(82);
    expect(CAMADA_ASTM_DO_PIQUE['U']).toBe(83);
    // E as que ja existiam continuam no lugar.
    expect(CAMADA_ASTM_DO_PIQUE['V']).toBe(4);
    expect(CAMADA_ASTM_DO_PIQUE['T']).toBe(80);
    expect(CAMADA_ASTM_DO_PIQUE['MX']).toBe(81);
  });

  it('offset recusa peca com recorte, em vez de mandar para o corte sem o vazado', () => {
    const modelo = reconstruir(logRetanguloPadrao());
    const base = modelo.pecas[PECA_ID]!;
    const cantos: readonly Vetor2[] = [
      { x: 40 * MM, y: 90 * MM },
      { x: 60 * MM, y: 90 * MM },
      { x: 60 * MM, y: 110 * MM },
      { x: 40 * MM, y: 110 * MM },
    ];
    const pontos = { ...base.pontos };
    cantos.forEach((c, i) => {
      pontos[`rc-${i}`] = { id: `rc-${i}`, x: c.x, y: c.y, tipo: 'interno' };
    });
    const comVazado: Peca = {
      ...base,
      pontos,
      recortes: {
        'rc-casa': { id: 'rc-casa', pontos: cantos.map((_, i) => `rc-${i}`) },
      },
    };

    const codigo = codigoDoErro(() => offsetMargem(comVazado));
    console.log(`peca com recorte interno (camada 11) -> ${codigo}`);
    expect(codigo).toBe('RECORTE_AINDA_NAO_SUPORTADO');
    // Sem o recorte, a mesma peca continua funcionando.
    expect(offsetMargem(base).pontos.length).toBe(4);
  });

  it('D10: o recorte gradua pela regra dos seus proprios pontos', () => {
    // Antes da D10 a graduacao RECUSAVA peca com recorte. Agora o recorte e feito
    // de Ponto, entao anda pela mesma regra do contorno — e o offset continua
    // recusando, porque quem nao existe ainda e a GEOMETRIA do vazado, nao o dado.
    const base = logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] });
    const envelope = (i: number) => ({
      id: `evt-rc-${i}`,
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: PECA_ID,
      timestamp: '2026-09-04T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
    });
    const cantos = [
      { x: 40 * MM, y: 90 * MM },
      { x: 60 * MM, y: 90 * MM },
      { x: 60 * MM, y: 110 * MM },
    ];
    const eventos = [...base];
    cantos.forEach((c, i) => {
      eventos.push({
        ...envelope(i),
        tipo: 'CriarPonto' as const,
        payload: { pontoId: `rc-${i}`, x: c.x, y: c.y, tipo: 'interno' as const },
      });
    });
    eventos.push({
      ...envelope(9),
      tipo: 'AdicionarRecorte' as const,
      payload: { recorteId: 'rc-casa', pontoIds: ['rc-0', 'rc-1', 'rc-2'] },
    });

    const modelo = reconstruir(
      comGraduacao(
        eventos,
        [
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          { gradePointId: 'gp-rc0', pontoId: 'rc-0' },
        ],
        [...regraEmTodaAGrade('r1', 'gp-1', 6, 0), ...regraEmTodaAGrade('rr', 'gp-rc0', 2, 0)],
      ),
    );
    const g = aplicarGraduacao(modelo, PECA_ID, 'G');
    console.log('--- D10: recorte graduando ---');
    console.log(`rc-0 (regra +2 mm em x): (${umParaMM(g.pontos['rc-0']!.x)}, ${umParaMM(g.pontos['rc-0']!.y)}) mm | esperado (42, 90)`);
    console.log(`rc-1 (sem regra):        (${umParaMM(g.pontos['rc-1']!.x)}, ${umParaMM(g.pontos['rc-1']!.y)}) mm | esperado (60, 90)`);
    console.log(`o recorte continua apontando: ${JSON.stringify(g.recortes['rc-casa']!.pontos)}`);

    expect(g.pontos['rc-0']).toMatchObject({ x: 42 * MM, y: 90 * MM });
    expect(g.pontos['rc-1']).toMatchObject({ x: 60 * MM, y: 90 * MM });
    expect(g.recortes['rc-casa']!.pontos).toEqual(['rc-0', 'rc-1', 'rc-2']);
    // O offset da peca graduada continua recusando o vazado.
    expect(codigoDoErro(() => offsetMargem(g))).toBe('RECORTE_AINDA_NAO_SUPORTADO');
  });
});
