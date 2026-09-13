/**
 * Os comandos de ofício da comparação com o Audaces: pregas paramétricas,
 * bainha, alinhar, desdobrar, pence e redefinir aresta — todos passando pela
 * MESMA sessão que o mouse usa, com o número cobrado de volta.
 */
import { describe, expect, it } from 'vitest';

import { MM, anelDoContorno, area, medirAresta, umParaMM, type Modelo } from '@cad/motor';

import {
  abrirPenceComando,
  alinharPeca,
  definirBainha,
  desdobrarPecaComando,
  duplicarPeca,
  gerarPregas,
  redefinirAresta,
} from '../src/index.js';

import { PECA, sessaoDaBlusa } from './fixtures.js';

const areaDa = (modelo: Modelo, id: string): number => area(anelDoContorno(modelo.pecas[id]!));
const larguraDe = (modelo: Modelo, id: string): number => {
  const xs = Object.values(modelo.pecas[id]!.pontos).map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
};

describe('Pregas paramétricas', () => {
  it('3 pregas de 15+5 mm ALARGAM a barra exatamente 60 mm — eixo vertical desloca na horizontal', () => {
    const sessao = sessaoDaBlusa();
    const antes = larguraDe(sessao.modelo, PECA);
    const gestos = gerarPregas(
      sessao.modelo,
      PECA,
      'ar-bainha',
      { quantidade: 3, distanciaMM: 40, largura1MM: 15, largura2MM: 5 },
      'pg',
    );
    sessao.aplicar(...gestos);
    const depois = larguraDe(sessao.modelo, PECA);

    console.log('--- o dialogo de Pregas do oficio, em gestos ---');
    console.log(`gestos: ${gestos.length} (3 eixos + 1 abrir)`);
    console.log(
      `largura da peca: ${umParaMM(antes)} -> ${umParaMM(depois)} mm ` +
        `(3 pregas x (15+5) mm = 60 mm de tecido)`,
    );
    const peca = sessao.modelo.pecas[PECA]!;
    const piquesDePrega = Object.keys(peca.piques).filter((id) => id.startsWith('pg'));
    console.log(`piques de dobra criados pelo motor: ${piquesDePrega.length}`);

    expect(gestos).toHaveLength(4);
    expect(umParaMM(depois - antes)).toBe(60);
    expect(piquesDePrega.length).toBeGreaterThanOrEqual(3);

    // Um desfazer devolve TUDO: os 4 gestos entraram num passo so.
    sessao.desfazer();
    expect(larguraDe(sessao.modelo, PECA)).toBe(antes);
  });

  it('recusa a quantidade que não cabe, com as medidas na mensagem', () => {
    const sessao = sessaoDaBlusa();
    expect(() =>
      gerarPregas(
        sessao.modelo,
        PECA,
        'ar-bainha',
        { quantidade: 20, distanciaMM: 40, largura1MM: 10 },
        'pg',
      ),
    ).toThrow(/nao cabem/);
    console.log('20 pregas a cada 40 mm numa barra de 180 -> recusado');
  });
});

describe('Bainha', () => {
  it('a barra ganha a altura como margem e as vizinhas ganham o pique da dobra', () => {
    const sessao = sessaoDaBlusa();
    sessao.aplicar(...definirBainha(sessao.modelo, PECA, 'ar-bainha', 25, 'bn'));
    const peca = sessao.modelo.pecas[PECA]!;
    const antes = peca.piques['bn-pq-antes']!;
    const depois = peca.piques['bn-pq-depois']!;
    console.log('--- bainha de 25 mm ---');
    console.log(`margem da barra: ${umParaMM(peca.margens['ar-bainha'] ?? 0)} mm`);
    console.log(
      `pique de dobra: "${antes.arestaId}" em s=${antes.s.toFixed(3)} e ` +
        `"${depois.arestaId}" em s=${depois.s.toFixed(3)}`,
    );
    expect(umParaMM(peca.margens['ar-bainha'] ?? 0)).toBe(25);
    expect(antes.arestaId).toBe('ar-meio');
    expect(depois.arestaId).toBe('ar-lateral');
    // Na anterior o pique fica perto do FIM; na seguinte, perto do INICIO.
    expect(antes.s).toBeGreaterThan(0.9);
    expect(depois.s).toBeLessThan(0.1);
  });

  it('bainha alta demais para a lateral é recusada', () => {
    const sessao = sessaoDaBlusa();
    expect(() => definirBainha(sessao.modelo, PECA, 'ar-bainha', 200, 'bn')).toThrow(/40%/);
  });
});

describe('Alinhar', () => {
  it('duas peças ficam com a mesma base por translação pura', () => {
    const sessao = sessaoDaBlusa();
    sessao.aplicar(...duplicarPeca(sessao.modelo, PECA, 'cp1'));
    const copiaId = Object.keys(sessao.modelo.pecas).find((id) => id !== PECA)!;
    sessao.aplicar({ tipo: 'TransladarPeca', pecaId: copiaId, payload: { dx: 0, dy: 77 * MM } });
    sessao.aplicar(...alinharPeca(sessao.modelo, copiaId, PECA, 'base'));
    const baseDe = (id: string): number =>
      Math.min(...Object.values(sessao.modelo.pecas[id]!.pontos).map((p) => p.y));
    console.log(`bases: ${umParaMM(baseDe(PECA))} e ${umParaMM(baseDe(copiaId))} mm — iguais`);
    expect(baseDe(copiaId)).toBe(baseDe(PECA));
    // E a area da copia nao mudou um micrometro: translacao e rigida.
    expect(areaDa(sessao.modelo, copiaId)).toBe(areaDa(sessao.modelo, PECA));
  });
});

describe('Desdobrar pela sessão', () => {
  it('a meia-blusa do fixture dobra a área pelo meio-da-frente', () => {
    const sessao = sessaoDaBlusa();
    const peca = sessao.modelo.pecas[PECA]!;
    const meio = peca.arestas['ar-meio']!;
    const p1 = peca.pontos[meio.pontoInicioId]!;
    const p2 = peca.pontos[meio.pontoFimId]!;
    sessao.aplicar({
      tipo: 'DefinirEixoDobra',
      pecaId: PECA,
      payload: {
        eixoId: 'ex-meio',
        p1: { x: p1.x, y: p1.y },
        p2: { x: p2.x, y: p2.y },
        direcao: 'dentro',
      },
    });
    const antes = areaDa(sessao.modelo, PECA);
    sessao.aplicar(...desdobrarPecaComando(sessao.modelo, PECA, 'ex-meio', 'dd'));
    const depois = areaDa(sessao.modelo, PECA);
    console.log(
      `area: ${(antes / 1e8).toFixed(1)} -> ${(depois / 1e8).toFixed(1)} cm2 ` +
        `(razao ${(depois / antes).toFixed(4)})`,
    );
    expect(depois / antes).toBeGreaterThan(1.99);
    expect(depois / antes).toBeLessThan(2.01);
    // Desfazer devolve a metade: e a rede de seguranca de sempre.
    sessao.desfazer();
    expect(areaDa(sessao.modelo, PECA)).toBe(antes);
  });
});

describe('Pence e redefinir pela sessão', () => {
  it('a pence tira a área do triângulo e a aresta redefinida CRAVA o alvo', () => {
    const sessao = sessaoDaBlusa();
    const antes = areaDa(sessao.modelo, PECA);
    sessao.aplicar(...abrirPenceComando(sessao.modelo, PECA, 'ar-bainha', 0.5, 30, 100, 'pn'));
    const removida = antes - areaDa(sessao.modelo, PECA);
    const triangulo = (30 * MM * (100 * MM)) / 2;
    console.log(
      `pence 30x100: removeu ${(removida / 1e8).toFixed(3)} cm2 ` +
        `(triangulo ${(triangulo / 1e8).toFixed(3)}, razao ${(removida / triangulo).toFixed(4)})`,
    );
    expect(removida / triangulo).toBeGreaterThan(0.999);
    expect(removida / triangulo).toBeLessThan(1.001);

    const atual = medirAresta(sessao.modelo.pecas[PECA]!, 'ar-lateral');
    const alvoMM = Math.round(umParaMM(atual)) + 20;
    sessao.aplicar(...redefinirAresta(sessao.modelo, PECA, 'ar-lateral', alvoMM));
    const nova = medirAresta(sessao.modelo.pecas[PECA]!, 'ar-lateral');
    console.log(
      `lateral: ${umParaMM(atual).toFixed(2)} -> ${umParaMM(nova).toFixed(2)} mm (alvo ${alvoMM})`,
    );
    expect(Math.abs(umParaMM(nova) - alvoMM)).toBeLessThan(0.1);
  });
});
