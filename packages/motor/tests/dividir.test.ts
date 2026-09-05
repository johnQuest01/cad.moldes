/**
 * Teste 12 (Parte 5) — dividir peca.
 *
 * "Retangulo 100 x 200 mm cortado ao meio com margem nova de 10 mm nas arestas do
 * corte -> as duas partes medem 100 x 110 mm cada (NAO 100 x 100), somando MAIS
 * area que a original; piques de casamento nas posicoes correspondentes; apos
 * graduar, a linha de divisao acompanha a grade proporcionalmente."
 *
 * O "100 x 110" e a LINHA DE CORTE de cada parte quando so a aresta nova tem
 * margem: 100 de largura e 100 de costura + 10 de margem nova na borda cortada.
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor } from '../src/erros.js';
import type { CodigoErro } from '../src/erros.js';
import { reconstruir } from '../src/eventos/fold.js';
import { dividirPeca } from '../src/dividir.js';
import { aplicarGraduacao } from '../src/graduacao.js';
import { area } from '../src/geometria/anel.js';
import { anelDoContorno } from '../src/geometria/anel.js';
import { medirAresta } from '../src/geometria/medir.js';
import { offsetMargem } from '../src/offset.js';
import { validarInconsistencias } from '../src/validar.js';
import type { Modelo, Peca, Vetor2 } from '../src/tipos.js';
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

function caixa(pontos: readonly Vetor2[]) {
  const xs = pontos.map((p) => p.x);
  const ys = pontos.map((p) => p.y);
  return {
    largura: Math.max(...xs) - Math.min(...xs),
    altura: Math.max(...ys) - Math.min(...ys),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Retangulo 100 x 200 com margem ZERO: assim o 100 x 110 sai limpo. */
function retanguloSemMargem(): Peca {
  return reconstruir(logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] }))
    .pecas[PECA_ID]!;
}

/** Eixo horizontal na altura y, atravessando a peca de lado a lado. */
const eixoHorizontal = (y: number) => ({
  p1: { x: -500 * MM, y },
  p2: { x: 500 * MM, y },
});

describe('Teste 12 — dividir peca ao meio com margem nova', () => {
  it('as duas partes tem corte 100 x 110 mm, e somadas consomem MAIS que a original', () => {
    const original = retanguloSemMargem();
    const [parteA, parteB] = dividirPeca(original, eixoHorizontal(100 * MM), 10 * MM, 'div');

    const costuraA = anelDoContorno(parteA);
    const costuraB = anelDoContorno(parteB);
    const corteA = offsetMargem(parteA).pontos;
    const corteB = offsetMargem(parteB).pontos;

    console.log('--- TESTE 12 (dividir ao meio, margem nova de 10 mm) ---');
    console.log(
      `original : costura ${umParaMM(caixa(anelDoContorno(original)).largura)} x ` +
        `${umParaMM(caixa(anelDoContorno(original)).altura)} mm | area ${area(anelDoContorno(original))} UM2`,
    );
    for (const [nome, costura, corte] of [
      [parteA.metadados.nome, costuraA, corteA],
      [parteB.metadados.nome, costuraB, corteB],
    ] as const) {
      console.log(
        `${nome}: costura ${umParaMM(caixa(costura).largura)} x ${umParaMM(caixa(costura).altura)} mm | ` +
          `corte ${umParaMM(caixa(corte).largura)} x ${umParaMM(caixa(corte).altura)} mm`,
      );
    }

    // A linha de costura de cada metade e 100 x 100.
    expect(caixa(costuraA).largura).toBe(100 * MM);
    expect(caixa(costuraA).altura).toBe(100 * MM);
    expect(caixa(costuraB).altura).toBe(100 * MM);

    // A linha de CORTE ganha os 10 mm da aresta nova: 100 x 110, nao 100 x 100.
    expect(caixa(corteA).largura).toBe(100 * MM);
    expect(caixa(corteA).altura).toBe(110 * MM);
    expect(caixa(corteB).altura).toBe(110 * MM);

    const areaOriginal = area(anelDoContorno(original));
    const areaPartes = area(corteA) + area(corteB);
    console.log(
      `area da original ${areaOriginal} UM2 | soma das partes cortadas ${areaPartes} UM2 | ` +
        `a mais: ${areaPartes - areaOriginal} UM2 (${umParaMM(areaPartes - areaOriginal) / 1000} cm2)`,
    );
    expect(areaPartes).toBeGreaterThan(areaOriginal);
    // Exatamente 2 x (100 x 10) mm2 de tecido a mais.
    expect(areaPartes - areaOriginal).toBe(2 * 100 * MM * (10 * MM));
  });

  it('cada parte ganha uma aresta de corte com a margem nova, e um pique de casamento', () => {
    const original = retanguloSemMargem();
    const [parteA, parteB] = dividirPeca(original, eixoHorizontal(100 * MM), 10 * MM, 'div');

    console.log('--- arestas e piques das partes ---');
    for (const [numero, parte] of [
      [1, parteA],
      [2, parteB],
    ] as const) {
      const arestaCorte = `div-corte-${numero}`;
      const pique = parte.piques[`div-pq-${numero}`]!;
      console.log(
        `${parte.metadados.nome}: arestas ${Object.keys(parte.arestas).sort().join(', ')} | ` +
          `margem da nova ${parte.margens[arestaCorte]} UM | ` +
          `aresta de corte mede ${medirAresta(parte, arestaCorte)} UM | ` +
          `pique ${pique.tipo} em s = ${pique.s}`,
      );
      expect(parte.margens[arestaCorte]).toBe(10 * MM);
      expect(medirAresta(parte, arestaCorte)).toBe(100 * MM);
      expect(pique.s).toBe(0.5);
      expect(pique.arestaId).toBe(arestaCorte);
    }

    // O pique cai no mesmo lugar nas duas: e por ele que se casa o corte de volta.
    expect(parteA.piques['div-pq-1']!.s).toBe(parteB.piques['div-pq-2']!.s);
    // As arestas HERDADAS mantem o id original (D3). A parte 1 e a de CIMA (ficou
    // com ar-cima) e a 2 e a de baixo — as duas ficam com pedacos das laterais.
    expect(Object.keys(parteA.arestas).sort()).toEqual([
      'ar-cima',
      'ar-direita',
      'ar-esquerda',
      'div-corte-1',
    ]);
    expect(Object.keys(parteB.arestas).sort()).toEqual([
      'ar-baixo',
      'ar-direita',
      'ar-esquerda',
      'div-corte-2',
    ]);
  });

  it('o nome de cada parte e derivado, e o encaixe e herdado', () => {
    const original = retanguloSemMargem();
    const [parteA, parteB] = dividirPeca(original, eixoHorizontal(100 * MM), 10 * MM, 'div');
    console.log(`nomes: "${parteA.metadados.nome}" e "${parteB.metadados.nome}"`);
    expect(parteA.metadados.nome).toBe('RETANGULO_1');
    expect(parteB.metadados.nome).toBe('RETANGULO_2');
    expect(parteA.encaixe).toEqual(original.encaixe);
    expect(parteA.tenantId).toBe(original.tenantId);
  });

  it('o fio e RECORTADO no lado de cada parte', () => {
    const base = logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] });
    const extra = (i: number, tipo: string, payload: unknown) => ({
      id: `evt-f-${i}`,
      tenantId: 'tenant-confeccao-01',
      modeloId: 'mod-0001',
      pecaId: PECA_ID,
      timestamp: '2026-09-04T12:00:00.000Z',
      autor: 'teste',
      versaoSchema: 1,
      tipo,
      payload,
    });
    const modelo = reconstruir([
      ...base,
      extra(0, 'CriarPonto', { pontoId: 'fio-a', x: 50 * MM, y: 10 * MM, tipo: 'interno' }),
      extra(1, 'CriarPonto', { pontoId: 'fio-b', x: 50 * MM, y: 190 * MM, tipo: 'interno' }),
      extra(2, 'CriarPonto', { pontoId: 'fio-c', x: 50 * MM, y: 20 * MM, tipo: 'interno' }),
      extra(3, 'AdicionarLinhaInterna', {
        linhaId: 'li-fio',
        tipo: 'fio',
        pontoIds: ['fio-a', 'fio-c', 'fio-b'],
      }),
    ] as never);

    const [parteA, parteB] = dividirPeca(
      modelo.pecas[PECA_ID]!,
      eixoHorizontal(100 * MM),
      10 * MM,
      'div',
    );
    const doFio = (parte: Peca) =>
      (parte.linhasInternas['li-fio']?.pontos ?? []).map(
        (id) => `${id}(y=${umParaMM(parte.pontos[id]!.y)})`,
      );

    console.log('fio original: fio-a (y=10) -> fio-c (y=20) -> fio-b (y=190), corte em y=100');
    console.log(`  parte 1 (de cima) : ${doFio(parteA).join(' ')}`);
    console.log(`  parte 2 (de baixo): ${doFio(parteB).join(' ')}`);

    // O trecho fio-c -> fio-b atravessa o eixo, entao entra um ponto de corte EM
    // CIMA dele (y = 100) nas duas partes: o fio sobrevive inteiro nas duas.
    expect(doFio(parteA)).toEqual(['div-li-fio-1-0(y=100)', 'fio-b(y=190)']);
    expect(doFio(parteB)).toEqual(['fio-a(y=10)', 'fio-c(y=20)', 'div-li-fio-2-0(y=100)']);
  });

  it('a linha de divisao acompanha a grade: dividir depois de graduar da a proporcao certa', () => {
    // Base ANCORADA (pt-0 e pt-1 sao grade points sem regra) e topo subindo 40 mm
    // por tamanho: a peca cresce de verdade, 160 / 200 / 240 mm em P / M / G.
    // Cortar sempre na METADE RELATIVA tem que dar duas partes iguais em todos os
    // tamanhos, e a linha de divisao sobe junto com a grade.
    const modelo: Modelo = reconstruir(
      comGraduacao(
        logRetangulo({ larguraMM: 100, alturaMM: 200, margensMM: [0, 0, 0, 0] }),
        [
          { gradePointId: 'gp-0', pontoId: 'pt-0' },
          { gradePointId: 'gp-1', pontoId: 'pt-1' },
          { gradePointId: 'gp-2', pontoId: 'pt-2' },
          { gradePointId: 'gp-3', pontoId: 'pt-3' },
        ],
        [...regraEmTodaAGrade('r2', 'gp-2', 0, 40), ...regraEmTodaAGrade('r3', 'gp-3', 0, 40)],
      ),
    );

    console.log('--- divisao acompanhando a grade ---');
    const alturas: number[] = [];
    for (const tamanho of modelo.tamanhos) {
      const peca = aplicarGraduacao(modelo, PECA_ID, tamanho);
      const dimensoes = caixa(anelDoContorno(peca));
      const meio = (dimensoes.minY + dimensoes.maxY) / 2;
      const [parteA, parteB] = dividirPeca(peca, eixoHorizontal(meio), 10 * MM, `d${tamanho}`);
      const alturaA = caixa(anelDoContorno(parteA)).altura;
      const alturaB = caixa(anelDoContorno(parteB)).altura;
      alturas.push(dimensoes.altura);
      console.log(
        `${tamanho}: peca ${umParaMM(dimensoes.altura)} mm | divisao em y = ${umParaMM(meio)} mm ` +
          `-> partes ${umParaMM(alturaA)} + ${umParaMM(alturaB)} mm`,
      );
      expect(alturaA).toBe(dimensoes.altura / 2);
      expect(alturaB).toBe(dimensoes.altura / 2);
    }
    // A peca cresceu de verdade — senao o teste acima passaria a toa.
    expect(alturas.map(umParaMM)).toEqual([160, 200, 240]);
  });

  it('as partes passam no validador (fora o fio, que elas nao tem)', () => {
    const original = retanguloSemMargem();
    const [parteA] = dividirPeca(original, eixoHorizontal(100 * MM), 10 * MM, 'div');
    const modelo = reconstruir(logRetangulo({ larguraMM: 1, alturaMM: 1, margensMM: [0, 0, 0, 0] }));
    const problemas = validarInconsistencias(
      { ...modelo, pecas: { [parteA.id]: parteA } },
      parteA.id,
    );
    console.log(
      `validar a parte: ${problemas.map((p) => `${p.gravidade}:${p.codigo}`).join(', ') || 'nada'}`,
    );
    expect(problemas.map((p) => p.codigo)).toEqual(['FIO_AUSENTE']);
  });

  it('recusa eixo que nao atravessa, e margem nova negativa', () => {
    const original = retanguloSemMargem();
    const foraDaPeca = codigoDoErro(() =>
      dividirPeca(original, eixoHorizontal(500 * MM), 10 * MM, 'x'),
    );
    const margemNegativa = codigoDoErro(() =>
      dividirPeca(original, eixoHorizontal(100 * MM), -1 * MM, 'x'),
    );
    console.log(`eixo fora da peca  -> ${foraDaPeca}`);
    console.log(`margem nova = -1 mm -> ${margemNegativa}`);
    expect(foraDaPeca).toBe('LINHA_DIVISAO_NAO_ATRAVESSA');
    expect(margemNegativa).toBe('MARGEM_NEGATIVA');
  });
});
