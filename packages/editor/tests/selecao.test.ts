/**
 * Bloco 3 — selecao (Parte 3).
 *
 * O teste que carrega a parte e o do marquee: a MESMA caixa tem que pegar
 * conjuntos diferentes conforme o sentido do arrasto. Errar isso nao quebra nada
 * visivelmente — so faz o modelista pegar peca a mais ou a menos o dia inteiro, e
 * culpar a propria mao.
 */
import { describe, expect, it } from 'vitest';

import { MM, umParaMM, type Vetor2 } from '@cad/motor';

import {
  Camadas,
  Cena,
  SEM_MODIFICADOR,
  Selecao,
  acharAlvo,
  caixaDoMarquee,
  chaveDa,
  type Referencia,
} from '../src/index.js';

import { PECA, VERTICES, sessaoDaBlusa } from './fixtures.js';

const UM_POR_PIXEL = MM;
const SHIFT = { ...SEM_MODIFICADOR, shift: true };
const CTRL = { ...SEM_MODIFICADOR, ctrl: true };

function novo(): { cena: Cena; camadas: Camadas; selecao: Selecao } {
  return { cena: new Cena(sessaoDaBlusa()), camadas: new Camadas(), selecao: new Selecao() };
}

const resumir = (itens: readonly Referencia[]): string =>
  itens.length === 0 ? 'nada' : itens.map((i) => chaveDa(i).replace(/\|pec-frente/, '')).join(', ');

const contar = (itens: readonly Referencia[], tipo: Referencia['tipo']): number =>
  itens.filter((i) => i.tipo === tipo).length;

describe('Clique, Shift e Ctrl', () => {
  it('clique substitui; no vazio, limpa', () => {
    const { cena, camadas, selecao } = novo();
    const ombro = acharAlvo(cena, camadas, VERTICES[3]!, 10 * UM_POR_PIXEL)!;
    const decote = acharAlvo(cena, camadas, VERTICES[4]!, 10 * UM_POR_PIXEL)!;

    selecao.clicar(ombro, SEM_MODIFICADOR);
    const primeiro = resumir(selecao.itens);
    selecao.clicar(decote, SEM_MODIFICADOR);
    const segundo = resumir(selecao.itens);
    selecao.clicar(null, SEM_MODIFICADOR);

    console.log('--- clique ---');
    console.log(`clicou no ombro  -> ${primeiro}`);
    console.log(`clicou no decote -> ${segundo} (substituiu)`);
    console.log(`clicou no vazio  -> ${resumir(selecao.itens)}`);
    expect(selecao.vazia).toBe(true);
  });

  it('Shift alterna: entra na primeira vez, sai na segunda', () => {
    const { cena, camadas, selecao } = novo();
    const ombro = acharAlvo(cena, camadas, VERTICES[3]!, 10 * UM_POR_PIXEL)!;
    const decote = acharAlvo(cena, camadas, VERTICES[4]!, 10 * UM_POR_PIXEL)!;

    selecao.clicar(ombro, SEM_MODIFICADOR);
    selecao.clicar(decote, SHIFT);
    const dois = selecao.tamanho;
    selecao.clicar(decote, SHIFT);

    console.log(`shift-clique: 1 -> ${dois} -> ${selecao.tamanho} (o segundo tirou)`);
    expect(dois).toBe(2);
    expect(selecao.tamanho).toBe(1);
  });

  it('Ctrl acrescenta e nao tira; clique no vazio com modificador nao limpa', () => {
    const { cena, camadas, selecao } = novo();
    const ombro = acharAlvo(cena, camadas, VERTICES[3]!, 10 * UM_POR_PIXEL)!;

    selecao.clicar(ombro, CTRL);
    selecao.clicar(ombro, CTRL);
    const semRepetir = selecao.tamanho;
    selecao.clicar(null, SHIFT);

    console.log(`ctrl-clique duas vezes no mesmo: ${semRepetir} item | vazio com shift: ${selecao.tamanho}`);
    expect(semRepetir).toBe(1);
    expect(selecao.tamanho).toBe(1);
  });
});

describe('Marquee: janela x cruzamento — a MESMA caixa, dois resultados', () => {
  /** Uma caixa que engole o topo da blusa e corta a lateral no meio. */
  const CANTO_A: Vetor2 = { x: -20 * MM, y: 250 * MM };
  const CANTO_B: Vetor2 = { x: 210 * MM, y: 480 * MM };

  it('o sentido do arrasto escolhe o modo', () => {
    const daEsquerda = caixaDoMarquee(CANTO_A, CANTO_B);
    const daDireita = caixaDoMarquee(CANTO_B, CANTO_A);
    console.log('--- sentido ---');
    console.log(`esquerda -> direita: ${daEsquerda.modo} | direita -> esquerda: ${daDireita.modo}`);
    console.log(
      `a caixa e a mesma nos dois: ${JSON.stringify(daEsquerda.caixa) === JSON.stringify(daDireita.caixa)}`,
    );
    expect(daEsquerda.modo).toBe('janela');
    expect(daDireita.modo).toBe('cruzamento');
    expect(daEsquerda.caixa).toEqual(daDireita.caixa);
  });

  it('cruzamento pega MAIS que janela, e o extra e o que a caixa so encosta', () => {
    const { cena, camadas, selecao } = novo();

    const modoJanela = selecao.marquee(cena, camadas, CANTO_A, CANTO_B, SEM_MODIFICADOR);
    const janela = [...selecao.itens];
    const modoCruzamento = selecao.marquee(cena, camadas, CANTO_B, CANTO_A, SEM_MODIFICADOR);
    const cruzamento = [...selecao.itens];

    const so = (itens: readonly Referencia[]) =>
      `${contar(itens, 'ponto')} pontos, ${contar(itens, 'aresta')} arestas, ` +
      `${contar(itens, 'interna')} internas`;

    console.log('--- marquee ---');
    console.log(`caixa de (-20, 250) a (210, 480) mm, sobre a metade de cima da blusa`);
    console.log(`${modoJanela.padEnd(11)}: ${janela.length} itens — ${so(janela)}`);
    console.log(`${modoCruzamento.padEnd(11)}: ${cruzamento.length} itens — ${so(cruzamento)}`);

    const soNoCruzamento = cruzamento
      .filter((c) => !janela.some((j) => chaveDa(j) === chaveDa(c)))
      .map((c) => chaveDa(c).replace(/\|pec-frente/, ''));
    console.log(`so no cruzamento: ${soNoCruzamento.join(', ')}`);

    expect(cruzamento.length).toBeGreaterThan(janela.length);
    // O ombro, o decote e o topo da lateral estao inteiros dentro: os dois pegam.
    expect(contar(janela, 'ponto')).toBeGreaterThan(0);
    // A bainha esta toda fora: nenhum dos dois pega.
    expect(cruzamento.some((r) => r.tipo === 'aresta' && r.arestaId === 'ar-bainha')).toBe(false);
  });

  it('uma caixa pequena NO MEIO de uma aresta pega ela por cruzamento, e nada por janela', () => {
    const { cena, camadas, selecao } = novo();
    // A lateral vai de (180, 0) a (190, 300). Uma caixinha de 6 mm em cima dela.
    const a: Vetor2 = { x: 182 * MM, y: 148 * MM };
    const b: Vetor2 = { x: 188 * MM, y: 154 * MM };

    selecao.marquee(cena, camadas, a, b, SEM_MODIFICADOR);
    const janela = selecao.tamanho;
    selecao.marquee(cena, camadas, b, a, SEM_MODIFICADOR);
    const cruzamento = [...selecao.itens];

    console.log(
      `caixinha de 6 x 6 mm em cima da lateral: janela -> ${janela} | ` +
        `cruzamento -> ${resumir(cruzamento)}`,
    );
    expect(janela).toBe(0);
    expect(cruzamento.some((r) => r.tipo === 'aresta' && r.arestaId === 'ar-lateral')).toBe(true);
  });

  it('a peca so entra quando pedida, e camada travada some do marquee', () => {
    const { cena, camadas, selecao } = novo();
    const tudo: Vetor2 = { x: -50 * MM, y: -50 * MM };
    const outro: Vetor2 = { x: 250 * MM, y: 500 * MM };

    selecao.marquee(cena, camadas, tudo, outro, SEM_MODIFICADOR);
    const semPeca = contar(selecao.itens, 'peca');
    selecao.marquee(cena, camadas, tudo, outro, SEM_MODIFICADOR, ['peca']);
    const soPeca = resumir(selecao.itens);

    camadas.travar('costura', true);
    selecao.marquee(cena, camadas, tudo, outro, SEM_MODIFICADOR);
    const travada = [...selecao.itens];

    console.log('--- o que o marquee recolhe ---');
    console.log(`padrao: ${semPeca} pecas | pedindo peca: ${soPeca}`);
    console.log(`com a camada costura travada: ${resumir(travada)} (so o que nao e da costura)`);
    expect(semPeca).toBe(0);
    expect(soPeca).toBe('peca');
    expect(travada.every((r) => r.tipo === 'interna' || r.tipo === 'pique')).toBe(true);
  });

  it('com Shift, o marquee acrescenta em vez de substituir', () => {
    const { cena, camadas, selecao } = novo();
    const perto = (v: Vetor2, d: number): Vetor2 => ({ x: v.x + d, y: v.y + d });

    selecao.marquee(
      cena,
      camadas,
      perto(VERTICES[3]!, -3 * MM),
      perto(VERTICES[3]!, 3 * MM),
      SEM_MODIFICADOR,
    );
    const primeiro = selecao.tamanho;
    selecao.marquee(
      cena,
      camadas,
      perto(VERTICES[4]!, -3 * MM),
      perto(VERTICES[4]!, 3 * MM),
      SHIFT,
    );

    console.log(`marquee no ombro: ${primeiro} | + shift-marquee no decote: ${selecao.tamanho}`);
    expect(selecao.tamanho).toBeGreaterThan(primeiro);
  });
});

describe('A selecao guarda REFERENCIA, nao coordenada', () => {
  it('o ponto selecionado continua selecionado depois de ser arrastado', () => {
    const sessao = sessaoDaBlusa();
    const cena = new Cena(sessao);
    const camadas = new Camadas();
    const selecao = new Selecao();

    selecao.clicar(acharAlvo(cena, camadas, VERTICES[3]!, 10 * UM_POR_PIXEL), SEM_MODIFICADOR);
    const antes = resumir(selecao.itens);

    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-3', dx: 25 * MM, dy: 15 * MM, modo: 'discreto', nVizinhos: 0 },
    });
    const ponto = cena.derivados(PECA).peca.pontos['pt-3']!;

    console.log('--- referencia sobrevive a edicao ---');
    console.log(
      `antes ${antes} | o ponto foi para (${umParaMM(ponto.x)}, ${umParaMM(ponto.y)}) mm | ` +
        `depois ${resumir(selecao.itens)}`,
    );
    expect(resumir(selecao.itens)).toBe(antes);
    expect(selecao.podar(cena)).toBe(0);
  });

  it('podar tira o que sumiu, e diz quantos tirou', () => {
    const sessao = sessaoDaBlusa();
    const cena = new Cena(sessao);
    const camadas = new Camadas();
    const selecao = new Selecao();

    // Insere um ponto no meio da bainha, seleciona ele e o vizinho, e apaga o novo.
    sessao.aplicar({
      tipo: 'InserirPonto',
      pecaId: PECA,
      payload: { segmentoId: 'sg-0', s: 0.5, prefixoId: 'novo' },
    });
    const inserido = cena.derivados(PECA).peca.pontos['novo-p']!;
    selecao.clicar(acharAlvo(cena, camadas, inserido, 10 * UM_POR_PIXEL), SEM_MODIFICADOR);
    selecao.clicar(acharAlvo(cena, camadas, VERTICES[3]!, 10 * UM_POR_PIXEL), SHIFT);
    const antes = selecao.tamanho;

    sessao.aplicar({ tipo: 'ExcluirPonto', pecaId: PECA, payload: { pontoId: 'novo-p' } });
    const tirados = selecao.podar(cena);

    console.log('--- podar ---');
    console.log(
      `selecionados ${antes} | apagou o ponto inserido | podar tirou ${tirados} | ` +
        `sobrou ${resumir(selecao.itens)}`,
    );
    expect(antes).toBe(2);
    expect(tirados).toBe(1);
    expect(selecao.tamanho).toBe(1);
  });

  it('a selecao sobrevive a troca do tamanho exibido (E9)', () => {
    const { cena, camadas, selecao } = novo();
    selecao.clicar(acharAlvo(cena, camadas, VERTICES[2]!, 10 * UM_POR_PIXEL), SEM_MODIFICADOR);
    const antes = resumir(selecao.itens);
    cena.tamanho = 'G';
    console.log(`no M ${antes} | trocou para G -> ${resumir(selecao.itens)} | podou ${selecao.podar(cena)}`);
    expect(resumir(selecao.itens)).toBe(antes);
    expect(selecao.podar(cena)).toBe(0);
  });
});

describe('Selecionar tudo e limpar', () => {
  it('Ctrl+A pega as pecas; com a camada travada, nao pega nada', () => {
    const { cena, camadas, selecao } = novo();
    selecao.selecionarTudo(cena, camadas);
    const tudo = resumir(selecao.itens);
    camadas.travar('costura', true);
    selecao.selecionarTudo(cena, camadas);

    console.log(`Ctrl+A -> ${tudo} | com costura travada -> ${resumir(selecao.itens)}`);
    expect(tudo).toBe('peca');
    expect(selecao.vazia).toBe(true);
  });

  it('`pecas` lista as pecas envolvidas sem repetir', () => {
    const { cena, camadas, selecao } = novo();
    selecao.marquee(cena, camadas, { x: -50 * MM, y: -50 * MM }, { x: 250 * MM, y: 500 * MM }, SEM_MODIFICADOR);
    console.log(`${selecao.tamanho} itens em ${selecao.pecas.length} peca(s): ${selecao.pecas.join(', ')}`);
    expect(selecao.pecas).toEqual([PECA]);
  });
});
