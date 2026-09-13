/**
 * O brinquedo: traçar moldes de imagem de internet, sem quadro e sem escala.
 *
 * O que fica provado com número:
 *  - um DIAGRAMA (fundo branco, contorno em tinta preta) vira peças — o
 *    interior branco cercado de tinta conta como molde, o branco da borda não;
 *  - uma FOTO invertida (papel claro em mesa escura) também;
 *  - os eventos reconstroem pelo motor e o validador não acha erro;
 *  - a escala inventada é a declarada (imagem inteira = larguraMM) e o AVISO
 *    de demonstração vai junto;
 *  - imagem sem molde nenhum é recusada com explicação, não com peça vazia.
 */
import { describe, expect, it } from 'vitest';

import { reconstruir, validarInconsistencias, umParaMM } from '@cad/motor';

import { tracarDaInternet, type Imagem } from '../src/index.js';

/** Imagem RGBA cinza-uniforme, para desenhar por cima. */
function tela(largura: number, altura: number, tom: number): {
  img: Imagem;
  pintar: (x0: number, y0: number, x1: number, y1: number, tom: number) => void;
} {
  const dados = new Uint8ClampedArray(largura * altura * 4);
  const por = (i: number, t: number): void => {
    dados[i * 4] = t;
    dados[i * 4 + 1] = t;
    dados[i * 4 + 2] = t;
    dados[i * 4 + 3] = 255;
  };
  for (let i = 0; i < largura * altura; i++) por(i, tom);
  return {
    img: { largura, altura, dados },
    pintar: (x0, y0, x1, y1, t) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) por(y * largura + x, t);
    },
  };
}

let n = 0;
const opcoes = () => {
  n = 0;
  return {
    tenantId: 't',
    modeloId: 'demo-internet',
    autor: 'brinquedo',
    gerarId: () => `01DEMO${String(n++).padStart(6, '0')}`,
    agora: () => '2026-09-13T18:00:00.000Z',
    larguraMM: 600,
  };
};

describe('tracarDaInternet', () => {
  it('diagrama de internet: contorno em tinta no fundo branco vira DUAS peças, na escala declarada', () => {
    // 300 x 200 branco; retangulo so de CONTORNO (3 px de tinta) e um bloco cheio.
    const { img, pintar } = tela(300, 200, 250);
    pintar(40, 40, 140, 43, 20); // topo do retangulo em linha
    pintar(40, 117, 140, 120, 20); // base
    pintar(40, 40, 43, 120, 20); // esquerda
    pintar(137, 40, 140, 120, 20); // direita
    pintar(200, 60, 260, 160, 20); // bloco cheio (uma "peca" pintada)

    const d = tracarDaInternet(img, opcoes());
    console.log('--- diagrama 300x200, imagem = 600 mm ---');
    console.log(
      d.pecas
        .map((p) => `${p.nome}: ${umParaMM(p.larguraUM).toFixed(0)} x ${umParaMM(p.alturaUM).toFixed(0)} mm`)
        .join(' | '),
    );
    expect(d.pecas).toHaveLength(2);

    // Escala: 300 px = 600 mm => 2 mm/px. O retangulo tem 101 px => ~202 mm.
    const retangulo = d.pecas.find((p) => p.nome === 'Molde 1 (demo)')!;
    expect(umParaMM(retangulo.larguraUM)).toBeGreaterThan(192);
    expect(umParaMM(retangulo.larguraUM)).toBeLessThan(212);

    // Os eventos entram pelo log como qualquer peca (I6) e o validador aceita.
    const modelo = reconstruir(d.eventos);
    expect(Object.keys(modelo.pecas)).toHaveLength(2);
    for (const id of Object.keys(modelo.pecas)) {
      const erros = validarInconsistencias(modelo, id).filter((p) => p.gravidade === 'erro');
      expect(erros).toEqual([]);
    }
    console.log('reconstruido pelo motor: 2 pecas, validador limpo');

    // E o aviso de demonstracao vai junto, sempre.
    const aviso = d.problemas.find((p) => p.mensagem.includes('DEMONSTRAÇÃO SEM ESCALA'));
    expect(aviso).toBeDefined();
  });

  it('foto invertida: papel claro na mesa escura vira uma peça', () => {
    const { img, pintar } = tela(240, 240, 35); // mesa escura
    pintar(50, 60, 190, 200, 235); // papel claro cheio
    const d = tracarDaInternet(img, { ...opcoes(), larguraMM: 480 });
    console.log(
      `mesa escura: ${d.pecas.length} peca de ` +
        `${umParaMM(d.pecas[0]!.larguraUM).toFixed(0)} x ${umParaMM(d.pecas[0]!.alturaUM).toFixed(0)} mm`,
    );
    expect(d.pecas).toHaveLength(1);
    // 141 px x 2 mm/px = ~282 mm de largura.
    expect(umParaMM(d.pecas[0]!.larguraUM)).toBeGreaterThan(272);
    expect(umParaMM(d.pecas[0]!.larguraUM)).toBeLessThan(292);
    expect(() => reconstruir(d.eventos)).not.toThrow();
  });

  it('imagem lisa é recusada com explicação, não com peça fantasma', () => {
    const { img } = tela(100, 100, 240);
    const d = tracarDaInternet(img, opcoes());
    expect(d.pecas).toHaveLength(0);
    expect(d.eventos).toHaveLength(0);
    const erro = d.problemas.find((p) => p.gravidade === 'erro');
    expect(erro?.mensagem).toContain('Nenhum molde');
    console.log(`imagem lisa: "${erro!.mensagem.slice(0, 60)}..."`);
  });

  it('é determinístico: a mesma imagem dá o mesmo log, byte a byte', () => {
    const desenhar = () => {
      const { img, pintar } = tela(160, 120, 250);
      pintar(30, 30, 130, 90, 20);
      return img;
    };
    const a = tracarDaInternet(desenhar(), opcoes());
    const b = tracarDaInternet(desenhar(), opcoes());
    expect(JSON.stringify(a.eventos)).toBe(JSON.stringify(b.eventos));
    console.log(`deterministico: ${a.eventos.length} eventos identicos nas duas rodadas`);
  });
});

describe('O caso do encaixe colorido (a imagem real que derrubou a v1)', () => {
  /** Tela COLORIDA: rgb por pixel, para desenhar o screenshot de encaixe. */
  function telaRGB(largura: number, altura: number, cor: [number, number, number]): {
    img: Imagem;
    pintar: (x0: number, y0: number, x1: number, y1: number, cor: [number, number, number]) => void;
  } {
    const dados = new Uint8ClampedArray(largura * altura * 4);
    const por = (i: number, c: [number, number, number]): void => {
      dados[i * 4] = c[0];
      dados[i * 4 + 1] = c[1];
      dados[i * 4 + 2] = c[2];
      dados[i * 4 + 3] = 255;
    };
    for (let i = 0; i < largura * altura; i++) por(i, cor);
    return {
      img: { largura, altura, dados },
      pintar: (x0, y0, x1, y1, c) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) por(y * largura + x, c);
      },
    };
  }

  it('três peças ENCOSTADAS de cores diferentes saem como TRÊS, com faixa cinza na borda e texto dentro', () => {
    const ROSA: [number, number, number] = [230, 0, 126];
    const PRETO: [number, number, number] = [20, 20, 20];
    const LARANJA: [number, number, number] = [245, 166, 0];
    const { img, pintar } = telaRGB(400, 260, [255, 255, 255]);
    // As faixas cinza da barra do video, coladas na borda de cima e de baixo.
    pintar(0, 0, 399, 11, [205, 205, 205]);
    pintar(0, 248, 399, 259, [205, 205, 205]);
    // Tres pecas lado a lado SEM vao: rosa | preta | laranja.
    pintar(40, 60, 140, 200, ROSA);
    pintar(141, 60, 240, 200, PRETO);
    pintar(241, 60, 340, 200, LARANJA);
    // "Texto" e seta de fio dentro da laranja: nao podem virar peca propria.
    pintar(260, 120, 320, 128, PRETO);

    const d = tracarDaInternet(img, { ...opcoes(), larguraMM: 800 });
    console.log('--- encaixe colorido 400x260 = 800 mm ---');
    console.log(
      d.pecas
        .map((p) => `${p.nome}: ${umParaMM(p.larguraUM).toFixed(0)} x ${umParaMM(p.alturaUM).toFixed(0)} mm`)
        .join(' | '),
    );
    // TRES pecas — a v1 (claro/escuro) devolvia UMA mancha com tudo grudado,
    // e o laranja claro sumia no fundo.
    expect(d.pecas).toHaveLength(3);
    // Cada uma com ~100 px x 2 mm = ~200 mm de largura, nao um blob de 300 px.
    for (const p of d.pecas) {
      expect(umParaMM(p.larguraUM)).toBeGreaterThan(180);
      expect(umParaMM(p.larguraUM)).toBeLessThan(220);
    }
    // As faixas cinza NAO viraram peca: sao cor dominante da borda, logo fundo.
    // (Se tivessem virado, seriam pecas de 800 mm de largura.)
    // E o texto dentro da laranja foi consumido pelo preenchimento, nao duplicado.
    const modelo = reconstruir(d.eventos);
    expect(Object.keys(modelo.pecas)).toHaveLength(3);
    for (const id of Object.keys(modelo.pecas)) {
      const erros = validarInconsistencias(modelo, id).filter((p) => p.gravidade === 'erro');
      expect(erros).toEqual([]);
    }
    console.log('3 pecas separadas, faixas de video ignoradas, texto interno consumido, validador limpo');
  });
});

describe('A foto de ateliê com marcações do software (a regressão do 6337)', () => {
  it('peça kraft com pontos e linhas coloridas em cima sai INTEIRA e com a borda LISA', () => {
    // Mesa escura, peca kraft, e as marcacoes que o software poe por cima:
    // pontos verdes NA BORDA, linha vermelha ao longo dela, pontos pretos dentro.
    const { img, pintar } = (function () {
      const dados = new Uint8ClampedArray(300 * 220 * 4);
      const por = (i: number, c: [number, number, number]): void => {
        dados[i * 4] = c[0];
        dados[i * 4 + 1] = c[1];
        dados[i * 4 + 2] = c[2];
        dados[i * 4 + 3] = 255;
      };
      for (let i = 0; i < 300 * 220; i++) por(i, [45, 42, 40]);
      return {
        img: { largura: 300, altura: 220, dados } as Imagem,
        pintar: (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) por(y * 300 + x, c);
        },
      };
    })();
    pintar(50, 40, 250, 180, [190, 160, 120]); // a peca kraft
    pintar(52, 42, 248, 44, [200, 40, 40]); // linha vermelha rente a borda de cima
    for (let k = 0; k < 8; k++) pintar(60 + k * 24, 40, 64 + k * 24, 46, [60, 200, 80]); // pontos verdes NA borda
    for (let k = 0; k < 5; k++) pintar(90 + k * 30, 100, 96 + k * 30, 106, [30, 30, 30]); // furos pretos dentro

    const d = tracarDaInternet(img, { ...opcoes(), larguraMM: 600 });
    console.log('--- foto de atelie com marcacoes ---');
    console.log(
      d.pecas
        .map(
          (p) =>
            `${p.nome}: ${umParaMM(p.larguraUM).toFixed(0)} x ${umParaMM(p.alturaUM).toFixed(0)} mm, ` +
            `${p.pontos} ponto(s) no contorno`,
        )
        .join(' | '),
    );
    // UMA peca — as marcacoes nao a picotam em migalhas (a v2 so-por-cor fazia isso).
    expect(d.pecas).toHaveLength(1);
    const p = d.pecas[0]!;
    // 201 x 141 px a 2 mm/px = 402 x 282 mm.
    expect(umParaMM(p.larguraUM)).toBeGreaterThan(392);
    expect(umParaMM(p.larguraUM)).toBeLessThan(412);
    // Borda LISA: o perimetro fica perto do retangulo ideal (2x(402+282) = 1368 mm),
    // nao o dobro dele serrilhado em volta de cada marcacao.
    const ideal = 2 * (402 + 282);
    expect(umParaMM(p.perimetroUM)).toBeLessThan(ideal * 1.1);
    // E poucos pontos: retangulo limpo, nao serrilhado.
    expect(p.pontos).toBeLessThan(20);
    console.log(
      `perimetro ${umParaMM(p.perimetroUM).toFixed(0)} mm (ideal ${ideal}, teto ${Math.round(ideal * 1.1)})`,
    );
  });

  it('a TIRA fina com pontos que a atravessam fica INTEIRA — kraft de um lado e do outro e a mesma peca', () => {
    const dados = new Uint8ClampedArray(300 * 120 * 4);
    const por = (i: number, c: [number, number, number]): void => {
      dados[i * 4] = c[0];
      dados[i * 4 + 1] = c[1];
      dados[i * 4 + 2] = c[2];
      dados[i * 4 + 3] = 255;
    };
    for (let i = 0; i < 300 * 120; i++) por(i, [45, 42, 40]);
    const pintar = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) por(y * 300 + x, c);
    };
    // Tira kraft de 240 x 22 px com QUATRO olhais pretos que quase a
    // atravessam (sobram 2 px de kraft em cima e embaixo — olhal real nao
    // rasga a borda; um furo de lado a lado dividiria o papel ate na tesoura,
    // e ai duas pecas E a resposta certa).
    pintar(30, 50, 269, 71, [190, 160, 120]);
    for (let k = 0; k < 4; k++) pintar(70 + k * 50, 52, 78 + k * 50, 69, [25, 25, 25]);

    const d = tracarDaInternet({ largura: 300, altura: 120, dados } as Imagem, {
      ...opcoes(),
      larguraMM: 600,
    });
    console.log(
      `tira atravessada: ${d.pecas.length} peca(s) — ` +
        d.pecas.map((p) => `${umParaMM(p.larguraUM).toFixed(0)} x ${umParaMM(p.alturaUM).toFixed(0)} mm`).join(' | '),
    );
    expect(d.pecas).toHaveLength(1);
    // 240 px x 2 mm = 480 mm de comprimento, inteira — nao cinco tocos.
    expect(umParaMM(d.pecas[0]!.larguraUM)).toBeGreaterThan(470);
    expect(umParaMM(d.pecas[0]!.larguraUM)).toBeLessThan(490);
  });
});
