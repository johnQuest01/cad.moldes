/**
 * Fase 6 — calibrar o quadro com um objeto de tamanho conhecido (I14).
 *
 * Aqui **a verdade é conhecida**: o quadro sintético mede 1380 × 792 mm por
 * construção, e a pergunta é se a calibração devolve esse número olhando só para um
 * retângulo de 1150 × 600 preso nele. Na foto do ateliê ninguém sabe a resposta — é
 * justamente o problema que esta função existe para resolver.
 */
import { describe, expect, it } from 'vitest';

import { MM } from '@cad/motor';

import {
  calibrarComObjeto,
  estimarHomografia,
  objetoConhecidoMM,
  projetar,
  type Imagem,
  type PontoImagem,
} from '../src/index.js';

/** A verdade que o teste vai cobrar de volta. */
const QUADRO_REAL = { larguraMM: 1380, alturaMM: 792 };
const OBJETO_REAL = { larguraMM: 1150, alturaMM: 600 };

const LARGURA_PX = 1400;
const ALTURA_PX = 900;

/** Câmera de furo de agulha: a mesma da prova da homografia. */
function camera(inclinacaoGraus: number, distanciaMM: number, focoPx: number) {
  const t = (inclinacaoGraus * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  const cx = QUADRO_REAL.larguraMM / 2;
  const cy = QUADRO_REAL.alturaMM / 2;
  return (p: { x: number; y: number }): PontoImagem => {
    const x = p.x - cx;
    const y = p.y - cy;
    const zc = distanciaMM - y * sen;
    return {
      x: LARGURA_PX / 2 + (focoPx * x) / zc,
      y: ALTURA_PX / 2 - (focoPx * y * cos) / zc,
    };
  };
}

/**
 * Desenha a foto de calibração: quadro preto, marcas brancas na borda, e o
 * retângulo de papel pardo no meio.
 *
 * A imagem é rasterizada indo de PIXEL para MUNDO, pela homografia inversa — assim
 * cada pixel recebe a cor do que está mesmo naquele ponto, com a perspectiva certa.
 */
function fotoSintetica(inclinacaoGraus = 10): Imagem {
  const lente = camera(inclinacaoGraus, 2500, 1500);
  const cantosMundo = [
    { x: 0, y: 0 },
    { x: QUADRO_REAL.larguraMM, y: 0 },
    { x: QUADRO_REAL.larguraMM, y: QUADRO_REAL.alturaMM },
    { x: 0, y: QUADRO_REAL.alturaMM },
  ];
  const paraMundo = estimarHomografia(cantosMundo.map(lente), cantosMundo);

  // Marcas de 20 mm de diâmetro a cada 40 mm, com os centros SOBRE o retângulo do
  // quadro — que é, por definição, o que a calibração tem que descobrir.
  const marcas: { x: number; y: number }[] = [];
  for (let x = 40; x < QUADRO_REAL.larguraMM; x += 40) {
    marcas.push({ x, y: 0 }, { x, y: QUADRO_REAL.alturaMM });
  }
  for (let y = 40; y < QUADRO_REAL.alturaMM; y += 40) {
    marcas.push({ x: 0, y }, { x: QUADRO_REAL.larguraMM, y });
  }

  const objeto = {
    x0: (QUADRO_REAL.larguraMM - OBJETO_REAL.larguraMM) / 2,
    y0: (QUADRO_REAL.alturaMM - OBJETO_REAL.alturaMM) / 2,
    x1: (QUADRO_REAL.larguraMM + OBJETO_REAL.larguraMM) / 2,
    y1: (QUADRO_REAL.alturaMM + OBJETO_REAL.alturaMM) / 2,
  };

  const dados = new Uint8ClampedArray(LARGURA_PX * ALTURA_PX * 4);
  for (let py = 0; py < ALTURA_PX; py++) {
    for (let px = 0; px < LARGURA_PX; px++) {
      const m = projetar(paraMundo, { x: px + 0.5, y: py + 0.5 });
      const j = (py * LARGURA_PX + px) * 4;
      let cor: [number, number, number] = [10, 10, 12]; // fora do quadro: preto
      if (m.x >= -30 && m.x <= QUADRO_REAL.larguraMM + 30 && m.y >= -30 && m.y <= QUADRO_REAL.alturaMM + 30) {
        cor = [31, 26, 20]; // o preto do quadro
        if (m.x > objeto.x0 && m.x < objeto.x1 && m.y > objeto.y0 && m.y < objeto.y1) {
          cor = [214, 158, 104]; // papel pardo: R − B = 110
        } else if (marcas.some((k) => Math.hypot(m.x - k.x, m.y - k.y) <= 10)) {
          cor = [248, 248, 248]; // marca branca
        }
      }
      dados[j] = cor[0];
      dados[j + 1] = cor[1];
      dados[j + 2] = cor[2];
      dados[j + 3] = 255;
    }
  }
  return { largura: LARGURA_PX, altura: ALTURA_PX, dados };
}

const diagonalReal = Math.hypot(OBJETO_REAL.larguraMM, OBJETO_REAL.alturaMM);

describe('Calibrar com objeto conhecido', () => {
  it('descobre o quadro de 1380 × 792 mm olhando um retângulo de 1150 × 600', () => {
    const img = fotoSintetica(10);
    const c = calibrarComObjeto(
      img,
      objetoConhecidoMM(
        OBJETO_REAL.larguraMM,
        OBJETO_REAL.alturaMM,
        diagonalReal,
        diagonalReal,
      ),
      { tenantId: 'confeccao-a' },
    );

    console.log('--- calibrar com objeto ---');
    console.log(
      `verdade: quadro ${QUADRO_REAL.larguraMM} × ${QUADRO_REAL.alturaMM} mm | ` +
        `objeto ${OBJETO_REAL.larguraMM} × ${OBJETO_REAL.alturaMM} mm`,
    );
    console.log(`manchas de papel na foto: ${c.manchasDePapel}`);
    console.log(
      `descoberto: ${(c.calibracao!.larguraUM / MM).toFixed(1)} × ` +
        `${(c.calibracao!.alturaUM / MM).toFixed(1)} mm`,
    );
    const erroL = c.calibracao!.larguraUM / MM - QUADRO_REAL.larguraMM;
    const erroA = c.calibracao!.alturaUM / MM - QUADRO_REAL.alturaMM;
    console.log(
      `erro: ${erroL.toFixed(2)} mm na largura (${((erroL / QUADRO_REAL.larguraMM) * 100).toFixed(3)}%), ` +
        `${erroA.toFixed(2)} mm na altura (${((erroA / QUADRO_REAL.alturaMM) * 100).toFixed(3)}%)`,
    );
    console.log(
      `conferencia independente da diagonal: ${(c.erroDaDiagonalUM! / MM).toFixed(2)} mm de erro`,
    );
    console.log(`resolucao: ${(c.umPorPixel / MM).toFixed(3)} mm por pixel`);
    console.log(`problemas: ${c.problemas.map((p) => p.codigo).join(', ') || 'nenhum'}`);

    expect(c.calibracao).not.toBeNull();
    // 0,5% em 1380 mm é 7 mm — folga larga de propósito: o objetivo aqui é provar a
    // CONTA, e o teto de precisão da imagem sintética é o pixel dela.
    expect(Math.abs(erroL)).toBeLessThan(0.005 * QUADRO_REAL.larguraMM);
    expect(Math.abs(erroA)).toBeLessThan(0.005 * QUADRO_REAL.alturaMM);
  });

  it('a mesma calibração sai de ângulos de foto diferentes', () => {
    const medidas = [0, 8, 16].map((graus) => {
      const c = calibrarComObjeto(
        fotoSintetica(graus),
        objetoConhecidoMM(OBJETO_REAL.larguraMM, OBJETO_REAL.alturaMM, diagonalReal, diagonalReal),
        { tenantId: 'confeccao-a' },
      );
      return { graus, c };
    });
    console.log('--- o angulo da foto nao muda a calibracao ---');
    for (const { graus, c } of medidas) {
      console.log(
        `${String(graus).padStart(2)} graus -> ${(c.calibracao!.larguraUM / MM).toFixed(1)} × ` +
          `${(c.calibracao!.alturaUM / MM).toFixed(1)} mm`,
      );
    }
    const larguras = medidas.map((m) => m.c.calibracao!.larguraUM / MM);
    const espalhamento = Math.max(...larguras) - Math.min(...larguras);
    console.log(`espalhamento entre os tres: ${espalhamento.toFixed(2)} mm`);
    expect(espalhamento).toBeLessThan(0.005 * QUADRO_REAL.larguraMM);
  });

  it('RECUSA quando a diagonal medida não bate — é a única conferência independente', () => {
    const img = fotoSintetica(10);
    // Diagonal 30 mm maior que a verdade: o objeto não seria retângulo.
    const c = calibrarComObjeto(
      img,
      objetoConhecidoMM(
        OBJETO_REAL.larguraMM,
        OBJETO_REAL.alturaMM,
        diagonalReal + 30,
        diagonalReal + 30,
      ),
      { tenantId: 'confeccao-a' },
    );
    console.log('--- a recusa pela diagonal ---');
    console.log(`"${c.problemas.find((p) => p.gravidade === 'erro')?.mensagem}"`);
    expect(c.calibracao).toBeNull();
    expect(c.problemas.some((p) => p.gravidade === 'erro')).toBe(true);
  });

  it('avisa quando a diagonal não foi medida — sem ela não há conferência', () => {
    const c = calibrarComObjeto(
      fotoSintetica(10),
      objetoConhecidoMM(OBJETO_REAL.larguraMM, OBJETO_REAL.alturaMM),
      { tenantId: 'confeccao-a' },
    );
    console.log(`sem diagonal -> ${c.problemas[0]?.codigo}: ${c.problemas[0]?.mensagem}`);
    expect(c.calibracao).not.toBeNull();
    expect(c.problemas.map((p) => p.codigo)).toContain('DIAGONAL_AUSENTE');
  });

  it('medida do objeto errada em 10% desloca a calibração em 10% — e a diagonal denuncia', () => {
    // A prova de que a conferência não é decorativa: se o operador digitar 1265 em
    // vez de 1150, a conta fecha lindamente e o quadro sai 10% maior. Quem pega é a
    // diagonal, que não entrou na conta.
    const c = calibrarComObjeto(
      fotoSintetica(10),
      objetoConhecidoMM(1265, OBJETO_REAL.alturaMM, diagonalReal, diagonalReal),
      { tenantId: 'confeccao-a' },
    );
    console.log('--- largura digitada errada (1265 em vez de 1150) ---');
    console.log(`calibracao aceita? ${c.calibracao !== null ? 'SIM' : 'NAO'}`);
    console.log(`"${c.problemas.find((p) => p.gravidade === 'erro')?.mensagem ?? '(sem erro)'}"`);
    expect(c.calibracao).toBeNull();
  });
});
