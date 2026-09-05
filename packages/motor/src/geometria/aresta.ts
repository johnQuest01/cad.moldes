/**
 * Localizar os segmentos de uma Aresta dentro do contorno (D3).
 *
 * A Aresta tem ID estavel e agrupa os segmentos entre dois pontos notaveis. Ela
 * NAO e derivada de indice — mas para medir, offsetar por aresta e ancorar pique
 * e preciso descobrir, no contorno, qual trecho pertence a ela.
 *
 * O contorno e CICLICO: uma aresta pode atravessar o fim da lista (o trecho que
 * vai do ultimo segmento de volta ao primeiro). Por isso a busca aceita corrida
 * circular, mas exige que ela seja UMA SO — segmentos da mesma aresta espalhados
 * em dois trechos separados sao contorno corrompido, nao caso a tratar.
 */
import { exigir, exigirDoMapa } from '../erros.js';
import type { Id, Peca, Segmento } from '../tipos.js';

/**
 * Segmentos da aresta, na ordem do contorno, do `pontoInicioId` ao `pontoFimId`.
 * Estoura se o trecho nao for contiguo ou se os extremos nao baterem com a Aresta.
 */
export function segmentosDaAresta(peca: Peca, arestaId: Id): Segmento[] {
  const aresta = exigirDoMapa(peca.arestas, arestaId, 'ARESTA_INEXISTENTE', 'Aresta');
  const total = peca.contorno.length;
  const pertence: boolean[] = [];
  for (const segmentoId of peca.contorno) {
    const segmento = exigirDoMapa(peca.segmentos, segmentoId, 'SEGMENTO_INEXISTENTE', 'Segmento');
    pertence.push(segmento.arestaId === arestaId);
  }

  const quantos = pertence.filter(Boolean).length;
  exigir(
    quantos > 0,
    'ARESTA_SEM_SEGMENTOS',
    `A aresta "${arestaId}" da peca "${peca.metadados.nome}" nao tem nenhum segmento no ` +
      `contorno. Aresta sem segmento nao pode ser medida nem receber margem.`,
    { pecaId: peca.id, arestaId },
  );

  // Inicio da corrida: o unico indice cujo antecessor ciclico nao pertence a aresta.
  const inicios: number[] = [];
  for (let i = 0; i < total; i++) {
    if (pertence[i]! && !pertence[(i - 1 + total) % total]) inicios.push(i);
  }
  if (quantos < total) {
    exigir(
      inicios.length === 1,
      'ARESTA_DESCONTINUA',
      `Os ${quantos} segmentos da aresta "${arestaId}" aparecem em ${inicios.length} trechos ` +
        `separados do contorno. Uma aresta e um trecho continuo entre dois pontos notaveis.`,
      { pecaId: peca.id, arestaId, trechos: inicios.length },
    );
  }
  const inicio = quantos === total ? 0 : inicios[0]!;

  const segmentos: Segmento[] = [];
  for (let k = 0; k < quantos; k++) {
    const i = (inicio + k) % total;
    exigir(
      pertence[i]!,
      'ARESTA_DESCONTINUA',
      `A aresta "${arestaId}" tem um furo: o segmento na posicao ${i} do contorno ` +
        `pertence a outra aresta.`,
      { pecaId: peca.id, arestaId, posicao: i },
    );
    segmentos.push(peca.segmentos[peca.contorno[i]!]!);
  }

  const primeiro = segmentos[0]!;
  const ultimo = segmentos[segmentos.length - 1]!;
  exigir(
    primeiro.de === aresta.pontoInicioId && ultimo.para === aresta.pontoFimId,
    'ARESTA_EXTREMOS_DIVERGENTES',
    `A aresta "${arestaId}" declara ir de "${aresta.pontoInicioId}" a "${aresta.pontoFimId}", ` +
      `mas o trecho do contorno vai de "${primeiro.de}" a "${ultimo.para}".`,
    {
      pecaId: peca.id,
      arestaId,
      declarado: [aresta.pontoInicioId, aresta.pontoFimId],
      encontrado: [primeiro.de, ultimo.para],
    },
  );

  return segmentos;
}
