/**
 * Graduacao (Parte 2, operacao 4): dado um tamanho, aplicar as regras a todos os
 * grade points e recomputar a geometria.
 *
 * A Parte 2 pedia duas definicoes que estavam em aberto. Ficaram assim:
 *
 * ## D7 — Nao ha ancora global
 * Cada grade point tem a SUA regra; grade point sem regra (ou com regra 0,0) nao
 * se move. A ancora e emergente: sao os pontos que ficaram parados. E como o
 * AAMA/ASTM grada, e por isso a importacao da Fase 3 mapeia 1:1 — nao existe no
 * DXF nenhuma "origem da graduacao" que precisasse ser inventada na leitura.
 *
 * Consequencia direta: `MarcarGradePoint` sem `DefinirRegraGraduacao` NAO e um
 * dado faltando, e uma declaracao de ancora. Grade point marcado e nunca usado
 * por engano e caso do validador (operacao 8, Bloco 10), que RELATA; graduar nao
 * pode estourar por isso.
 *
 * ## D8 — Incremento ENTRE tamanhos consecutivos, acumulado pelo motor
 * A `RegraGraduacao` guarda `(deTamanho, paraTamanho, dx, dy)` com os dois
 * tamanhos vizinhos na grade. Para ir do base a um tamanho distante, o motor SOMA
 * os passos; para um tamanho menor, subtrai os passos do caminho de volta. O
 * modelista declara o salto de um tamanho para o proximo, que e como a tabela de
 * graduacao e escrita na pratica; o acumulado nunca e digitado a mao.
 *
 * ## D10 — Geometria interna gradua pela MESMA regra
 * Fio, pence, furo e recorte sao feitos de `Ponto` (D10), entao entram no mesmo
 * mapa de deslocamento do contorno. Grade point marcado num ponto interno anda
 * pela sua regra; ponto interno sem regra fica parado, que e a ancora da D7.
 * Ponto interno esquecido sem regra numa peca que cresce e caso do VALIDADOR
 * (operacao 8), que relata — graduar nao pode estourar por isso.
 *
 * ## D8b — O que nao e grade point acompanha proporcionalmente
 * Entre dois grade points vizinhos NO CONTORNO, os pontos intermediarios recebem a
 * interpolacao dos dois deslocamentos, pesada pela posicao deles em COMPRIMENTO DE
 * ARCO (a mesma regua do `s` do pique). O campo de deslocamento resultante e
 * aplicado por `geometria/deslocar.ts`, que tambem leva os controles da Bezier
 * junto (1/3 e 2/3) sem reamostrar a curva.
 *
 * Se os pontos livres ficassem parados, a cava entre um grade point que andou 6 mm
 * e um vizinho parado mudaria de formato a cada tamanho.
 */
import { exigir, exigirDoMapa, ErroMotor } from './erros.js';
import type { Id, Modelo, Peca } from './tipos.js';
import type { UM } from './unidades.js';
import { tesselarSegmento } from './geometria/tesselar.js';
import {
  aplicarDeslocamentos,
  verticesDoContorno,
  PARADO,
  type Deslocamento,
} from './geometria/deslocar.js';

/**
 * Devolve a peca no tamanho pedido. Nao muta a entrada.
 *
 * A assinatura da Parte 1 era `aplicarGraduacao(peca, tamanho)`, mas a grade de
 * tamanhos e as `RegraGraduacao` vivem no MODELO (e o mesmo modelo grada varias
 * pecas), entao a peca sozinha nao carrega o que e preciso para graduar. Passar o
 * modelo e a unica forma de nao duplicar a grade dentro de cada peca.
 */
export function aplicarGraduacao(modelo: Modelo, pecaId: Id, tamanho: string): Peca {
  const peca = exigirDoMapa(modelo.pecas, pecaId, 'PECA_INEXISTENTE', 'Peca');

  const destino = modelo.tamanhos.indexOf(tamanho);
  exigir(
    destino >= 0,
    'TAMANHO_DESCONHECIDO',
    `O tamanho "${tamanho}" nao esta na grade do modelo "${modelo.nome}" ` +
      `[${modelo.tamanhos.join(', ')}].`,
    { modeloId: modelo.id, tamanho },
  );

  if (tamanho === modelo.tamanhoBase) return peca;

  const porGradePoint = deslocamentoAcumulado(modelo, destino);
  const porPonto = deslocamentoDeCadaPonto(peca, porGradePoint);
  if (porPonto === null) return peca;

  return aplicarDeslocamentos(peca, porPonto);
}

/**
 * Deslocamento acumulado de cada grade point do tamanho base ate `destino`.
 * Soma os passos para cima, subtrai os passos para baixo. Passo sem regra vale
 * zero — e a ancora da D7, nao um dado faltando.
 */
function deslocamentoAcumulado(modelo: Modelo, destino: number): Map<Id, Deslocamento> {
  const base = modelo.tamanhos.indexOf(modelo.tamanhoBase);
  const acumulado = new Map<Id, Deslocamento>();

  const somar = (gradePointId: Id, dx: UM, dy: UM): void => {
    const anterior = acumulado.get(gradePointId) ?? PARADO;
    acumulado.set(gradePointId, { dx: anterior.dx + dx, dy: anterior.dy + dy });
  };

  const paraCima = destino > base;
  const primeiro = paraCima ? base : destino;
  const ultimo = paraCima ? destino : base;

  for (const regra of Object.values(modelo.regrasGraduacao)) {
    const passo = modelo.tamanhos.indexOf(regra.deTamanho);
    // O fold ja garantiu que a regra liga tamanhos consecutivos, nesta ordem.
    if (passo < primeiro || passo >= ultimo) continue;
    const sinal = paraCima ? 1 : -1;
    somar(regra.pontoGraduacaoId, sinal * regra.dx, sinal * regra.dy);
  }

  return acumulado;
}

/**
 * Deslocamento de CADA ponto do contorno: o do proprio grade point, ou a
 * interpolacao por comprimento de arco entre os dois grade points vizinhos.
 * Devolve `null` quando a peca nao tem grade point nenhum — nada se move.
 */
function deslocamentoDeCadaPonto(
  peca: Peca,
  porGradePoint: ReadonlyMap<Id, Deslocamento>,
): Map<Id, Deslocamento> | null {
  const vertices = verticesDoContorno(peca);
  const arco = arcoAcumuladoNosVertices(peca);
  const total = arco[arco.length - 1]!;

  const deslocamentoDoPonto = new Map<Id, Deslocamento>();
  const ancoras: number[] = [];
  for (const [gradePointId, gradePoint] of Object.entries(peca.gradePoints)) {
    exigirDoMapa(peca.pontos, gradePoint.pontoId, 'PONTO_INEXISTENTE', 'Ponto do grade point');
    deslocamentoDoPonto.set(gradePoint.pontoId, porGradePoint.get(gradePointId) ?? PARADO);

    // Grade point FORA do contorno (fio, pence, furo — D10) recebe o proprio
    // deslocamento e pronto: nao ha vizinhanca de contorno para interpolar por ele,
    // e ele tambem nao serve de ancora para os vizinhos do contorno.
    const indice = vertices.indexOf(gradePoint.pontoId);
    if (indice >= 0) ancoras.push(indice);
  }

  if (ancoras.length === 0) return deslocamentoDoPonto.size > 0 ? deslocamentoDoPonto : null;
  ancoras.sort((a, b) => a - b);

  // Um grade point so: a peca inteira translada por ele.
  if (ancoras.length === 1) {
    const unico = deslocamentoDoPonto.get(vertices[ancoras[0]!]!)!;
    for (const pontoId of vertices) deslocamentoDoPonto.set(pontoId, unico);
    return deslocamentoDoPonto;
  }

  for (let i = 0; i < vertices.length; i++) {
    const pontoId = vertices[i]!;
    if (deslocamentoDoPonto.has(pontoId)) continue;

    const antes = ancoraAntes(ancoras, i);
    const depois = ancoraDepois(ancoras, i);
    const deAntes = deslocamentoDoPonto.get(vertices[antes]!)!;
    const deDepois = deslocamentoDoPonto.get(vertices[depois]!)!;

    const daAncoraAteAqui = distanciaCiclica(arco, total, antes, i);
    const daAncoraAteAProxima = distanciaCiclica(arco, total, antes, depois);
    const peso = daAncoraAteAProxima === 0 ? 0 : daAncoraAteAqui / daAncoraAteAProxima;

    deslocamentoDoPonto.set(pontoId, {
      dx: deAntes.dx + (deDepois.dx - deAntes.dx) * peso,
      dy: deAntes.dy + (deDepois.dy - deAntes.dy) * peso,
    });
  }

  return deslocamentoDoPonto;
}

/** Comprimento acumulado do contorno em cada vertice; a ultima entrada e o total. */
function arcoAcumuladoNosVertices(peca: Peca): number[] {
  const acumulado: number[] = [0];
  for (const segmentoId of peca.contorno) {
    const pontos = tesselarSegmento(peca, segmentoId);
    let comprimento = 0;
    for (let i = 1; i < pontos.length; i++) {
      const a = pontos[i - 1]!;
      const b = pontos[i]!;
      comprimento += Math.hypot(b.x - a.x, b.y - a.y);
    }
    acumulado.push(acumulado[acumulado.length - 1]! + comprimento);
  }
  return acumulado;
}

function ancoraAntes(ancoras: readonly number[], indice: number): number {
  for (let k = ancoras.length - 1; k >= 0; k--) {
    if (ancoras[k]! < indice) return ancoras[k]!;
  }
  return ancoras[ancoras.length - 1]!;
}

function ancoraDepois(ancoras: readonly number[], indice: number): number {
  for (const ancora of ancoras) {
    if (ancora > indice) return ancora;
  }
  return ancoras[0]!;
}

/** Distancia ao longo do contorno de `de` ate `para`, andando sempre para a frente. */
function distanciaCiclica(
  arco: readonly number[],
  total: number,
  de: number,
  para: number,
): number {
  const bruta = arco[para]! - arco[de]!;
  return bruta >= 0 ? bruta : bruta + total;
}

