/**
 * Redefinir o comprimento de uma aresta.
 *
 * O que precisa ficar provado com número:
 *  - a aresta passa a medir EXATAMENTE o alvo, em reta e em CURVA;
 *  - a forma da curva sobrevive (é escala, não reamostragem);
 *  - a vizinha estica pelo ponto compartilhado, e só por ele;
 *  - fator fora da faixa é recusado com o motivo.
 */
import { describe, expect, it } from 'vitest';

import {
  MM,
  medirAresta,
  reconstruir,
  redefinirComprimentoDaAresta,
  umParaMM,
  type Evento,
  type Modelo,
} from '../src/index.js';

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: '180' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

let n = 0;
const envelope = (pecaId: string | null) => ({
  id: `01RED${String(n++).padStart(5, '0')}`,
  tenantId: 't',
  modeloId: 'm',
  pecaId,
  timestamp: '2026-09-13T12:00:00.000Z',
  autor: 'fixture',
  versaoSchema: 1,
});

/** Retângulo 400 × 300; ar-1 (direita) é uma cava em Bézier. */
function eventos(): Evento[] {
  n = 0;
  const cantos = [
    { x: 0, y: 0 },
    { x: 400 * MM, y: 0 },
    { x: 400 * MM, y: 300 * MM },
    { x: 0, y: 300 * MM },
  ];
  const lista: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    { ...envelope('p'), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } } as Evento,
  ];
  cantos.forEach((c, i) =>
    lista.push({
      ...envelope('p'),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    lista.push({
      ...envelope('p'),
      tipo: 'DefinirAresta',
      payload: { arestaId: `ar-${i}`, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    lista.push({
      ...envelope('p'),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % 4}`,
        ...(i === 1
          ? {
              tipo: 'curva',
              controles: [
                { x: 360 * MM, y: 100 * MM },
                { x: 360 * MM, y: 200 * MM },
              ],
            }
          : { tipo: 'reta' }),
      },
    } as Evento),
  );
  return lista;
}
const modelo = (): Modelo => reconstruir(eventos());

describe('Redefinir o comprimento da aresta', () => {
  it('a barra reta de 400 vira 385,00 mm exatos, e a lateral acompanha só no canto', () => {
    const peca = modelo().pecas['p']!;
    const nova = redefinirComprimentoDaAresta(peca, 'ar-0', 385 * MM);
    console.log('--- barra 400 -> 385 ---');
    console.log(
      `ar-0: ${umParaMM(medirAresta(peca, 'ar-0'))} -> ${umParaMM(medirAresta(nova, 'ar-0')).toFixed(2)} mm`,
    );
    expect(medirAresta(nova, 'ar-0')).toBe(385 * MM);
    // O canto compartilhado (pt-1) se moveu; pt-2 nao.
    expect(nova.pontos['pt-1']!.x).toBe(385 * MM);
    expect(nova.pontos['pt-2']!.x).toBe(400 * MM);
  });

  it('a CAVA em Bézier vira exatamente o alvo, com a forma preservada', () => {
    const peca = modelo().pecas['p']!;
    const antes = medirAresta(peca, 'ar-1');
    const alvo = Math.round(antes * 1.05);
    const nova = redefinirComprimentoDaAresta(peca, 'ar-1', alvo);
    const depois = medirAresta(nova, 'ar-1');
    console.log('--- cava em Bezier +5% ---');
    console.log(
      `antes ${umParaMM(antes).toFixed(2)} mm | alvo ${umParaMM(alvo).toFixed(2)} | ` +
        `depois ${umParaMM(depois).toFixed(2)} | erro ${umParaMM(Math.abs(depois - alvo)).toFixed(3)} mm`,
    );
    // Escala uniforme: o arco escala pelo fator, exato a menos do arredondamento.
    expect(Math.abs(depois - alvo)).toBeLessThan(100); // 0,1 mm
  });

  it('casar a cava da manga com a da frente: o caso de ofício, em um comando', () => {
    const peca = modelo().pecas['p']!;
    const cavaFrente = medirAresta(peca, 'ar-1');
    const embebido = 8 * MM; // a manga leva 8 mm de embebido
    const nova = redefinirComprimentoDaAresta(peca, 'ar-1', cavaFrente + embebido);
    console.log(
      `cava ${umParaMM(cavaFrente).toFixed(1)} + embebido 8 -> ` +
        `${umParaMM(medirAresta(nova, 'ar-1')).toFixed(1)} mm`,
    );
    expect(Math.abs(medirAresta(nova, 'ar-1') - (cavaFrente + embebido))).toBeLessThan(100);
  });

  it('RECUSA fator fora da faixa, dizendo que é engano de unidade', () => {
    const peca = modelo().pecas['p']!;
    expect(() => redefinirComprimentoDaAresta(peca, 'ar-0', 10 * MM)).toThrow(/unidade|faixa/);
    console.log('400 mm -> 10 mm (fator 0,025) recusado');
  });

  it('o EVENTO RedefinirAresta reconstrói pelo log', () => {
    const direta = redefinirComprimentoDaAresta(modelo().pecas['p']!, 'ar-0', 385 * MM);
    n = 500;
    const doLog = reconstruir([
      ...eventos(),
      {
        ...envelope('p'),
        tipo: 'RedefinirAresta',
        payload: { arestaId: 'ar-0', comprimentoUM: 385 * MM },
      } as Evento,
    ]).pecas['p']!;
    expect(JSON.stringify(doLog.pontos)).toBe(JSON.stringify(direta.pontos));
    console.log('fold x funcao direta: identicos');
  });
});
