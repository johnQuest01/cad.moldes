/**
 * Fase 6 — regiões: rotular, tapar buraco, andar pela borda.
 *
 * A regra aqui é a da decisão I13: **primeiro figura sintética de resposta conhecida
 * de antemão, depois a foto.** Na foto ninguém sabe a resposta certa; num retângulo
 * de 40 × 30 pixels, sabe — e é isso que separa "parece que funcionou" de
 * "funcionou".
 */
import { describe, expect, it } from 'vitest';

import {
  buracosDe,
  contornoDaRegiao,
  preencherBuracos,
  rotular,
  segmentar,
  type Imagem,
} from '../src/index.js';

const W = 80;
const H = 60;

/** Uma máscara vazia, e um pincel de retângulo. */
function tela(): Uint8Array {
  return new Uint8Array(W * H);
}
function retangulo(m: Uint8Array, x0: number, y0: number, x1: number, y1: number, v = 1): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = v;
}

describe('Rotular componentes', () => {
  it('dois retângulos separados são duas regiões, com a área exata', () => {
    const m = tela();
    retangulo(m, 5, 5, 25, 20); // 20 x 15 = 300
    retangulo(m, 40, 30, 60, 50); // 20 x 20 = 400
    const { regioes } = rotular(m, W, H);

    console.log('--- dois retangulos ---');
    for (const r of regioes) {
      console.log(
        `regiao ${r.rotulo}: area ${r.area} px, caixa ${r.maxX - r.minX + 1} x ${r.maxY - r.minY + 1}`,
      );
    }
    expect(regioes).toHaveLength(2);
    expect(regioes.map((r) => r.area)).toEqual([400, 300]); // maior primeiro
  });

  it('duas peças que se tocam SÓ na quina continuam duas — é a vizinhança de 4', () => {
    const m = tela();
    retangulo(m, 5, 5, 15, 15);
    retangulo(m, 15, 15, 25, 25); // encosta em (14,14)-(15,15), só na diagonal
    const { regioes } = rotular(m, W, H);
    console.log(
      `duas pecas encostadas na quina -> ${regioes.length} regiao(oes) ` +
        `(com vizinhanca de 8 sairia 1, e o molde sairia grudado)`,
    );
    expect(regioes).toHaveLength(2);
  });

  it('área mínima descarta sujeira', () => {
    const m = tela();
    retangulo(m, 5, 5, 25, 20); // 300
    retangulo(m, 70, 55, 72, 57); // 4 px de sujeira
    expect(rotular(m, W, H).regioes).toHaveLength(2);
    expect(rotular(m, W, H, 100).regioes).toHaveLength(1);
    console.log('sujeira de 4 px -> descartada com areaMinima = 100');
  });
});

describe('Tapar buracos — é o que resolve os ímãs', () => {
  it('um anel vira disco cheio, e o buraco é contado', () => {
    const m = tela();
    retangulo(m, 10, 10, 40, 40); // 30 x 30 = 900
    retangulo(m, 20, 20, 25, 25, 0); // buraco 5 x 5 = 25
    const antes = rotular(m, W, H).regioes[0]!.area;

    const cheia = preencherBuracos(m, W, H);
    const depois = rotular(cheia, W, H).regioes[0]!.area;
    const buracos = buracosDe(m, cheia, W, H);

    console.log('--- o ima ---');
    console.log(`peca com buraco: ${antes} px | depois de tapar: ${depois} px`);
    console.log(`buracos achados: ${buracos.length}, area ${buracos[0]?.area} px em (${buracos[0]?.x}, ${buracos[0]?.y})`);
    expect(antes).toBe(875);
    expect(depois).toBe(900);
    expect(buracos).toHaveLength(1);
    expect(buracos[0]!.area).toBe(25);
  });

  it('entalhe que ABRE na borda da peça NÃO é tapado — é assim que o pique sobrevive', () => {
    // Um pique é um corte que vem de fora para dentro: não é buraco fechado. Se o
    // preenchimento tapasse isso, todo pique seria apagado na digitalização.
    const m = tela();
    retangulo(m, 10, 10, 40, 40);
    retangulo(m, 22, 10, 26, 18, 0); // entalhe descendo da borda de cima
    const antes = rotular(m, W, H).regioes[0]!.area;
    const depois = rotular(preencherBuracos(m, W, H), W, H).regioes[0]!.area;
    console.log(`peca com entalhe aberto: ${antes} px | depois de tapar: ${depois} px (igual = pique preservado)`);
    expect(depois).toBe(antes);
  });
});

describe('Contorno: andar pela borda', () => {
  it('um retângulo 20 × 15 dá o perímetro exato em pixels', () => {
    const m = tela();
    retangulo(m, 10, 10, 30, 25); // 20 de largura, 15 de altura
    const { rotulos } = rotular(m, W, H);
    const c = contornoDaRegiao(rotulos, W, H, 1);

    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    // O passeio anda pelos pixels de borda: 2·(20−1) + 2·(15−1) = 66.
    console.log('--- contorno de um retangulo 20 x 15 px ---');
    console.log(`${c.length} pontos | x ${Math.min(...xs)}..${Math.max(...xs)} | y ${Math.min(...ys)}..${Math.max(...ys)}`);
    expect(c.length).toBe(66);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.max(...xs)).toBe(29);
    expect(Math.min(...ys)).toBe(10);
    expect(Math.max(...ys)).toBe(24);
    // Fechado: o último ponto é vizinho do primeiro.
    const a = c[0]!;
    const z = c[c.length - 1]!;
    expect(Math.abs(a.x - z.x) + Math.abs(a.y - z.y)).toBeLessThanOrEqual(2);
  });

  it('o contorno de um disco tem o perímetro perto de 2πr', () => {
    const m = tela();
    const cx = 40;
    const cy = 30;
    const r = 20;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * W + x] = 1;

    const { rotulos } = rotular(m, W, H);
    const c = contornoDaRegiao(rotulos, W, H, 1);
    // Soma o comprimento real do passeio: passo diagonal vale √2, não 1.
    let perimetro = 0;
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!;
      const b = c[(i + 1) % c.length]!;
      perimetro += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const esperado = 2 * Math.PI * r;
    console.log(
      `disco r=${r}: perimetro medido ${perimetro.toFixed(1)} px | 2πr = ${esperado.toFixed(1)} px | ` +
        `erro ${(((perimetro - esperado) / esperado) * 100).toFixed(1)}%`,
    );
    // O passeio anda de pixel em pixel, e uma escada de pixels e sempre mais
    // comprida que a curva que ela imita — aqui ~5%. E POR ISSO que nao se mede
    // perimetro na malha crua: mede-se depois de simplificar e ajustar a curva.
    expect(Math.abs(perimetro - esperado) / esperado).toBeLessThan(0.1);
  });
});

describe('Segmentar por croma', () => {
  it('separa pardo de preto e de branco pelo R − B, e não pelo brilho', () => {
    // Três faixas com o mesmo problema da foto real: o preto com REFLEXO fica mais
    // claro que o pardo com SOMBRA. Só o croma sobrevive a isso.
    const largura = 40;
    const altura = 10;
    const dados = new Uint8ClampedArray(largura * altura * 4);
    const pintar = (x0: number, x1: number, r: number, g: number, b: number): void => {
      for (let y = 0; y < altura; y++)
        for (let x = x0; x < x1; x++) {
          const j = (y * largura + x) * 4;
          dados[j] = r;
          dados[j + 1] = g;
          dados[j + 2] = b;
          dados[j + 3] = 255;
        }
    };
    pintar(0, 10, 31, 26, 20); // fundo preto           lum  27  R−B  11
    pintar(10, 20, 174, 114, 66); // papel EM SOMBRA    lum 126  R−B 108
    pintar(20, 30, 140, 138, 140); // preto com REFLEXO lum 138  R−B   0
    pintar(30, 40, 250, 250, 250); // borda branca do quadro lum 250  R−B 0

    const img: Imagem = { largura, altura, dados };
    const s = segmentar(img);
    console.log('--- croma vence o brilho ---');
    console.log('preto lum 27 R-B 11 | papel em SOMBRA lum 126 R-B 108 | reflexo lum 138 R-B 0 | borda lum 250');
    console.log('repare: o reflexo (138) e MAIS CLARO que o papel em sombra (126).');
    console.log('qualquer limiar de brilho que pegue o papel pega o reflexo junto.');
    console.log(
      `papel: ${(s.fracaoPapel * 100).toFixed(0)}% da imagem (uma faixa de quatro) | ` +
        `borda branca: ${(s.fracaoBorda * 100).toFixed(0)}%`,
    );
    // Um limiar de brilho pegaria o reflexo e perderia a sombra. O croma acerta.
    expect(s.papel[5 * largura + 15]).toBe(1); // papel em sombra: dentro
    expect(s.papel[5 * largura + 5]).toBe(0); // preto: fora
    expect(s.papel[5 * largura + 25]).toBe(0); // reflexo claro: fora do papel
    expect(s.bordaDoQuadro[5 * largura + 25]).toBe(0); // e nem por isso vira borda
    expect(s.bordaDoQuadro[5 * largura + 35]).toBe(1); // a borda de verdade, sim
  });
});
