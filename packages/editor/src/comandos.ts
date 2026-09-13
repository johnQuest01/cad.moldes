/**
 * COMANDOS: o que se faz por botao, e nao por gesto de ponteiro.
 *
 * Duplicar peca, renomear, remover, definir margem da selecao, simplificar
 * contorno, abrir pregas e mexer na regra de graduacao nao sao arrastos — sao
 * cliques de botao e valores digitados. Forcar cada um a virar `Ferramenta`
 * criaria maquina de estados para o que nao tem estado.
 *
 * Cada comando e uma FUNCAO PURA que devolve os gestos. Quem aplica e a sessao, e
 * e o mesmo caminho de sempre: nada aqui muda peca por baixo. Sendo puros, sao
 * testados headless como o resto.
 */
import {
  medirAresta,
  mmParaUM,
  pontoEmS,
  umParaMM,
  type Id,
  type Modelo,
  type Peca,
  type PropriedadesEncaixe,
  type TipoPique,
} from '@cad/motor';

import type { Gesto } from './sessao.js';
import type { Referencia } from './selecao.js';

/** Quanto a copia se afasta da original, para as duas nao nascerem sobrepostas. */
export const AFASTAMENTO_DA_COPIA_UM = 50_000;

/**
 * Duplica a peca. `comGraduacao` decide se as regras vao junto — sem elas a copia
 * nasce parada, e o validador acusa `GRADE_POINT_SEM_REGRA`.
 */
export function duplicarPeca(
  modelo: Modelo,
  pecaId: Id,
  semente: string,
  comGraduacao = true,
): Gesto[] {
  const peca = exigirPeca(modelo, pecaId);
  const larguraDaPeca = larguraDe(peca);
  return [
    {
      tipo: 'DuplicarPeca',
      pecaId,
      payload: {
        novoPecaId: `${pecaId}-${semente}`,
        prefixoId: semente,
        dx: larguraDaPeca + AFASTAMENTO_DA_COPIA_UM,
        dy: 0,
        comGraduacao,
      },
    },
  ];
}

export function renomearPeca(modelo: Modelo, pecaId: Id, nome: string): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [{ tipo: 'DefinirMetadados', pecaId, payload: { nome } }];
}

export function removerPeca(modelo: Modelo, pecaId: Id): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [{ tipo: 'RemoverPeca', pecaId, payload: {} }];
}

export function definirEncaixe(
  modelo: Modelo,
  pecaId: Id,
  encaixe: PropriedadesEncaixe,
): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [{ tipo: 'DefinirEncaixe', pecaId, payload: { encaixe } }];
}

/** Margem de TODAS as arestas selecionadas, de uma vez. Um passo de undo. */
export function definirMargem(selecionadas: readonly Referencia[], milimetros: number): Gesto[] {
  const margemUM = mmParaUM(milimetros);
  return selecionadas
    .filter((ref): ref is Extract<Referencia, { tipo: 'aresta' }> => ref.tipo === 'aresta')
    .map((ref) => ({
      tipo: 'DefinirMargem',
      pecaId: ref.pecaId,
      payload: { arestaId: ref.arestaId, margemUM },
    }));
}

/** Douglas-Peucker no contorno. Destrutivo: a interface pede confirmacao antes. */
export function simplificarContorno(modelo: Modelo, pecaId: Id, milimetros: number): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [
    { tipo: 'SimplificarContorno', pecaId, payload: { toleranciaUM: mmParaUM(milimetros) } },
  ];
}

/** Abre as pregas dos eixos dados e deixa a peca plana, com os piques de prega. */
export function abrirPregas(
  modelo: Modelo,
  pecaId: Id,
  eixoIds: readonly Id[],
  semente: string,
): Gesto[] {
  exigirPeca(modelo, pecaId);
  if (eixoIds.length === 0) return [];
  return [{ tipo: 'AbrirPregas', pecaId, payload: { eixoIds: [...eixoIds], prefixoId: semente } }];
}

/**
 * A regra de graduacao de um grade point entre DOIS TAMANHOS CONSECUTIVOS (D8).
 *
 * Trocar a regra e remover a antiga e por a nova: `DefinirRegraGraduacao` recusa
 * id repetido e recusa duas regras para o mesmo par de tamanhos. Os dois eventos
 * saem no mesmo passo, entao um desfazer devolve a regra que estava la.
 */
export function definirRegraGraduacao(
  modelo: Modelo,
  gradePointId: Id,
  deTamanho: string,
  paraTamanho: string,
  dxMM: number,
  dyMM: number,
  semente: string,
): Gesto[] {
  const antiga = Object.values(modelo.regrasGraduacao).find(
    (r) =>
      r.pontoGraduacaoId === gradePointId &&
      r.deTamanho === deTamanho &&
      r.paraTamanho === paraTamanho,
  );
  const gestos: Gesto[] = [];
  if (antiga !== undefined) {
    gestos.push({ tipo: 'RemoverRegraGraduacao', pecaId: null, payload: { regraId: antiga.id } });
  }
  gestos.push({
    tipo: 'DefinirRegraGraduacao',
    pecaId: null,
    payload: {
      regraId: `r-${semente}`,
      pontoGraduacaoId: gradePointId,
      deTamanho,
      paraTamanho,
      dx: mmParaUM(dxMM),
      dy: mmParaUM(dyMM),
    },
  });
  return gestos;
}

/** Tira a regra, deixando o grade point parado (a ancora da peca, D7). */
export function removerRegraGraduacao(modelo: Modelo, regraId: Id): Gesto[] {
  if (modelo.regrasGraduacao[regraId] === undefined) return [];
  return [{ tipo: 'RemoverRegraGraduacao', pecaId: null, payload: { regraId } }];
}

/** Muda o tipo e a dimensao de um pique ja cravado: remove e recrava no mesmo `s`. */
export function trocarPique(
  modelo: Modelo,
  pecaId: Id,
  piqueId: Id,
  tipo: TipoPique,
  profundidadeMM: number,
  larguraMM: number,
): Gesto[] {
  const pique = exigirPeca(modelo, pecaId).piques[piqueId];
  if (pique === undefined) return [];
  return [
    { tipo: 'RemoverPique', pecaId, payload: { piqueId } },
    {
      tipo: 'AdicionarPique',
      pecaId,
      payload: {
        piqueId,
        arestaId: pique.arestaId,
        s: pique.s,
        tipo,
        alturaUM: mmParaUM(profundidadeMM),
        larguraUM: mmParaUM(larguraMM),
        anguloGraus: pique.anguloGraus,
      },
    },
  ];
}

/** Os pares de tamanhos consecutivos da grade. E a tabela do painel de graduacao. */
export function passosDaGrade(modelo: Modelo): (readonly [string, string])[] {
  const passos: [string, string][] = [];
  for (let i = 0; i + 1 < modelo.tamanhos.length; i++) {
    passos.push([modelo.tamanhos[i]!, modelo.tamanhos[i + 1]!]);
  }
  return passos;
}

function exigirPeca(modelo: Modelo, pecaId: Id): Peca {
  const peca = modelo.pecas[pecaId];
  if (peca === undefined) {
    throw new Error(`A peca "${pecaId}" nao existe no modelo "${modelo.nome}".`);
  }
  return peca;
}

function larguraDe(peca: Peca): number {
  const xs = Object.values(peca.pontos).map((p) => p.x);
  return xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs);
}

/**
 * Dimensiona a peca por percentuais — o Encolhimento e o Dimensionar do oficio.
 *
 * A tela fala em PERCENTUAL DO TAMANHO FINAL (100 = como esta, 103 = cresce 3%),
 * porque e assim que a ficha do tecido chega: "compensar 3% no comprimento". O
 * evento viaja em FATOR (1,03), que nao depende de convencao de tela.
 *
 * O centro e o meio da caixa da peca: dimensionar nao e mover — a peca cresce ou
 * encolhe no lugar, e o operador nao a perde de vista.
 */
export function dimensionarPeca(
  modelo: Modelo,
  pecaId: Id,
  percentualLargura: number,
  percentualAltura: number,
): Gesto[] {
  const peca = exigirPeca(modelo, pecaId);
  const xs = Object.values(peca.pontos).map((p) => p.x);
  const ys = Object.values(peca.pontos).map((p) => p.y);
  const centro = {
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
  };
  return [
    {
      tipo: 'DimensionarPeca',
      pecaId,
      payload: {
        centro,
        fatorX: percentualLargura / 100,
        fatorY: percentualAltura / 100,
      },
    },
  ];
}

/** Altura e boca padrao do pique gerado por comandos (o padrao do motor: 1/4" x 1/16"). */
const PIQUE_PADRAO = { alturaUM: 6350, larguraUM: 1590, anguloGraus: 0 } as const;

/**
 * Gera pregas PARAMETRICAS numa aresta — o dialogo "Pregas" do oficio: quantas,
 * de quanto em quanto, e com que largura.
 *
 * O que sai daqui sao os gestos de sempre: N eixos de dobra perpendiculares a
 * CORDA da aresta (perpendiculares a corda = paralelos entre si, que e o que
 * `abrirPregas` exige), centrados na aresta, e um `AbrirPregas` no fim. O motor
 * faz o corte-e-abre e poe os piques de cada dobra; nada e recalculado aqui.
 *
 * ## A conversao de largura
 * O dialogo do oficio pede "largura 1" e "largura 2" (as duas dobras da prega).
 * Uma prega consome `largura1 + largura2` de tecido plano, e o motor cobra `2 x
 * profundidade` por eixo — entao `profundidade = (largura1 + largura2) / 2`. Com
 * largura 2 zero (prega simples), e meia largura 1: a mesma conta.
 */
export function gerarPregas(
  modelo: Modelo,
  pecaId: Id,
  arestaId: Id,
  opcoes: {
    quantidade: number;
    distanciaMM: number;
    largura1MM: number;
    largura2MM?: number;
  },
  semente: string,
): Gesto[] {
  const peca = exigirPeca(modelo, pecaId);
  const aresta = peca.arestas[arestaId];
  if (aresta === undefined) {
    throw new Error(
      `A aresta "${arestaId}" nao existe na peca "${peca.metadados.nome}". ` +
        `As arestas dela sao: ${Object.keys(peca.arestas).join(', ')}.`,
    );
  }
  const { quantidade, distanciaMM } = opcoes;
  const largura2MM = opcoes.largura2MM ?? 0;
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 60) {
    throw new Error(`O numero de pregas precisa ser um inteiro de 1 a 60; veio ${quantidade}.`);
  }
  if (!(distanciaMM > 0) || !(opcoes.largura1MM > 0) || largura2MM < 0) {
    throw new Error(
      'Pregas precisam de distancia e largura 1 positivas (largura 2 pode ser zero).',
    );
  }

  const comprimento = medirAresta(peca, arestaId);
  const vao = mmParaUM(distanciaMM);
  const folgaDaPonta = 0.05;
  const span = (quantidade - 1) * vao;
  const sInicio = 0.5 - span / 2 / comprimento;
  const sFim = 0.5 + span / 2 / comprimento;
  if (sInicio < folgaDaPonta || sFim > 1 - folgaDaPonta) {
    throw new Error(
      `${quantidade} pregas a cada ${distanciaMM} mm ocupam ${umParaMM(span)} mm, e a aresta ` +
        `"${arestaId}" tem ${umParaMM(comprimento)} mm: nao cabem com folga de 5% nas pontas. ` +
        `Diminua a quantidade ou a distancia.`,
    );
  }

  // Perpendicular a CORDA (nao a tangente local): e o que garante eixos paralelos.
  const inicio = peca.pontos[aresta.pontoInicioId]!;
  const fim = peca.pontos[aresta.pontoFimId]!;
  const cordaX = fim.x - inicio.x;
  const cordaY = fim.y - inicio.y;
  const norma = Math.hypot(cordaX, cordaY);
  if (!(norma > 0)) {
    throw new Error(`A aresta "${arestaId}" tem corda de comprimento zero.`);
  }
  const normal = { x: -cordaY / norma, y: cordaX / norma };
  // O eixo atravessa a peca de sobra: metade do alcance para cada lado.
  const xs = Object.values(peca.pontos).map((p) => p.x);
  const ys = Object.values(peca.pontos).map((p) => p.y);
  const alcance =
    Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 10_000;

  const profundidadeUM = Math.round(mmParaUM(opcoes.largura1MM + largura2MM) / 2);
  const gestos: Gesto[] = [];
  const eixoIds: Id[] = [];
  for (let i = 0; i < quantidade; i++) {
    const s = sInicio + (i * vao) / comprimento;
    const ponto = pontoEmS(peca, arestaId, s);
    const eixoId = `${semente}-eixo-${i}`;
    eixoIds.push(eixoId);
    gestos.push({
      tipo: 'DefinirEixoDobra',
      pecaId,
      payload: {
        eixoId,
        p1: {
          x: Math.round(ponto.x - normal.x * alcance),
          y: Math.round(ponto.y - normal.y * alcance),
        },
        p2: {
          x: Math.round(ponto.x + normal.x * alcance),
          y: Math.round(ponto.y + normal.y * alcance),
        },
        direcao: 'dentro',
        profundidadeUM,
      },
    });
  }
  gestos.push({
    tipo: 'AbrirPregas',
    pecaId,
    payload: { eixoIds, prefixoId: semente },
  });
  return gestos;
}

/**
 * Bainha (v1): a barra ganha a altura da dobra como margem, e um pique em cada
 * aresta VIZINHA marca onde a barra vira.
 *
 * E o que a costureira precisa para dobrar no lugar certo. O refino da v2 — os
 * lados da barra ESPELHADOS nas laterais, para bainha em lateral inclinada casar
 * dobrada — esta dito como pendente na comparacao com o Audaces; ate la, isto
 * aqui nao inventa geometria nenhuma: margem e pique, os dois ja testados.
 */
export function definirBainha(
  modelo: Modelo,
  pecaId: Id,
  arestaId: Id,
  alturaMM: number,
  semente: string,
): Gesto[] {
  const peca = exigirPeca(modelo, pecaId);
  const aresta = peca.arestas[arestaId];
  if (aresta === undefined) {
    throw new Error(
      `A aresta "${arestaId}" nao existe na peca "${peca.metadados.nome}". ` +
        `As arestas dela sao: ${Object.keys(peca.arestas).join(', ')}.`,
    );
  }
  if (!(alturaMM > 0)) {
    throw new Error(`A altura da bainha precisa ser positiva; veio ${alturaMM}.`);
  }
  const alturaUM = mmParaUM(alturaMM);

  // As vizinhas: quem TERMINA onde a barra comeca, e quem COMECA onde ela termina.
  const anterior = Object.values(peca.arestas).find(
    (a) => a.id !== arestaId && a.pontoFimId === aresta.pontoInicioId,
  );
  const seguinte = Object.values(peca.arestas).find(
    (a) => a.id !== arestaId && a.pontoInicioId === aresta.pontoFimId,
  );
  if (anterior === undefined || seguinte === undefined) {
    throw new Error(
      `Nao achei as arestas vizinhas da "${arestaId}" na peca "${peca.metadados.nome}" — o ` +
        `contorno esta aberto?`,
    );
  }

  const gestos: Gesto[] = [
    { tipo: 'DefinirMargem', pecaId, payload: { arestaId, margemUM: alturaUM } },
  ];
  const marcar = (vizinha: Id, s: number, quala: string): void => {
    const comprimento = medirAresta(peca, vizinha);
    if (alturaUM > comprimento * 0.4) {
      throw new Error(
        `A bainha de ${alturaMM} mm e mais de 40% da aresta ${quala} "${vizinha}" ` +
          `(${umParaMM(comprimento)} mm). Bainha dessa altura nao dobra — confira a medida.`,
      );
    }
    gestos.push({
      tipo: 'AdicionarPique',
      pecaId,
      payload: {
        piqueId: `${semente}-pq-${quala}`,
        arestaId: vizinha,
        s: Math.min(0.98, Math.max(0.02, s)),
        tipo: 'I',
        ...PIQUE_PADRAO,
      },
    });
  };
  // Na anterior o pique fica a `altura` do FIM (que encosta na barra); na
  // seguinte, a `altura` do INICIO.
  marcar(anterior.id, 1 - alturaUM / medirAresta(peca, anterior.id), 'antes');
  marcar(seguinte.id, alturaUM / medirAresta(peca, seguinte.id), 'depois');
  return gestos;
}

/**
 * Alinha uma peca pela CAIXA de outra: borda com borda, ou centro com centro.
 * Translacao pura — nada de forma muda, e o desfazer devolve com um passo.
 */
export function alinharPeca(
  modelo: Modelo,
  pecaId: Id,
  referenciaId: Id,
  lado: 'esquerda' | 'direita' | 'topo' | 'base' | 'centro',
): Gesto[] {
  const peca = exigirPeca(modelo, pecaId);
  const referencia = exigirPeca(modelo, referenciaId);
  if (pecaId === referenciaId) {
    throw new Error('Alinhar uma peca com ela mesma nao muda nada.');
  }
  const caixa = (p: Peca) => {
    const xs = Object.values(p.pontos).map((v) => v.x);
    const ys = Object.values(p.pontos).map((v) => v.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  };
  const a = caixa(peca);
  const b = caixa(referencia);
  let dx = 0;
  let dy = 0;
  if (lado === 'esquerda') dx = b.minX - a.minX;
  else if (lado === 'direita') dx = b.maxX - a.maxX;
  else if (lado === 'topo') dy = b.maxY - a.maxY;
  else if (lado === 'base') dy = b.minY - a.minY;
  else {
    dx = Math.round((b.minX + b.maxX) / 2 - (a.minX + a.maxX) / 2);
    dy = Math.round((b.minY + b.maxY) / 2 - (a.minY + a.maxY) / 2);
  }
  return [{ tipo: 'TransladarPeca', pecaId, payload: { dx, dy } }];
}

/** Materializa o desdobrado da peca no eixo dado. Um gesto, um desfazer. */
export function desdobrarPecaComando(modelo: Modelo, pecaId: Id, eixoDobraId: Id, semente: string): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [{ tipo: 'DesdobrarPeca', pecaId, payload: { eixoDobraId, prefixoId: semente } }];
}

/** Abre uma pence na aresta: boca em mm centrada na fracao s, apice para dentro. */
export function abrirPenceComando(
  modelo: Modelo,
  pecaId: Id,
  arestaId: Id,
  s: number,
  aberturaMM: number,
  profundidadeMM: number,
  semente: string,
): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [
    {
      tipo: 'AbrirPence',
      pecaId,
      payload: {
        arestaId,
        s,
        aberturaUM: mmParaUM(aberturaMM),
        profundidadeUM: mmParaUM(profundidadeMM),
        prefixoId: semente,
      },
    },
  ];
}

/** Impoe o comprimento de uma aresta, em mm. */
export function redefinirAresta(
  modelo: Modelo,
  pecaId: Id,
  arestaId: Id,
  comprimentoMM: number,
): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [
    {
      tipo: 'RedefinirAresta',
      pecaId,
      payload: { arestaId, comprimentoUM: mmParaUM(comprimentoMM) },
    },
  ];
}
