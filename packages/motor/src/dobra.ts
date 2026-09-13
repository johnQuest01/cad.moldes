/**
 * Dobra (Parte 3, operacao 14).
 *
 * ## Dobra simples: a peca desenhada e METADE
 * O modelista desenha meia frente com o eixo de dobra na lateral que cai na dobra
 * do tecido. A geometria que vai para o corte, e principalmente **o consumo e a
 * area do encaixe**, e a peca DESDOBRADA. A Parte 3 chama isso de "fonte classica
 * de erro de consumo": quem mede a metade compra metade do tecido necessario.
 *
 * ## Por que devolve poligono, e nao Peca
 * O desdobrado e geometria DERIVADA — como a linha de corte. A peca continua sendo
 * a metade desenhada: e ela que o modelista edita, gradua e cujo contorno tem
 * aresta, margem e ParCostura. Devolver uma `Peca` desdobrada obrigaria a inventar
 * arestas e margens para o lado espelhado, e a proxima edicao teria duas verdades
 * concorrentes sobre a mesma peca.
 *
 * ## O que e validado
 * O eixo tem que deixar a peca inteira de UM LADO so (tocar o eixo e permitido, e
 * o normal: a aresta da dobra fica em cima dele). Se parte da peca cruzasse o
 * eixo, o espelho cairia por cima dela e a area desdobrada sairia menor que o
 * dobro — errado, e sem aviso.
 */
import { FillRule, trimCollinear, union, type Paths64 } from 'clipper2-ts';

import { ErroMotor, exigir, exigirDoMapa } from './erros.js';
import type { Aresta, EixoDobra, Id, Peca, Pique, Poligono, Ponto, Segmento, Vetor2 } from './tipos.js';
import { area, areaComSinal } from './geometria/anel.js';
import { anelDoContorno } from './geometria/anel.js';
import { offsetMargem } from './offset.js';
import { direcaoDoEixo, ladoDoEixo, refletirPonto, type Eixo } from './transformar.js';
import { normalizarWinding } from './geometria/winding.js';
import type { UM } from './unidades.js';

/**
 * Tolerancia de "em cima do eixo", em UM. Um vertice a menos disto do eixo conta
 * como estando nele, nao do outro lado: sao os 0,71 UM de arredondamento para
 * inteiro mais folga, nao uma frouxidao de criterio.
 */
const NA_LINHA_UM = 2;

/** Contorno da peca DESDOBRADA (linha de costura), em UM inteiro, CCW. */
export function contornoDesdobrado(peca: Peca, eixoDobraId: Id): Poligono {
  const eixo = eixoDaPeca(peca, eixoDobraId);
  return desdobrarAnel(peca, eixo, anelDoContorno(peca), 'contorno');
}

/** Linha de CORTE da peca desdobrada: o offset por aresta, espelhado no eixo. */
export function linhaDeCorteDesdobrada(peca: Peca, eixoDobraId: Id): Poligono {
  const eixo = eixoDaPeca(peca, eixoDobraId);
  // Valida contra a linha de costura: e ela que precisa estar de um lado so.
  // A de corte pode passar do eixo pela margem, e isso e legitimo — a margem da
  // aresta que cai na dobra costuma ser zero justamente por isso.
  exigirDeUmLadoSo(peca, eixo, anelDoContorno(peca));
  return desdobrarAnel(peca, eixo, offsetMargem(peca).pontos, 'linha de corte', false);
}

/** Area da peca desdobrada, em UM^2. E ela que o encaixe e o consumo usam. */
export function areaDesdobrada(peca: Peca, eixoDobraId: Id): number {
  return area(contornoDesdobrado(peca, eixoDobraId).pontos);
}

function eixoDaPeca(peca: Peca, eixoDobraId: Id): Eixo {
  const eixo = exigirDoMapa(peca.eixosDobra, eixoDobraId, 'EIXO_DOBRA_INEXISTENTE', 'Eixo de dobra');
  return { p1: eixo.p1, p2: eixo.p2 };
}

function desdobrarAnel(
  peca: Peca,
  eixo: Eixo,
  anel: readonly Vetor2[],
  oQue: string,
  validar = true,
): Poligono {
  const direcao = direcaoDoEixo(eixo, peca.id);
  if (validar) exigirDeUmLadoSo(peca, eixo, anel);

  const espelhado = anel.map((p) => refletirPonto(p, eixo, direcao));
  // A reflexao inverte a orientacao; a uniao exige os dois aneis no mesmo sentido.
  if (areaComSinal(espelhado) < 0) espelhado.reverse();

  const entrada: Paths64 = [
    anel.map((p) => ({ x: p.x, y: p.y })),
    espelhado.map((p) => ({ x: p.x, y: p.y })),
  ];
  const unido = union(entrada, FillRule.NonZero);

  exigir(
    unido.length === 1,
    'DESDOBRA_NAO_FECHOU',
    `Desdobrar o ${oQue} da peca "${peca.metadados.nome}" produziu ${unido.length} aneis. ` +
      `A metade e o seu espelho tem que encostar no eixo e virar uma peca so.`,
    { pecaId: peca.id, aneis: unido.length },
  );

  const desdobrado = trimCollinear(unido[0]!).map((p) => ({ x: p.x, y: p.y }));
  const areaMetade = area(anel);
  const areaTotal = area(desdobrado);
  if (!(areaTotal > areaMetade)) {
    throw new ErroMotor(
      'DESDOBRA_NAO_CRESCEU',
      `O ${oQue} desdobrado da peca "${peca.metadados.nome}" tem area ${areaTotal} UM2, que ` +
        `nao e maior que a metade (${areaMetade} UM2). O espelho caiu por cima da propria ` +
        `peca — o consumo de tecido sairia menor que o real.`,
      { pecaId: peca.id, areaMetade, areaTotal },
    );
  }
  return { pontos: desdobrado };
}

/**
 * Exige que a peca esteja toda de um lado do eixo. Vertice EM CIMA do eixo e o
 * caso normal (a aresta da dobra), nao erro.
 */
function exigirDeUmLadoSo(peca: Peca, eixo: Eixo, anel: readonly Vetor2[]): void {
  const direcao = direcaoDoEixo(eixo, peca.id);
  let positivos = 0;
  let negativos = 0;
  let piorPositivo = 0;
  let piorNegativo = 0;

  for (const ponto of anel) {
    const lado = ladoDoEixo(ponto, eixo, direcao);
    if (lado > NA_LINHA_UM) {
      positivos++;
      piorPositivo = Math.max(piorPositivo, lado);
    } else if (lado < -NA_LINHA_UM) {
      negativos++;
      piorNegativo = Math.min(piorNegativo, lado);
    }
  }

  exigir(
    positivos === 0 || negativos === 0,
    'EIXO_DOBRA_ATRAVESSA_A_PECA',
    `O eixo de dobra atravessa a peca "${peca.metadados.nome}": ${positivos} vertice(s) de um ` +
      `lado (ate ${Math.round(piorPositivo)} UM) e ${negativos} do outro (ate ` +
      `${Math.round(-piorNegativo)} UM). Numa dobra simples a peca desenhada e a METADE e ` +
      `fica toda de um lado; espelhar assim colocaria o reflexo por cima dela mesma.`,
    { pecaId: peca.id, positivos, negativos },
  );
  exigir(
    positivos > 0 || negativos > 0,
    'EIXO_DOBRA_FORA_DO_CONTORNO',
    `Todos os vertices da peca "${peca.metadados.nome}" estao em cima do eixo de dobra. ` +
      `A peca nao tem area de um lado para espelhar.`,
    { pecaId: peca.id },
  );
}

/**
 * MATERIALIZA o desdobrado: a meia-peca vira a peca INTEIRA, editavel.
 *
 * E o "Desdobrar" do botao, distinto das vistas derivadas acima. As vistas
 * continuam sendo o caminho certo enquanto a peca e trabalhada como metade (a
 * doc la em cima explica por que); materializar e para quando o modelista decide
 * parar de trabalhar na metade — dai as arestas espelhadas viram arestas DE
 * VERDADE, com margem copiada da irma e pique espelhado com `s -> 1 - s`.
 *
 * ## O que se exige da metade
 * A lateral da dobra tem que estar EM CIMA do eixo, como um trecho continuo do
 * contorno (e o desenho classico de meia-frente). Essa lateral e consumida: os
 * pontos de juncao sobrevivem, o resto dela some, e o espelho do contorno fecha a
 * peca pelo outro lado. Toque no eixo fora dessa lateral e recusado — desdobrar
 * ali criaria contorno que se cruza, em silencio.
 *
 * ## O que NAO e espelhado (v1, dito e testado)
 * Linhas internas (o fio continua UM so, e e isso que se quer), recortes e grade
 * points ficam como estao. A conferencia final e a mesma da vista derivada: a
 * area tem que dobrar.
 */
export function desdobrarPeca(peca: Peca, eixoDobraId: Id, prefixoId: Id): Peca {
  const eixoDef = exigirDoMapa(
    peca.eixosDobra,
    eixoDobraId,
    'EIXO_DOBRA_INEXISTENTE',
    'Eixo de dobra',
  );
  const eixo: Eixo = { p1: eixoDef.p1, p2: eixoDef.p2 };
  const direcao = direcaoDoEixo(eixo, peca.id);
  exigirDeUmLadoSo(peca, eixo, anelDoContorno(peca));

  const noEixo = (p: Vetor2): boolean => Math.abs(ladoDoEixo(p, eixo, direcao)) <= NA_LINHA_UM;

  const segs = peca.contorno.map((id) =>
    exigirDoMapa(peca.segmentos, id, 'SEGMENTO_INEXISTENTE', 'Segmento'),
  );
  const total = segs.length;
  const naDobra = segs.map((s) => noEixo(peca.pontos[s.de]!) && noEixo(peca.pontos[s.para]!));
  const quantosNaDobra = naDobra.filter(Boolean).length;

  exigir(
    quantosNaDobra >= 1 && quantosNaDobra < total,
    'DESDOBRA_APOIO_INVALIDO',
    `A peca "${peca.metadados.nome}" tem ${quantosNaDobra} segmento(s) do contorno em cima do ` +
      `eixo de dobra. Para desdobrar, a LATERAL DA DOBRA precisa estar deitada no eixo — e o ` +
      `resto da peca, fora dele.`,
    { pecaId: peca.id, quantosNaDobra, total },
  );

  // O trecho na dobra tem que ser UM so (contiguo no ciclo): mais de uma entrada
  // no eixo quer dizer que o contorno encosta nele em dois lugares separados.
  let entradas = 0;
  for (let i = 0; i < total; i++) {
    if (naDobra[i] && !naDobra[(i - 1 + total) % total]) entradas++;
  }
  exigir(
    entradas === 1,
    'DESDOBRA_APOIO_INVALIDO',
    `O contorno da peca "${peca.metadados.nome}" encosta no eixo de dobra em ${entradas} ` +
      `trechos separados. Desdobrar assim faria o espelho cruzar a propria peca.`,
    { pecaId: peca.id, entradas },
  );

  // Gira o ciclo para comecar no primeiro segmento FORA da dobra depois dela.
  let inicio = 0;
  for (let i = 0; i < total; i++) {
    if (!naDobra[i] && naDobra[(i - 1 + total) % total]) {
      inicio = i;
      break;
    }
  }
  const fora: Segmento[] = [];
  for (let i = 0; i < total - quantosNaDobra; i++) {
    fora.push(segs[(inicio + i) % total]!);
  }

  const j1 = fora[0]!.de;
  const j2 = fora[fora.length - 1]!.para;
  exigir(
    noEixo(peca.pontos[j1]!) && noEixo(peca.pontos[j2]!),
    'DESDOBRA_APOIO_INVALIDO',
    `As juncoes do contorno com a lateral da dobra nao estao em cima do eixo na peca ` +
      `"${peca.metadados.nome}". O trecho da dobra precisa comecar e terminar no eixo.`,
    { pecaId: peca.id },
  );
  // Toque no eixo NO MEIO do lado de fora: o espelho cairia em cima do contorno.
  for (let i = 0; i < fora.length - 1; i++) {
    const meio = fora[i]!.para;
    exigir(
      !noEixo(peca.pontos[meio]!),
      'DESDOBRA_APOIO_INVALIDO',
      `O ponto "${meio}" do contorno encosta no eixo de dobra fora da lateral da dobra, na ` +
        `peca "${peca.metadados.nome}". Desdobrar criaria contorno que se cruza.`,
      { pecaId: peca.id, pontoId: meio },
    );
  }

  // Uma aresta nao pode ficar metade na dobra, metade fora: margem e pique
  // ancoram NELA, e cortar a aresta ao meio deixaria os dois sem chao.
  const arestasForaIds: Id[] = [];
  for (const s of fora) {
    if (!arestasForaIds.includes(s.arestaId)) arestasForaIds.push(s.arestaId);
  }
  const arestasDobraIds = new Set<Id>();
  for (let i = 0; i < total; i++) {
    if (naDobra[i]) arestasDobraIds.add(segs[i]!.arestaId);
  }
  for (const id of arestasDobraIds) {
    exigir(
      !arestasForaIds.includes(id),
      'DESDOBRA_APOIO_INVALIDO',
      `A aresta "${id}" da peca "${peca.metadados.nome}" tem segmentos em cima do eixo E fora ` +
        `dele. A lateral da dobra precisa ser aresta inteira — divida a aresta antes.`,
      { pecaId: peca.id, arestaId: id },
    );
  }

  // ---------------------------------------------------------------- espelhos
  const pontos: Record<Id, Ponto> = {};
  const espelhoDoPonto = new Map<Id, Id>([
    [j1, j1],
    [j2, j2],
  ]);
  // Ficam: todos os pontos usados fora da dobra, mais as juncoes. Os pontos
  // exclusivos da lateral da dobra sao consumidos com ela.
  const pontosVivos = new Set<Id>([j1, j2]);
  for (const s of fora) {
    pontosVivos.add(s.de);
    pontosVivos.add(s.para);
  }
  for (const id of pontosVivos) pontos[id] = peca.pontos[id]!;

  let n = 0;
  for (const id of pontosVivos) {
    if (espelhoDoPonto.has(id)) continue;
    const novoId = `${prefixoId}-pt-${n++}`;
    const original = peca.pontos[id]!;
    const refletido = refletirPonto(original, eixo, direcao);
    pontos[novoId] = { ...original, id: novoId, x: refletido.x, y: refletido.y };
    espelhoDoPonto.set(id, novoId);
  }

  const arestas: Record<Id, Aresta> = {};
  const margens: Record<Id, UM> = {};
  for (const id of arestasForaIds) {
    arestas[id] = peca.arestas[id]!;
    if (peca.margens[id] !== undefined) margens[id] = peca.margens[id]!;
  }
  const espelhoDaAresta = new Map<Id, Id>();
  let na = 0;
  for (const id of arestasForaIds) {
    const original = peca.arestas[id]!;
    const novoId = `${prefixoId}-ar-${na++}`;
    arestas[novoId] = {
      ...original,
      id: novoId,
      pontoInicioId: espelhoDoPonto.get(original.pontoFimId)!,
      pontoFimId: espelhoDoPonto.get(original.pontoInicioId)!,
    };
    if (peca.margens[id] !== undefined) margens[novoId] = peca.margens[id]!;
    espelhoDaAresta.set(id, novoId);
  }

  const segmentos: Record<Id, Segmento> = {};
  for (const s of fora) segmentos[s.id] = s;
  const contorno: Id[] = fora.map((s) => s.id);
  let ns = 0;
  for (let i = fora.length - 1; i >= 0; i--) {
    const s = fora[i]!;
    const novoId = `${prefixoId}-sg-${ns++}`;
    segmentos[novoId] = {
      ...s,
      id: novoId,
      arestaId: espelhoDaAresta.get(s.arestaId)!,
      de: espelhoDoPonto.get(s.para)!,
      para: espelhoDoPonto.get(s.de)!,
      ...(s.controles === undefined
        ? {}
        : {
            controles: [
              refletirPonto(s.controles[1], eixo, direcao),
              refletirPonto(s.controles[0], eixo, direcao),
            ] as [Vetor2, Vetor2],
          }),
    };
    contorno.push(novoId);
  }

  const piques: Record<Id, Pique> = {};
  let np = 0;
  for (const [id, pique] of Object.entries(peca.piques)) {
    if (!arestasForaIds.includes(pique.arestaId)) continue;
    piques[id] = pique;
    const novoId = `${prefixoId}-pq-${np++}`;
    piques[novoId] = {
      ...pique,
      id: novoId,
      arestaId: espelhoDaAresta.get(pique.arestaId)!,
      // A aresta espelhada e percorrida ao contrario: o mesmo lugar fisico e 1-s.
      s: 1 - pique.s,
    };
  }

  const eixosDobra: Record<Id, EixoDobra> = { ...peca.eixosDobra };
  delete eixosDobra[eixoDobraId];

  const inteira = normalizarWinding({
    ...peca,
    pontos,
    arestas,
    segmentos,
    contorno,
    margens,
    piques,
    eixosDobra,
  });

  // A mesma prova da vista derivada: desdobrar tem que DOBRAR a area. O eixo tem
  // area zero, entao o certo e exatamente 2x, a menos do arredondamento de
  // refletir para inteiro.
  const areaMetade = area(anelDoContorno(peca));
  const areaInteira = area(anelDoContorno(inteira));
  const razao = areaInteira / areaMetade;
  exigir(
    razao > 1.99 && razao < 2.01,
    'DESDOBRA_NAO_CRESCEU',
    `A peca "${peca.metadados.nome}" desdobrada ficou com ${razao.toFixed(4)}x a area da ` +
      `metade — o certo e 2x. O espelho caiu torto.`,
    { pecaId: peca.id, areaMetade, areaInteira },
  );

  return inteira;
}
