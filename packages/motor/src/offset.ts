/**
 * Offset de margem: LINHA DE COSTURA -> LINHA DE CORTE.
 *
 * D4 aplicada:
 *   - contorno exigido em CCW (normalize antes com normalizarWinding);
 *   - delta positivo = PARA FORA;
 *   - junção Miter com limite, nunca Round: Round arredondaria os cantos do
 *     retangulo e transformaria margem de canto em curva — errado para molde;
 *   - assertion DENTRO da funcao (nao so no teste): area(corte) > area(costura).
 *     Sentido invertido estoura na hora, em vez de mandar molde pequeno pro corte.
 *
 * ## Por que o deslocamento paralelo e feito aqui (desvio documentado da inegociavel 3)
 *
 * A margem e por ARESTA (D3): a bainha pode ter 40 mm e a lateral 10 mm. O caminho
 * previsto era `ClipperOffset.executeWithCallback`, mas lendo a implementacao
 * (`clipper2-ts/dist/Offset.js:430`) o callback devolve **um delta por VERTICE**, e
 * `offsetPoint` usa esse mesmo delta nos DOIS lados da junção: chama `doMiter` com
 * `normals[k]` (aresta que chega) e `normals[j]` (aresta que sai) e um `groupDelta`
 * so. No retangulo com bainha de 40 mm e lateral de 10 mm, o canto verdadeiro e o
 * cruzamento de `y = -40` com `x = L+10`, ou seja `(L+10, -40)`; com um delta so o
 * clipper produz `(L+d, -d)` — nem 10 nem 40 resolve. A biblioteca nao suporta o
 * caso.
 *
 * O que se faz aqui, entao, e apenas a parte trivialmente verificavel: transladar
 * cada corda pela margem da SUA aresta ao longo da normal externa e fechar o canto
 * no **cruzamento das duas retas deslocadas** — que e exatamente o que "Miter"
 * significa. A parte perigosa — auto-interseção, laços negativos em concavidade,
 * reversao de contorno — continua sendo do clipper2, via `union` com `FillRule.Positive`.
 *
 * O teste `offset por aresta e o inflatePaths concordam` prova, para margem
 * uniforme, que este caminho devolve o MESMO anel que o `inflatePaths` do clipper.
 */
import { FillRule, trimCollinear, union, type Path64, type Paths64 } from 'clipper2-ts';

import { ErroMotor, exigir, exigirDoMapa } from './erros.js';
import type { Id, Peca, Poligono, Vetor2 } from './tipos.js';
import { LIMITE_MITER, type UM } from './unidades.js';
import { area, ehCCW } from './geometria/anel.js';
import { anelComArestas } from './geometria/tesselar.js';

/** Ponto intermediario em UM fracionario: existe so entre o deslocamento e o arredondamento. */
interface PontoF {
  readonly x: number;
  readonly y: number;
}

/**
 * Seno do angulo de giro abaixo do qual duas cordas sao tratadas como colineares.
 * 1e-6 rad e ~0,00006 graus: nesse angulo, com margem de 100 mm, os dois pontos
 * deslocados distam 0,1 UM — abaixo do arredondamento para inteiro. Acima disso o
 * cruzamento das retas ja e numericamente estavel.
 */
const SENO_COLINEAR = 1e-6;

/**
 * Cosseno minimo do giro para o canto ainda sair em Miter. Abaixo dele a ponta
 * passaria de `LIMITE_MITER` vezes a margem e o canto e cortado em quadrado.
 *
 * Com margens iguais, a ponta do miter fica a `m * sqrt(2/(1+cos))` do vertice;
 * exigir essa razao <= LIMITE_MITER e o mesmo que exigir `cos > 2/LIMITE_MITER^2 - 1`.
 * E exatamente o criterio do clipper (`cosA > mitLimSqr - 1`, Offset.js:457) —
 * escrito na forma de angulo para nao depender da margem e para bater com a
 * biblioteca no limite.
 */
const COSSENO_MINIMO_MITER = 2 / (LIMITE_MITER * LIMITE_MITER) - 1;

/**
 * Deriva a linha de corte da peca, com a margem de cada ARESTA (D3).
 * Arestas diferentes podem ter margens diferentes; margem zero e legitima
 * (aresta que cai na dobra do tecido) e faz a linha de corte coincidir com a de
 * costura naquele trecho.
 */
export function offsetMargem(peca: Peca): Poligono {
  const recortes = Object.keys(peca.recortes).length;
  exigir(
    recortes === 0,
    'RECORTE_AINDA_NAO_SUPORTADO',
    `A peca "${peca.metadados.nome}" tem ${recortes} recorte(s) interno(s) e o offset ` +
      `so sabe derivar o anel externo. Devolver so o externo mandaria para a mesa uma ` +
      `peca SEM o vazado, e o defeito so apareceria no tecido cortado. O recorte tambem ` +
      `recebe margem, e para dentro dele — operacao propria, ainda nao escrita.`,
    { pecaId: peca.id, recortes },
  );

  const { pontos: costura, arestas } = anelComArestas(peca);

  exigir(
    ehCCW(costura),
    'OFFSET_NAO_CRESCEU',
    `Contorno da peca "${peca.metadados.nome}" esta em CW. Chame normalizarWinding() ` +
      `antes do offset: em CW o delta positivo apontaria para dentro e o molde sairia menor.`,
    { pecaId: peca.id },
  );

  const margens = margensDasCordas(peca, arestas);

  // Todas as margens zero: a linha de corte E a linha de costura. A assertion de
  // crescimento so vale quando ha delta positivo em algum trecho.
  if (margens.every((margem) => margem === 0)) return { pontos: costura };

  const bruto = deslocarPorAresta(costura, margens);
  const limpo: Paths64 = union([bruto.map((p) => ({ x: p.x, y: p.y }))], FillRule.Positive);

  exigir(
    limpo.length > 0,
    'OFFSET_VAZIO',
    `O offset da peca "${peca.metadados.nome}" nao produziu geometria.`,
    { pecaId: peca.id },
  );
  exigir(
    limpo.length === 1,
    'OFFSET_MULTIPLOS_ANEIS',
    `O offset da peca "${peca.metadados.nome}" produziu ${limpo.length} aneis. ` +
      `Uma linha de costura simples e fechada tem que produzir exatamente um anel de corte.`,
    { pecaId: peca.id, aneis: limpo.length },
  );

  // A linha de corte tem que depender da FORMA da peca, nao de quantos pontos o
  // modelista clicou nela: um ponto colinear inserido no contorno (operacao 13)
  // nao pode aparecer como vertice a mais no corte. Quem tira e o clipper.
  // Vertice onde duas arestas de margens DIFERENTES se encontram nao e colinear
  // (ha um degrau perpendicular), entao esse sobrevive.
  const anelCorte = paraAnel(trimCollinear(limpo[0]!));
  exigir(
    anelCorte.length >= 3,
    'OFFSET_VAZIO',
    `Depois de tirar os vertices colineares, a linha de corte da peca ` +
      `"${peca.metadados.nome}" ficou com ${anelCorte.length} vertice(s).`,
    { pecaId: peca.id },
  );
  const areaCostura = area(costura);
  const areaCorte = area(anelCorte);

  if (!(areaCorte > areaCostura)) {
    throw new ErroMotor(
      'OFFSET_NAO_CRESCEU',
      `A linha de corte da peca "${peca.metadados.nome}" nao ficou maior que a de costura ` +
        `(costura ${areaCostura} UM2, corte ${areaCorte} UM2). ` +
        `Delta positivo tem que crescer para fora — molde menor que a costura vai errado pro corte.`,
      { pecaId: peca.id, areaCostura, areaCorte },
    );
  }

  return { pontos: anelCorte };
}

/**
 * Margem de cada corda do anel, lida da aresta dona da corda.
 * Recusa margem ausente ou negativa — nunca assume um valor padrao.
 */
function margensDasCordas(peca: Peca, arestas: readonly Id[]): UM[] {
  const cache = new Map<Id, UM>();

  return arestas.map((arestaId) => {
    const guardada = cache.get(arestaId);
    if (guardada !== undefined) return guardada;

    exigirDoMapa(peca.arestas, arestaId, 'ARESTA_INEXISTENTE', 'Aresta');
    const margem = peca.margens[arestaId];
    exigir(
      margem !== undefined,
      'MARGEM_AUSENTE',
      `A aresta "${arestaId}" da peca "${peca.metadados.nome}" nao tem margem definida. ` +
        `Emita DefinirMargem para ela — o motor nao assume zero por conta propria.`,
      { pecaId: peca.id, arestaId },
    );
    exigir(
      margem >= 0,
      'MARGEM_NEGATIVA',
      `A aresta "${arestaId}" tem margem ${margem} UM. Margem negativa encolheria ` +
        `a peca; para linha de corte interna use uma operacao propria, nao margem negativa.`,
      { pecaId: peca.id, arestaId, margem },
    );

    cache.set(arestaId, margem);
    return margem;
  });
}

/**
 * Anel bruto da linha de corte: cada corda transladada pela sua propria margem.
 * Canto convexo sai em Miter (ou em quadrado, quando o giro passa do
 * `LIMITE_MITER`); canto CONCAVO sai com os dois pes de perpendicular e o vertice
 * no meio, criando de proposito regiao negativa.
 *
 * Pode sair auto-interseccionado de proposito: quem limpa isso e a uniao do clipper.
 */
function deslocarPorAresta(anel: readonly Vetor2[], margens: readonly UM[]): Vetor2[] {
  const n = anel.length;
  const direcoes: PontoF[] = [];
  const normais: PontoF[] = [];

  for (let i = 0; i < n; i++) {
    const a = anel[i]!;
    const b = anel[(i + 1) % n]!;
    const comprimento = Math.hypot(b.x - a.x, b.y - a.y);
    exigir(
      comprimento > 0,
      'SEGMENTO_COMPRIMENTO_ZERO',
      `O anel do contorno tem dois vertices iguais em (${a.x}, ${a.y}); nao da para ` +
        `saber para que lado deslocar a margem.`,
      { indice: i },
    );
    const direcao: PontoF = { x: (b.x - a.x) / comprimento, y: (b.y - a.y) / comprimento };
    direcoes.push(direcao);
    // Contorno CCW com Y-up tem o interior a ESQUERDA do sentido de percurso,
    // entao a normal externa e a da direita: (dy, -dx).
    normais.push({ x: direcao.y, y: -direcao.x });
  }

  const saida: Vetor2[] = [];
  for (let i = 0; i < n; i++) {
    const anterior = (i - 1 + n) % n;
    const vertice = anel[i]!;
    const chegando = deslocar(vertice, normais[anterior]!, margens[anterior]!);
    const saindo = deslocar(vertice, normais[i]!, margens[i]!);

    const seno =
      direcoes[anterior]!.x * direcoes[i]!.y - direcoes[anterior]!.y * direcoes[i]!.x;

    if (Math.abs(seno) < SENO_COLINEAR) {
      // Cordas colineares: as duas retas deslocadas sao paralelas. Se as margens
      // sao iguais elas coincidem (um ponto so); se sao diferentes, o degrau
      // perpendicular entre elas E a geometria correta.
      empilhar(saida, chegando);
      empilhar(saida, saindo);
      continue;
    }

    const cosseno =
      direcoes[anterior]!.x * direcoes[i]!.x + direcoes[anterior]!.y * direcoes[i]!.y;

    // Canto CONCAVO (giro para a direita num contorno CCW): NAO leva miter.
    //
    // O ponto de miter de um canto reflexo e um offset legitimo das duas arestas
    // vizinhas, mas pode estar DENTRO da faixa de uma aresta distante — num
    // entalhe fundo ele fica a menos de uma margem de outro lado da peca. Como o
    // anel resultante nao se auto-intersecta, a uniao nao tem o que limpar, e
    // sobra uma agulha: medido, 2 mm de comprimento por 14 UM de largura, que o
    // plotter desenharia como um espinho no molde.
    //
    // A saida e a mesma do clipper (`offsetPoint`, Offset.js:441): inserir os dois
    // pes de perpendicular com o VERTICE no meio. Isso cria de proposito uma
    // regiao de orientacao negativa, e e a uniao com `FillRule.Positive` que a
    // remove — junto com tudo que ficou coberto por outra aresta.
    if (cosseno > -0.999 && seno < 0) {
      empilhar(saida, chegando);
      empilhar(saida, vertice);
      empilhar(saida, saindo);
      continue;
    }

    if (cosseno > COSSENO_MINIMO_MITER) {
      empilhar(
        saida,
        cantoMiter(vertice, normais[anterior]!, normais[i]!, margens[anterior]!, margens[i]!, cosseno),
      );
      continue;
    }

    // Canto agudo demais: a ponta do miter viraria um espinho. O clipper, nesse
    // caso, nao corta em bevel simples — ele faz o "square": corta com uma reta
    // PERPENDICULAR A BISSETRIZ, a uma margem de distancia do vertice. Isso importa
    // para molde: o bevel simples passaria a so `m*cos(phi/2)` do vertice e comeria
    // parte da margem de costura bem na ponta. O quadrado mantem a margem cheia.
    const quadrado = cortarEmQuadrado(
      vertice,
      { chegando, direcao: direcoes[anterior]! },
      { saindo, direcao: direcoes[i]! },
      Math.max(margens[anterior]!, margens[i]!),
    );
    for (const ponto of quadrado) empilhar(saida, ponto);
  }

  // O anel e ciclico: o ultimo ponto nao pode repetir o primeiro.
  while (saida.length > 1 && iguais(saida[saida.length - 1]!, saida[0]!)) saida.pop();

  exigir(
    saida.length >= 3,
    'OFFSET_VAZIO',
    `O deslocamento das margens colapsou o contorno em ${saida.length} vertice(s).`,
    { vertices: saida.length },
  );
  return saida;
}

/**
 * Ponta do canto em Miter: o unico ponto que fica a `margemQueChega` da reta que
 * chega E a `margemQueSai` da reta que sai.
 *
 * Resolvendo `u = a*nk + b*nj` com `u.nk = mk` e `u.nj = mj` (e `c = nk.nj`):
 *   a = (mk - c*mj) / (1 - c^2),   b = (mj - c*mk) / (1 - c^2)
 * Com `mk = mj = m` isso colapsa em `u = (nk + nj) * m/(1+c)` — a formula do
 * `doMiter` do clipper. O caso de margens iguais e escrito assim de proposito: alem
 * de ser a conta estavel perto de cordas colineares (divide por `1+c ~ 2`, nao por
 * `1-c^2 ~ 0`), percorre as mesmas operacoes de ponto flutuante da biblioteca, e o
 * resultado sai identico ao dela.
 */
function cantoMiter(
  vertice: Vetor2,
  normalQueChega: PontoF,
  normalQueSai: PontoF,
  margemQueChega: UM,
  margemQueSai: UM,
  cosseno: number,
): PontoF {
  if (margemQueChega === margemQueSai) {
    const q = margemQueChega / (cosseno + 1);
    return {
      x: vertice.x + (normalQueChega.x + normalQueSai.x) * q,
      y: vertice.y + (normalQueChega.y + normalQueSai.y) * q,
    };
  }
  const denominador = 1 - cosseno * cosseno;
  const a = (margemQueChega - cosseno * margemQueSai) / denominador;
  const b = (margemQueSai - cosseno * margemQueChega) / denominador;
  return {
    x: vertice.x + normalQueChega.x * a + normalQueSai.x * b,
    y: vertice.y + normalQueChega.y * a + normalQueSai.y * b,
  };
}

/**
 * Corte "square" do clipper para canto que estoura o limite de miter: uma reta
 * perpendicular a bissetriz externa, a `distancia` do vertice, cortando as duas
 * retas deslocadas. Devolve os dois pontos, na ordem do percurso.
 *
 * Se alguma das retas ficar paralela a reta de corte (nao acontece em canto agudo,
 * mas o caso existe), cai para o bevel simples em vez de devolver ponto no infinito.
 */
function cortarEmQuadrado(
  vertice: Vetor2,
  entrada: { readonly chegando: PontoF; readonly direcao: PontoF },
  saida: { readonly saindo: PontoF; readonly direcao: PontoF },
  distancia: UM,
): PontoF[] {
  const bissetriz = normalizar({
    x: entrada.direcao.x - saida.direcao.x,
    y: entrada.direcao.y - saida.direcao.y,
  });
  if (bissetriz === null) return [entrada.chegando, saida.saindo];

  const pontaQuadrada: PontoF = {
    x: vertice.x + bissetriz.x * distancia,
    y: vertice.y + bissetriz.y * distancia,
  };
  const direcaoDoCorte: PontoF = { x: bissetriz.y, y: -bissetriz.x };

  const a = cruzarRetas(pontaQuadrada, direcaoDoCorte, entrada.chegando, entrada.direcao);
  const b = cruzarRetas(pontaQuadrada, direcaoDoCorte, saida.saindo, saida.direcao);
  if (a === null || b === null) return [entrada.chegando, saida.saindo];
  return [a, b];
}

/**
 * Cruzamento de duas retas dadas por ponto e direcao unitaria.
 * `null` quando sao paralelas — quem chama decide o que fazer, ninguem devolve
 * coordenada infinita fingindo que deu certo.
 */
function cruzarRetas(
  pontoA: PontoF,
  direcaoA: PontoF,
  pontoB: PontoF,
  direcaoB: PontoF,
): PontoF | null {
  const seno = direcaoA.x * direcaoB.y - direcaoA.y * direcaoB.x;
  if (Math.abs(seno) < SENO_COLINEAR) return null;
  const t = ((pontoB.x - pontoA.x) * direcaoB.y - (pontoB.y - pontoA.y) * direcaoB.x) / seno;
  return { x: pontoA.x + direcaoA.x * t, y: pontoA.y + direcaoA.y * t };
}

function normalizar(vetor: PontoF): PontoF | null {
  const comprimento = Math.hypot(vetor.x, vetor.y);
  if (comprimento < SENO_COLINEAR) return null;
  return { x: vetor.x / comprimento, y: vetor.y / comprimento };
}

function deslocar(ponto: Vetor2, normal: PontoF, margem: UM): PontoF {
  return { x: ponto.x + normal.x * margem, y: ponto.y + normal.y * margem };
}

/** Arredonda para UM inteiro e descarta vertice que colapsou no anterior. */
function empilhar(saida: Vetor2[], ponto: PontoF): void {
  const inteiro: Vetor2 = { x: Math.round(ponto.x), y: Math.round(ponto.y) };
  const anterior = saida[saida.length - 1];
  if (anterior !== undefined && iguais(anterior, inteiro)) return;
  saida.push(inteiro);
}

function iguais(a: Vetor2, b: Vetor2): boolean {
  return a.x === b.x && a.y === b.y;
}

function paraAnel(caminho: Path64): Vetor2[] {
  return caminho.map((p) => ({ x: p.x, y: p.y }));
}
