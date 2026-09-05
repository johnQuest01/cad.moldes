/**
 * Teste 1 e teste 18 (Parte 5).
 *
 * Regra de teste inegociavel: todo teste e EXECUTADO e a saida numerica e colada
 * na resposta. Por isso estes testes imprimem os numeros que conferem.
 */
import { describe, expect, it } from 'vitest';

import { EndType, inflatePaths, JoinType } from 'clipper2-ts';

import { reconstruir } from '../src/eventos/fold.js';
import { area, areaComSinal, ehCCW } from '../src/geometria/anel.js';
import { normalizarWinding } from '../src/geometria/winding.js';
import { offsetMargem } from '../src/offset.js';
import type { Peca, Vetor2 } from '../src/tipos.js';
import { LIMITE_MITER, MM, umParaMM } from '../src/unidades.js';
import {
  anelCanonico,
  logPoligonoLivre,
  logRetangulo,
  logRetanguloPadrao,
  PECA_ID,
} from './fixtures.js';

function pecaDoLog(sentidoHorario = false): Peca {
  const modelo = reconstruir(logRetanguloPadrao(sentidoHorario));
  return modelo.pecas[PECA_ID]!;
}

function caixa(pontos: readonly Vetor2[]) {
  const xs = pontos.map((p) => p.x);
  const ys = pontos.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, largura: maxX - minX, altura: maxY - minY };
}

/** Produto escalar das arestas que chegam e saem de cada vertice. Zero = angulo reto. */
function produtosEscalaresNosVertices(pontos: readonly Vetor2[]): number[] {
  const n = pontos.length;
  return pontos.map((_, i) => {
    const anterior = pontos[(i - 1 + n) % n]!;
    const atual = pontos[i]!;
    const proximo = pontos[(i + 1) % n]!;
    const entrada = { x: atual.x - anterior.x, y: atual.y - anterior.y };
    const saida = { x: proximo.x - atual.x, y: proximo.y - atual.y };
    const produto = entrada.x * saida.x + entrada.y * saida.y;
    // -0 e +0 sao o mesmo numero; o sinal do zero e artefato do IEEE 754, nao
    // geometria. Normalizar aqui evita que o teste falhe por Object.is(-0, 0).
    return produto === 0 ? 0 : produto;
  });
}

describe('Teste 1 — retangulo 100x200 mm com margem uniforme de 10 mm', () => {
  it('produz linha de corte de 120x220 mm exatos, com cantos em angulo reto', () => {
    const peca = pecaDoLog();
    const costura = { pontos: peca.contorno.map((id) => pontoDe(peca, id)) };
    const corte = offsetMargem(peca);

    const caixaCostura = caixa(costura.pontos);
    const caixaCorte = caixa(corte.pontos);
    const produtos = produtosEscalaresNosVertices(corte.pontos);

    console.log('--- TESTE 1 ---');
    console.log(
      'costura  :',
      costura.pontos.map((p) => `(${p.x},${p.y})`).join(' '),
    );
    console.log(
      'corte    :',
      corte.pontos.map((p) => `(${p.x},${p.y})`).join(' '),
    );
    console.log(
      `dimensao costura: ${umParaMM(caixaCostura.largura)} x ${umParaMM(caixaCostura.altura)} mm`,
    );
    console.log(
      `dimensao corte  : ${umParaMM(caixaCorte.largura)} x ${umParaMM(caixaCorte.altura)} mm  (esperado 120 x 220)`,
    );
    console.log(`area costura    : ${area(costura.pontos)} UM2`);
    console.log(`area corte      : ${area(corte.pontos)} UM2  (esperado 26400000000)`);
    console.log(`vertices do corte: ${corte.pontos.length} (esperado 4 — Miter, nao Round)`);
    console.log(`produtos escalares nos cantos: [${produtos.join(', ')}] (esperado todos 0)`);

    // Dimensao exata, em UM inteiro.
    expect(caixaCorte.largura).toBe(120 * MM);
    expect(caixaCorte.altura).toBe(220 * MM);
    expect(caixaCorte.minX).toBe(-10 * MM);
    expect(caixaCorte.minY).toBe(-10 * MM);
    expect(caixaCorte.maxX).toBe(110 * MM);
    expect(caixaCorte.maxY).toBe(210 * MM);

    // Area exata: 120 mm x 220 mm = 26.400.000.000 UM2.
    expect(area(corte.pontos)).toBe(26_400_000_000);

    // 4 vertices e nao mais: Round teria gerado um arco em cada canto.
    expect(corte.pontos.length).toBe(4);

    // Cantos retos: produto escalar zero em todos os vertices.
    for (const produto of produtos) expect(produto).toBe(0);

    // D4: a linha de corte tem que ser maior que a de costura.
    expect(area(corte.pontos)).toBeGreaterThan(area(costura.pontos));

    // O corte sai em CCW, como a costura.
    expect(ehCCW(corte.pontos)).toBe(true);
  });
});

describe('Teste 2 — margem diferente por aresta (D3)', () => {
  it('bainha de 40 mm e laterais de 10 mm dao corte de 120 x 250 mm exatos', () => {
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [40, 10, 10, 10] }),
    );
    const corte = offsetMargem(modelo.pecas[PECA_ID]!);
    const caixaCorte = caixa(corte.pontos);
    const produtos = produtosEscalaresNosVertices(corte.pontos);

    console.log('--- TESTE 2 (margem por aresta: bainha 40 mm, lados e topo 10 mm) ---');
    console.log(
      'corte    :',
      corte.pontos.map((p) => `(${p.x},${p.y})`).join(' '),
    );
    console.log(
      `caixa do corte: x de ${umParaMM(caixaCorte.minX)} a ${umParaMM(caixaCorte.maxX)} mm | ` +
        `y de ${umParaMM(caixaCorte.minY)} a ${umParaMM(caixaCorte.maxY)} mm`,
    );
    console.log(
      `dimensao corte: ${umParaMM(caixaCorte.largura)} x ${umParaMM(caixaCorte.altura)} mm  (esperado 120 x 250)`,
    );
    console.log(`area corte    : ${area(corte.pontos)} UM2  (esperado 30000000000)`);
    console.log(`vertices      : ${corte.pontos.length} (esperado 4) | produtos escalares: [${produtos.join(', ')}]`);

    // A bainha desce 40 mm; os outros tres lados crescem 10 mm.
    expect(caixaCorte.minY).toBe(-40 * MM);
    expect(caixaCorte.maxY).toBe(210 * MM);
    expect(caixaCorte.minX).toBe(-10 * MM);
    expect(caixaCorte.maxX).toBe(110 * MM);
    expect(caixaCorte.largura).toBe(120 * MM);
    expect(caixaCorte.altura).toBe(250 * MM);
    expect(area(corte.pontos)).toBe(120 * MM * (250 * MM));

    // Os cantos onde 40 mm encontra 10 mm continuam retos: (110, -40) e (-10, -40).
    expect(corte.pontos.length).toBe(4);
    expect(produtos.every((valor) => valor === 0)).toBe(true);
    expect(corte.pontos).toContainEqual({ x: 110 * MM, y: -40 * MM });
    expect(corte.pontos).toContainEqual({ x: -10 * MM, y: -40 * MM });
  });

  it('margem zero numa aresta so: aquele trecho fica na propria linha de costura', () => {
    // Aresta esquerda na dobra do tecido (margem 0); as outras com 10 mm.
    const modelo = reconstruir(
      logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [10, 10, 10, 0] }),
    );
    const corte = offsetMargem(modelo.pecas[PECA_ID]!);
    const caixaCorte = caixa(corte.pontos);
    console.log(
      `--- margem 0 na dobra --- corte x de ${umParaMM(caixaCorte.minX)} a ${umParaMM(caixaCorte.maxX)} mm | ` +
        `y de ${umParaMM(caixaCorte.minY)} a ${umParaMM(caixaCorte.maxY)} mm`,
    );
    expect(caixaCorte.minX).toBe(0);
    expect(caixaCorte.maxX).toBe(110 * MM);
    expect(caixaCorte.minY).toBe(-10 * MM);
    expect(caixaCorte.maxY).toBe(210 * MM);
  });

  it('para margem uniforme, o offset por aresta e o inflatePaths do clipper concordam', () => {
    // Se o deslocamento paralelo feito no motor divergisse do offset da biblioteca,
    // apareceria aqui. Poligonos convexos e concavos, margens variadas.
    const casos: readonly { readonly nome: string; readonly vertices: readonly Vetor2[] }[] = [
      {
        nome: 'retangulo',
        vertices: [
          { x: 0, y: 0 },
          { x: 100 * MM, y: 0 },
          { x: 100 * MM, y: 200 * MM },
          { x: 0, y: 200 * MM },
        ],
      },
      {
        nome: 'triangulo',
        vertices: [
          { x: 0, y: 0 },
          { x: 120 * MM, y: 0 },
          { x: 40 * MM, y: 90 * MM },
        ],
      },
      {
        nome: 'L concavo',
        vertices: [
          { x: 0, y: 0 },
          { x: 120 * MM, y: 0 },
          { x: 120 * MM, y: 40 * MM },
          { x: 40 * MM, y: 40 * MM },
          { x: 40 * MM, y: 150 * MM },
          { x: 0, y: 150 * MM },
        ],
      },
    ];

    console.log('--- CONSISTENCIA: motor x inflatePaths (margem uniforme) ---');
    for (const caso of casos) {
      for (const margemMM of [5, 10, 25]) {
        const margemUM = margemMM * MM;
        const modelo = reconstruir(logPoligonoLivre(caso.vertices, margemUM));
        const doMotor = offsetMargem(modelo.pecas[PECA_ID]!).pontos;
        const doClipper = inflatePaths(
          [caso.vertices.map((v) => ({ x: v.x, y: v.y }))],
          margemUM,
          JoinType.Miter,
          EndType.Polygon,
          LIMITE_MITER,
        );
        const clipperAnel = doClipper[0]!.map((p) => ({ x: p.x, y: p.y }));
        console.log(
          `${caso.nome.padEnd(11)} margem ${String(margemMM).padStart(2)} mm -> ` +
            `motor ${doMotor.length} vertices / area ${area(doMotor)} | ` +
            `clipper ${clipperAnel.length} vertices / area ${area(clipperAnel)}`,
        );
        expect(doClipper.length).toBe(1);
        expect(anelCanonico(doMotor)).toBe(anelCanonico(clipperAnel));
      }
    }
  });
});

describe('Teste 18 — normalizacao de winding (D4)', () => {
  it('mesmo contorno em CW e em CCW produz geometria de corte identica', () => {
    const pecaCCW = pecaDoLog(false);
    const pecaCW = pecaDoLog(true);

    const anelCCW = pecaCCW.contorno.map((id) => pontoDe(pecaCCW, id));
    const anelCW = pecaCW.contorno.map((id) => pontoDe(pecaCW, id));

    console.log('--- TESTE 18 ---');
    console.log(`area com sinal antes, entrada CCW: ${areaComSinal(anelCCW)} UM2 (positiva)`);
    console.log(`area com sinal antes, entrada CW : ${areaComSinal(anelCW)} UM2 (negativa)`);

    expect(areaComSinal(anelCCW)).toBeGreaterThan(0);
    expect(areaComSinal(anelCW)).toBeLessThan(0);

    const corteDeCCW = offsetMargem(normalizarWinding(pecaCCW));
    const corteDeCW = offsetMargem(normalizarWinding(pecaCW));

    console.log(`corte a partir de CCW: ${anelCanonico(corteDeCCW.pontos)}`);
    console.log(`corte a partir de CW : ${anelCanonico(corteDeCW.pontos)}`);
    console.log(`area CCW: ${area(corteDeCCW.pontos)} | area CW: ${area(corteDeCW.pontos)}`);

    expect(anelCanonico(corteDeCW.pontos)).toBe(anelCanonico(corteDeCCW.pontos));
    expect(area(corteDeCW.pontos)).toBe(area(corteDeCCW.pontos));
    expect(area(corteDeCW.pontos)).toBe(26_400_000_000);
  });

  it('normalizarWinding e idempotente e preserva os IDs das arestas (D3)', () => {
    const pecaCW = pecaDoLog(true);
    const uma = normalizarWinding(pecaCW);
    const duas = normalizarWinding(uma);

    const idsAntes = Object.keys(pecaCW.arestas).sort();
    const idsDepois = Object.keys(uma.arestas).sort();

    console.log('--- TESTE 18b (idempotencia + IDs estaveis) ---');
    console.log(`arestas antes : ${idsAntes.join(', ')}`);
    console.log(`arestas depois: ${idsDepois.join(', ')}`);

    expect(idsDepois).toEqual(idsAntes);
    expect(duas.contorno).toEqual(uma.contorno);
    expect(ehCCW(uma.contorno.map((id) => pontoDe(uma, id)))).toBe(true);

    // As margens continuam coladas nas mesmas arestas.
    expect(uma.margens).toEqual(pecaCW.margens);
  });
});

function pontoDe(peca: Peca, segmentoId: string): Vetor2 {
  const segmento = peca.segmentos[segmentoId]!;
  const ponto = peca.pontos[segmento.de]!;
  return { x: ponto.x, y: ponto.y };
}
