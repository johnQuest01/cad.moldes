/**
 * Testes 6 e 7 (Parte 5): modificar ponto nos modos discreto e proporcional.
 *
 * O teste 7 exige conferir os NUMEROS da funcao de decaimento, nao olhar e achar
 * que "parece suave". Para N = 3 os fatores sao, exatos:
 *
 *     f(1) = (1 + cos(pi/4))/2   = 0,8535533905932737
 *     f(2) = (1 + cos(pi/2))/2   = 0,5
 *     f(3) = (1 + cos(3pi/4))/2  = 0,1464466094067263
 *
 * Com dx = 10 mm = 10000 UM isso da 8536, 5000 e 1464 UM depois do arredondamento
 * para micrometro inteiro.
 */
import { describe, expect, it } from 'vitest';

import { ErroMotor } from '../src/erros.js';
import type { CodigoErro } from '../src/erros.js';
import { fold, reconstruir } from '../src/eventos/fold.js';
import type { Evento } from '../src/eventos/tipos.js';
import { fatorDeDecaimento, modificarPonto } from '../src/edicao.js';
import type { Modelo, Peca, Vetor2 } from '../src/tipos.js';
import { MM } from '../src/unidades.js';
import {
  AUTOR,
  logPoligonoLivre,
  logQuartoDeCirculo,
  MODELO_ID,
  PECA_ID,
  TENANT,
} from './fixtures.js';

const LADOS = 9;
const RAIO: number = 100 * MM;
const DX: number = 10 * MM;

/** Nove-gono regular: pontos suficientes para N = 4 vizinhos de cada lado caberem. */
function noveGono(): Vetor2[] {
  return Array.from({ length: LADOS }, (_, i) => {
    const angulo = (2 * Math.PI * i) / LADOS;
    return { x: Math.round(RAIO * Math.cos(angulo)), y: Math.round(RAIO * Math.sin(angulo)) };
  });
}

function pecaNoveGono(): Peca {
  return reconstruir(logPoligonoLivre(noveGono(), 0)).pecas[PECA_ID]!;
}

function codigoDoErro(acao: () => unknown): CodigoErro | null {
  try {
    acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroMotor) return erro.codigo;
    throw erro;
  }
}

/** Deslocamento de cada ponto entre duas versoes da peca. */
function deslocamentos(antes: Peca, depois: Peca): Map<string, Vetor2> {
  const mapa = new Map<string, Vetor2>();
  for (const id of Object.keys(antes.pontos)) {
    mapa.set(id, {
      x: depois.pontos[id]!.x - antes.pontos[id]!.x,
      y: depois.pontos[id]!.y - antes.pontos[id]!.y,
    });
  }
  return mapa;
}

describe('Teste 6 — modo discreto', () => {
  it('move so o ponto alvo; todos os vizinhos ficam nas coordenadas originais', () => {
    const antes = pecaNoveGono();
    const depois = modificarPonto(antes, 'pt-0', DX, 0, 'discreto', 3);
    const andou = deslocamentos(antes, depois);

    console.log('--- TESTE 6 (discreto, dx = 10 mm em pt-0, N = 3 ignorado) ---');
    for (const [id, d] of andou) console.log(`  ${id}: (${d.x}, ${d.y}) UM`);

    expect(andou.get('pt-0')).toEqual({ x: DX, y: 0 });
    for (let i = 1; i < LADOS; i++) {
      expect(andou.get(`pt-${i}`)).toEqual({ x: 0, y: 0 });
      // Comparacao exata da coordenada, nao so do delta.
      expect(depois.pontos[`pt-${i}`]).toEqual(antes.pontos[`pt-${i}`]);
    }
  });

  it('a curva acompanha o extremo que se moveu, em vez de descolar dele', () => {
    // Nao e contradicao com "so o ponto alvo muda": os controles nao sao pontos do
    // contorno. Se ficassem parados, a tangente da curva no extremo giraria sozinha.
    // A regra e a mesma da graduacao (deslocar.ts): 1/3 e 2/3 entre os extremos.
    const antes = reconstruir(logQuartoDeCirculo(RAIO)).pecas[PECA_ID]!;
    const depois = modificarPonto(antes, 'pt-0', DX, 0, 'discreto', 0);

    const c0 = antes.segmentos['sg-0']!.controles!;
    const c1 = depois.segmentos['sg-0']!.controles!;
    const passo0 = { x: c1[0].x - c0[0].x, y: c1[0].y - c0[0].y };
    const passo1 = { x: c1[1].x - c0[1].x, y: c1[1].y - c0[1].y };

    console.log('--- controles da Bezier no modo discreto (pt-0 anda 10 mm, pt-1 parado) ---');
    console.log(`  controle[0]: (${passo0.x}, ${passo0.y}) UM  (esperado 2/3 de 10000 = 6667)`);
    console.log(`  controle[1]: (${passo1.x}, ${passo1.y}) UM  (esperado 1/3 de 10000 = 3333)`);

    expect(passo0).toEqual({ x: Math.round((DX * 2) / 3), y: 0 });
    expect(passo1).toEqual({ x: Math.round(DX / 3), y: 0 });
    expect(depois.pontos['pt-1']).toEqual(antes.pontos['pt-1']);
  });
});

describe('Teste 7 — modo proporcional', () => {
  it('alvo anda o valor cheio, vizinhos andam f(i), e fora do alcance ninguem anda', () => {
    const antes = pecaNoveGono();
    const depois = modificarPonto(antes, 'pt-0', DX, 0, 'proporcional', 3);
    const andou = deslocamentos(antes, depois);

    const esperado = [
      Math.round(DX * fatorDeDecaimento(1, 3)),
      Math.round(DX * fatorDeDecaimento(2, 3)),
      Math.round(DX * fatorDeDecaimento(3, 3)),
    ];

    console.log('--- TESTE 7 (proporcional, dx = 10 mm em pt-0, N = 3) ---');
    console.log(
      `fatores: f(1) = ${fatorDeDecaimento(1, 3)} | f(2) = ${fatorDeDecaimento(2, 3)} | ` +
        `f(3) = ${fatorDeDecaimento(3, 3)}`,
    );
    console.log(`esperado em UM: alvo ${DX} | ${esperado.join(' | ')} | 0 fora do alcance`);
    for (let i = 0; i < LADOS; i++) {
      const d = andou.get(`pt-${i}`)!;
      console.log(`  pt-${i}: (${d.x}, ${d.y}) UM`);
    }

    expect(andou.get('pt-0')).toEqual({ x: DX, y: 0 });
    expect(esperado).toEqual([8536, 5000, 1464]);

    // Vizinhos i = 1, 2, 3 de cada lado, com o mesmo fator dos dois lados.
    for (let i = 1; i <= 3; i++) {
      expect(andou.get(`pt-${i}`)).toEqual({ x: esperado[i - 1]!, y: 0 });
      expect(andou.get(`pt-${LADOS - i}`)).toEqual({ x: esperado[i - 1]!, y: 0 });
    }
    // Alem do vizinho 3 ninguem se move.
    expect(andou.get('pt-4')).toEqual({ x: 0, y: 0 });
    expect(andou.get('pt-5')).toEqual({ x: 0, y: 0 });
  });

  it('N = 1 move o vizinho exatamente pela metade', () => {
    const antes = pecaNoveGono();
    const andou = deslocamentos(antes, modificarPonto(antes, 'pt-0', DX, 0, 'proporcional', 1));
    console.log(
      `N = 1: f(1) = ${fatorDeDecaimento(1, 1)} -> vizinhos andam ${andou.get('pt-1')!.x} UM ` +
        `(metade de ${DX})`,
    );
    expect(andou.get('pt-1')).toEqual({ x: DX / 2, y: 0 });
    expect(andou.get('pt-8')).toEqual({ x: DX / 2, y: 0 });
    expect(andou.get('pt-2')).toEqual({ x: 0, y: 0 });
  });

  it('N = 0 no modo proporcional e igual ao discreto', () => {
    const antes = pecaNoveGono();
    const proporcional = modificarPonto(antes, 'pt-0', DX, 0, 'proporcional', 0);
    const discreto = modificarPonto(antes, 'pt-0', DX, 0, 'discreto', 0);
    console.log(`N = 0 proporcional == discreto: ${JSON.stringify(proporcional) === JSON.stringify(discreto)}`);
    expect(proporcional).toEqual(discreto);
  });

  it('a formula e simetrica: f(i) + f(N+1-i) = 1 para qualquer N', () => {
    // Consequencia de cos(pi - x) = -cos(x). Se a formula for trocada por outra
    // "parecida", esta identidade quebra.
    let piorDesvio = 0;
    for (let n = 1; n <= 40; n++) {
      for (let i = 1; i <= n; i++) {
        piorDesvio = Math.max(
          piorDesvio,
          Math.abs(fatorDeDecaimento(i, n) + fatorDeDecaimento(n + 1 - i, n) - 1),
        );
        // Decrescente: o vizinho mais longe nunca anda mais que o mais perto.
        if (i > 1) {
          expect(fatorDeDecaimento(i, n)).toBeLessThan(fatorDeDecaimento(i - 1, n));
        }
      }
    }
    console.log(
      `simetria f(i) + f(N+1-i) = 1 em N = 1..40: pior desvio ${piorDesvio.toExponential(2)}`,
    );
    console.log(`f(0) = ${fatorDeDecaimento(0, 5)} (alvo) | f(N+1) = ${fatorDeDecaimento(6, 5)} (fora)`);
    expect(piorDesvio).toBeLessThan(1e-15);
    expect(fatorDeDecaimento(0, 5)).toBe(1);
    expect(Math.abs(fatorDeDecaimento(6, 5))).toBeLessThan(1e-15);
  });
});

describe('Modificar ponto — evento e recusas', () => {
  it('o evento ModificarPonto produz exatamente o mesmo estado da chamada direta', () => {
    const log = logPoligonoLivre(noveGono(), 0);
    const modelo = reconstruir(log);
    const evento: Evento = {
      id: 'evt-modificar',
      tenantId: TENANT,
      modeloId: MODELO_ID,
      pecaId: PECA_ID,
      timestamp: '2026-08-28T12:00:00.000Z',
      autor: AUTOR,
      versaoSchema: 1,
      tipo: 'ModificarPonto',
      payload: { pontoId: 'pt-0', dx: DX, dy: 0, modo: 'proporcional', nVizinhos: 3 },
    };

    const pelaFold = fold(modelo, evento).pecas[PECA_ID]!;
    const direto = modificarPonto(modelo.pecas[PECA_ID]!, 'pt-0', DX, 0, 'proporcional', 3);
    console.log(`fold(ModificarPonto) == modificarPonto(): ${JSON.stringify(pelaFold) === JSON.stringify(direto)}`);
    expect(pelaFold).toEqual(direto);

    // E o replay continua deterministico.
    const comEvento: Evento[] = [...log, evento];
    expect(reconstruir(comEvento)).toEqual(reconstruir(comEvento));
  });

  it('recusa N que faz a influencia dar a volta no contorno', () => {
    const peca = pecaNoveGono();
    // 9 vertices: N = 4 alcanca 9 pontos e ainda cabe; N = 5 alcancaria 11.
    const cabe = codigoDoErro(() => modificarPonto(peca, 'pt-0', DX, 0, 'proporcional', 4));
    const naoCabe = codigoDoErro(() => modificarPonto(peca, 'pt-0', DX, 0, 'proporcional', 5));
    console.log(`contorno com ${LADOS} vertices: N = 4 -> ${String(cabe)} | N = 5 -> ${naoCabe}`);
    expect(cabe).toBeNull();
    expect(naoCabe).toBe('N_VIZINHOS_EXCEDE_CONTORNO');
  });

  it('recusa N negativo e N fracionario', () => {
    const peca = pecaNoveGono();
    for (const n of [-1, 1.5, Number.NaN]) {
      const codigo = codigoDoErro(() => modificarPonto(peca, 'pt-0', DX, 0, 'proporcional', n));
      console.log(`N = ${String(n).padEnd(4)} -> ${String(codigo)}`);
      expect(codigo).toBe('N_VIZINHOS_INVALIDO');
    }
  });

  it('recusa delta que nao e micrometro inteiro', () => {
    const peca = pecaNoveGono();
    const codigo = codigoDoErro(() => modificarPonto(peca, 'pt-0', 10.5, 0, 'discreto', 0));
    console.log(`dx = 10,5 UM (float de mm vazando) -> ${codigo}`);
    expect(codigo).toBe('UM_NAO_INTEIRO');
  });

  it('recusa ponto inexistente e, no proporcional, ponto fora do contorno', () => {
    const peca = pecaNoveGono();
    expect(codigoDoErro(() => modificarPonto(peca, 'pt-fantasma', DX, 0, 'discreto', 0))).toBe(
      'PONTO_INEXISTENTE',
    );

    const comSolto: Peca = {
      ...peca,
      pontos: {
        ...peca.pontos,
        'pt-solto': { id: 'pt-solto', x: 0, y: 0, tipo: 'construcao' },
      },
    };
    const codigo = codigoDoErro(() =>
      modificarPonto(comSolto, 'pt-solto', DX, 0, 'proporcional', 2),
    );
    console.log(`ponto de construcao fora do contorno, no proporcional -> ${codigo}`);
    expect(codigo).toBe('PONTO_FORA_DO_CONTORNO');
    // No discreto ele pode andar: nao ha vizinhanca a propagar.
    expect(codigoDoErro(() => modificarPonto(comSolto, 'pt-solto', DX, 0, 'discreto', 0))).toBeNull();
  });
});
