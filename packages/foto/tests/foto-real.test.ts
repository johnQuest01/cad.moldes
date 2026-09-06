/**
 * Fase 6 — o pipeline rodando na FOTO REAL do ateliê.
 *
 * `tests/fixtures/parede-01.png`: quadro preto de 138 × 72 cm com borda branca
 * recortada, treze moldes de papel pardo presos por ímãs.
 *
 * Aqui ninguém sabe a resposta certa de antemão — por isso os testes de figura
 * sintética vêm antes (I13). O que este arquivo prova é outra coisa, e é
 * insubstituível: que o método sobrevive à **foto de verdade**, com sombra, reflexo,
 * escrita à mão, ímã e compressão.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';
import { describe, expect, it } from 'vitest';

import {
  buracosDe,
  contornoDaRegiao,
  preencherBuracos,
  rotular,
  segmentar,
  type Imagem,
} from '../src/index.js';

const CAMINHO = fileURLToPath(new URL('./fixtures/parede-01.png', import.meta.url));

async function carregar(): Promise<Imagem> {
  const jimp = await Jimp.read(readFileSync(CAMINHO));
  return {
    largura: jimp.bitmap.width,
    altura: jimp.bitmap.height,
    dados: new Uint8ClampedArray(jimp.bitmap.data),
  };
}

describe('A foto do ateliê', () => {
  it('acha as peças, tapa os ímãs e tira o contorno', async () => {
    const img = await carregar();
    const s = segmentar(img);

    // 0,05% da imagem: descarta respingo de compressão sem perder peça pequena.
    // A menor peça da foto tem ~1% da imagem, então a folga é de 20×.
    const areaMinima = Math.round(img.largura * img.altura * 0.0005);
    const cru = rotular(s.papel, img.largura, img.altura, areaMinima);
    const cheia = preencherBuracos(s.papel, img.largura, img.altura);
    const { rotulos, regioes } = rotular(cheia, img.largura, img.altura, areaMinima);
    const buracos = buracosDe(s.papel, cheia, img.largura, img.altura).filter((b) => b.area >= 4);

    console.log('--- a foto do atelie ---');
    console.log(`${img.largura} x ${img.altura} px`);
    console.log(
      `papel pardo: ${(s.fracaoPapel * 100).toFixed(1)}% da imagem | ` +
        `branco neutro (a borda do quadro): ${(s.fracaoBorda * 100).toFixed(1)}%`,
    );
    console.log(`area minima usada: ${areaMinima} px`);
    console.log('');
    console.log(`pecas antes de tapar ima: ${cru.regioes.length} | depois: ${regioes.length}`);
    console.log(`buracos tapados (imas e escrita fechada): ${buracos.length}`);
    console.log('');
    console.log('peca   area(px)   caixa(px)');
    for (const [i, r] of regioes.entries()) {
      console.log(
        `${String(i + 1).padStart(4)}   ${String(r.area).padStart(7)}   ` +
          `${r.maxX - r.minX + 1} x ${r.maxY - r.minY + 1}`,
      );
    }

    // O contorno da maior peça — a frente grande, no canto de cima à esquerda.
    const maior = regioes[0]!;
    const contorno = contornoDaRegiao(rotulos, img.largura, img.altura, maior.rotulo);
    let perimetro = 0;
    for (let i = 0; i < contorno.length; i++) {
      const a = contorno[i]!;
      const b = contorno[(i + 1) % contorno.length]!;
      perimetro += Math.hypot(b.x - a.x, b.y - a.y);
    }
    console.log('');
    console.log(
      `contorno da maior peca: ${contorno.length} pontos, perimetro ${perimetro.toFixed(0)} px ` +
        `(malha crua — superestima ~5%, ver o teste do disco)`,
    );

    // A caixa do contorno tem que bater com a caixa da região: se o passeio
    // cortasse caminho por dentro, aqui apareceria.
    const cx = contorno.map((p) => p.x);
    const cy = contorno.map((p) => p.y);
    console.log(
      `caixa do contorno ${Math.min(...cx)}..${Math.max(...cx)} x ${Math.min(...cy)}..${Math.max(...cy)} | ` +
        `caixa da regiao ${maior.minX}..${maior.maxX} x ${maior.minY}..${maior.maxY}`,
    );

    expect(regioes.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...cx)).toBe(maior.minX);
    expect(Math.max(...cx)).toBe(maior.maxX);
    expect(Math.min(...cy)).toBe(maior.minY);
    expect(Math.max(...cy)).toBe(maior.maxY);
  });

  it('a borda branca do quadro aparece como um anel de marcas', async () => {
    const img = await carregar();
    const s = segmentar(img);
    // Cada semicírculo da borda é uma marca separada. São elas o alvo de
    // calibração: quatro cantos saem daí, e dezenas de pontos junto.
    const marcas = rotular(s.bordaDoQuadro, img.largura, img.altura, 20).regioes;
    const areas = marcas.map((m) => m.area).sort((a, b) => a - b);
    const mediana = areas[Math.floor(areas.length / 2)]!;

    console.log('--- a borda recortada do quadro ---');
    console.log(`${marcas.length} marcas brancas com 20 px ou mais`);
    console.log(
      `area: menor ${areas[0]}, mediana ${mediana}, maior ${areas[areas.length - 1]} px`,
    );
    console.log(
      `caixa de todas: x ${Math.min(...marcas.map((m) => m.minX))}..${Math.max(...marcas.map((m) => m.maxX))} | ` +
        `y ${Math.min(...marcas.map((m) => m.minY))}..${Math.max(...marcas.map((m) => m.maxY))}`,
    );
    expect(marcas.length).toBeGreaterThan(20);
  });
});
