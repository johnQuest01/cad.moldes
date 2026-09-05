/**
 * Operacoes de edicao do modelista (Parte 3, operacoes 9 a 13).
 *
 *   9. `modificarPonto`        — discreto e proporcional
 *  10. `arredondarVertice` / `chanfrarVertice` — fillet e chanfro
 *  11. `simplificarContorno`   — Douglas-Peucker com tolerancia explicita
 *  12. `converterSegmento`     — reta <-> curva preservando os extremos
 *  13. `inserirPonto` / `excluirPonto`
 *
 * ## O fio que atravessa todas: o ID da aresta nao muda (D3)
 * Inserir um ponto parte um segmento em dois, e os DOIS continuam na mesma aresta.
 * Arredondar um vertice troca dois segmentos por tres, e as arestas envolvidas
 * mantem o id. Nada aqui renumera aresta — se renumerasse, margem por aresta e
 * ParCostura passariam a apontar para o lugar errado, em silencio, que e
 * exatamente a armadilha que a D3 existe para evitar.
 *
 * ## IDs vem de fora (D2)
 * Toda operacao que cria entidade recebe um `prefixoId` e deriva os ids dele de
 * forma deterministica. Nada de `randomUUID()` aqui: estas funcoes rodam dentro do
 * fold, e entropia dentro do fold quebra o replay.
 */
import { ramerDouglasPeucker } from 'clipper2-ts';

import { ErroMotor, exigir, exigirDoMapa } from './erros.js';
import type { Aresta, Id, Peca, Ponto, Segmento, Vetor2 } from './tipos.js';
import { exigirUM, TOLERANCIA_MEDICAO_UM, type UM } from './unidades.js';
import {
  aplicarDeslocamentos,
  verticesDoContorno,
  type Deslocamento,
} from './geometria/deslocar.js';
import { bezierDe, parametroEmS, subdividirEmT, type Bezier } from './geometria/bezier.js';

export type ModoDeEdicao = 'discreto' | 'proporcional';

// ===========================================================================
// Operacao 9 — modificar ponto
// ===========================================================================

/**
 * Move um ponto, levando (ou nao) os vizinhos junto. Nao muta a entrada.
 *
 * ## A funcao de decaimento (fixada na Parte 3, nao inventada aqui)
 *
 *     f(i) = (1 + cos(pi * i / (N + 1))) / 2,   i = 1..N
 *
 * O alvo recebe fator 1; ponto alem do vizinho `N` recebe 0. A curva vai de quase
 * 1 (vizinho colado) a quase 0 (ultimo vizinho), com derivada zero nas duas pontas
 * — e por isso a emenda com o trecho que nao se move nao cria bico. Para `N = 3`:
 *
 *     f(1) = 0,853553...   f(2) = 0,5   f(3) = 0,146447...
 *
 * O indice `i` e a POSICAO NO CONTORNO (topologia), nao distancia: o vizinho
 * imediato e `i = 1` mesmo que esteja a 2 mm ou a 20 cm.
 *
 * `nVizinhos` e ignorado no modo discreto — a assinatura da Parte 1 pede o
 * parametro nos dois modos.
 */
export function modificarPonto(
  peca: Peca,
  pontoId: Id,
  dx: UM,
  dy: UM,
  modo: ModoDeEdicao,
  nVizinhos: number,
): Peca {
  exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto a modificar');
  const deslocamento: Deslocamento = {
    dx: exigirUM(dx, 'dx de modificarPonto'),
    dy: exigirUM(dy, 'dy de modificarPonto'),
  };

  if (modo === 'discreto') {
    return aplicarDeslocamentos(peca, new Map([[pontoId, deslocamento]]));
  }

  exigir(
    Number.isInteger(nVizinhos) && nVizinhos >= 0,
    'N_VIZINHOS_INVALIDO',
    `O numero de vizinhos do modo proporcional precisa ser inteiro e nao negativo; ` +
      `recebi ${String(nVizinhos)}.`,
    { pecaId: peca.id, pontoId, nVizinhos },
  );

  const vertices = verticesDoContorno(peca);
  const alvo = vertices.indexOf(pontoId);
  exigir(
    alvo >= 0,
    'PONTO_FORA_DO_CONTORNO',
    `O ponto "${pontoId}" nao esta no contorno da peca "${peca.metadados.nome}". ` +
      `O modo proporcional distribui a influencia pelos vizinhos AO LONGO DO CONTORNO, ` +
      `entao nao ha por onde propagar. Use o modo discreto.`,
    { pecaId: peca.id, pontoId },
  );
  exigir(
    2 * nVizinhos + 1 <= vertices.length,
    'N_VIZINHOS_EXCEDE_CONTORNO',
    `O modo proporcional com ${nVizinhos} vizinhos de cada lado alcanca ` +
      `${2 * nVizinhos + 1} pontos, mas o contorno da peca "${peca.metadados.nome}" tem ` +
      `${vertices.length}. A influencia daria a volta e o mesmo ponto seria vizinho pelos ` +
      `dois lados, sem resposta certa para quanto ele anda.`,
    { pecaId: peca.id, pontoId, nVizinhos, vertices: vertices.length },
  );

  const total = vertices.length;
  const porPonto = new Map<Id, Deslocamento>([[pontoId, deslocamento]]);

  for (let i = 1; i <= nVizinhos; i++) {
    const fator = fatorDeDecaimento(i, nVizinhos);
    const parcial: Deslocamento = { dx: deslocamento.dx * fator, dy: deslocamento.dy * fator };
    porPonto.set(vertices[(alvo - i + total) % total]!, parcial);
    porPonto.set(vertices[(alvo + i) % total]!, parcial);
  }

  return aplicarDeslocamentos(peca, porPonto);
}

/**
 * `f(i) = (1 + cos(pi * i / (N + 1))) / 2` — a formula da Parte 3, literal.
 * `i = 0` (o alvo) da 1 e `i = N + 1` da 0, o que mostra que a curva encaixa
 * exatamente entre o alvo e o primeiro ponto fora do alcance.
 */
export function fatorDeDecaimento(i: number, nVizinhos: number): number {
  return (1 + Math.cos((Math.PI * i) / (nVizinhos + 1))) / 2;
}

// ===========================================================================
// Operacao 13 — inserir / excluir ponto
// ===========================================================================

/**
 * Insere um ponto no meio de um segmento, na posicao `s` (0..1) medida por
 * COMPRIMENTO DE ARCO — nunca pelo `t` cru da Bezier.
 *
 * O segmento vira dois, e os dois ficam na MESMA aresta (D3): nenhum `arestaId`
 * muda, e por isso margem por aresta e ParCostura continuam apontando certo.
 *
 * Em curva, a divisao e por de Casteljau: as duas metades SAO a curva de antes.
 * O unico desvio e o arredondamento do ponto de corte e dos controles novos para
 * micrometro inteiro (inegociavel 1), da ordem de 1 UM — tres ordens de grandeza
 * abaixo da tolerancia de tesselacao.
 */
export function inserirPonto(peca: Peca, segmentoId: Id, s: number, prefixoId: Id): Peca {
  const segmento = exigirDoMapa(peca.segmentos, segmentoId, 'SEGMENTO_INEXISTENTE', 'Segmento');
  const posicao = peca.contorno.indexOf(segmentoId);
  exigir(
    posicao >= 0,
    'SEGMENTO_INEXISTENTE',
    `O segmento "${segmentoId}" existe na peca "${peca.metadados.nome}" mas nao esta no ` +
      `contorno. Inserir ponto so vale para segmento do contorno.`,
    { pecaId: peca.id, segmentoId },
  );
  exigir(
    Number.isFinite(s) && s > 0 && s < 1,
    'S_FORA_DA_FAIXA',
    `A posicao s = ${String(s)} precisa estar ESTRITAMENTE entre 0 e 1: 0 e 1 sao os ` +
      `extremos do segmento, e os pontos deles ja existem.`,
    { pecaId: peca.id, segmentoId, s },
  );

  const novoPontoId = `${prefixoId}-p`;
  const novoSegmentoId = `${prefixoId}-s`;
  exigir(
    peca.pontos[novoPontoId] === undefined && peca.segmentos[novoSegmentoId] === undefined,
    'PONTO_DUPLICADO',
    `O prefixo "${prefixoId}" ja foi usado nesta peca (existe "${novoPontoId}" ou ` +
      `"${novoSegmentoId}"). Cada insercao precisa do seu proprio prefixo.`,
    { pecaId: peca.id, prefixoId },
  );

  const de = coordenada(peca, segmento.de);
  const para = coordenada(peca, segmento.para);

  let corte: Vetor2;
  let primeiro: Segmento;
  let segundo: Segmento;

  if (segmento.tipo === 'reta') {
    corte = { x: Math.round(de.x + (para.x - de.x) * s), y: Math.round(de.y + (para.y - de.y) * s) };
    exigir(
      !mesmoPonto(corte, de) && !mesmoPonto(corte, para),
      'SEGMENTO_COMPRIMENTO_ZERO',
      `Com s = ${s} o ponto novo cai em cima de um dos extremos do segmento ` +
        `"${segmentoId}", criando um segmento de comprimento zero.`,
      { pecaId: peca.id, segmentoId, s },
    );
    primeiro = { ...segmento, para: novoPontoId };
    segundo = {
      id: novoSegmentoId,
      arestaId: segmento.arestaId,
      de: novoPontoId,
      para: segmento.para,
      tipo: 'reta',
    };
  } else {
    const bezier = bezierDoSegmento(peca, segmento);
    const t = parametroEmS(bezier, s, TOLERANCIA_MEDICAO_UM);
    const [esquerda, direita] = subdividirEmT(bezier, t);
    corte = arredondar(esquerda[3]);
    exigir(
      !mesmoPonto(corte, de) && !mesmoPonto(corte, para),
      'SEGMENTO_COMPRIMENTO_ZERO',
      `Com s = ${s} o ponto novo cai em cima de um dos extremos da curva "${segmentoId}".`,
      { pecaId: peca.id, segmentoId, s },
    );
    primeiro = {
      ...segmento,
      para: novoPontoId,
      controles: [arredondar(esquerda[1]), arredondar(esquerda[2])],
    };
    segundo = {
      id: novoSegmentoId,
      arestaId: segmento.arestaId,
      de: novoPontoId,
      para: segmento.para,
      tipo: 'curva',
      controles: [arredondar(direita[1]), arredondar(direita[2])],
    };
  }

  const contorno = [...peca.contorno];
  contorno.splice(posicao + 1, 0, novoSegmentoId);

  return {
    ...peca,
    pontos: {
      ...peca.pontos,
      [novoPontoId]: { id: novoPontoId, x: corte.x, y: corte.y, tipo: 'contorno' },
    },
    segmentos: { ...peca.segmentos, [segmentoId]: primeiro, [novoSegmentoId]: segundo },
    contorno,
  };
}

/**
 * Remove um ponto do meio de uma aresta, fundindo os dois segmentos vizinhos.
 *
 * Recusa, em vez de aproximar:
 *  - ponto NOTAVEL (inicio ou fim de aresta): removelo mudaria onde uma aresta
 *    acaba e a outra comeca, e margem por aresta e ParCostura passariam a apontar
 *    para o lugar errado (D3);
 *  - ponto que e grade point: a regra de graduacao ficaria orfa;
 *  - juncao que envolve CURVA: a fusao de duas Bezier cubicas nao e, em geral,
 *    outra Bezier cubica. Reduzir pontos de curva e a operacao 11
 *    (`simplificarContorno`), que tem tolerancia explicita e valida medindo.
 */
export function excluirPonto(peca: Peca, pontoId: Id): Peca {
  exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto a excluir');

  const posicaoQueSai = peca.contorno.findIndex((id) => peca.segmentos[id]!.de === pontoId);
  const posicaoQueChega = peca.contorno.findIndex((id) => peca.segmentos[id]!.para === pontoId);
  exigir(
    posicaoQueSai >= 0 && posicaoQueChega >= 0,
    'PONTO_FORA_DO_CONTORNO',
    `O ponto "${pontoId}" nao e juncao de dois segmentos do contorno da peca ` +
      `"${peca.metadados.nome}".`,
    { pecaId: peca.id, pontoId },
  );

  const queChega = peca.segmentos[peca.contorno[posicaoQueChega]!]!;
  const queSai = peca.segmentos[peca.contorno[posicaoQueSai]!]!;

  for (const aresta of Object.values(peca.arestas)) {
    exigir(
      aresta.pontoInicioId !== pontoId && aresta.pontoFimId !== pontoId,
      'PONTO_NOTAVEL_NAO_REMOVIVEL',
      `O ponto "${pontoId}" e extremo da aresta "${aresta.id}". Remove-lo mudaria onde ` +
        `essa aresta comeca ou acaba, e a margem por aresta e o ParCostura passariam a ` +
        `apontar para o lugar errado (D3).`,
      { pecaId: peca.id, pontoId, arestaId: aresta.id },
    );
  }
  for (const gradePoint of Object.values(peca.gradePoints)) {
    exigir(
      gradePoint.pontoId !== pontoId,
      'GRADE_POINT_NAO_REMOVIVEL',
      `O ponto "${pontoId}" e o grade point "${gradePoint.id}". Remove-lo deixaria a ` +
        `regra de graduacao sem ponto para aplicar. Desmarque o grade point antes.`,
      { pecaId: peca.id, pontoId, gradePointId: gradePoint.id },
    );
  }
  exigir(
    queChega.tipo === 'reta' && queSai.tipo === 'reta',
    'MERGE_DE_CURVA_NAO_REPRESENTAVEL',
    `A juncao no ponto "${pontoId}" envolve curva ("${queChega.id}" e "${queSai.id}"). ` +
      `Fundir duas Bezier cubicas nao da, em geral, outra Bezier cubica, entao a fusao ` +
      `mudaria o desenho da peca. Para reduzir pontos de curva use simplificarContorno, ` +
      `que tem tolerancia explicita.`,
    { pecaId: peca.id, pontoId },
  );
  exigir(
    peca.contorno.length > 3,
    'CONTORNO_DEGENERADO',
    `O contorno da peca "${peca.metadados.nome}" tem ${peca.contorno.length} segmentos; ` +
      `remover mais um deixaria menos de 3 e o poligono deixaria de fechar.`,
    { pecaId: peca.id, pontoId },
  );

  const fundido: Segmento = { ...queChega, para: queSai.para };
  const segmentos: Record<Id, Segmento> = {};
  for (const [id, segmento] of Object.entries(peca.segmentos)) {
    if (id === queSai.id) continue;
    segmentos[id] = id === queChega.id ? fundido : segmento;
  }
  const pontos: Record<Id, Ponto> = {};
  for (const [id, ponto] of Object.entries(peca.pontos)) {
    if (id !== pontoId) pontos[id] = ponto;
  }

  return {
    ...peca,
    pontos,
    segmentos,
    contorno: peca.contorno.filter((id) => id !== queSai.id),
  };
}

// ===========================================================================
// Operacao 12 — converter reta <-> curva
// ===========================================================================

/**
 * Converte um segmento entre reta e curva PRESERVANDO OS EXTREMOS.
 *
 * `reta -> curva` coloca os dois controles a 1/3 e 2/3 da propria reta: a Bezier
 * resultante e geometricamente IDENTICA a reta. O desenho da peca so muda quando o
 * modelista mexer nos controles depois — converter, por si so, nao altera medida
 * nenhuma. E o inverso do que se esperaria de uma conversao "aproximada", e e o que
 * evita uma peca mudar de tamanho so porque alguem trocou o tipo do segmento.
 *
 * `curva -> reta` descarta os controles, e ai sim o desenho muda: e o que foi pedido.
 */
export function converterSegmento(peca: Peca, segmentoId: Id, para: 'reta' | 'curva'): Peca {
  const segmento = exigirDoMapa(peca.segmentos, segmentoId, 'SEGMENTO_INEXISTENTE', 'Segmento');
  if (segmento.tipo === para) return peca;

  let convertido: Segmento;
  if (para === 'reta') {
    const { controles, ...semControles } = segmento;
    void controles;
    convertido = { ...semControles, tipo: 'reta' };
  } else {
    const de = coordenada(peca, segmento.de);
    const fim = coordenada(peca, segmento.para);
    convertido = {
      ...segmento,
      tipo: 'curva',
      controles: [aoLongoDaReta(de, fim, 1 / 3), aoLongoDaReta(de, fim, 2 / 3)],
    };
  }

  return { ...peca, segmentos: { ...peca.segmentos, [segmentoId]: convertido } };
}

// ===========================================================================
// Operacao 10 — arredondar (fillet) e chanfrar
// ===========================================================================

/**
 * Arredonda um vertice com um raio, trocando o canto por um arco de circulo
 * aproximado por Bezier cubica (D1): `kappa = 4/3 * tan(theta/4)`, com `theta` o
 * angulo varrido pelo arco. Em arco de 90 graus o erro radial e ~0,027% do raio —
 * 2,7 um num fillet de 10 mm, contra os 100 um da tolerancia de tesselacao.
 *
 * O circulo e o INSCRITO no angulo: tangente aos dois lados, a `raio` de distancia
 * de cada um. Os pontos de tangencia ficam a `raio / tan(phi/2)` do vertice, onde
 * `phi` e o angulo interno. Se essa distancia nao couber num dos lados, recusa.
 */
export function arredondarVertice(
  peca: Peca,
  pontoId: Id,
  raioUM: UM,
  prefixoId: Id,
): Peca {
  exigirUM(raioUM, 'raioUM de arredondarVertice');
  exigir(
    raioUM > 0,
    'RAIO_INVALIDO',
    `O raio do fillet precisa ser positivo; recebi ${raioUM} UM.`,
    { pecaId: peca.id, pontoId, raioUM },
  );

  const canto = lerCanto(peca, pontoId, 'arredondar');
  const meioAngulo = canto.anguloInterno / 2;
  const recuo = raioUM / Math.tan(meioAngulo);
  exigirQueCaiba(peca, pontoId, recuo, canto, 'fillet de raio ' + raioUM + ' UM');

  const inicio = aPartirDoVertice(canto.vertice, canto.paraAnterior, recuo);
  const fim = aPartirDoVertice(canto.vertice, canto.paraProximo, recuo);

  // Arco varrido = pi - angulo interno. kappa = 4/3 * tan(theta/4) (D1).
  const varrido = Math.PI - canto.anguloInterno;
  const kappa = (4 / 3) * Math.tan(varrido / 4);
  const bezier: Bezier = [
    inicio,
    { x: inicio.x - kappa * raioUM * canto.paraAnterior.x, y: inicio.y - kappa * raioUM * canto.paraAnterior.y },
    { x: fim.x - kappa * raioUM * canto.paraProximo.x, y: fim.y - kappa * raioUM * canto.paraProximo.y },
    fim,
  ];

  return trocarVerticePorTrecho(peca, pontoId, prefixoId, canto, {
    tipo: 'curva',
    inicio: arredondar(inicio),
    fim: arredondar(fim),
    bezier,
  });
}

/**
 * Chanfra um vertice: troca o canto por uma reta que corta os dois lados a
 * `distanciaUM` do vertice. Mesma estrutura do fillet, sem o arco.
 */
export function chanfrarVertice(
  peca: Peca,
  pontoId: Id,
  distanciaUM: UM,
  prefixoId: Id,
): Peca {
  exigirUM(distanciaUM, 'distanciaUM de chanfrarVertice');
  exigir(
    distanciaUM > 0,
    'RAIO_INVALIDO',
    `A distancia do chanfro precisa ser positiva; recebi ${distanciaUM} UM.`,
    { pecaId: peca.id, pontoId, distanciaUM },
  );

  const canto = lerCanto(peca, pontoId, 'chanfrar');
  exigirQueCaiba(peca, pontoId, distanciaUM, canto, 'chanfro de ' + distanciaUM + ' UM');

  const inicio = arredondar(aPartirDoVertice(canto.vertice, canto.paraAnterior, distanciaUM));
  const fim = arredondar(aPartirDoVertice(canto.vertice, canto.paraProximo, distanciaUM));

  return trocarVerticePorTrecho(peca, pontoId, prefixoId, canto, {
    tipo: 'reta',
    inicio,
    fim,
  });
}

// ===========================================================================
// Operacao 11 — simplificar contorno
// ===========================================================================

/**
 * Reduz pontos do contorno por Douglas-Peucker com tolerancia EXPLICITA.
 *
 * A implementacao do algoritmo vem do clipper2 (`ramerDouglasPeucker`), nao daqui:
 * a inegociavel 3 proibe reimplementar simplificacao existindo biblioteca.
 *
 * O que e do motor e decidir O QUE pode sumir. Nunca somem:
 *  - pontos NOTAVEIS (inicio e fim de aresta) — mexeriam na D3;
 *  - grade points — deixariam a regra de graduacao orfa;
 *  - extremos de segmento em curva — a curva ja e compacta, e mexer nela aqui
 *    mudaria o desenho sem passar pelo criterio de desvio do Douglas-Peucker.
 *
 * Sobram os trechos de RETAS consecutivas dentro de uma mesma aresta, que e onde
 * a digitalizacao e a importacao deixam pontos demais. Cada trecho e simplificado
 * separadamente, com os dois extremos travados.
 *
 * `ramerDouglasPeucker` do clipper devolve o caminho intacto quando ele tem menos
 * de 5 pontos — trecho curto nao e simplificado, e isso e proposital dela.
 */
export function simplificarContorno(peca: Peca, toleranciaUM: UM): Peca {
  exigir(
    Number.isFinite(toleranciaUM) && toleranciaUM > 0,
    'TOLERANCIA_INVALIDA',
    `A tolerancia de simplificacao precisa ser positiva; recebi ${String(toleranciaUM)}. ` +
      `Simplificar sem tolerancia declarada e o mesmo que simplificar sem criterio.`,
    { pecaId: peca.id, toleranciaUM },
  );

  const protegidos = pontosProtegidos(peca);
  const trechos = trechosSimplificaveis(peca, protegidos);
  if (trechos.length === 0) return peca;

  const segmentos: Record<Id, Segmento> = { ...peca.segmentos };
  const pontos: Record<Id, Ponto> = { ...peca.pontos };
  const removidos = new Set<Id>();

  for (const trecho of trechos) {
    const caminho = trecho.pontoIds.map((id) => {
      const ponto = peca.pontos[id]!;
      return { x: ponto.x, y: ponto.y };
    });
    const mantidos = indicesMantidos(caminho, toleranciaUM);
    if (mantidos.length === trecho.pontoIds.length) continue;

    // Reaproveita os primeiros ids de segmento do trecho; os demais somem.
    for (let k = 0; k < mantidos.length - 1; k++) {
      const id = trecho.segmentoIds[k]!;
      segmentos[id] = {
        ...segmentos[id]!,
        de: trecho.pontoIds[mantidos[k]!]!,
        para: trecho.pontoIds[mantidos[k + 1]!]!,
        tipo: 'reta',
      };
    }
    for (let k = mantidos.length - 1; k < trecho.segmentoIds.length; k++) {
      removidos.add(trecho.segmentoIds[k]!);
      delete segmentos[trecho.segmentoIds[k]!];
    }
    const sobreviventes = new Set(mantidos.map((i) => trecho.pontoIds[i]!));
    for (const id of trecho.pontoIds) {
      if (!sobreviventes.has(id)) delete pontos[id];
    }
  }

  if (removidos.size === 0) return peca;
  return {
    ...peca,
    pontos,
    segmentos,
    contorno: peca.contorno.filter((id) => !removidos.has(id)),
  };
}

// ===========================================================================
// Interno
// ===========================================================================

interface Canto {
  readonly vertice: Vetor2;
  /** Unitario do vertice em direcao ao ponto ANTERIOR do contorno. */
  readonly paraAnterior: Vetor2Flutuante;
  /** Unitario do vertice em direcao ao proximo ponto. */
  readonly paraProximo: Vetor2Flutuante;
  readonly anguloInterno: number;
  readonly distanciaAnterior: number;
  readonly distanciaProxima: number;
  readonly queChega: Segmento;
  readonly queSai: Segmento;
}

interface Vetor2Flutuante {
  readonly x: number;
  readonly y: number;
}

interface TrechoNovo {
  readonly tipo: 'reta' | 'curva';
  readonly inicio: Vetor2;
  readonly fim: Vetor2;
  readonly bezier?: Bezier;
}

function lerCanto(peca: Peca, pontoId: Id, operacao: string): Canto {
  exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Vertice');

  const iChega = peca.contorno.findIndex((id) => peca.segmentos[id]!.para === pontoId);
  const iSai = peca.contorno.findIndex((id) => peca.segmentos[id]!.de === pontoId);
  exigir(
    iChega >= 0 && iSai >= 0,
    'PONTO_FORA_DO_CONTORNO',
    `O ponto "${pontoId}" nao e juncao de dois segmentos do contorno; nao ha canto para ` +
      `${operacao}.`,
    { pecaId: peca.id, pontoId },
  );

  const queChega = peca.segmentos[peca.contorno[iChega]!]!;
  const queSai = peca.segmentos[peca.contorno[iSai]!]!;
  exigir(
    queChega.tipo === 'reta' && queSai.tipo === 'reta',
    'FILLET_EM_CURVA_NAO_SUPORTADO',
    `O vertice "${pontoId}" e encontro de curva com algo ("${queChega.id}" e ` +
      `"${queSai.id}"). ${operacao} um canto onde ja ha curva exige achar a tangencia ` +
      `sobre a Bezier, que e outra operacao. Recusando em vez de aproximar.`,
    { pecaId: peca.id, pontoId },
  );

  const vertice = coordenada(peca, pontoId);
  const anterior = coordenada(peca, queChega.de);
  const proximo = coordenada(peca, queSai.para);

  const paraAnterior = normalizar(anterior, vertice);
  const paraProximo = normalizar(proximo, vertice);
  const cosseno = Math.max(
    -1,
    Math.min(1, paraAnterior.x * paraProximo.x + paraAnterior.y * paraProximo.y),
  );
  exigir(
    Math.abs(cosseno) < 0.999999,
    'VERTICE_DEGENERADO',
    `Os dois lados do vertice "${pontoId}" sao praticamente colineares (cos = ` +
      `${cosseno.toFixed(6)}). Nao ha canto para ${operacao}.`,
    { pecaId: peca.id, pontoId, cosseno },
  );

  return {
    vertice,
    paraAnterior,
    paraProximo,
    anguloInterno: Math.acos(cosseno),
    distanciaAnterior: Math.hypot(anterior.x - vertice.x, anterior.y - vertice.y),
    distanciaProxima: Math.hypot(proximo.x - vertice.x, proximo.y - vertice.y),
    queChega,
    queSai,
  };
}

function exigirQueCaiba(
  peca: Peca,
  pontoId: Id,
  recuo: number,
  canto: Canto,
  oQue: string,
): void {
  exigir(
    recuo < canto.distanciaAnterior && recuo < canto.distanciaProxima,
    'FILLET_NAO_CABE',
    `O ${oQue} no vertice "${pontoId}" recua ${Math.round(recuo)} UM de cada lado, mas os ` +
      `lados medem ${Math.round(canto.distanciaAnterior)} e ` +
      `${Math.round(canto.distanciaProxima)} UM. O canto comeria o segmento vizinho ` +
      `inteiro e o contorno se dobraria sobre si mesmo.`,
    { pecaId: peca.id, pontoId, recuo: Math.round(recuo) },
  );
}

/**
 * Troca o vertice pelos dois pontos de tangencia e pelo trecho entre eles.
 *
 * Quando o vertice e a FRONTEIRA entre duas arestas, o trecho novo pertence as
 * duas: ele e partido ao meio (por comprimento de arco) e o ponto do meio vira a
 * nova fronteira. As duas arestas mantem o id (D3) — o que muda e so onde uma
 * acaba e a outra comeca, que e inevitavel: o ponto antigo deixou de existir.
 */
function trocarVerticePorTrecho(
  peca: Peca,
  pontoId: Id,
  prefixoId: Id,
  canto: Canto,
  trecho: TrechoNovo,
): Peca {
  const idInicio = `${prefixoId}-i`;
  const idFim = `${prefixoId}-f`;
  const idMeio = `${prefixoId}-m`;
  const idSeg1 = `${prefixoId}-s1`;
  const idSeg2 = `${prefixoId}-s2`;
  for (const id of [idInicio, idFim, idMeio]) {
    exigir(
      peca.pontos[id] === undefined,
      'PONTO_DUPLICADO',
      `O prefixo "${prefixoId}" ja foi usado nesta peca (existe o ponto "${id}").`,
      { pecaId: peca.id, prefixoId },
    );
  }

  const atravessaArestas = canto.queChega.arestaId !== canto.queSai.arestaId;
  const pontos: Record<Id, Ponto> = { ...peca.pontos };
  delete pontos[pontoId];
  pontos[idInicio] = { id: idInicio, x: trecho.inicio.x, y: trecho.inicio.y, tipo: 'contorno' };
  pontos[idFim] = { id: idFim, x: trecho.fim.x, y: trecho.fim.y, tipo: 'contorno' };

  const segmentos: Record<Id, Segmento> = { ...peca.segmentos };
  segmentos[canto.queChega.id] = { ...canto.queChega, para: idInicio };
  segmentos[canto.queSai.id] = { ...canto.queSai, de: idFim };

  const novos: Id[] = [];
  const arestas: Record<Id, Aresta> = { ...peca.arestas };

  if (!atravessaArestas) {
    segmentos[idSeg1] = montarSegmento(idSeg1, canto.queChega.arestaId, idInicio, idFim, trecho);
    novos.push(idSeg1);
  } else {
    const [primeira, segunda] = partirAoMeio(trecho);
    pontos[idMeio] = { id: idMeio, x: primeira.fim.x, y: primeira.fim.y, tipo: 'contorno' };
    segmentos[idSeg1] = montarSegmento(idSeg1, canto.queChega.arestaId, idInicio, idMeio, primeira);
    segmentos[idSeg2] = montarSegmento(idSeg2, canto.queSai.arestaId, idMeio, idFim, segunda);
    novos.push(idSeg1, idSeg2);

    // As arestas mantem o id; muda so onde uma acaba e a outra comeca.
    const arestaQueChega = peca.arestas[canto.queChega.arestaId]!;
    const arestaQueSai = peca.arestas[canto.queSai.arestaId]!;
    arestas[arestaQueChega.id] = { ...arestaQueChega, pontoFimId: idMeio };
    arestas[arestaQueSai.id] = { ...arestaQueSai, pontoInicioId: idMeio };
  }

  const contorno = [...peca.contorno];
  contorno.splice(contorno.indexOf(canto.queChega.id) + 1, 0, ...novos);

  return { ...peca, pontos, segmentos, arestas, contorno };
}

function montarSegmento(
  id: Id,
  arestaId: Id,
  de: Id,
  para: Id,
  trecho: TrechoNovo,
): Segmento {
  if (trecho.tipo === 'reta') return { id, arestaId, de, para, tipo: 'reta' };
  const bezier = trecho.bezier!;
  return {
    id,
    arestaId,
    de,
    para,
    tipo: 'curva',
    controles: [arredondar(bezier[1]), arredondar(bezier[2])],
  };
}

/** Parte o trecho novo ao meio por comprimento de arco. */
function partirAoMeio(trecho: TrechoNovo): [TrechoNovo, TrechoNovo] {
  if (trecho.tipo === 'reta') {
    const meio = arredondar({
      x: (trecho.inicio.x + trecho.fim.x) / 2,
      y: (trecho.inicio.y + trecho.fim.y) / 2,
    });
    return [
      { tipo: 'reta', inicio: trecho.inicio, fim: meio },
      { tipo: 'reta', inicio: meio, fim: trecho.fim },
    ];
  }
  const bezier = trecho.bezier!;
  const t = parametroEmS(bezier, 0.5, TOLERANCIA_MEDICAO_UM);
  const [esquerda, direita] = subdividirEmT(bezier, t);
  const meio = arredondar(esquerda[3]);
  return [
    { tipo: 'curva', inicio: trecho.inicio, fim: meio, bezier: esquerda },
    { tipo: 'curva', inicio: meio, fim: trecho.fim, bezier: direita },
  ];
}

function pontosProtegidos(peca: Peca): Set<Id> {
  const protegidos = new Set<Id>();
  for (const aresta of Object.values(peca.arestas)) {
    protegidos.add(aresta.pontoInicioId);
    protegidos.add(aresta.pontoFimId);
  }
  for (const gradePoint of Object.values(peca.gradePoints)) {
    protegidos.add(gradePoint.pontoId);
  }
  for (const segmento of Object.values(peca.segmentos)) {
    if (segmento.tipo === 'curva') {
      protegidos.add(segmento.de);
      protegidos.add(segmento.para);
    }
  }
  return protegidos;
}

interface Trecho {
  readonly pontoIds: readonly Id[];
  readonly segmentoIds: readonly Id[];
}

/** Corridas maximas de retas da mesma aresta entre dois pontos protegidos. */
function trechosSimplificaveis(peca: Peca, protegidos: ReadonlySet<Id>): Trecho[] {
  const trechos: Trecho[] = [];
  let pontoIds: Id[] = [];
  let segmentoIds: Id[] = [];
  let arestaAtual: Id | null = null;

  const fechar = (): void => {
    if (segmentoIds.length >= 2) trechos.push({ pontoIds, segmentoIds });
    pontoIds = [];
    segmentoIds = [];
    arestaAtual = null;
  };

  for (const segmentoId of peca.contorno) {
    const segmento = peca.segmentos[segmentoId]!;
    const podeEntrar =
      segmento.tipo === 'reta' &&
      (arestaAtual === null || arestaAtual === segmento.arestaId) &&
      (segmentoIds.length === 0 || !protegidos.has(segmento.de));

    if (!podeEntrar) {
      fechar();
      if (segmento.tipo !== 'reta') continue;
    }
    if (segmentoIds.length === 0) {
      pontoIds.push(segmento.de);
      arestaAtual = segmento.arestaId;
    }
    pontoIds.push(segmento.para);
    segmentoIds.push(segmentoId);
  }
  fechar();
  return trechos;
}

/** Indices do caminho que o Douglas-Peucker do clipper2 manteve. */
function indicesMantidos(caminho: readonly Vetor2[], toleranciaUM: UM): number[] {
  const mantidos = simplificarCaminho(caminho, toleranciaUM);
  const indices: number[] = [];
  let i = 0;
  for (const ponto of mantidos) {
    while (i < caminho.length && !mesmoPonto(caminho[i]!, ponto)) i++;
    if (i < caminho.length) indices.push(i++);
  }
  return indices;
}

function bezierDoSegmento(peca: Peca, segmento: Segmento): Bezier {
  exigir(
    segmento.controles !== undefined,
    'CURVA_SEM_CONTROLES',
    `Segmento "${segmento.id}" e curva mas nao tem os 2 pontos de controle da Bezier (D1).`,
    { pecaId: peca.id, segmentoId: segmento.id },
  );
  return bezierDe(coordenada(peca, segmento.de), segmento.controles, coordenada(peca, segmento.para));
}

function coordenada(peca: Peca, pontoId: Id): Vetor2 {
  const ponto = exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto');
  return { x: ponto.x, y: ponto.y };
}

function normalizar(destino: Vetor2, origem: Vetor2): Vetor2Flutuante {
  const dx = destino.x - origem.x;
  const dy = destino.y - origem.y;
  const comprimento = Math.hypot(dx, dy);
  if (comprimento === 0) {
    throw new ErroMotor(
      'SEGMENTO_COMPRIMENTO_ZERO',
      `Dois pontos do contorno estao na mesma coordenada (${origem.x}, ${origem.y}).`,
      { origem },
    );
  }
  return { x: dx / comprimento, y: dy / comprimento };
}

function aPartirDoVertice(
  vertice: Vetor2,
  direcao: Vetor2Flutuante,
  distancia: number,
): Vetor2Flutuante {
  return { x: vertice.x + direcao.x * distancia, y: vertice.y + direcao.y * distancia };
}

function aoLongoDaReta(de: Vetor2, para: Vetor2, fracao: number): Vetor2 {
  return {
    x: Math.round(de.x + (para.x - de.x) * fracao),
    y: Math.round(de.y + (para.y - de.y) * fracao),
  };
}

function arredondar(ponto: Vetor2Flutuante): Vetor2 {
  return { x: Math.round(ponto.x), y: Math.round(ponto.y) };
}

function mesmoPonto(a: Vetor2, b: Vetor2): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * A simplificacao em si e do clipper2 (inegociavel 3): so a conversao de formato
 * fica aqui, para o resto do arquivo nao depender do tipo de caminho da biblioteca.
 */
function simplificarCaminho(caminho: readonly Vetor2[], toleranciaUM: UM): Vetor2[] {
  const entrada = caminho.map((p) => ({ x: p.x, y: p.y }));
  return ramerDouglasPeucker(entrada, toleranciaUM).map((p) => ({ x: p.x, y: p.y }));
}
