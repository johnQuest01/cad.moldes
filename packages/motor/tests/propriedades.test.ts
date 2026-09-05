/**
 * Testes de propriedade (Parte 5) com fast-check.
 *
 * "Teste de exemplo prova um caso; teste de invariante prova a classe inteira."
 * Aqui entram as invariantes do offset que ja tem implementacao:
 *   - offset sempre cresce: area(corte) > area(costura) para qualquer delta positivo;
 *   - com margem uniforme, o anel do motor bate com o do clipper;
 *   - a graduacao nunca ultrapassa: nenhum ponto anda mais que o grade point que
 *     mais andou (a interpolacao da D8b e convexa, entao nao pode extrapolar);
 *   - casamento preservado, na forma em que a afirmacao e VERDADEIRA (ver abaixo).
 *
 * Os poligonos gerados sao estrelados (vertices em angulo crescente em volta de um
 * centro), o que garante contorno simples e fechado sem precisar rejeitar amostra.
 */
import fc from 'fast-check';
import { EndType, inflatePaths, JoinType } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';

import { ErroMotor } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import { area } from '../src/geometria/anel.js';
import { normalizarWinding } from '../src/geometria/winding.js';
import { offsetMargem } from '../src/offset.js';
import type { Peca, Vetor2 } from '../src/tipos.js';
import { LIMITE_MITER, MM } from '../src/unidades.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import {
  comGraduacao,
  logFrenteEManga,
  logPoligonoLivre,
  PECA_FRENTE,
  PECA_ID,
  PECA_MANGA,
  regraEmTodaAGrade,
} from './fixtures.js';
import { validarCasamento } from '../src/conferencia.js';
import { medirAresta } from '../src/geometria/medir.js';
import type { EspecGradePoint, EspecRegra } from './fixtures.js';

const RAIO_MINIMO = 30 * MM;
const RAIO_MAXIMO = 80 * MM;
const MARGEM_MAXIMA = 10 * MM;

/**
 * Afastamento maximo aceito entre o anel do motor e o do clipper, em UM.
 *
 * O valor MEDIDO e zero: desde que os cantos concavos passaram a usar a construcao
 * do clipper, os dois aneis saem identicos coordenada por coordenada em milhares
 * de poligonos aleatorios. 1 UM (0,001 mm) e a folga minima para um desempate de
 * arredondamento que nunca apareceu — e nao esconde nada: a agulha que este teste
 * pegou media 1980 UM.
 */
const LIMITE_DE_FORMA_UM = 1;

/**
 * Largura media da fatia entre os dois aneis, em UM: `|area(A) - area(B)| / perimetro`.
 *
 * E esta a grandeza invariante de escala, e as duas obvias NAO sao:
 *  - **Hausdorff absoluto** aperta quando o canto e agudo, porque a geometria do
 *    canto amplifica o arredondamento;
 *  - **area relativa** aperta quando a margem e pequena, porque a area absoluta
 *    encolhe enquanto o erro de canto nao.
 *
 * Se os dois aneis so diferem perto dos cantos, por um deslocamento de ate `d`, a
 * diferenca de area e no maximo uma fatia de largura `d` ao longo da borda —
 * entao `|dA| / perimetro <= d`, independente do tamanho da peca e da margem.
 * Medido: fica na casa de 0,06 UM. O limite de 1 UM da uma ordem de grandeza de
 * folga e ainda pegaria qualquer divergencia de forma, que muda a area em muito
 * mais que a largura de um vertice.
 */
const LIMITE_DE_FATIA_UM = 1;

/** Poligono estrelado: angulos crescentes com separacao minima, raios sorteados. */
const poligonoArbitrario = fc
  .record({
    quantidade: fc.integer({ min: 3, max: 9 }),
    fatias: fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 9, maxLength: 9 }),
    raios: fc.array(fc.integer({ min: RAIO_MINIMO, max: RAIO_MAXIMO }), {
      minLength: 9,
      maxLength: 9,
    }),
    giro: fc.integer({ min: 0, max: 359 }),
  })
  .map(({ quantidade, fatias, raios, giro }): Vetor2[] => {
    const usadas = fatias.slice(0, quantidade);
    const total = usadas.reduce((soma, fatia) => soma + fatia, 0);
    let acumulado = 0;
    return usadas.map((fatia, i) => {
      const angulo = ((giro * Math.PI) / 180) + (2 * Math.PI * acumulado) / total;
      acumulado += fatia;
      const raio = raios[i]!;
      return { x: Math.round(raio * Math.cos(angulo)), y: Math.round(raio * Math.sin(angulo)) };
    });
  });

/** Codigo do ErroMotor que a acao estourou, ou `null` se nao estourou. */
function codigoDoErro(acao: () => unknown): string | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

function pecaDe(vertices: readonly Vetor2[], margemUM: number): Peca {
  return normalizarWinding(reconstruir(logPoligonoLivre(vertices, margemUM)).pecas[PECA_ID]!);
}

/**
 * Distancia de Hausdorff entre dois aneis fechados, em UM: o maior afastamento
 * entre os contornos, medido nos dois sentidos. Compara FORMA, sem exigir a mesma
 * quantidade de vertices nem o mesmo ponto de partida.
 */
/** Perimetro de um anel fechado, em UM. */
function perimetro(anel: readonly Vetor2[]): number {
  let total = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function hausdorff(a: readonly Vetor2[], b: readonly Vetor2[]): number {
  return Math.max(maiorAfastamento(a, b), maiorAfastamento(b, a));
}

function maiorAfastamento(de: readonly Vetor2[], para: readonly Vetor2[]): number {
  let maior = 0;
  for (const ponto of de) {
    let menor = Number.POSITIVE_INFINITY;
    for (let i = 0; i < para.length; i++) {
      menor = Math.min(menor, distanciaAoSegmento(ponto, para[i]!, para[(i + 1) % para.length]!));
    }
    maior = Math.max(maior, menor);
  }
  return maior;
}

function distanciaAoSegmento(p: Vetor2, a: Vetor2, b: Vetor2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const comprimento2 = vx * vx + vy * vy;
  if (comprimento2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / comprimento2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

describe('Propriedade — offset sempre cresce', () => {
  it('para qualquer poligono valido e margem positiva, area(corte) > area(costura)', () => {
    let amostras = 0;
    let menorCrescimento = Number.POSITIVE_INFINITY;

    fc.assert(
      fc.property(
        poligonoArbitrario,
        fc.integer({ min: 1, max: MARGEM_MAXIMA }),
        (vertices, margemUM) => {
          const peca = pecaDe(vertices, margemUM);
          const costura = peca.contorno.map((id) => {
            const ponto = peca.pontos[peca.segmentos[id]!.de]!;
            return { x: ponto.x, y: ponto.y };
          });
          const corte = offsetMargem(peca);

          const areaCostura = area(costura);
          const areaCorte = area(corte.pontos);
          amostras++;
          menorCrescimento = Math.min(menorCrescimento, areaCorte / areaCostura);
          expect(areaCorte).toBeGreaterThan(areaCostura);
        },
      ),
      { numRuns: 300 },
    );

    console.log(
      `--- PROPRIEDADE: offset sempre cresce --- ${amostras} amostras | ` +
        `menor razao area(corte)/area(costura) = ${menorCrescimento.toFixed(4)} (tem que ser > 1)`,
    );
    expect(menorCrescimento).toBeGreaterThan(1);
  });

  it('com margem uniforme, o anel do motor e o do clipper concordam sempre', () => {
    // Esta e a invariante que segura o deslocamento paralelo feito a mao. Ela pegou
    // um defeito de verdade: em canto CONCAVO profundo o ponto de miter podia cair
    // dentro da faixa de uma aresta NAO adjacente, e sobrava uma agulha de 2 mm por
    // 14 UM na linha de corte. Desde que os cantos concavos passaram a usar a
    // construcao do clipper (perpendicular, vertice, perpendicular), o afastamento
    // medido caiu de ~2 UM para ZERO: os dois aneis saem coordenada por coordenada
    // iguais.
    //
    // Poligono degenerado nao e pulado, e ASSERTADO: quando o clipper parte o
    // offset em mais de um anel — lasca fina demais para a margem, vertice em
    // reversao de 180 graus — o motor tem que RECUSAR, que e a mesma resposta dita
    // de outro jeito.
    let comparados = 0;
    let degenerados = 0;
    let maiorVista = 0;
    let piorFatia = 0;

    fc.assert(
      fc.property(
        poligonoArbitrario,
        // Faixa de margem REAL: de 1 mm a 15 mm. Margem de costura e medida em
        // milimetros; abaixo de ~0,1 mm o que domina a comparacao nao e mais a
        // geometria, e a grade de inteiros de 1 UM em que os dois arredondam.
        fc.integer({ min: 1 * MM, max: 15 * MM }),
        (vertices, margemUM) => {
          const peca = pecaDe(vertices, margemUM);
          const anelCostura = peca.contorno.map((id) => {
            const ponto = peca.pontos[peca.segmentos[id]!.de]!;
            return { x: ponto.x, y: ponto.y };
          });

          const doClipper = inflatePaths(
            [anelCostura],
            margemUM,
            JoinType.Miter,
            EndType.Polygon,
            LIMITE_MITER,
          );

          if (doClipper.length !== 1) {
            degenerados++;
            expect(codigoDoErro(() => offsetMargem(peca))).toBe('OFFSET_MULTIPLOS_ANEIS');
            return;
          }

          const doMotor = offsetMargem(peca).pontos;
          const clipperAnel = doClipper[0]!.map((p) => ({ x: p.x, y: p.y }));
          comparados++;

          const diferenca = hausdorff(doMotor, clipperAnel);
          maiorVista = Math.max(maiorVista, diferenca);
          expect(diferenca).toBeLessThanOrEqual(LIMITE_DE_FORMA_UM);

          // A forma quem prende e a fatia entre os dois aneis: dois contornos que
          // fechassem regioes diferentes dariam uma fatia larga, nao de sub-UM.
          const fatia = Math.abs(area(doMotor) - area(clipperAnel)) / perimetro(doMotor);
          piorFatia = Math.max(piorFatia, fatia);
          expect(fatia).toBeLessThan(LIMITE_DE_FATIA_UM);
        },
      ),
      { numRuns: 300 },
    );

    console.log(
      `--- PROPRIEDADE: motor x clipper, margem uniforme --- ` +
        `${comparados} comparados + ${degenerados} degenerados (recusados dos dois lados) | ` +
        `maior Hausdorff ${maiorVista.toFixed(3)} UM (limite ${LIMITE_DE_FORMA_UM}) | ` +
        `pior fatia |dA|/perimetro ${piorFatia.toFixed(4)} UM (limite ${LIMITE_DE_FATIA_UM} UM)`,
    );
    expect(comparados).toBeGreaterThan(0);
  });
});

describe('Propriedade — graduacao nao ultrapassa', () => {
  it('nenhum ponto anda mais que o grade point que mais andou', () => {
    // A D8b interpola o deslocamento entre dois grade points vizinhos com peso em
    // [0,1]. Combinacao convexa nao sai do casco dos dois vetores, entao o modulo
    // do deslocamento de qualquer ponto e <= o maior modulo entre os grade points.
    // Se algum dia isso extrapolar, a peca cresce mais do que a tabela mandou —
    // e ninguem percebe olhando so o grade point.
    let amostras = 0;
    let piorRazao = 0;

    fc.assert(
      fc.property(
        poligonoArbitrario,
        fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
        fc.array(
          fc.record({
            dxMM: fc.integer({ min: -20, max: 20 }),
            dyMM: fc.integer({ min: -20, max: 20 }),
          }),
          { minLength: 9, maxLength: 9 },
        ),
        (vertices, marcados, saltos) => {
          const gradePoints: EspecGradePoint[] = [];
          const regras: EspecRegra[] = [];
          vertices.forEach((_, i) => {
            if (!marcados[i]! && i !== 0) return;
            gradePoints.push({ gradePointId: `gp-${i}`, pontoId: `pt-${i}` });
            regras.push(...regraEmTodaAGrade(`r-${i}`, `gp-${i}`, saltos[i]!.dxMM, saltos[i]!.dyMM));
          });

          const modelo = reconstruir(
            comGraduacao(logPoligonoLivre(vertices, 0), gradePoints, regras),
          );
          const base = modelo.pecas[PECA_ID]!;
          const graduada = aplicarGraduacao(modelo, PECA_ID, 'G');

          const maiorDoGradePoint = Math.max(
            ...gradePoints.map((gp) =>
              Math.hypot(
                graduada.pontos[gp.pontoId]!.x - base.pontos[gp.pontoId]!.x,
                graduada.pontos[gp.pontoId]!.y - base.pontos[gp.pontoId]!.y,
              ),
            ),
          );
          if (maiorDoGradePoint === 0) return;

          for (const id of Object.keys(base.pontos)) {
            const andou = Math.hypot(
              graduada.pontos[id]!.x - base.pontos[id]!.x,
              graduada.pontos[id]!.y - base.pontos[id]!.y,
            );
            amostras++;
            // 1 UM de folga: o arredondamento da coordenada para inteiro.
            expect(andou).toBeLessThanOrEqual(maiorDoGradePoint + 1);
            piorRazao = Math.max(piorRazao, andou / maiorDoGradePoint);
          }
        },
      ),
      { numRuns: 200 },
    );

    console.log(
      `--- PROPRIEDADE: graduacao nao ultrapassa --- ${amostras} pontos conferidos | ` +
        `pior razao andou/maior_grade_point = ${piorRazao.toFixed(4)} (tem que ser <= 1)`,
    );
    expect(amostras).toBeGreaterThan(0);
  });
});

describe('Propriedade — casamento preservado', () => {
  it('arestas pareadas que recebem os MESMOS saltos continuam iguais em toda a grade', () => {
    // A Parte 5 escreve a invariante como "para qualquer regra de graduacao, arestas
    // pareadas continuam com o mesmo comprimento em todos os tamanhos". Do jeito que
    // esta escrito a afirmacao e FALSA, e de proposito: uma regra que abre a cava da
    // frente e nao a da manga quebra o casamento — e justamente o defeito que
    // `validarCasamento` existe para pegar (esta nos testes de exemplo).
    //
    // A invariante que o motor tem que garantir e esta: quando os dois extremos das
    // duas arestas pareadas recebem o MESMO salto, as curvas graduadas sao
    // congruentes e os comprimentos continuam iguais — em qualquer raio e qualquer
    // salto. Se a propagacao da D8b nao fosse afim, isso quebraria.
    let amostras = 0;
    let piorDiferenca = 0;

    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 200 }),
        fc.record({
          dxMM: fc.integer({ min: -10, max: 10 }),
          dyMM: fc.integer({ min: -10, max: 10 }),
        }),
        fc.record({
          dxMM: fc.integer({ min: -10, max: 10 }),
          dyMM: fc.integer({ min: -10, max: 10 }),
        }),
        (raioMM, inicio, fim) => {
          const saltos = [inicio, fim] as const;
          const modelo = reconstruir(logFrenteEManga({ raioMM, frente: saltos, manga: saltos }));

          for (const tamanho of modelo.tamanhos) {
            const frente = medirAresta(
              aplicarGraduacao(modelo, PECA_FRENTE, tamanho),
              'ar-cava-frente',
            );
            const manga = medirAresta(
              aplicarGraduacao(modelo, PECA_MANGA, tamanho),
              'ar-cava-manga',
            );
            amostras++;
            piorDiferenca = Math.max(piorDiferenca, Math.abs(frente - manga));
            expect(frente).toBe(manga);
          }

          expect(validarCasamento(modelo)).toEqual([]);
        },
      ),
      { numRuns: 150 },
    );

    console.log(
      `--- PROPRIEDADE: casamento preservado --- ${amostras} medicoes | ` +
        `maior diferenca entre as arestas pareadas: ${piorDiferenca} UM`,
    );
    expect(piorDiferenca).toBe(0);
  });
});
