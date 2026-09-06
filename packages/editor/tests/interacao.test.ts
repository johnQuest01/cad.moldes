/**
 * Bloco 2 — hit-testing e snap (Parte 3).
 *
 * Os testes que mais importam sao os de PRIORIDADE. Um editor em que o cursor pega
 * a coisa errada e pior que um editor lento: o modelista arrasta o fio achando que
 * arrastou o contorno, e so descobre no corte.
 *
 * Tudo aqui roda headless: entra coordenada em UM, sai decisao.
 */
import { describe, expect, it } from 'vitest';

import { MM, pontoEmS, pontoEmT, umParaMM, type Vetor2 } from '@cad/motor';

import {
  Camadas,
  Cena,
  PASSO_DA_GRADE_UM,
  RAIOS_PX,
  SEM_MODIFICADOR,
  acharAlvo,
  acharSnap,
  type Alvo,
} from '../src/index.js';

import { PECA, sessaoDaBlusa } from './fixtures.js';

function novaCena(): { cena: Cena; camadas: Camadas } {
  return { cena: new Cena(sessaoDaBlusa()), camadas: new Camadas() };
}

/** Zoom de trabalho: 1 px por mm. Fica 1000 UM por pixel, que e conta redonda. */
const UM_POR_PIXEL = MM;

const descrever = (alvo: Alvo | null): string => {
  if (alvo === null) return 'nada';
  switch (alvo.tipo) {
    case 'ponto':
      return `ponto ${alvo.pontoId}`;
    case 'pique':
      return `pique ${alvo.piqueId}`;
    case 'aresta':
      return `aresta ${alvo.arestaId} em s=${alvo.s.toFixed(3)}`;
    case 'interna':
      return `interna ${alvo.linhaId}`;
    case 'controle':
      return `controle ${alvo.indice} de ${alvo.segmentoId}`;
    case 'peca':
      return `peca ${alvo.pecaId}`;
  }
};

describe('A cena e o cache dos derivados (E8)', () => {
  it('derivar dez vezes sem mudar nada calcula UMA vez; editar invalida', () => {
    const sessao = sessaoDaBlusa();
    const cena = new Cena(sessao);
    for (let i = 0; i < 10; i++) void cena.derivados(PECA);
    const depoisDeLer = cena.calculos;

    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-2', dx: 10 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });
    void cena.derivados(PECA);
    const depoisDeEditar = cena.calculos;

    console.log('--- cache dos derivados ---');
    console.log(`10 leituras sem editar -> ${depoisDeLer} calculo`);
    console.log(`1 edicao + 1 leitura   -> ${depoisDeEditar} calculos no total`);
    expect(depoisDeLer).toBe(1);
    expect(depoisDeEditar).toBe(2);
  });

  it('trocar o tamanho exibido recalcula, e a peca muda de tamanho (E9)', () => {
    const cena = new Cena(sessaoDaBlusa());
    const larguras: string[] = [];
    for (const tamanho of ['P', 'M', 'G']) {
      cena.tamanho = tamanho;
      const { contorno } = cena.derivados(PECA);
      const largura = Math.max(...contorno.map((p) => p.x)) - Math.min(...contorno.map((p) => p.x));
      larguras.push(`${tamanho} ${umParaMM(largura)} mm`);
    }
    console.log(`tamanho exibido: ${larguras.join(' | ')} | ${cena.calculos} calculos`);
    expect(cena.calculos).toBe(3);
  });

  it('a cena junta os problemas do validador para o painel de conferencia (E14)', () => {
    const cena = new Cena(sessaoDaBlusa());
    const codigos = cena.problemas.map((p) => `${p.gravidade}:${p.codigo}`);
    console.log(`problemas: ${codigos.join(', ') || 'nenhum'}`);
    // pt-0 e a ancora da graduacao: grade point sem regra e proposital (D7).
    expect(codigos.every((c) => c.startsWith('aviso'))).toBe(true);
  });
});

describe('Hit-testing: a ordem de prioridade e do alvo menor para o maior', () => {
  it('encostado num vertice, sai o VERTICE, nao a aresta que passa por ele', () => {
    const { cena, camadas } = novaCena();
    // pt-3 e o ombro de fora, em (150, 430) mm. 2 mm de folga.
    const alvo = acharAlvo(cena, camadas, { x: 152 * MM, y: 431 * MM }, 10 * UM_POR_PIXEL);
    console.log('--- prioridade ---');
    console.log(`2 mm do ombro de fora -> ${descrever(alvo)}`);
    expect(alvo?.tipo).toBe('ponto');
    if (alvo?.tipo === 'ponto') expect(alvo.pontoId).toBe('pt-3');
  });

  it('no meio de um lado, sai a ARESTA, com s e segmento', () => {
    const { cena, camadas } = novaCena();
    const alvo = acharAlvo(cena, camadas, { x: 186 * MM, y: 150 * MM }, 10 * UM_POR_PIXEL);
    console.log(`no meio da lateral -> ${descrever(alvo)}`);
    expect(alvo?.tipo).toBe('aresta');
    if (alvo?.tipo === 'aresta') {
      expect(alvo.arestaId).toBe('ar-lateral');
      expect(alvo.s).toBeGreaterThan(0.4);
      expect(alvo.s).toBeLessThan(0.6);
    }
  });

  it('dentro da peca e longe de tudo, sai a PECA', () => {
    const { cena, camadas } = novaCena();
    const alvo = acharAlvo(cena, camadas, { x: 60 * MM, y: 200 * MM }, 10 * UM_POR_PIXEL);
    console.log(`no meio do tecido -> ${descrever(alvo)}`);
    expect(alvo?.tipo).toBe('peca');
  });

  it('fora de tudo, nao sai nada', () => {
    const { cena, camadas } = novaCena();
    const alvo = acharAlvo(cena, camadas, { x: 900 * MM, y: 900 * MM }, 10 * UM_POR_PIXEL);
    console.log(`a 90 cm da peca -> ${descrever(alvo)}`);
    expect(alvo).toBeNull();
  });

  it('o pique ganha da aresta em que ele esta cravado', () => {
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'AdicionarPique',
      pecaId: PECA,
      payload: {
        piqueId: 'pq-1',
        arestaId: 'ar-lateral',
        s: 0.5,
        tipo: 'V',
        alturaUM: 6350,
        larguraUM: 1590,
        anguloGraus: 0,
      },
    });
    const cena = new Cena(sessao);
    const camadas = new Camadas();
    const [, projetado] = cena.derivados(PECA).piques[0]!;
    const naCostura = projetado.pontoDaCostura;

    const comPique = acharAlvo(cena, camadas, naCostura, 10 * UM_POR_PIXEL);
    camadas.travar('pique', true);
    const semPique = acharAlvo(cena, camadas, naCostura, 10 * UM_POR_PIXEL);

    console.log(
      `em cima do pique -> ${descrever(comPique)} | com a camada travada -> ${descrever(semPique)}`,
    );
    expect(comPique?.tipo).toBe('pique');
    expect(semPique?.tipo).toBe('aresta');
  });

  it('o fio so e alvo quando a camada interna esta destravada', () => {
    const { cena, camadas } = novaCena();
    const noFio = { x: 91 * MM, y: 200 * MM };
    const destravada = acharAlvo(cena, camadas, noFio, 10 * UM_POR_PIXEL);
    camadas.travar('interna', true);
    const travada = acharAlvo(cena, camadas, noFio, 10 * UM_POR_PIXEL);

    console.log('--- camada travada ---');
    console.log(`1 mm do fio: destravada -> ${descrever(destravada)} | travada -> ${descrever(travada)}`);
    expect(destravada?.tipo).toBe('interna');
    expect(travada?.tipo).toBe('peca');
  });

  it('a alca de controle so aparece no segmento selecionado, e ganha de tudo', () => {
    const { cena, camadas } = novaCena();
    const controle = cena.derivados(PECA).peca.segmentos['sg-2']!.controles![0];
    const semSelecao = acharAlvo(cena, camadas, controle, 10 * UM_POR_PIXEL);
    const comSelecao = acharAlvo(cena, camadas, controle, 10 * UM_POR_PIXEL, {
      comControleVisivel: new Set(['sg-2']),
    });

    console.log(
      `no controle da cava: sem selecao -> ${descrever(semSelecao)} | ` +
        `com sg-2 selecionado -> ${descrever(comSelecao)}`,
    );
    expect(semSelecao?.tipo).not.toBe('controle');
    expect(comSelecao?.tipo).toBe('controle');
  });

  it('o raio de captura acompanha o zoom: o que pega afastado nao pega de perto', () => {
    const { cena, camadas } = novaCena();
    const alvo = { x: 158 * MM, y: 434 * MM }; // ~8.9 mm do ombro em (150, 430)
    const afastado = acharAlvo(cena, camadas, alvo, 10 * MM); // 1 px = 1 mm
    const deperto = acharAlvo(cena, camadas, alvo, 10 * (MM / 8)); // zoom 8x

    console.log('--- raio de captura x zoom ---');
    console.log(`a 8.9 mm do ombro: zoom 1x -> ${descrever(afastado)} | zoom 8x -> ${descrever(deperto)}`);
    expect(afastado?.tipo).toBe('ponto');
    expect(deperto?.tipo).not.toBe('ponto');
  });
});

describe('Snap: a ordem e de PRIORIDADE, nao de proximidade', () => {
  it('um vertice a 8 px ganha de um ponto de grade a 2 px — os dois estao no raio', () => {
    const { cena, camadas } = novaCena();
    // pt-2 (o canto da lateral com a cava) fica em (190, 300) mm; o ponto de grade
    // mais proximo e (200, 300). O cursor cai perto dos DOIS, e mais perto da grade.
    const cursor: Vetor2 = { x: 198 * MM, y: 300 * MM };
    const aoVertice = umParaMM(Math.hypot(cursor.x - 190 * MM, cursor.y - 300 * MM));
    const aGrade = umParaMM(Math.hypot(cursor.x - 200 * MM, cursor.y - 300 * MM));

    const snap = acharSnap(cena, camadas, cursor, UM_POR_PIXEL);
    console.log('--- prioridade do snap ---');
    console.log(
      `cursor a ${aoVertice} mm do vertice (raio 12 px) e a ${aGrade} mm da grade (raio 6 px)`,
    );
    console.log(
      `-> ganhou ${snap?.tipo} em (${umParaMM(snap!.ponto.x)}, ${umParaMM(snap!.ponto.y)}) mm ` +
        `— prioridade, nao proximidade`,
    );
    expect(aoVertice).toBeGreaterThan(aGrade);
    expect(snap?.tipo).toBe('vertice');
    expect(snap?.ponto).toEqual({ x: 190 * MM, y: 300 * MM });
  });

  it('Alt segurado desliga TODO snap', () => {
    const { cena, camadas } = novaCena();
    const emCima = { x: 180 * MM, y: 0 };
    const com = acharSnap(cena, camadas, emCima, UM_POR_PIXEL);
    const sem = acharSnap(cena, camadas, emCima, UM_POR_PIXEL, { ...SEM_MODIFICADOR, alt: true });
    console.log(`em cima do vertice: sem Alt -> ${com?.tipo} | com Alt -> ${sem === null ? 'nada' : sem.tipo}`);
    expect(com?.tipo).toBe('vertice');
    expect(sem).toBeNull();
  });

  it('longe de tudo, sobra a grade de 5 cm', () => {
    const { cena, camadas } = novaCena();
    const snap = acharSnap(cena, camadas, { x: 98 * MM, y: 202 * MM }, UM_POR_PIXEL, SEM_MODIFICADOR, {
      ligados: new Set(['vertice', 'grade']),
    });
    console.log(
      `cursor em (98, 202) mm -> ${snap?.tipo} em ` +
        `(${umParaMM(snap!.ponto.x)}, ${umParaMM(snap!.ponto.y)}) mm | passo ${umParaMM(PASSO_DA_GRADE_UM)} mm`,
    );
    expect(snap?.tipo).toBe('grade');
    expect(snap?.ponto).toEqual({ x: 100 * MM, y: 200 * MM });
  });

  it('o snap ortogonal precisa de origem, e prende em 0, 45 e 90', () => {
    const { cena, camadas } = novaCena();
    const origem = { x: 90 * MM, y: 100 * MM };
    const semOrigem = acharSnap(cena, camadas, { x: 140 * MM, y: 103 * MM }, UM_POR_PIXEL, SEM_MODIFICADOR, {
      ligados: new Set(['ortogonal']),
    });
    const comOrigem = acharSnap(
      cena,
      camadas,
      { x: 140 * MM, y: 103 * MM },
      UM_POR_PIXEL,
      SEM_MODIFICADOR,
      { ligados: new Set(['ortogonal']), origem },
    );
    console.log('--- ortogonal ---');
    console.log(`sem origem -> ${semOrigem === null ? 'nada' : semOrigem.tipo}`);
    console.log(
      `com origem, cursor 3 mm acima da horizontal -> ${comOrigem?.anguloGraus}graus em ` +
        `(${umParaMM(comOrigem!.ponto.x)}, ${umParaMM(comOrigem!.ponto.y)}) mm`,
    );
    expect(semOrigem).toBeNull();
    expect(comOrigem?.anguloGraus).toBe(0);
    expect(comOrigem?.ponto.y).toBe(100 * MM);
  });

  it('no contorno, mas longe de vertice e de meio, sobra `noContorno`', () => {
    const { cena, camadas } = novaCena();
    const snap = acharSnap(cena, camadas, { x: 184 * MM, y: 80 * MM }, UM_POR_PIXEL);
    console.log(
      `no meio-baixo da lateral -> ${snap?.tipo} em ` +
        `(${umParaMM(snap!.ponto.x).toFixed(1)}, ${umParaMM(snap!.ponto.y).toFixed(1)}) mm`,
    );
    expect(snap?.tipo).toBe('noContorno');
  });

  it('o eixo de dobra tem snap proprio', () => {
    const { cena, camadas } = novaCena();
    const snap = acharSnap(cena, camadas, { x: 3 * MM, y: 220 * MM }, UM_POR_PIXEL, SEM_MODIFICADOR, {
      ligados: new Set(['eixo']),
    });
    console.log(`3 mm do eixo de dobra -> ${snap?.tipo} ${snap?.eixoId} em x = ${umParaMM(snap!.ponto.x)} mm`);
    expect(snap?.tipo).toBe('eixo');
    expect(snap?.ponto.x).toBe(0);
  });
});

describe('O snap de meio e por comprimento de ARCO — e nao pelo t da Bezier', () => {
  it('na cava, o meio por arco e o ponto de t = 0.5 sao lugares DIFERENTES', () => {
    const { cena, camadas } = novaCena();
    const peca = cena.derivados(PECA).peca;

    const porArco = pontoEmS(peca, 'ar-cava', 0.5);
    const segmento = peca.segmentos['sg-2']!;
    const porT = pontoEmT(
      [
        peca.pontos[segmento.de]!,
        segmento.controles![0],
        segmento.controles![1],
        peca.pontos[segmento.para]!,
      ],
      0.5,
    );
    const diferenca = Math.hypot(porArco.x - porT.x, porArco.y - porT.y);

    console.log('--- meio por arco x t = 0.5 (bonus da D1) ---');
    console.log(`por ARCO   (${umParaMM(porArco.x).toFixed(2)}, ${umParaMM(porArco.y).toFixed(2)}) mm`);
    console.log(`por t=0.5  (${umParaMM(porT.x).toFixed(2)}, ${umParaMM(porT.y).toFixed(2)}) mm`);
    console.log(`distancia entre os dois: ${umParaMM(diferenca).toFixed(3)} mm`);

    const snap = acharSnap(cena, camadas, porArco, UM_POR_PIXEL, SEM_MODIFICADOR, {
      ligados: new Set(['meio']),
    });
    console.log(`o snap de meio cai no de ARCO: ${snap?.ponto.x === porArco.x && snap.ponto.y === porArco.y}`);

    expect(diferenca).toBeGreaterThan(0);
    expect(snap?.tipo).toBe('meio');
    expect(snap?.arestaId).toBe('ar-cava');
    expect(snap?.ponto).toEqual(porArco);
  });
});

describe('Os raios sao em pixels — constantes na tela', () => {
  it('a tabela de raios cobre os sete tipos, e o mesmo gesto agarra em qualquer zoom', () => {
    const { cena, camadas } = novaCena();
    console.log('--- raios (px) ---');
    console.log(RAIOS_PX.map(([tipo, px]) => `${tipo} ${px}`).join(' | '));

    // Um cursor a 10 px do vertice tem que agarrar em qualquer zoom, porque 10 px
    // e 10 px. Em UM, essa mesma distancia muda com o zoom.
    for (const umPorPixel of [MM * 4, MM, MM / 4, MM / 16]) {
      const dez = 10 * umPorPixel;
      const snap = acharSnap(cena, camadas, { x: 180 * MM + dez, y: 0 }, umPorPixel, SEM_MODIFICADOR, {
        ligados: new Set(['vertice']),
      });
      console.log(
        `${(MM / umPorPixel).toFixed(2)} px/mm: 10 px = ${umParaMM(dez).toFixed(2)} mm -> ${snap?.tipo ?? 'nada'}`,
      );
      expect(snap?.tipo).toBe('vertice');
    }
    expect(RAIOS_PX).toHaveLength(7);
  });
});
