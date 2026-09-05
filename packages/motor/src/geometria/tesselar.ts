/**
 * Tesselacao (Parte 2, operacao 2): curva -> poligonal na TOLERANCIA_TESSELACAO_UM,
 * mantendo a associacao com o segmento original.
 *
 * REGRA: a poligonal NUNCA e persistida — so a definicao da curva. Tesselar sempre
 * na leitura. Poligonal persistida vira float que varia entre plataformas e quebra
 * o teste de integridade da Parte 4. Por isso a tesselacao tem que ser
 * deterministica: ver o cabecalho de `bezier.ts` para o motivo de ela nao sair do
 * amostrador adaptativo do verb.
 *
 * A saida volta para MICROMETRO INTEIRO (inegociavel 1). O arredondamento dos
 * vertices interiores desloca cada um em no maximo 0,5 UM — tres ordens de
 * grandeza abaixo da tolerancia de 100 UM. Os extremos NAO sao arredondados: eles
 * sao copiados dos `Ponto` armazenados, entao a poligonal encosta exatamente nos
 * pontos do modelo e a emenda entre segmentos fecha sem folga.
 */
import { exigir, exigirDoMapa } from '../erros.js';
import type { Id, Peca, Vetor2 } from '../tipos.js';
import { TOLERANCIA_TESSELACAO_UM, type UM } from '../unidades.js';
import { bezierDe, tesselarBezier, type Vetor2F } from './bezier.js';

/**
 * Poligonal de um segmento do contorno, em UM inteiro, com os dois extremos.
 * Reta devolve exatamente 2 pontos; curva devolve a subdivisao dentro da tolerancia.
 * Vertices consecutivos que caem no mesmo inteiro sao fundidos — dois vertices a
 * menos de 1 UM nao carregam informacao e viram junta espuria no offset.
 */
export function tesselarSegmento(
  peca: Peca,
  segmentoId: string,
  toleranciaUM: UM = TOLERANCIA_TESSELACAO_UM,
): Vetor2[] {
  const segmento = exigirDoMapa(peca.segmentos, segmentoId, 'SEGMENTO_INEXISTENTE', 'Segmento');
  const de = pontoDo(peca, segmento.de);
  const para = pontoDo(peca, segmento.para);

  if (segmento.tipo === 'reta') {
    exigir(
      de.x !== para.x || de.y !== para.y,
      'SEGMENTO_COMPRIMENTO_ZERO',
      `Segmento "${segmento.id}" liga dois pontos na mesma coordenada (${de.x}, ${de.y}).`,
      { pecaId: peca.id, segmentoId: segmento.id },
    );
    return [de, para];
  }

  exigir(
    segmento.controles !== undefined,
    'CURVA_SEM_CONTROLES',
    `Segmento "${segmento.id}" e curva mas nao tem os 2 pontos de controle da Bezier (D1).`,
    { pecaId: peca.id, segmentoId: segmento.id },
  );

  const bezier = bezierDe(de, segmento.controles, para);
  const bruta = tesselarBezier(bezier, toleranciaUM);
  const pontos = paraInteiros(bruta, de, para);

  exigir(
    pontos.length >= 2,
    'SEGMENTO_COMPRIMENTO_ZERO',
    `Segmento "${segmento.id}" e uma curva de comprimento zero: os 4 pontos de controle ` +
      `caem na mesma coordenada (${de.x}, ${de.y}).`,
    { pecaId: peca.id, segmentoId: segmento.id },
  );
  return pontos;
}

/**
 * Anel do contorno com a ARESTA de cada trecho.
 *
 * `arestas[i]` e a aresta dona da corda que SAI de `pontos[i]` e chega em
 * `pontos[i+1]` (ciclico). E o que permite ao offset dar a cada trecho a margem
 * da sua propria aresta (D3) em vez de uma margem so para a peca inteira.
 */
export interface AnelComArestas {
  readonly pontos: readonly Vetor2[];
  readonly arestas: readonly Id[];
}

/**
 * Anel de vertices do contorno inteiro, ja tesselado, em UM inteiro.
 * O primeiro ponto NAO e repetido no fim. Valida continuidade e fechamento —
 * nunca conserta um furo em silencio.
 */
export function tesselarContorno(
  peca: Peca,
  toleranciaUM: UM = TOLERANCIA_TESSELACAO_UM,
): Vetor2[] {
  return anelComArestas(peca, toleranciaUM).pontos as Vetor2[];
}

/** Mesma caminhada de `tesselarContorno`, guardando a aresta dona de cada corda. */
export function anelComArestas(
  peca: Peca,
  toleranciaUM: UM = TOLERANCIA_TESSELACAO_UM,
): AnelComArestas {
  exigir(
    peca.contorno.length > 0,
    'CONTORNO_VAZIO',
    `Peca "${peca.metadados.nome}" (${peca.id}) nao tem contorno.`,
    { pecaId: peca.id },
  );
  exigir(
    peca.contorno.length >= 3,
    'CONTORNO_DEGENERADO',
    `Contorno da peca "${peca.metadados.nome}" tem ${peca.contorno.length} segmento(s); ` +
      `um poligono fechado precisa de pelo menos 3.`,
    { pecaId: peca.id, segmentos: peca.contorno.length },
  );

  const primeiro = exigirDoMapa(
    peca.segmentos,
    peca.contorno[0]!,
    'SEGMENTO_INEXISTENTE',
    'Segmento',
  );
  const pontos: Vetor2[] = [];
  const arestas: Id[] = [];
  let esperadoDe: string | null = null;

  for (const segmentoId of peca.contorno) {
    const segmento = exigirDoMapa(peca.segmentos, segmentoId, 'SEGMENTO_INEXISTENTE', 'Segmento');
    exigir(
      esperadoDe === null || segmento.de === esperadoDe,
      'SEGMENTO_DESCONTINUO',
      `Segmento "${segmento.id}" comeca no ponto "${segmento.de}", mas o segmento ` +
        `anterior terminou em "${String(esperadoDe)}". O contorno tem um furo.`,
      { pecaId: peca.id, segmentoId: segmento.id },
    );

    // O ultimo ponto e o primeiro do proximo segmento: entra uma vez so.
    const trecho = tesselarSegmento(peca, segmentoId, toleranciaUM);
    for (let i = 0; i < trecho.length - 1; i++) {
      pontos.push(trecho[i]!);
      arestas.push(segmento.arestaId);
    }
    esperadoDe = segmento.para;
  }

  exigir(
    esperadoDe === primeiro.de,
    'CONTORNO_ABERTO',
    `O contorno da peca "${peca.metadados.nome}" termina em "${String(esperadoDe)}" ` +
      `mas comeca em "${primeiro.de}". Linha de costura precisa ser um ciclo fechado.`,
    { pecaId: peca.id },
  );

  return { pontos, arestas };
}

/**
 * Arredonda a poligonal para inteiro, fixando os extremos nos pontos armazenados
 * e descartando vertices que colapsam no mesmo inteiro.
 */
function paraInteiros(bruta: readonly Vetor2F[], de: Vetor2, para: Vetor2): Vetor2[] {
  const saida: Vetor2[] = [de];
  for (let i = 1; i < bruta.length - 1; i++) {
    const p = bruta[i]!;
    const inteiro = { x: Math.round(p.x), y: Math.round(p.y) };
    const anterior = saida[saida.length - 1]!;
    if (inteiro.x === anterior.x && inteiro.y === anterior.y) continue;
    saida.push(inteiro);
  }
  const ultimo = saida[saida.length - 1]!;
  if (ultimo.x === para.x && ultimo.y === para.y) return saida;
  saida.push(para);
  return saida;
}

function pontoDo(peca: Peca, pontoId: string): Vetor2 {
  const ponto = exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto');
  return { x: ponto.x, y: ponto.y };
}
