/**
 * Teste 4 (Parte 5) e as duas decisoes do Bloco 5:
 *   D7  — nao ha ancora global: grade point sem regra fica parado;
 *   D8b — quem nao e grade point acompanha proporcionalmente.
 *
 * Todos os numeros conferidos sao calculaveis a mao; estao escritos no comentario
 * de cada teste para poderem ser refeitos sem rodar nada.
 */
import { describe, expect, it } from 'vitest';
// Entry-point padrao do verb toca `window`; o build ES roda headless no Node.
import verb from 'verb-nurbs/build/js/verb.es.js';

import { ErroMotor } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import type { CodigoErro } from '../src/erros.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import { medirAresta, pontoEmS } from '../src/geometria/medir.js';
import { areaDoContorno } from '../src/geometria/winding.js';
import type { Modelo, Peca, Vetor2 } from '../src/tipos.js';
import { MM, TOLERANCIA_MEDICAO_UM, umParaMM } from '../src/unidades.js';
import {
  AGORA,
  AUTOR,
  comGraduacao,
  logQuartoDeCirculo,
  logRetangulo,
  MODELO_ID,
  PECA_ID,
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

function coordenada(peca: Peca, pontoId: string): Vetor2 {
  const ponto = peca.pontos[pontoId]!;
  return { x: ponto.x, y: ponto.y };
}

function emMM(p: Vetor2): string {
  return `(${umParaMM(p.x)}, ${umParaMM(p.y)})`;
}

/**
 * Retangulo 100 x 200 mm, grade P-M-G com base M.
 *   pt-0 (0,0)     grade point SEM regra  -> ancora, fica parado (D7)
 *   pt-1 (100,0)   +6 mm em x por tamanho
 *   pt-2 (100,200) +6 mm em x, +4 mm em y
 *   pt-3 (0,200)             0, +4 mm em y
 */
function modeloRetanguloGraduado(): Modelo {
  return reconstruir(
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
}

describe('Teste 4 — graduar por regra conhecida', () => {
  it('da as coordenadas exatas em cada tamanho, e o grade point sem regra fica parado (D7)', () => {
    const modelo = modeloRetanguloGraduado();
    const esperado: Record<string, readonly Vetor2[]> = {
      // base M: a peca desenhada.
      M: [
        { x: 0, y: 0 },
        { x: 100 * MM, y: 0 },
        { x: 100 * MM, y: 200 * MM },
        { x: 0, y: 200 * MM },
      ],
      // G = M + um passo.
      G: [
        { x: 0, y: 0 },
        { x: 106 * MM, y: 0 },
        { x: 106 * MM, y: 204 * MM },
        { x: 0, y: 204 * MM },
      ],
      // P = M - um passo.
      P: [
        { x: 0, y: 0 },
        { x: 94 * MM, y: 0 },
        { x: 94 * MM, y: 196 * MM },
        { x: 0, y: 196 * MM },
      ],
    };

    console.log('--- TESTE 4 (grade P-M-G, base M) ---');
    for (const tamanho of ['P', 'M', 'G']) {
      const peca = aplicarGraduacao(modelo, PECA_ID, tamanho);
      const cantos = ['pt-0', 'pt-1', 'pt-2', 'pt-3'].map((id) => coordenada(peca, id));
      console.log(
        `${tamanho}: ${cantos.map(emMM).join(' ')} | base ar-baixo ${umParaMM(medirAresta(peca, 'ar-baixo'))} mm ` +
          `| ar-direita ${umParaMM(medirAresta(peca, 'ar-direita'))} mm`,
      );
      expect(cantos).toEqual(esperado[tamanho]);
    }

    // pt-0 e grade point mas nao tem regra: e a ancora, e nao anda em nenhum tamanho.
    for (const tamanho of ['P', 'M', 'G']) {
      expect(coordenada(aplicarGraduacao(modelo, PECA_ID, tamanho), 'pt-0')).toEqual({ x: 0, y: 0 });
    }
  });

  it('graduar para o tamanho base devolve a peca identica', () => {
    const modelo = modeloRetanguloGraduado();
    const base = modelo.pecas[PECA_ID]!;
    const graduada = aplicarGraduacao(modelo, PECA_ID, 'M');
    console.log(`graduar para o base (M): area ${areaDoContorno(graduada)} UM2 (original ${areaDoContorno(base)})`);
    expect(graduada).toEqual(base);
  });

  it('a medida da aresta acompanha: ar-baixo vale 94, 100 e 106 mm', () => {
    const modelo = modeloRetanguloGraduado();
    const medidas = ['P', 'M', 'G'].map((t) =>
      umParaMM(medirAresta(aplicarGraduacao(modelo, PECA_ID, t), 'ar-baixo')),
    );
    console.log(`ar-baixo em P, M, G: ${medidas.join(' mm, ')} mm`);
    expect(medidas).toEqual([94, 100, 106]);
  });
});

describe('D8b — o que nao e grade point acompanha proporcionalmente', () => {
  it('vertice livre interpola por comprimento de arco entre os dois grade points', () => {
    // Retangulo 100 x 200. Grade points so em pt-0 (0,0), sem regra, e em
    // pt-2 (100,200), com +30 mm em x. Perimetro 600 mm.
    //   pt-1: 100 mm depois de pt-0, e pt-2 esta a 300 mm  -> peso 1/3 -> +10 mm
    //   pt-3: 100 mm depois de pt-2, e pt-0 esta a 300 mm  -> peso 1/3 -> 30 - 10 = +20 mm
    const modelo = reconstruir(
      comGraduacao(
        logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] }),
        [
          { gradePointId: 'gp-0', pontoId: 'pt-0' },
          { gradePointId: 'gp-2', pontoId: 'pt-2' },
        ],
        regraEmTodaAGrade('r', 'gp-2', 30, 0),
      ),
    );
    const g = aplicarGraduacao(modelo, PECA_ID, 'G');
    const cantos = ['pt-0', 'pt-1', 'pt-2', 'pt-3'].map((id) => coordenada(g, id));

    console.log('--- D8b (vertice livre) --- grade points: pt-0 (parado) e pt-2 (+30 mm em x)');
    console.log(`G: ${cantos.map(emMM).join(' ')}`);
    console.log('   esperado: (0, 0) (110, 0) (130, 200) (20, 200)');

    expect(cantos).toEqual([
      { x: 0, y: 0 },
      { x: 110 * MM, y: 0 },
      { x: 130 * MM, y: 200 * MM },
      { x: 20 * MM, y: 200 * MM },
    ]);
  });

  it('os dois controles da Bezier andam 1/3 e 2/3 entre os deslocamentos dos extremos', () => {
    // Fatia de quarto de circulo R = 100 mm. So pt-0 tem regra (+30 mm em x);
    // pt-1 e pt-2 sao grade points sem regra (ancoras).
    //   controle[0] = 30 + (0 - 30)*1/3 = +20 mm
    //   controle[1] = 30 + (0 - 30)*2/3 = +10 mm
    const R = 100 * MM;
    const modelo = reconstruir(
      comGraduacao(
        logQuartoDeCirculo(R),
        [
          { gradePointId: 'gp-0', pontoId: 'pt-0' },
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          { gradePointId: 'gp-2', pontoId: 'pt-2' },
        ],
        regraEmTodaAGrade('r', 'gp-0', 30, 0),
      ),
    );
    const base = modelo.pecas[PECA_ID]!;
    const g = aplicarGraduacao(modelo, PECA_ID, 'G');

    const antes = base.segmentos['sg-0']!.controles!;
    const depois = g.segmentos['sg-0']!.controles!;
    const passo0 = { x: depois[0].x - antes[0].x, y: depois[0].y - antes[0].y };
    const passo1 = { x: depois[1].x - antes[1].x, y: depois[1].y - antes[1].y };

    console.log('--- D8b (controles da Bezier) --- pt-0 anda +30 mm em x, pt-1 fica parado');
    console.log(`controle[0] andou ${emMM(passo0)} mm  (esperado (20, 0))`);
    console.log(`controle[1] andou ${emMM(passo1)} mm  (esperado (10, 0))`);
    console.log(
      `ponto pt-0 andou ${emMM({ x: g.pontos['pt-0']!.x - base.pontos['pt-0']!.x, y: 0 })} mm ` +
        `| pt-1 andou ${emMM({ x: g.pontos['pt-1']!.x - base.pontos['pt-1']!.x, y: g.pontos['pt-1']!.y - base.pontos['pt-1']!.y })} mm`,
    );

    expect(passo0).toEqual({ x: 20 * MM, y: 0 });
    expect(passo1).toEqual({ x: 10 * MM, y: 0 });
  });

  it('o ponto ancorado por s continua dividindo o arco em duas metades iguais', () => {
    // Teste 14, metade da graduacao: o pique nao guarda coordenada, guarda `s`.
    // Depois de graduar, `s = 0,5` tem que continuar sendo o meio do arco.
    const R = 100 * MM;
    const modelo = reconstruir(
      comGraduacao(
        logQuartoDeCirculo(R),
        [
          { gradePointId: 'gp-0', pontoId: 'pt-0' },
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          { gradePointId: 'gp-2', pontoId: 'pt-2' },
        ],
        regraEmTodaAGrade('r', 'gp-0', 30, 0),
      ),
    );

    console.log('--- pique por s sob graduacao ---');
    for (const tamanho of ['M', 'G']) {
      const peca = aplicarGraduacao(modelo, PECA_ID, tamanho);
      const meio = pontoEmS(peca, 'ar-arco', 0.5);

      // Oraculo independente: o comprimento de arco do verb sobre a Bezier JA
      // GRADUADA. Nao usa nada da tabela do motor, entao mede de verdade se o
      // ponto devolvido parte a curva ao meio.
      const segmento = peca.segmentos['sg-0']!;
      const curva = new verb.geom.BezierCurve(
        [
          peca.pontos[segmento.de]!,
          segmento.controles![0],
          segmento.controles![1],
          peca.pontos[segmento.para]!,
        ].map((ponto) => [ponto.x, ponto.y, 0]),
      ).asNurbs();

      const total = verb.eval.Analyze.rationalCurveArcLength(curva);
      const t = verb.eval.Analyze.rationalCurveClosestParam(curva, [meio.x, meio.y, 0]);
      const primeira = verb.eval.Analyze.rationalCurveArcLength(curva, t);
      const segunda = total - primeira;

      console.log(
        `${tamanho}: arco ${total.toFixed(1)} UM (verb) | ponto em s=0,5 ${emMM(meio)} mm | ` +
          `metades ${primeira.toFixed(1)} e ${segunda.toFixed(1)} UM | diferenca ${Math.abs(primeira - segunda).toFixed(1)} UM`,
      );
      expect(Math.abs(primeira - segunda)).toBeLessThanOrEqual(2 * TOLERANCIA_MEDICAO_UM);
    }

    const emM = pontoEmS(aplicarGraduacao(modelo, PECA_ID, 'M'), 'ar-arco', 0.5);
    const emG = pontoEmS(aplicarGraduacao(modelo, PECA_ID, 'G'), 'ar-arco', 0.5);
    // A curva cresceu, entao o meio dela nao pode ter ficado na mesma coordenada.
    expect(emG).not.toEqual(emM);
  });
});

describe('Graduacao — o motor recusa em vez de graduar errado', () => {
  it('recusa tamanho que nao esta na grade', () => {
    const modelo = modeloRetanguloGraduado();
    const codigo = codigoDoErro(() => aplicarGraduacao(modelo, PECA_ID, 'XG'));
    console.log(`tamanho fora da grade         -> ${codigo}`);
    expect(codigo).toBe('TAMANHO_DESCONHECIDO');
  });

  it('recusa regra entre tamanhos nao consecutivos (o acumulado e do motor)', () => {
    const codigo = codigoDoErro(() =>
      reconstruir(
        comGraduacao(
          logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] }),
          [{ gradePointId: 'gp-1', pontoId: 'pt-1' }],
          [
            {
              regraId: 'r-salto',
              pontoGraduacaoId: 'gp-1',
              deTamanho: 'P',
              paraTamanho: 'G',
              dxMM: 12,
              dyMM: 0,
            },
          ],
        ),
      ),
    );
    console.log(`regra P -> G (pula o M)       -> ${codigo}`);
    expect(codigo).toBe('REGRA_GRADUACAO_NAO_CONSECUTIVA');
  });

  it('recusa duas regras para o mesmo grade point no mesmo passo', () => {
    const codigo = codigoDoErro(() =>
      reconstruir(
        comGraduacao(
          logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] }),
          [{ gradePointId: 'gp-1', pontoId: 'pt-1' }],
          [
            { regraId: 'r-a', pontoGraduacaoId: 'gp-1', deTamanho: 'M', paraTamanho: 'G', dxMM: 6, dyMM: 0 },
            { regraId: 'r-b', pontoGraduacaoId: 'gp-1', deTamanho: 'M', paraTamanho: 'G', dxMM: 9, dyMM: 0 },
          ],
        ),
      ),
    );
    console.log(`duas regras no mesmo passo    -> ${codigo}`);
    expect(codigo).toBe('REGRA_GRADUACAO_DUPLICADA');
  });

  it('recusa dois grade points no mesmo ponto', () => {
    const codigo = codigoDoErro(() =>
      reconstruir(
        comGraduacao(
          logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] }),
          [
            { gradePointId: 'gp-a', pontoId: 'pt-1' },
            { gradePointId: 'gp-b', pontoId: 'pt-1' },
          ],
          [],
        ),
      ),
    );
    console.log(`dois grade points no ponto    -> ${codigo}`);
    expect(codigo).toBe('GRADE_POINT_DUPLICADO');
  });

  it('recusa regra para grade point que nao existe', () => {
    const codigo = codigoDoErro(() =>
      reconstruir(
        comGraduacao(
          logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] }),
          [],
          regraEmTodaAGrade('r', 'gp-fantasma', 6, 0),
        ),
      ),
    );
    console.log(`regra sem grade point         -> ${codigo}`);
    expect(codigo).toBe('GRADE_POINT_INEXISTENTE');
  });

  it('o fio gradua pela MESMA regra do contorno quando e grade point (D10)', () => {
    // O fio e feito de Ponto (D10), entao pode ser marcado como grade point e anda
    // pela sua propria regra. Antes da D10 o motor RECUSAVA graduar peca com fio.
    const base = logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] });
    const comFio = [...base];
    const envelope = (i: number, pecaId: string | null) => ({
      id: `evt-fio-${i}`,
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId,
      timestamp: AGORA,
      autor: AUTOR,
      versaoSchema: 1,
    });
    comFio.push({
      ...envelope(0, PECA_ID),
      tipo: 'CriarPonto',
      payload: { pontoId: 'fio-a', x: 50 * MM, y: 20 * MM, tipo: 'interno' },
    });
    comFio.push({
      ...envelope(1, PECA_ID),
      tipo: 'CriarPonto',
      payload: { pontoId: 'fio-b', x: 50 * MM, y: 180 * MM, tipo: 'interno' },
    });
    comFio.push({
      ...envelope(2, PECA_ID),
      tipo: 'AdicionarLinhaInterna',
      payload: { linhaId: 'li-fio', tipo: 'fio', pontoIds: ['fio-a', 'fio-b'] },
    });

    const modelo = reconstruir(
      comGraduacao(
        comFio,
        [
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          // A ponta de cima do fio gradua junto com o topo da peca.
          { gradePointId: 'gp-fio-b', pontoId: 'fio-b' },
          // A de baixo NAO tem regra: e ancora (D7), fica parada.
          { gradePointId: 'gp-fio-a', pontoId: 'fio-a' },
        ],
        [...regraEmTodaAGrade('r1', 'gp-1', 6, 0), ...regraEmTodaAGrade('rf', 'gp-fio-b', 0, 4)],
      ),
    );

    const g = aplicarGraduacao(modelo, PECA_ID, 'G');
    console.log('--- D10: fio graduando ---');
    console.log(`fio-a (sem regra, ancora): ${emMM(coordenada(g, 'fio-a'))} mm  | esperado (50, 20)`);
    console.log(`fio-b (regra +4 mm em y):  ${emMM(coordenada(g, 'fio-b'))} mm  | esperado (50, 184)`);
    console.log(`a linha interna continua apontando: ${JSON.stringify(g.linhasInternas['li-fio']!.pontos)}`);

    expect(coordenada(g, 'fio-a')).toEqual({ x: 50 * MM, y: 20 * MM });
    expect(coordenada(g, 'fio-b')).toEqual({ x: 50 * MM, y: 184 * MM });
    expect(g.linhasInternas['li-fio']!.pontos).toEqual(['fio-a', 'fio-b']);
  });

  it('ponto interno sem grade point fica parado — e o que a D7 manda', () => {
    // Nao e defeito silencioso: e a semantica declarada. Quem alerta sobre fio
    // esquecido numa peca que cresce e o validador (operacao 8).
    const base = logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] });
    const envelope = (i: number) => ({
      id: `evt-furo-${i}`,
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: PECA_ID,
      timestamp: AGORA,
      autor: AUTOR,
      versaoSchema: 1,
    });
    const comFuro = [
      ...base,
      {
        ...envelope(0),
        tipo: 'CriarPonto' as const,
        payload: { pontoId: 'furo-1', x: 30 * MM, y: 30 * MM, tipo: 'interno' as const },
      },
      {
        ...envelope(1),
        tipo: 'CriarPonto' as const,
        payload: { pontoId: 'furo-2', x: 30 * MM, y: 40 * MM, tipo: 'interno' as const },
      },
      {
        ...envelope(2),
        tipo: 'AdicionarLinhaInterna' as const,
        payload: { linhaId: 'li-furo', tipo: 'furo' as const, pontoIds: ['furo-1', 'furo-2'] },
      },
    ];
    const modelo = reconstruir(
      comGraduacao(
        comFuro,
        [{ gradePointId: 'gp-1', pontoId: 'pt-1' }],
        regraEmTodaAGrade('r1', 'gp-1', 6, 0),
      ),
    );
    const g = aplicarGraduacao(modelo, PECA_ID, 'G');
    console.log(
      `furo sem regra em G: ${emMM(coordenada(g, 'furo-1'))} mm (parado) | ` +
        `pt-1 andou para ${emMM(coordenada(g, 'pt-1'))} mm`,
    );
    expect(coordenada(g, 'furo-1')).toEqual({ x: 30 * MM, y: 30 * MM });
    expect(coordenada(g, 'pt-1')).toEqual({ x: 106 * MM, y: 0 });
  });

  it('peca sem nenhum grade point nao se move (e nao estoura)', () => {
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 10] }),
    );
    const g = aplicarGraduacao(modelo, PECA_ID, 'G');
    console.log(`peca sem grade point em G     -> area ${areaDoContorno(g)} UM2 (inalterada)`);
    expect(g).toEqual(modelo.pecas[PECA_ID]!);
  });
});
