/**
 * Fase 6 — do passeio de pixels ao contorno do motor.
 *
 * Figura sintética de resposta conhecida ANTES da foto (I13). Aqui dá para desenhar
 * um pique de 6,35 mm de fundo por 1,6 mm de boca e cobrar o número de volta.
 */
import { describe, expect, it } from 'vitest';

import { MM, type Vetor2 } from '@cad/motor';

import {
  ajustarCurvas,
  detectarCantos,
  detectarPiques,
  removerPiques,
  simplificarAnel,
} from '../src/index.js';

/** Um retângulo em UM, no sentido anti-horário (Y para cima), tesselado de 1 em 1 mm. */
function retangulo(larguraMM: number, alturaMM: number, passoMM = 1): Vetor2[] {
  const p: Vetor2[] = [];
  const empurrar = (x: number, y: number): void => {
    p.push({ x: Math.round(x), y: Math.round(y) });
  };
  for (let x = 0; x < larguraMM; x += passoMM) empurrar(x * MM, 0);
  for (let y = 0; y < alturaMM; y += passoMM) empurrar(larguraMM * MM, y * MM);
  for (let x = larguraMM; x > 0; x -= passoMM) empurrar(x * MM, alturaMM * MM);
  for (let y = alturaMM; y > 0; y -= passoMM) empurrar(0, y * MM);
  return p;
}

describe('Simplificar', () => {
  it('um retângulo de 400 pontos vira quatro cantos', () => {
    const anel = retangulo(100, 100, 1);
    const simples = simplificarAnel(anel, 0.5 * MM);
    console.log(`retangulo tesselado: ${anel.length} pontos -> simplificado: ${simples.length}`);
    expect(anel.length).toBeGreaterThan(300);
    expect(simples.length).toBeLessThanOrEqual(6);
  });

  it('não mexe em anel curto — abaixo de 5 pontos o clipper devolve intacto', () => {
    const triangulo: Vetor2[] = [
      { x: 0, y: 0 },
      { x: 100 * MM, y: 0 },
      { x: 0, y: 100 * MM },
    ];
    expect(simplificarAnel(triangulo, 5 * MM)).toHaveLength(3);
  });
});

describe('Piques', () => {
  /** Um retângulo com um V entrando pela borda de baixo, na posição pedida. */
  function comPique(posicaoMM: number, fundoMM: number, bocaMM: number): Vetor2[] {
    const anel: Vetor2[] = [];
    for (let x = 0; x < 200; x += 1) {
      if (Math.abs(x - posicaoMM) < 0.001) {
        // A boca desce, chega ao fundo e sobe: é o desenho de um pique.
        anel.push({ x: Math.round(x * MM), y: 0 });
        anel.push({ x: Math.round((x + bocaMM / 2) * MM), y: Math.round(fundoMM * MM) });
        anel.push({ x: Math.round((x + bocaMM) * MM), y: 0 });
        x += Math.ceil(bocaMM) - 1;
        continue;
      }
      anel.push({ x: Math.round(x * MM), y: 0 });
    }
    for (let y = 0; y < 100; y += 1) anel.push({ x: 200 * MM, y: Math.round(y * MM) });
    for (let x = 200; x > 0; x -= 1) anel.push({ x: Math.round(x * MM), y: 100 * MM });
    for (let y = 100; y > 0; y -= 1) anel.push({ x: 0, y: Math.round(y * MM) });
    return anel;
  }

  it('acha um pique de 6,35 mm de fundo por 1,6 mm de boca, e mede os dois', () => {
    const anel = comPique(80, 6.35, 1.6);
    const piques = detectarPiques(anel);
    console.log('--- um pique padrao (1/4" x 1/16") ---');
    for (const p of piques) {
      console.log(
        `s = ${(p.sUM / MM).toFixed(1)} mm | fundo ${(p.fundoUM / MM).toFixed(2)} mm | ` +
          `boca ${(p.bocaUM / MM).toFixed(2)} mm`,
      );
    }
    expect(piques).toHaveLength(1);
    expect(piques[0]!.fundoUM / MM).toBeCloseTo(6.35, 1);
    expect(piques[0]!.bocaUM / MM).toBeCloseTo(1.6, 1);
    // O `s` aqui é medido no anel CRU, e o caminho cru desce e sobe pelo V: dá
    // 86,4 mm. Quem corrige para a aresta é `removerPiques`, e tem teste próprio.
    expect(piques[0]!.sUM / MM).toBeCloseTo(86.4, 0);
  });

  it('acha CINCO piques e não confunde nenhum com o canto do retângulo', () => {
    const anel: Vetor2[] = [];
    const posicoes = [30, 60, 90, 120, 150];
    for (let x = 0; x < 200; x += 1) {
      if (posicoes.some((p) => Math.abs(x - p) < 0.001)) {
        anel.push({ x: Math.round(x * MM), y: 0 });
        anel.push({ x: Math.round((x + 0.8) * MM), y: Math.round(6.35 * MM) });
        anel.push({ x: Math.round((x + 1.6) * MM), y: 0 });
        x += 1;
        continue;
      }
      anel.push({ x: Math.round(x * MM), y: 0 });
    }
    for (let y = 0; y < 100; y += 1) anel.push({ x: 200 * MM, y: Math.round(y * MM) });
    for (let x = 200; x > 0; x -= 1) anel.push({ x: Math.round(x * MM), y: 100 * MM });
    for (let y = 100; y > 0; y -= 1) anel.push({ x: 0, y: Math.round(y * MM) });

    const piques = detectarPiques(anel);
    console.log(
      `cinco piques em ${posicoes.join(', ')} mm -> achados em ` +
        `${piques.map((p) => (p.sUM / MM).toFixed(1)).join(', ')} mm`,
    );
    expect(piques).toHaveLength(5);
  });

  it('NÃO confunde um recorte largo com pique — boca de 30 mm passa batido', () => {
    const anel = comPique(80, 6.35, 30);
    const piques = detectarPiques(anel);
    console.log(`recorte de 30 mm de boca -> ${piques.length} pique(s) achado(s)`);
    expect(piques).toHaveLength(0);
  });

  it('NÃO confunde ondulação rasa com pique — 0,8 mm de fundo passa batido', () => {
    const anel = comPique(80, 0.8, 1.6);
    console.log(`ondulacao de 0,8 mm de fundo -> ${detectarPiques(anel).length} pique(s)`);
    expect(detectarPiques(anel)).toHaveLength(0);
  });

  it('tirar o pique devolve a borda reta, e a posição fica guardada', () => {
    const anel = comPique(80, 6.35, 1.6);
    const piques = detectarPiques(anel);
    const { anel: semPique, piques: corrigidos } = removerPiques(anel, piques);
    // Só a faixa do pique, e só a metade de baixo: a lateral e a borda de cima do
    // retângulo têm pontos altos que não têm nada a ver com o pique.
    const naFaixa = (pontos: readonly Vetor2[]): number =>
      Math.max(
        ...pontos.filter((p) => p.x > 79 * MM && p.x < 83 * MM && p.y < 50 * MM).map((p) => p.y),
      );
    console.log(
      `na faixa do pique, ponto mais alto: antes ${(naFaixa(anel) / MM).toFixed(2)} mm | ` +
        `depois ${(naFaixa(semPique) / MM).toFixed(2)} mm`,
    );
    console.log(
      `s medido no anel CRU: ${(piques[0]!.sUM / MM).toFixed(1)} mm | ` +
        `corrigido para a aresta sem o pique: ${(corrigidos[0]!.sUM / MM).toFixed(1)} mm`,
    );
    expect(naFaixa(semPique)).toBe(0);
    // O pique fica a 80,8 mm da origem ao longo da ARESTA — não a 86,4, que é o
    // que o caminho cru mede descendo e subindo pelo V.
    expect(corrigidos[0]!.sUM / MM).toBeCloseTo(80.8, 0);
  });
});

describe('Cantos e curvas', () => {
  it('um retângulo tem exatamente quatro cantos', () => {
    const simples = simplificarAnel(retangulo(200, 100, 1), 0.5 * MM);
    const cantos = detectarCantos(simples, 30, 8000);
    console.log(`retangulo 200 x 100 -> ${cantos.length} cantos`);
    expect(cantos).toHaveLength(4);
  });

  it('um círculo não tem canto nenhum', () => {
    const anel: Vetor2[] = [];
    for (let g = 0; g < 360; g += 2) {
      const t = (g * Math.PI) / 180;
      anel.push({ x: Math.round(50 * MM * Math.cos(t)), y: Math.round(50 * MM * Math.sin(t)) });
    }
    const cantos = detectarCantos(anel, 30, 8000);
    console.log(`circulo de raio 50 mm -> ${cantos.length} cantos`);
    expect(cantos).toHaveLength(0);
  });

  it('trecho reto vira RETA, e o resíduo é zero', () => {
    const reta: Vetor2[] = [];
    for (let x = 0; x <= 100; x += 1) reta.push({ x: x * MM, y: 20 * MM });
    const trechos = ajustarCurvas(reta, [0, reta.length - 1], 0.2 * MM);
    console.log(`101 pontos numa reta -> ${trechos.length} trecho(s), tipo ${trechos[0]?.tipo}`);
    expect(trechos.every((t) => t.tipo === 'reta')).toBe(true);
    expect(trechos[0]!.residuoUM).toBe(0);
  });

  it('um arco de raio conhecido vira Bézier, e o raio volta certo', () => {
    // A prova de fogo do ajuste: um arco de 90 graus e raio 80 mm. Depois de virar
    // Bézier, cada ponto do traçado tem que estar a 80 mm do centro.
    const R = 80 * MM;
    const arco: Vetor2[] = [];
    for (let g = 0; g <= 90; g += 1) {
      const t = (g * Math.PI) / 180;
      arco.push({ x: Math.round(R * Math.cos(t)), y: Math.round(R * Math.sin(t)) });
    }
    const trechos = ajustarCurvas(arco, [0, arco.length - 1], 0.2 * MM);
    const curvas = trechos.filter((t) => t.tipo === 'curva');

    // Percorre a Bézier e mede a distância ao centro.
    let piorRaio = 0;
    for (const c of curvas) {
      const [c1, c2] = c.controles!;
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const u = 1 - t;
        const x = u ** 3 * c.de.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * c.para.x;
        const y = u ** 3 * c.de.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * c.para.y;
        piorRaio = Math.max(piorRaio, Math.abs(Math.hypot(x, y) - R));
      }
    }
    console.log('--- ajuste de curva contra raio conhecido ---');
    console.log(`arco de 90 graus, raio 80 mm, 91 pontos -> ${trechos.length} trecho(s)`);
    console.log(
      `${curvas.length} Bezier(s) | pior erro de raio: ${(piorRaio / MM).toFixed(4)} mm ` +
        `(tolerancia pedida 0,200 mm)`,
    );
    expect(curvas.length).toBeGreaterThanOrEqual(1);
    expect(piorRaio).toBeLessThanOrEqual(0.2 * MM);
  });
});
