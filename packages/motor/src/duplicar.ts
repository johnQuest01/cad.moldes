/**
 * Duplicar peca — o gesto com que todo molde comeca.
 *
 * Desenha-se a frente, duplica-se, ajusta-se o decote e vira costas. Sem isto o
 * modelista redesenha tudo do zero, e duas pecas que deveriam ser irmas nascem com
 * medidas que nao batem.
 *
 * ## Por que TODO id e reescrito
 * A tentacao e copiar a peca so trocando o `Peca.id`. Nao serve: `ParCostura` e
 * `RegraGraduacao` vivem no MODELO e apontam para `arestaId` e `gradePointId`. Se
 * a copia reaproveitasse esses ids, uma regra de graduacao da frente passaria a
 * mover tambem a costas, e um par de costura casaria a aresta errada — em silencio,
 * que e o pior jeito de errar. Por isso cada entidade interna ganha id novo,
 * derivado de `prefixoId` de forma deterministica (D2: entropia vem de fora, o
 * replay tem que reproduzir os mesmos ids).
 *
 * ## O que NAO e copiado aqui
 * As regras de graduacao. Elas moram no `Modelo`, e esta funcao so enxerga a
 * `Peca`. Quem decide e o fold do evento `DuplicarPeca`, pelo campo
 * `comGraduacao` — e o mapa `gradePointsNovos` devolvido aqui e o que ele usa para
 * reapontar as regras copiadas.
 */
import { exigir } from './erros.js';
import type {
  Aresta,
  EixoDobra,
  Id,
  LinhaInterna,
  Peca,
  Pique,
  Ponto,
  PontoGraduacao,
  Recorte,
  Segmento,
} from './tipos.js';
import { exigirUM, type UM } from './unidades.js';
import { transladarPeca } from './transformar.js';

/** A copia, mais o mapa que liga cada grade point antigo ao novo. */
export interface PecaDuplicada {
  readonly peca: Peca;
  /** gradePointId antigo -> novo. E o que o fold usa para copiar as regras. */
  readonly gradePointsNovos: ReadonlyMap<Id, Id>;
}

/** Copia a peca inteira com ids novos e a afasta da original. Nao muta a entrada. */
export function duplicarPeca(
  peca: Peca,
  novoPecaId: Id,
  prefixoId: Id,
  deslocamento: { readonly dx: UM; readonly dy: UM },
): PecaDuplicada {
  exigir(
    novoPecaId.length > 0 && prefixoId.length > 0,
    'PECA_INEXISTENTE',
    `duplicarPeca precisa de um id de peca e de um prefixo nao vazios; recebi ` +
      `"${novoPecaId}" e "${prefixoId}".`,
    { pecaId: peca.id },
  );
  exigirUM(deslocamento.dx, 'dx de duplicarPeca');
  exigirUM(deslocamento.dy, 'dy de duplicarPeca');

  // Um renomeador por familia de entidade. Numera pela ORDEM DE INSERCAO do mapa,
  // que no JS e estavel — dois replays do mesmo log geram os mesmos ids.
  const renomear = (chaves: readonly Id[], sigla: string): Map<Id, Id> =>
    new Map(chaves.map((antigo, i) => [antigo, `${prefixoId}-${sigla}-${i}`]));

  const pontosNovos = renomear(Object.keys(peca.pontos), 'pt');
  const segmentosNovos = renomear(Object.keys(peca.segmentos), 'sg');
  const arestasNovas = renomear(Object.keys(peca.arestas), 'ar');
  const linhasNovas = renomear(Object.keys(peca.linhasInternas), 'li');
  const recortesNovos = renomear(Object.keys(peca.recortes), 'rc');
  const piquesNovos = renomear(Object.keys(peca.piques), 'pq');
  const eixosNovos = renomear(Object.keys(peca.eixosDobra), 'ed');
  const gradePointsNovos = renomear(Object.keys(peca.gradePoints), 'gp');

  const de = (mapa: Map<Id, Id>, antigo: Id): Id => {
    const novo = mapa.get(antigo);
    // Uma referencia interna que nao esta no mapa e peca corrompida, nao caso a
    // tratar: copiar mantendo o id antigo espalharia a corrupcao para a copia.
    exigir(
      novo !== undefined,
      'PONTO_INEXISTENTE',
      `A peca "${peca.metadados.nome}" referencia a entidade "${antigo}", que nao existe ` +
        `nela. Duplicar uma peca com referencia quebrada so duplicaria o defeito.`,
      { pecaId: peca.id, entidadeId: antigo },
    );
    return novo;
  };

  const pontos: Record<Id, Ponto> = {};
  for (const [antigo, ponto] of Object.entries(peca.pontos)) {
    pontos[de(pontosNovos, antigo)] = { ...ponto, id: de(pontosNovos, antigo) };
  }

  const segmentos: Record<Id, Segmento> = {};
  for (const [antigo, segmento] of Object.entries(peca.segmentos)) {
    const id = de(segmentosNovos, antigo);
    segmentos[id] = {
      ...segmento,
      id,
      arestaId: de(arestasNovas, segmento.arestaId),
      de: de(pontosNovos, segmento.de),
      para: de(pontosNovos, segmento.para),
    };
  }

  const arestas: Record<Id, Aresta> = {};
  const margens: Record<Id, UM> = {};
  for (const [antigo, aresta] of Object.entries(peca.arestas)) {
    const id = de(arestasNovas, antigo);
    arestas[id] = {
      id,
      pecaId: novoPecaId,
      pontoInicioId: de(pontosNovos, aresta.pontoInicioId),
      pontoFimId: de(pontosNovos, aresta.pontoFimId),
    };
    const margem = peca.margens[antigo];
    if (margem !== undefined) margens[id] = margem;
  }

  const linhasInternas: Record<Id, LinhaInterna> = {};
  for (const [antigo, linha] of Object.entries(peca.linhasInternas)) {
    const id = de(linhasNovas, antigo);
    linhasInternas[id] = { ...linha, id, pontos: linha.pontos.map((p) => de(pontosNovos, p)) };
  }

  const recortes: Record<Id, Recorte> = {};
  for (const [antigo, recorte] of Object.entries(peca.recortes)) {
    const id = de(recortesNovos, antigo);
    recortes[id] = { id, pontos: recorte.pontos.map((p) => de(pontosNovos, p)) };
  }

  const piques: Record<Id, Pique> = {};
  for (const [antigo, pique] of Object.entries(peca.piques)) {
    const id = de(piquesNovos, antigo);
    piques[id] = { ...pique, id, arestaId: de(arestasNovas, pique.arestaId) };
  }

  const eixosDobra: Record<Id, EixoDobra> = {};
  for (const [antigo, eixo] of Object.entries(peca.eixosDobra)) {
    const id = de(eixosNovos, antigo);
    eixosDobra[id] = { ...eixo, id };
  }

  const gradePoints: Record<Id, PontoGraduacao> = {};
  for (const [antigo, gp] of Object.entries(peca.gradePoints)) {
    const id = de(gradePointsNovos, antigo);
    gradePoints[id] = { id, pontoId: de(pontosNovos, gp.pontoId) };
  }

  const copia: Peca = {
    ...peca,
    id: novoPecaId,
    pontos,
    segmentos,
    arestas,
    contorno: peca.contorno.map((s) => de(segmentosNovos, s)),
    margens,
    linhasInternas,
    recortes,
    piques,
    eixosDobra,
    gradePoints,
    metadados: { ...peca.metadados, nome: `${peca.metadados.nome} (copia)` },
  };

  return {
    peca: transladarPeca(copia, deslocamento.dx, deslocamento.dy),
    gradePointsNovos,
  };
}
