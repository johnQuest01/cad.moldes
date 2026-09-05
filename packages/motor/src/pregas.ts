/**
 * Dobra multipla — pregas (Parte 3, operacao 14, terceiro caso).
 *
 * `N` eixos paralelos, profundidade por prega, e os piques de inicio e fim de cada
 * dobra. Distinta da dobra simples (que espelha) e da divisao (que gera pecas
 * separadas): aqui sai UMA peca, mais larga.
 *
 * ## Quanto tecido cada prega come
 * Uma prega de profundidade `D` dobra o tecido duas vezes, entao consome `2D` de
 * largura plana. E a conta do oficio, e vale igual para prega macho e prega
 * sanfona: a `direcao` (dentro/fora) muda como a prega assenta, nao quanto tecido
 * ela leva. Com `N` eixos de profundidade `D`, a peca plana fica `N * 2D` mais
 * larga que a acabada.
 *
 * ## Como e feito: cortar e abrir
 * Em cada eixo os cruzamentos com o contorno viram vertices (operacao 13), e tudo
 * que esta do lado de la e transladado por `2D` na perpendicular ao eixo. As
 * arestas que cruzavam o eixo se esticam sozinhas — que e exatamente o "slash and
 * spread" da modelagem, sem aproximacao nenhuma.
 *
 * Os eixos sao processados do mais distante para o mais proximo, para o
 * deslocamento de um nao mexer na posicao onde o proximo ainda vai cortar.
 */
import { exigir } from './erros.js';
import type { EixoDobra, Id, Peca, Pique, Ponto, Vetor2 } from './tipos.js';
import { exigirUM, TOLERANCIA_MEDICAO_UM, type UM } from './unidades.js';
import { anelDoContorno } from './geometria/anel.js';
import { tesselarSegmento } from './geometria/tesselar.js';
import { inserirPonto } from './edicao.js';
import { direcaoDoEixo, ladoDoEixo, type Eixo, type Vetor2Flutuante } from './transformar.js';

const NA_LINHA_UM = 2;

/**
 * Abre as pregas dos eixos dados e devolve a peca PLANA, com os piques de inicio e
 * fim de cada dobra na aresta em que o eixo corta o contorno.
 */
export function abrirPregas(peca: Peca, eixoIds: readonly Id[], prefixoId: Id): Peca {
  exigir(
    eixoIds.length > 0,
    'PREGA_SEM_EIXO',
    `Abrir pregas na peca "${peca.metadados.nome}" sem nenhum eixo nao faz nada. ` +
      `Passe pelo menos um eixo de dobra.`,
    { pecaId: peca.id },
  );

  const eixos = eixoIds.map((id) => {
    const eixo = peca.eixosDobra[id];
    exigir(
      eixo !== undefined,
      'EIXO_DOBRA_INEXISTENTE',
      `O eixo de dobra "${id}" nao existe na peca "${peca.metadados.nome}".`,
      { pecaId: peca.id, eixoId: id },
    );
    exigir(
      eixo.profundidadeUM !== undefined && eixo.profundidadeUM > 0,
      'PREGA_SEM_PROFUNDIDADE',
      `O eixo "${id}" nao tem profundidade. Uma prega sem profundidade nao come tecido ` +
        `nenhum — se a intencao era so marcar a dobra, use a dobra simples.`,
      { pecaId: peca.id, eixoId: id },
    );
    exigirUM(eixo.profundidadeUM, `profundidadeUM do eixo ${id}`);
    return eixo;
  });

  exigirParalelos(peca, eixos);

  // Do mais distante para o mais proximo: assim o deslocamento de um eixo nao
  // move o contorno onde o proximo ainda precisa cortar.
  const referencia = { p1: eixos[0]!.p1, p2: eixos[0]!.p2 };
  const direcaoRef = direcaoDoEixo(referencia, peca.id);
  const ordenados = [...eixos].sort(
    (a, b) =>
      ladoDoEixo(b.p1, referencia, direcaoRef) - ladoDoEixo(a.p1, referencia, direcaoRef),
  );

  let atual = peca;
  const piques: Record<Id, Pique> = { ...peca.piques };
  let contador = 0;

  for (const eixoDobra of ordenados) {
    const eixo: Eixo = { p1: eixoDobra.p1, p2: eixoDobra.p2 };
    const direcao = direcaoDoEixo(eixo, peca.id);
    const abertura = 2 * eixoDobra.profundidadeUM!;

    atual = inserirCruzamentos(atual, eixo, direcao, `${prefixoId}-${contador}`);
    registrarPiques(atual, eixo, direcao, eixoDobra, piques, `${prefixoId}-${contador}`);
    atual = afastarLadoDeLa(atual, eixo, direcao, abertura);
    contador++;
  }

  return { ...atual, piques };
}

/** Largura que as pregas acrescentam: a soma de 2 x profundidade de cada eixo. */
export function aberturaDasPregas(peca: Peca, eixoIds: readonly Id[]): UM {
  return eixoIds.reduce((soma, id) => {
    const eixo = peca.eixosDobra[id];
    return soma + 2 * (eixo?.profundidadeUM ?? 0);
  }, 0);
}

function exigirParalelos(peca: Peca, eixos: readonly EixoDobra[]): void {
  const referencia = direcaoDoEixo({ p1: eixos[0]!.p1, p2: eixos[0]!.p2 }, peca.id);
  for (const eixo of eixos.slice(1)) {
    const direcao = direcaoDoEixo({ p1: eixo.p1, p2: eixo.p2 }, peca.id);
    const cruzado = Math.abs(referencia.x * direcao.y - referencia.y * direcao.x);
    exigir(
      cruzado < 1e-6,
      'EIXOS_DE_PREGA_NAO_PARALELOS',
      `O eixo "${eixo.id}" nao e paralelo ao primeiro (seno do angulo entre eles: ` +
        `${cruzado.toExponential(2)}). Pregas em eixos que se cruzam se sobreporiam, e o ` +
        `resultado nao seria uma peca plana.`,
      { pecaId: peca.id, eixoId: eixo.id },
    );
  }
}

function inserirCruzamentos(
  peca: Peca,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
  prefixoId: Id,
): Peca {
  let atual = peca;
  let contador = 0;
  for (const segmentoId of peca.contorno) {
    const s = cruzamentoNoSegmento(atual, segmentoId, eixo, direcao);
    if (s === null) continue;
    atual = inserirPonto(atual, segmentoId, s, `${prefixoId}-x${contador++}`);
  }
  return atual;
}

function cruzamentoNoSegmento(
  peca: Peca,
  segmentoId: Id,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
): number | null {
  const pontos = tesselarSegmento(peca, segmentoId, TOLERANCIA_MEDICAO_UM);
  const lados = pontos.map((p) => ladoDoEixo(p, eixo, direcao));
  if (Math.abs(lados[0]!) <= NA_LINHA_UM || Math.abs(lados[lados.length - 1]!) <= NA_LINHA_UM) {
    return null;
  }

  const acumulado: number[] = [0];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]!;
    const b = pontos[i]!;
    acumulado.push(acumulado[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = acumulado[acumulado.length - 1]!;
  if (total === 0) return null;

  for (let i = 1; i < pontos.length; i++) {
    if (lados[i - 1]! * lados[i]! > 0) continue;
    const fracao = lados[i - 1]! / (lados[i - 1]! - lados[i]!);
    const s = (acumulado[i - 1]! + fracao * (acumulado[i]! - acumulado[i - 1]!)) / total;
    if (s > 0 && s < 1) return s;
  }
  return null;
}

/** Um pique em cada ponto onde o eixo encontra o contorno: inicio e fim da dobra. */
function registrarPiques(
  peca: Peca,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
  eixoDobra: EixoDobra,
  piques: Record<Id, Pique>,
  prefixoId: Id,
): void {
  let contador = 0;
  for (const segmentoId of peca.contorno) {
    const segmento = peca.segmentos[segmentoId]!;
    const ponto = peca.pontos[segmento.de]!;
    if (Math.abs(ladoDoEixo(ponto, eixo, direcao)) > NA_LINHA_UM) continue;

    const s = posicaoNaAresta(peca, segmento.arestaId, segmento.de);
    if (s === null) continue;
    const id = `${prefixoId}-pq${contador++}`;
    piques[id] = {
      id,
      tipo: 'I',
      alturaUM: 6350,
      larguraUM: 1590,
      anguloGraus: 0,
      arestaId: segmento.arestaId,
      s,
    };
  }
  void eixoDobra;
}

/** `s` do ponto dentro da aresta dele, por comprimento de arco. */
function posicaoNaAresta(peca: Peca, arestaId: Id, pontoId: Id): number | null {
  const daAresta = peca.contorno
    .map((id) => peca.segmentos[id]!)
    .filter((segmento) => segmento.arestaId === arestaId);
  if (daAresta.length === 0) return null;

  let ate = 0;
  let total = 0;
  let achou = false;
  for (const segmento of daAresta) {
    const comprimento = comprimentoDoSegmento(peca, segmento.id);
    if (segmento.de === pontoId) {
      ate = total;
      achou = true;
    }
    total += comprimento;
  }
  if (!achou || total === 0) return null;
  return ate / total;
}

function comprimentoDoSegmento(peca: Peca, segmentoId: Id): number {
  const pontos = tesselarSegmento(peca, segmentoId, TOLERANCIA_MEDICAO_UM);
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]!;
    const b = pontos[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Translada por `abertura` na perpendicular tudo que esta do lado positivo. */
function afastarLadoDeLa(
  peca: Peca,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
  abertura: UM,
): Peca {
  // Perpendicular ao eixo, apontando para o lado positivo.
  const normal = { x: -direcao.y, y: direcao.x };
  const mover = (p: Vetor2): Vetor2 =>
    ladoDoEixo(p, eixo, direcao) > NA_LINHA_UM
      ? { x: Math.round(p.x + normal.x * abertura), y: Math.round(p.y + normal.y * abertura) }
      : p;

  const pontos: Record<Id, Ponto> = {};
  for (const [id, ponto] of Object.entries(peca.pontos)) {
    const movido = mover({ x: ponto.x, y: ponto.y });
    pontos[id] = { ...ponto, x: movido.x, y: movido.y };
  }

  const segmentos = { ...peca.segmentos };
  for (const [id, segmento] of Object.entries(peca.segmentos)) {
    if (segmento.controles === undefined) continue;
    segmentos[id] = {
      ...segmento,
      controles: [mover(segmento.controles[0]), mover(segmento.controles[1])],
    };
  }

  const resultado = { ...peca, pontos, segmentos };
  // Se a abertura tivesse virado o contorno do avesso, isto estouraria aqui.
  anelDoContorno(resultado);
  return resultado;
}
