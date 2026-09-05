/**
 * Projecao do pique da linha de COSTURA para a linha de CORTE.
 *
 * Era a unica lacuna que a Parte 1 deixou marcada como aberta, e ela avisa por
 * que: "o pique e ancorado na linha de costura, mas a cortadora corta na linha de
 * corte. Sem isso o pique sai deslocado na peca cortada — e erro de geometria,
 * nao de acabamento".
 *
 * ## A regra: PERPENDICULAR a costura
 * O ponto do pique na costura e empurrado ao longo da NORMAL EXTERNA da costura
 * naquele ponto, ate encontrar a linha de corte. E o que corresponde ao gesto
 * fisico: o pique marca onde duas peças se encontram ao costurar, e a margem de
 * costura e medida perpendicular a costura. Duas alternativas foram descartadas:
 *
 *  - **manter o `s` na linha de corte** — a linha de corte tem comprimento
 *    diferente da de costura (num canto convexo e maior, num concavo menor), entao
 *    o mesmo `s` cai em outro lugar. Erra pouco em aresta reta e erra muito perto
 *    de canto, que e onde o pique costuma estar;
 *  - **ponto mais proximo na linha de corte** — coincide com a perpendicular em
 *    aresta reta, mas perto de canto escolhe a projecao no lado errado.
 *
 * ## O que sai
 * O ponto no corte e a direcao PARA DENTRO da peca: e nela que a altura do pique
 * e medida, porque o corte entra a partir da borda. A distancia devolvida e o
 * quanto o pique andou — em aresta de margem uniforme, e a propria margem.
 */
import { exigir, exigirDoMapa } from './erros.js';
import type { Id, Peca, Vetor2 } from './tipos.js';
import type { UM } from './unidades.js';
import { TOLERANCIA_MEDICAO_UM } from './unidades.js';
import { pontoNaTabela, tabelaArcoDaAresta } from './geometria/medir.js';
import { offsetMargem } from './offset.js';

/** Onde o pique cai na linha de corte, e para onde ele entra. */
export interface PiqueProjetado {
  readonly pontoDaCostura: Vetor2;
  readonly pontoDoCorte: Vetor2;
  /** Unitario apontando da borda para DENTRO da peca. E a direcao da altura do pique. */
  readonly paraDentro: { readonly x: number; readonly y: number };
  /** Distancia percorrida da costura ate o corte, em UM. */
  readonly distanciaUM: UM;
}

/**
 * Projeta um pique da linha de costura na linha de corte.
 * `offsetMargem` e chamado uma vez por pique; para varios, use `projetarPiques`.
 */
export function projetarPique(peca: Peca, piqueId: Id): PiqueProjetado {
  return projetarPiques(peca, [piqueId])[0]!;
}

/** Projeta varios piques de uma vez, derivando a linha de corte uma so vez. */
export function projetarPiques(peca: Peca, piqueIds: readonly Id[]): PiqueProjetado[] {
  const corte = offsetMargem(peca).pontos;
  return piqueIds.map((piqueId) => {
    const pique = exigirDoMapa(peca.piques, piqueId, 'PIQUE_ORFAO', 'Pique');
    exigirDoMapa(peca.arestas, pique.arestaId, 'ARESTA_INEXISTENTE', 'Aresta do pique');
    exigir(
      Number.isFinite(pique.s) && pique.s >= 0 && pique.s <= 1,
      'PIQUE_FORA_DA_ARESTA',
      `O pique "${piqueId}" tem s = ${String(pique.s)}, fora de [0, 1].`,
      { pecaId: peca.id, piqueId },
    );

    const tabela = tabelaArcoDaAresta(peca, pique.arestaId, TOLERANCIA_MEDICAO_UM);
    const naCostura = pontoNaTabela(tabela, pique.s, pique.arestaId);
    const paraFora = normalExternaEm(tabela.pontos, pique.s);

    const alcance = alcanceDoRaio(naCostura, paraFora, corte, peca, piqueId);
    // `Math.round` de um negativo minusculo devolve -0, e -0 numa distancia so
    // confunde quem le. O sinal do zero e artefato do IEEE 754, nao geometria.
    const distancia = Math.round(alcance.distancia);
    return {
      pontoDaCostura: naCostura,
      pontoDoCorte: alcance.ponto,
      paraDentro: { x: -paraFora.x, y: -paraFora.y },
      distanciaUM: distancia === 0 ? 0 : distancia,
    };
  });
}

/**
 * Normal externa da costura na posicao `s` da aresta.
 *
 * Contorno CCW com Y-up tem o interior a ESQUERDA do sentido de percurso, entao a
 * normal externa e a da direita: `(dy, -dx)`. A direcao vem da corda em que `s`
 * cai — perto de um vertice as duas cordas dao normais diferentes, e nesse caso a
 * media das duas e o que o modelista espera (a bissetriz do canto).
 */
function normalExternaEm(
  pontos: readonly Vetor2[],
  s: number,
): { readonly x: number; readonly y: number } {
  const acumulado: number[] = [0];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]!;
    const b = pontos[i]!;
    acumulado.push(acumulado[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = acumulado[acumulado.length - 1]!;
  const alvo = s * total;

  let indice = 0;
  while (indice < acumulado.length - 2 && acumulado[indice + 1]! < alvo) indice++;

  const normais: { x: number; y: number }[] = [normalDaCorda(pontos[indice]!, pontos[indice + 1]!)];
  // Exatamente em cima de um vertice: media as duas cordas (bissetriz do canto).
  const noVertice = Math.abs(acumulado[indice + 1]! - alvo) < 1;
  if (noVertice && indice + 2 < pontos.length) {
    normais.push(normalDaCorda(pontos[indice + 1]!, pontos[indice + 2]!));
  }

  const somaX = normais.reduce((soma, n) => soma + n.x, 0);
  const somaY = normais.reduce((soma, n) => soma + n.y, 0);
  const comprimento = Math.hypot(somaX, somaY);
  return comprimento === 0 ? normais[0]! : { x: somaX / comprimento, y: somaY / comprimento };
}

function normalDaCorda(a: Vetor2, b: Vetor2): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const comprimento = Math.hypot(dx, dy);
  return { x: dy / comprimento, y: -dx / comprimento };
}

/** Primeiro encontro do raio com o anel de corte, andando para fora. */
function alcanceDoRaio(
  origem: Vetor2,
  direcao: { readonly x: number; readonly y: number },
  anel: readonly Vetor2[],
  peca: Peca,
  piqueId: Id,
): { ponto: Vetor2; distancia: number } {
  let melhor = Number.POSITIVE_INFINITY;
  let encontro: Vetor2 | null = null;

  for (let i = 0; i < anel.length; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % anel.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denominador = direcao.x * ey - direcao.y * ex;
    if (Math.abs(denominador) < 1e-12) continue;

    // Resolvendo `origem + t*direcao = a + u*aresta`:
    //   t = (w x aresta) / (direcao x aresta)   e   u = (w x direcao) / (direcao x aresta),
    // com w = a - origem e (p x q) = p.x*q.y - p.y*q.x.
    const dx = a.x - origem.x;
    const dy = a.y - origem.y;
    const distancia = (dx * ey - dy * ex) / denominador;
    const naAresta = (dx * direcao.y - dy * direcao.x) / denominador;
    if (distancia < 0 || naAresta < 0 || naAresta > 1) continue;
    if (distancia >= melhor) continue;

    melhor = distancia;
    encontro = {
      x: Math.round(origem.x + direcao.x * distancia),
      y: Math.round(origem.y + direcao.y * distancia),
    };
  }

  // Assertion defensiva: um raio que sai de um ponto do contorno para FORA sempre
  // encontra a linha de corte, porque ela envolve o contorno. Chegar aqui significa
  // normal degenerada ou anel corrompido — melhor estourar que devolver coordenada
  // inventada. Nao ha teste para este ramo: geometria valida nao o alcanca.
  exigir(
    encontro !== null,
    'PIQUE_SEM_PROJECAO',
    `O pique "${piqueId}" da peca "${peca.metadados.nome}" nao alcancou a linha de corte ` +
      `andando pela perpendicular a costura. A normal da costura naquele ponto esta ` +
      `degenerada ou o anel de corte esta corrompido.`,
    { pecaId: peca.id, piqueId },
  );
  return { ponto: encontro, distancia: melhor };
}
