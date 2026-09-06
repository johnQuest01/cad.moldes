/**
 * Importar DXF-AAMA/ASTM (F4, F5, F6, F8).
 *
 * ## Sai EVENTO, nunca `Peca` montada a mao (F4)
 * A regra E1 vale aqui inteira: o documento e o fold do log. Um importador que
 * montasse `Peca` direto criaria o caminho paralelo que o projeto existe para nao
 * ter, e o arquivo importado nao sobreviveria a um replay.
 *
 * ## Os turn points definem as arestas (F5)
 * E para isso que a camada 2 existe na norma: o trecho do contorno entre dois turn
 * points consecutivos vira uma `Aresta`, que e o que sustenta margem por aresta,
 * `ParCostura` e ancora de pique (D3). Arquivo sem camada 2 e importado com uma
 * aresta por corda, e um AVISO.
 *
 * ## A margem e MEDIDA (F6)
 * Com a camada 1 no arquivo, a margem de cada aresta sai da normal externa do meio
 * da aresta ate o anel de corte. Sem ela, a margem entra zero e o validador acusa
 * `MARGEM_AUSENTE` — o motor nao assume margem, porque assumir errado custa tecido.
 */
import {
  MM,
  contemPonto,
  cruzarSegmentos,
  type Evento,
  type Id,
  type Problema,
  type PropriedadesEncaixe,
  type TenantId,
  type Vetor2,
} from '@cad/motor';

import { CAMADA, TIPO_DO_PIQUE_POR_CAMADA, lerPares, paraUM, type Par } from './formato.js';

/** O que o leitor extrai do arquivo, antes de virar evento. */
interface BlocoCru {
  nome: string;
  readonly polilinhas: { camada: number; fechada: boolean; pontos: Vetor2[] }[];
  readonly pontos: { camada: number; em: Vetor2 }[];
  readonly linhas: { camada: number; de: Vetor2; ate: Vetor2 }[];
  readonly textos: { camada: number; conteudo: string }[];
}

export interface OpcoesDeImportacao {
  readonly tenantId: TenantId;
  readonly modeloId: Id;
  readonly autor: string;
  readonly gerarId: () => Id;
  readonly agora?: () => string;
  /** Grade de tamanhos do modelo criado. O arquivo traz um tamanho so (F: um por arquivo). */
  readonly tamanhos?: readonly string[];
  /** Arredondamento da margem medida, em UM. Zero desliga. */
  readonly arredondarMargemUM?: number;
}

export interface Importacao {
  readonly eventos: readonly Evento[];
  readonly problemas: readonly Problema[];
  /** Margem medida por aresta, antes de arredondar. E o que se confere na mao. */
  readonly margensMedidasUM: Readonly<Record<Id, number>>;
}

const ENCAIXE_PADRAO: PropriedadesEncaixe = {
  quantidadePorModelo: 1,
  giro: 'livre',
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

/** Arredondamento padrao da margem medida: 0,5 mm, como a industria trabalha. */
export const ARREDONDAMENTO_DA_MARGEM_UM = 500;

export function importarDxf(texto: string, opcoes: OpcoesDeImportacao): Importacao {
  const problemas: Problema[] = [];
  const blocos = lerBlocos(lerPares(texto), problemas);

  const tamanhos = opcoes.tamanhos ?? ['M'];
  const relogio = opcoes.agora ?? (() => new Date().toISOString());
  let n = 0;
  const envelope = (pecaId: Id | null) => ({
    id: opcoes.gerarId(),
    tenantId: opcoes.tenantId,
    modeloId: opcoes.modeloId,
    pecaId,
    timestamp: relogio(),
    autor: opcoes.autor,
    versaoSchema: 1,
  });
  void n;

  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: {
        nome: opcoes.modeloId,
        tamanhos: [...tamanhos],
        tamanhoBase: tamanhos[0]!,
      },
    } as Evento,
  ];

  const margensMedidas: Record<Id, number> = {};
  let indice = 0;

  for (const bloco of blocos) {
    const costura = bloco.polilinhas.find((p) => p.camada === CAMADA.COSTURA);
    if (costura === undefined) {
      problemas.push({
        gravidade: 'aviso',
        codigo: 'CONTORNO_VAZIO',
        mensagem:
          `O bloco "${bloco.nome}" nao tem polilinha na camada 14 (costura) e foi pulado. ` +
          `Sem contorno nao ha peca.`,
      });
      continue;
    }
    if (!costura.fechada) {
      problemas.push({
        gravidade: 'aviso',
        codigo: 'CONTORNO_ABERTO',
        mensagem: `A polilinha de costura do bloco "${bloco.nome}" veio ABERTA; foi fechada na importacao.`,
      });
    }

    const pecaId = `pec-${indice++}`;
    const nome = bloco.textos.find((t) => t.camada === CAMADA.TEXTO)?.conteudo ?? bloco.nome;
    eventos.push({
      ...envelope(pecaId),
      tipo: 'CriarPeca',
      payload: { nome, encaixe: ENCAIXE_PADRAO },
    } as Evento);

    const vertices = semRepetirOFecho(costura.pontos);
    const turnPoints = bloco.pontos.filter((p) => p.camada === CAMADA.TURN_POINT).map((p) => p.em);
    const cortes = cortesDoContorno(vertices, turnPoints, problemas, bloco.nome);

    // Pontos do contorno.
    vertices.forEach((v, i) =>
      eventos.push({
        ...envelope(pecaId),
        tipo: 'CriarPonto',
        payload: { pontoId: `${pecaId}-pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
      } as Evento),
    );

    // Arestas: uma por trecho entre turn points consecutivos.
    cortes.forEach((inicio, i) => {
      const fim = cortes[(i + 1) % cortes.length]!;
      eventos.push({
        ...envelope(pecaId),
        tipo: 'DefinirAresta',
        payload: {
          arestaId: `${pecaId}-ar-${i}`,
          pontoInicioId: `${pecaId}-pt-${inicio}`,
          pontoFimId: `${pecaId}-pt-${fim}`,
        },
      } as Evento);
    });

    // Segmentos: um por corda, cada um na aresta do trecho a que pertence.
    for (let i = 0; i < vertices.length; i++) {
      eventos.push({
        ...envelope(pecaId),
        tipo: 'DefinirSegmento',
        payload: {
          segmentoId: `${pecaId}-sg-${i}`,
          arestaId: `${pecaId}-ar-${arestaDaCorda(cortes, vertices.length, i)}`,
          de: `${pecaId}-pt-${i}`,
          para: `${pecaId}-pt-${(i + 1) % vertices.length}`,
          tipo: 'reta',
        },
      } as Evento);
    }

    // Margem: medida contra a linha de corte, quando ela veio no arquivo (F6).
    const corte = bloco.polilinhas.find((p) => p.camada === CAMADA.CORTE);
    const arredondar = opcoes.arredondarMargemUM ?? ARREDONDAMENTO_DA_MARGEM_UM;
    cortes.forEach((inicio, i) => {
      const arestaId = `${pecaId}-ar-${i}`;
      const fim = cortes[(i + 1) % cortes.length]!;
      const medida =
        corte === undefined
          ? 0
          : medirMargem(vertices, inicio, fim, semRepetirOFecho(corte.pontos));
      margensMedidas[arestaId] = medida;
      const margemUM =
        arredondar > 0 ? Math.round(medida / arredondar) * arredondar : Math.round(medida);
      eventos.push({
        ...envelope(pecaId),
        tipo: 'DefinirMargem',
        payload: { arestaId, margemUM },
      } as Evento);
    });

    if (corte === undefined) {
      problemas.push({
        gravidade: 'aviso',
        codigo: 'MARGEM_AUSENTE',
        mensagem:
          `O bloco "${bloco.nome}" nao tem a camada 1 (corte); as margens entraram ZERO. ` +
          `O motor nao assume margem: confira aresta por aresta antes de cortar.`,
        pecaId,
      });
    }

    // Fio, eixo e linhas internas — que o arquivo pode trazer como LINE **ou** como
    // POLYLINE. A norma admite as duas, e ler so uma delas foi o que fez o fio
    // sumir no round-trip do proprio exportador.
    const comoLinhas = [
      ...bloco.linhas,
      ...bloco.polilinhas
        .filter((pl) => pl.pontos.length >= 2)
        .map((pl) => ({
          camada: pl.camada,
          de: pl.pontos[0]!,
          ate: pl.pontos[pl.pontos.length - 1]!,
        })),
    ];
    for (const linha of comoLinhas) {
      if (linha.camada === CAMADA.FIO || linha.camada === CAMADA.LINHA_INTERNA) {
        const prefixo = `${pecaId}-li-${linha.camada}-${eventos.length}`;
        eventos.push(
          {
            ...envelope(pecaId),
            tipo: 'CriarPonto',
            payload: { pontoId: `${prefixo}-a`, x: linha.de.x, y: linha.de.y, tipo: 'interno' },
          } as Evento,
          {
            ...envelope(pecaId),
            tipo: 'CriarPonto',
            payload: { pontoId: `${prefixo}-b`, x: linha.ate.x, y: linha.ate.y, tipo: 'interno' },
          } as Evento,
          {
            ...envelope(pecaId),
            tipo: 'AdicionarLinhaInterna',
            payload: {
              linhaId: prefixo,
              tipo: linha.camada === CAMADA.FIO ? 'fio' : 'referencia',
              pontoIds: [`${prefixo}-a`, `${prefixo}-b`],
            },
          } as Evento,
        );
      }
      if (linha.camada === CAMADA.EIXO_DOBRA) {
        eventos.push({
          ...envelope(pecaId),
          tipo: 'DefinirEixoDobra',
          payload: {
            eixoId: `${pecaId}-ed-${eventos.length}`,
            p1: linha.de,
            p2: linha.ate,
            direcao: 'dentro',
          },
        } as Evento);
      }
    }

    // Grade points, pelos pontos da camada 5 que caem em cima de um vertice.
    for (const gp of bloco.pontos.filter((p) => p.camada === CAMADA.GRADE_POINT)) {
      const i = maisProximo(vertices, gp.em);
      if (i === null) continue;
      eventos.push({
        ...envelope(pecaId),
        tipo: 'MarcarGradePoint',
        payload: { gradePointId: `${pecaId}-gp-${i}`, pontoId: `${pecaId}-pt-${i}` },
      } as Evento);
    }

    // Piques: a camada diz o TIPO, e o `s` sai da posicao ao longo da aresta.
    for (const marca of bloco.pontos) {
      const tipo = TIPO_DO_PIQUE_POR_CAMADA[marca.camada];
      if (tipo === undefined) continue;
      const lugar = ondeNaCostura(vertices, cortes, marca.em);
      if (lugar === null) {
        problemas.push({
          gravidade: 'aviso',
          codigo: 'PIQUE_ORFAO',
          mensagem:
            `Um pique da camada ${marca.camada} do bloco "${bloco.nome}" nao caiu em aresta ` +
            `nenhuma e foi descartado.`,
          pecaId,
        });
        continue;
      }
      eventos.push({
        ...envelope(pecaId),
        tipo: 'AdicionarPique',
        payload: {
          piqueId: `${pecaId}-pq-${eventos.length}`,
          arestaId: `${pecaId}-ar-${lugar.aresta}`,
          s: lugar.s,
          tipo,
          alturaUM: 6350,
          larguraUM: 1590,
          anguloGraus: 0,
        },
      } as Evento);
    }

    if (!comoLinhas.some((l) => l.camada === CAMADA.FIO)) {
      problemas.push({
        gravidade: 'aviso',
        codigo: 'FIO_AUSENTE',
        mensagem: `O bloco "${bloco.nome}" nao tem fio do tecido (camada 7).`,
        pecaId,
      });
    }
  }

  return { eventos, problemas, margensMedidasUM: margensMedidas };
}

// --------------------------------------------------------------- leitura

function lerBlocos(pares: readonly Par[], problemas: Problema[]): BlocoCru[] {
  const blocos: BlocoCru[] = [];
  let atual: BlocoCru | null = null;
  let i = 0;

  const novoBloco = (nome: string): BlocoCru => ({
    nome,
    polilinhas: [],
    pontos: [],
    linhas: [],
    textos: [],
  });

  while (i < pares.length) {
    const p = pares[i]!;
    if (p.codigo !== 0) {
      i++;
      continue;
    }

    if (p.valor === 'BLOCK') {
      const campos = camposAte(pares, i + 1);
      atual = novoBloco(campos.get(2) ?? `BLOCO_${blocos.length}`);
      blocos.push(atual);
      i = campos.fim;
      continue;
    }
    if (p.valor === 'ENDBLK') {
      atual = null;
      i++;
      continue;
    }

    // Fora de bloco, so o INSERT interessa — e ele nao carrega geometria.
    if (atual === null) {
      i++;
      continue;
    }

    if (p.valor === 'POLYLINE') {
      const campos = camposAte(pares, i + 1);
      const camada = Number(campos.get(8) ?? '0');
      const fechada = (Number(campos.get(70) ?? '0') & 1) === 1;
      const pontos: Vetor2[] = [];
      i = campos.fim;
      while (i < pares.length && pares[i]!.codigo === 0 && pares[i]!.valor === 'VERTEX') {
        const v = camposAte(pares, i + 1);
        pontos.push({ x: paraUM(v.get(10) ?? '0'), y: paraUM(v.get(20) ?? '0') });
        i = v.fim;
      }
      if (i < pares.length && pares[i]!.valor === 'SEQEND') {
        i = camposAte(pares, i + 1).fim;
      }
      atual.polilinhas.push({ camada, fechada, pontos });
      continue;
    }

    if (p.valor === 'POINT') {
      const campos = camposAte(pares, i + 1);
      atual.pontos.push({
        camada: Number(campos.get(8) ?? '0'),
        em: { x: paraUM(campos.get(10) ?? '0'), y: paraUM(campos.get(20) ?? '0') },
      });
      i = campos.fim;
      continue;
    }

    if (p.valor === 'LINE') {
      const campos = camposAte(pares, i + 1);
      atual.linhas.push({
        camada: Number(campos.get(8) ?? '0'),
        de: { x: paraUM(campos.get(10) ?? '0'), y: paraUM(campos.get(20) ?? '0') },
        ate: { x: paraUM(campos.get(11) ?? '0'), y: paraUM(campos.get(21) ?? '0') },
      });
      i = campos.fim;
      continue;
    }

    if (p.valor === 'TEXT') {
      const campos = camposAte(pares, i + 1);
      atual.textos.push({ camada: Number(campos.get(8) ?? '0'), conteudo: campos.get(1) ?? '' });
      i = campos.fim;
      continue;
    }

    if (p.valor === 'SPLINE') {
      problemas.push({
        gravidade: 'aviso',
        codigo: 'CURVA_SEM_CONTROLES',
        mensagem:
          `O bloco "${atual.nome}" traz uma SPLINE, que este importador nao le (a D1 fechou a ` +
          `curva em Bezier cubica). Ela foi ignorada.`,
      });
    }
    i = camposAte(pares, i + 1).fim;
  }

  return blocos;
}

/** Le os pares ate o proximo codigo 0. Devolve o mapa e onde parou. */
function camposAte(
  pares: readonly Par[],
  inicio: number,
): { get(codigo: number): string | undefined; fim: number } {
  const mapa = new Map<number, string>();
  let i = inicio;
  while (i < pares.length && pares[i]!.codigo !== 0) {
    if (!mapa.has(pares[i]!.codigo)) mapa.set(pares[i]!.codigo, pares[i]!.valor);
    i++;
  }
  return { get: (codigo) => mapa.get(codigo), fim: i };
}

// --------------------------------------------------------------- geometria

/** A polilinha fechada costuma repetir o primeiro ponto no fim. Tira. */
function semRepetirOFecho(pontos: readonly Vetor2[]): Vetor2[] {
  const lista = [...pontos];
  while (lista.length > 1) {
    const primeiro = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    if (primeiro.x === ultimo.x && primeiro.y === ultimo.y) lista.pop();
    else break;
  }
  return lista;
}

/**
 * Indices dos vertices que sao turn point, em ordem. Sao eles que cortam o
 * contorno em arestas (F5).
 */
function cortesDoContorno(
  vertices: readonly Vetor2[],
  turnPoints: readonly Vetor2[],
  problemas: Problema[],
  nome: string,
): number[] {
  if (turnPoints.length === 0) {
    problemas.push({
      gravidade: 'aviso',
      codigo: 'ARESTA_SEM_SEGMENTOS',
      mensagem:
        `O bloco "${nome}" nao tem turn points (camada 2): entrou com UMA ARESTA POR CORDA. ` +
        `O molde funciona, mas margem e pique ficam ancorados em arestas de um segmento so.`,
    });
    return vertices.map((_, i) => i);
  }

  const indices = new Set<number>();
  for (const tp of turnPoints) {
    const i = maisProximo(vertices, tp);
    if (i !== null) indices.add(i);
  }
  const ordenados = [...indices].sort((a, b) => a - b);
  if (ordenados.length < 2) {
    problemas.push({
      gravidade: 'aviso',
      codigo: 'ARESTA_SEM_SEGMENTOS',
      mensagem: `O bloco "${nome}" tem menos de dois turn points aproveitaveis; entrou com uma aresta por corda.`,
    });
    return vertices.map((_, i) => i);
  }
  return ordenados;
}

/** Em qual trecho (aresta) cai a corda `i`. */
function arestaDaCorda(cortes: readonly number[], total: number, i: number): number {
  for (let k = cortes.length - 1; k >= 0; k--) {
    if (i >= cortes[k]!) return k;
  }
  // Antes do primeiro corte: pertence ao trecho que fecha o ciclo.
  void total;
  return cortes.length - 1;
}

/** O vertice mais proximo, se estiver dentro de meio milimetro. */
function maisProximo(vertices: readonly Vetor2[], alvo: Vetor2): number | null {
  let melhor: { i: number; d: number } | null = null;
  for (let i = 0; i < vertices.length; i++) {
    const d = Math.hypot(vertices[i]!.x - alvo.x, vertices[i]!.y - alvo.y);
    if (melhor === null || d < melhor.d) melhor = { i, d };
  }
  return melhor !== null && melhor.d <= MM / 2 ? melhor.i : null;
}

/** Aresta e `s` do ponto do contorno mais proximo do alvo. */
function ondeNaCostura(
  vertices: readonly Vetor2[],
  cortes: readonly number[],
  alvo: Vetor2,
): { aresta: number; s: number } | null {
  let melhor: { aresta: number; s: number; d: number } | null = null;

  for (let k = 0; k < cortes.length; k++) {
    const inicio = cortes[k]!;
    const fim = cortes[(k + 1) % cortes.length]!;
    const trecho = trechoDe(vertices, inicio, fim);
    let percorrido = 0;
    const total = comprimentoDe(trecho);
    if (total === 0) continue;

    for (let i = 1; i < trecho.length; i++) {
      const a = trecho[i - 1]!;
      const b = trecho[i]!;
      const corda = Math.hypot(b.x - a.x, b.y - a.y);
      const pe = peNaCorda(a, b, alvo);
      const d = Math.hypot(pe.ponto.x - alvo.x, pe.ponto.y - alvo.y);
      if (melhor === null || d < melhor.d) {
        melhor = { aresta: k, s: (percorrido + corda * pe.u) / total, d };
      }
      percorrido += corda;
    }
  }
  return melhor === null ? null : { aresta: melhor.aresta, s: melhor.s };
}

/**
 * Margem da aresta: distancia do MEIO dela ate o anel de corte, pela normal
 * externa (F6). E a mesma ideia de `projetarPique`, aplicada ao contrario.
 */
function medirMargem(
  vertices: readonly Vetor2[],
  inicio: number,
  fim: number,
  corte: readonly Vetor2[],
): number {
  const trecho = trechoDe(vertices, inicio, fim);
  if (trecho.length < 2 || corte.length < 3) return 0;

  const meio = Math.max(1, Math.floor(trecho.length / 2));
  const a = trecho[meio - 1]!;
  const b = trecho[meio]!;
  const de: Vetor2 = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };

  // Normal da direita: contorno CCW com Y-up tem o interior a esquerda (D4).
  const comprimento = Math.hypot(b.x - a.x, b.y - a.y);
  if (comprimento === 0) return 0;
  let nx = (b.y - a.y) / comprimento;
  let ny = -(b.x - a.x) / comprimento;
  // Se a normal apontar para DENTRO do proprio contorno, inverte: winding CW.
  if (contemPonto(vertices, { x: Math.round(de.x + nx * 10), y: Math.round(de.y + ny * 10) })) {
    nx = -nx;
    ny = -ny;
  }

  const longe: Vetor2 = { x: Math.round(de.x + nx * 1e7), y: Math.round(de.y + ny * 1e7) };
  let menor = Number.POSITIVE_INFINITY;
  for (let i = 0; i < corte.length; i++) {
    const p = corte[i]!;
    const q = corte[(i + 1) % corte.length]!;
    const cruz = cruzarSegmentos(de, longe, p, q);
    if (cruz === null) continue;
    const d = Math.hypot(cruz.x - de.x, cruz.y - de.y);
    if (d < menor) menor = d;
  }
  return Number.isFinite(menor) ? Math.round(menor) : 0;
}

function trechoDe(vertices: readonly Vetor2[], inicio: number, fim: number): Vetor2[] {
  const trecho: Vetor2[] = [];
  let i = inicio;
  trecho.push(vertices[i]!);
  while (i !== fim) {
    i = (i + 1) % vertices.length;
    trecho.push(vertices[i]!);
  }
  return trecho;
}

function comprimentoDe(pontos: readonly Vetor2[]): number {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    total += Math.hypot(pontos[i]!.x - pontos[i - 1]!.x, pontos[i]!.y - pontos[i - 1]!.y);
  }
  return total;
}

function peNaCorda(a: Vetor2, b: Vetor2, p: Vetor2): { ponto: Vetor2; u: number } {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const quadrado = ex * ex + ey * ey;
  if (quadrado === 0) return { ponto: a, u: 0 };
  const bruto = ((p.x - a.x) * ex + (p.y - a.y) * ey) / quadrado;
  const u = bruto < 0 ? 0 : bruto > 1 ? 1 : bruto;
  return { ponto: { x: Math.round(a.x + ex * u), y: Math.round(a.y + ey * u) }, u };
}
