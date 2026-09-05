/**
 * Normalizacao de winding (D4).
 *
 * O contorno e SEMPRE CCW no nucleo. Nunca confie no sentido que veio do DXF:
 * um contorno CW faria o offset de delta positivo apontar para DENTRO e mandaria
 * um molde menor que o necessario para a mesa de corte.
 *
 * Inverter o contorno nao e so inverter a lista de segmentos: e preciso trocar
 * `de`/`para` de cada segmento, inverter a ordem dos controles da Bezier (senao a
 * curva vira do avesso), trocar inicio/fim de cada aresta e refletir a posicao `s`
 * dos piques (s -> 1 - s), que e medida ao longo da aresta.
 *
 * O ID de cada aresta e preservado (D3).
 */
import type { Peca, Pique, Segmento, Aresta, Id } from '../tipos.js';
import { anelDoContorno, areaComSinal, ehCCW } from './anel.js';

/** Forca o contorno da peca a ficar em CCW. Idempotente. */
export function normalizarWinding(peca: Peca): Peca {
  const anel = anelDoContorno(peca);
  if (ehCCW(anel)) return peca;
  return inverterContorno(peca);
}

/** Area com sinal do contorno da peca, em UM^2. Positiva = CCW. */
export function areaDoContorno(peca: Peca): number {
  return areaComSinal(anelDoContorno(peca));
}

function inverterContorno(peca: Peca): Peca {
  const segmentos: Record<Id, Segmento> = {};
  for (const id of Object.keys(peca.segmentos)) {
    segmentos[id] = inverterSegmento(peca.segmentos[id]!);
  }

  const arestas: Record<Id, Aresta> = {};
  for (const id of Object.keys(peca.arestas)) {
    const aresta = peca.arestas[id]!;
    arestas[id] = {
      id: aresta.id,
      pecaId: aresta.pecaId,
      pontoInicioId: aresta.pontoFimId,
      pontoFimId: aresta.pontoInicioId,
    };
  }

  const piques: Record<Id, Pique> = {};
  for (const id of Object.keys(peca.piques)) {
    const pique = peca.piques[id]!;
    piques[id] = { ...pique, s: 1 - pique.s };
  }

  return {
    ...peca,
    segmentos,
    arestas,
    piques,
    contorno: [...peca.contorno].reverse(),
  };
}

function inverterSegmento(segmento: Segmento): Segmento {
  const invertido: Segmento = {
    id: segmento.id,
    arestaId: segmento.arestaId,
    de: segmento.para,
    para: segmento.de,
    tipo: segmento.tipo,
  };
  if (segmento.controles === undefined) return invertido;
  return { ...invertido, controles: [segmento.controles[1], segmento.controles[0]] };
}
