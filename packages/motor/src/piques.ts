/**
 * Operacoes de PIQUE: colocar, arrastar e tirar.
 *
 * O motor ja sabia **projetar** um pique da costura para o corte (`pique.ts`), e
 * ja **criava** piques por dentro (abrir prega, dividir peca). O que faltava era o
 * gesto do modelista: encostar o cursor na lateral da peca e cravar o pique ali.
 * Sem isto, um pique so entrava no modelo por objeto montado a mao — nunca pelo
 * log de eventos, que e a unica fonte de verdade (Parte 4).
 *
 * ## Por que `localizarNoContorno` mora aqui
 * O cursor entrega COORDENADA; o `Pique` guarda `(arestaId, s)`. A conversao entre
 * as duas e a operacao inteira, e ela e a mesma de que o editor da Fase 2 precisa
 * para qualquer clique no contorno. Guardar a coordenada em vez de `(aresta, s)`
 * seria o erro classico: o pique descolaria da peca na primeira graduacao. Com
 * `s` por comprimento de arco (bonus da D1), o pique acompanha a aresta de graca —
 * gradua junto, sobrevive a edicao do vertice e ao espelhamento (que inverte
 * `s -> 1 - s`).
 *
 * ## Dimensao padrao
 * O notcher de modelagem corta 1/4" x 1/16" (Parte 7, caso 4). Sao esses os
 * numeros usados como padrao aqui, e nao um valor redondo inventado.
 */
import { exigir, exigirDoMapa } from './erros.js';
import type { Id, Peca, Pique, TipoPique, Vetor2 } from './tipos.js';
import { exigirUM, TOLERANCIA_MEDICAO_UM, type UM } from './unidades.js';
import { segmentosDaAresta } from './geometria/aresta.js';
import { tabelaArcoDaAresta } from './geometria/medir.js';
import { tesselarSegmento } from './geometria/tesselar.js';

/** Profundidade do notcher padrao de modelagem: 1/4" = 6,35 mm (Parte 7, caso 4). */
export const ALTURA_PADRAO_DO_PIQUE_UM: UM = 6350;
/** Largura do notcher padrao de modelagem: 1/16" = 1,59 mm (Parte 7, caso 4). */
export const LARGURA_PADRAO_DO_PIQUE_UM: UM = 1590;

/** Onde um ponto qualquer do plano cai no contorno da peca. */
export interface LugarNoContorno {
  readonly arestaId: Id;
  /** Fracao do comprimento de arco da ARESTA, em [0, 1]. E o que o `Pique` guarda. */
  readonly s: number;
  /** Segmento em que o ponto caiu — e o que `inserirPonto` pede. */
  readonly segmentoId: Id;
  /** Fracao do comprimento de arco do SEGMENTO, em [0, 1]. */
  readonly sNoSegmento: number;
  /** O ponto do contorno propriamente dito (o pe da perpendicular). */
  readonly ponto: Vetor2;
  /** Distancia do alvo ate o contorno, em UM. E o raio de captura do cursor. */
  readonly distanciaUM: UM;
}

/**
 * Aresta, segmento e `s` do ponto do CONTORNO mais proximo de `alvo`.
 *
 * Devolve os dois niveis de `s` porque as duas operacoes de cursor pedem niveis
 * diferentes: o pique ancora na ARESTA (que e o que sobrevive a edicao, D3), e
 * `inserirPonto` corta um SEGMENTO. Calcular os dois na mesma varredura garante
 * que eles apontem para o mesmo lugar — dois calculos separados poderiam divergir
 * por meio micrometro e cravar o pique um fio ao lado do ponto inserido.
 *
 * Empate entre duas arestas (o alvo caiu exatamente sobre um vertice) resolve pela
 * primeira na ordem do contorno — arbitrario, mas deterministico, que e o que o
 * replay do log exige.
 */
export function localizarNoContorno(peca: Peca, alvo: Vetor2): LugarNoContorno {
  exigir(
    peca.contorno.length > 0,
    'CONTORNO_VAZIO',
    `A peca "${peca.metadados.nome}" nao tem contorno; nao ha onde ancorar um pique.`,
    { pecaId: peca.id },
  );

  const arestas: Id[] = [];
  for (const segmentoId of peca.contorno) {
    const segmento = exigirDoMapa(peca.segmentos, segmentoId, 'SEGMENTO_INEXISTENTE', 'Segmento');
    if (!arestas.includes(segmento.arestaId)) arestas.push(segmento.arestaId);
  }

  let melhor: {
    arestaId: Id;
    s: number;
    segmentoId: Id;
    sNoSegmento: number;
    ponto: Vetor2;
    distancia: number;
  } | null = null;

  for (const arestaId of arestas) {
    const comprimentoDaAresta = tabelaArcoDaAresta(peca, arestaId).comprimento;
    let percorridoNaAresta = 0;

    for (const segmento of segmentosDaAresta(peca, arestaId)) {
      const pontos = tesselarSegmento(peca, segmento.id, TOLERANCIA_MEDICAO_UM);
      const cordas: number[] = [];
      let comprimentoDoSegmento = 0;
      for (let i = 1; i < pontos.length; i++) {
        const corda = Math.hypot(pontos[i]!.x - pontos[i - 1]!.x, pontos[i]!.y - pontos[i - 1]!.y);
        cordas.push(corda);
        comprimentoDoSegmento += corda;
      }

      let antes = 0;
      for (let i = 1; i < pontos.length; i++) {
        const a = pontos[i - 1]!;
        const b = pontos[i]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const quadrado = ex * ex + ey * ey;
        if (quadrado === 0) continue;

        // Projecao do alvo na corda, presa ao trecho [a, b].
        const bruto = ((alvo.x - a.x) * ex + (alvo.y - a.y) * ey) / quadrado;
        const u = bruto < 0 ? 0 : bruto > 1 ? 1 : bruto;
        const px = a.x + ex * u;
        const py = a.y + ey * u;
        const distancia = Math.hypot(alvo.x - px, alvo.y - py);
        if (melhor === null || distancia < melhor.distancia) {
          const andado = antes + cordas[i - 1]! * u;
          melhor = {
            arestaId,
            s: (percorridoNaAresta + andado) / comprimentoDaAresta,
            segmentoId: segmento.id,
            sNoSegmento: andado / comprimentoDoSegmento,
            ponto: { x: Math.round(px), y: Math.round(py) },
            distancia,
          };
        }
        antes += cordas[i - 1]!;
      }
      percorridoNaAresta += comprimentoDoSegmento;
    }
  }

  // Contorno com aresta valida sempre tem pelo menos uma corda de comprimento
  // positivo: `tabelaArcoDaAresta` ja estoura em comprimento zero. Chegar aqui
  // com `null` seria contorno corrompido, e coordenada inventada e pior que erro.
  exigir(
    melhor !== null,
    'CONTORNO_DEGENERADO',
    `Nenhuma aresta do contorno da peca "${peca.metadados.nome}" tem corda de ` +
      `comprimento positivo. Nao da para localizar um ponto nele.`,
    { pecaId: peca.id },
  );

  return {
    arestaId: melhor.arestaId,
    s: melhor.s,
    segmentoId: melhor.segmentoId,
    sNoSegmento: melhor.sNoSegmento,
    ponto: melhor.ponto,
    distanciaUM: Math.round(melhor.distancia),
  };
}

/** O que se escolhe ao cravar um pique; o resto vem do padrao do notcher. */
export interface PiqueNovo {
  readonly id: Id;
  readonly arestaId: Id;
  readonly s: number;
  readonly tipo?: TipoPique;
  readonly alturaUM?: UM;
  readonly larguraUM?: UM;
  readonly anguloGraus?: number;
}

/** Crava um pique na aresta. Nao muta a entrada. */
export function adicionarPique(peca: Peca, novo: PiqueNovo): Peca {
  exigir(
    peca.piques[novo.id] === undefined,
    'PIQUE_DUPLICADO',
    `O pique "${novo.id}" ja existe na peca "${peca.metadados.nome}".`,
    { pecaId: peca.id, piqueId: novo.id },
  );
  exigirDoMapa(peca.arestas, novo.arestaId, 'ARESTA_INEXISTENTE', 'Aresta do pique');

  const pique: Pique = {
    id: novo.id,
    tipo: novo.tipo ?? 'I',
    alturaUM: exigirUM(novo.alturaUM ?? ALTURA_PADRAO_DO_PIQUE_UM, 'alturaUM do pique'),
    larguraUM: exigirUM(novo.larguraUM ?? LARGURA_PADRAO_DO_PIQUE_UM, 'larguraUM do pique'),
    anguloGraus: novo.anguloGraus ?? 0,
    arestaId: novo.arestaId,
    s: conferirS(peca, novo.id, novo.s),
  };
  exigir(
    pique.alturaUM > 0 && pique.larguraUM > 0,
    'PIQUE_DIMENSAO_INVALIDA',
    `O pique "${novo.id}" tem altura ${pique.alturaUM} UM e largura ${pique.larguraUM} UM; ` +
      `as duas precisam ser positivas para haver corte.`,
    { pecaId: peca.id, piqueId: novo.id },
  );
  exigir(
    Number.isFinite(pique.anguloGraus),
    'PIQUE_DIMENSAO_INVALIDA',
    `O pique "${novo.id}" tem angulo ${String(pique.anguloGraus)}, que nao e numero finito.`,
    { pecaId: peca.id, piqueId: novo.id },
  );

  return { ...peca, piques: { ...peca.piques, [pique.id]: pique } };
}

/** Arrasta o pique ao longo da MESMA aresta. Nao muta a entrada. */
export function moverPique(peca: Peca, piqueId: Id, s: number): Peca {
  const pique = exigirDoMapa(peca.piques, piqueId, 'PIQUE_ORFAO', 'Pique a mover');
  const novo: Pique = { ...pique, s: conferirS(peca, piqueId, s) };
  return { ...peca, piques: { ...peca.piques, [piqueId]: novo } };
}

/** Tira o pique. Nao muta a entrada. */
export function removerPique(peca: Peca, piqueId: Id): Peca {
  exigirDoMapa(peca.piques, piqueId, 'PIQUE_ORFAO', 'Pique a remover');
  const piques: Record<Id, Pique> = {};
  for (const id of Object.keys(peca.piques)) {
    if (id !== piqueId) piques[id] = peca.piques[id]!;
  }
  return { ...peca, piques };
}

function conferirS(peca: Peca, piqueId: Id, s: number): number {
  exigir(
    Number.isFinite(s) && s >= 0 && s <= 1,
    'PIQUE_FORA_DA_ARESTA',
    `O pique "${piqueId}" foi posicionado em s = ${String(s)}, fora de [0, 1]. ` +
      `s e fracao do comprimento de arco da aresta, nao coordenada.`,
    { pecaId: peca.id, piqueId, s },
  );
  return s;
}
