/**
 * Exportar o modelo para DXF-AAMA/ASTM (F1, F3).
 *
 * R12 ASCII, `POLYLINE`/`VERTEX`, uma peca por `BLOCK` e um `INSERT` por
 * colocacao. Nada aqui inventa geometria: contorno e linha de corte saem das
 * funcoes do motor, e os piques saem projetados na linha de corte, que e onde a
 * tesoura passa.
 */
import {
  anelDoContorno,
  offsetMargem,
  projetarPique,
  aplicarGraduacao,
  ErroMotor,
  type Id,
  type Modelo,
  type Peca,
  type Problema,
  type Vetor2,
} from '@cad/motor';

import {
  CAMADA,
  camadaDoPique,
  emMilimetros,
  escreverPares,
  nomeDeBloco,
  par,
  type Par,
} from './formato.js';

export interface OpcoesDeExportacao {
  /** Tamanho a exportar. Um arquivo por tamanho, como o parque le (ver "o que NAO faz"). */
  readonly tamanho?: string;
  /** Altura do texto de anotacao, em UM. */
  readonly alturaDoTextoUM?: number;
}

export interface Exportacao {
  readonly dxf: string;
  /** O que nao coube ou nao existia. O exportador RELATA (F8). */
  readonly problemas: readonly Problema[];
}

const ALTURA_PADRAO_DO_TEXTO_UM = 10_000;

/** Gera o DXF do modelo inteiro, num tamanho. */
export function exportarDxf(modelo: Modelo, opcoes: OpcoesDeExportacao = {}): Exportacao {
  const tamanho = opcoes.tamanho ?? modelo.tamanhoBase;
  const alturaDoTexto = opcoes.alturaDoTextoUM ?? ALTURA_PADRAO_DO_TEXTO_UM;
  const problemas: Problema[] = [];

  const blocos: Par[] = [];
  const insercoes: Par[] = [];
  const usados = new Set<string>();

  for (const pecaId of Object.keys(modelo.pecas)) {
    let peca: Peca;
    try {
      peca = aplicarGraduacao(modelo, pecaId, tamanho);
    } catch (erro) {
      if (!(erro instanceof ErroMotor)) throw erro;
      problemas.push({
        gravidade: 'erro',
        codigo: erro.codigo,
        mensagem: `A peca "${pecaId}" nao pode ser graduada para "${tamanho}": ${erro.message}`,
        pecaId,
      });
      continue;
    }

    // Dois nomes que saneiam para o mesmo bloco fundiriam as pecas na importacao.
    const base = nomeDeBloco(peca.metadados.nome);
    let bloco = base;
    let n = 2;
    while (usados.has(bloco)) bloco = `${base}_${n++}`;
    usados.add(bloco);

    blocos.push(...desenharBloco(bloco, peca, tamanho, alturaDoTexto, problemas));
    insercoes.push(
      par(0, 'INSERT'),
      par(8, CAMADA.CORTE),
      par(2, bloco),
      par(10, '0.000'),
      par(20, '0.000'),
      par(30, '0.000'),
    );
  }

  const pares: Par[] = [
    ...cabecalho(),
    par(0, 'SECTION'),
    par(2, 'BLOCKS'),
    ...blocos,
    par(0, 'ENDSEC'),
    par(0, 'SECTION'),
    par(2, 'ENTITIES'),
    ...insercoes,
    par(0, 'ENDSEC'),
    par(0, 'EOF'),
  ];

  return { dxf: escreverPares(pares), problemas };
}

/** `$INSUNITS = 4` diz ao outro CAD que o arquivo esta em MILIMETRO (F2). */
function cabecalho(): Par[] {
  return [
    par(0, 'SECTION'),
    par(2, 'HEADER'),
    par(9, '$ACADVER'),
    par(1, 'AC1009'),
    par(9, '$INSUNITS'),
    par(70, 4),
    par(0, 'ENDSEC'),
  ];
}

function desenharBloco(
  bloco: string,
  peca: Peca,
  tamanho: string,
  alturaDoTexto: number,
  problemas: Problema[],
): Par[] {
  const pares: Par[] = [
    par(0, 'BLOCK'),
    par(8, CAMADA.CORTE),
    par(2, bloco),
    par(70, 0),
    par(10, '0.000'),
    par(20, '0.000'),
    par(30, '0.000'),
    par(3, bloco),
    par(1, ''),
  ];

  const contorno = anelDoContorno(peca);
  pares.push(...polilinha(CAMADA.COSTURA, contorno, true));

  // Linha de corte. Peca sem margem nao tem corte — e o validador ja acusa isso;
  // aqui vira problema do arquivo, e nao motivo para nao exportar o resto.
  let corte: readonly Vetor2[] = [];
  try {
    corte = offsetMargem(peca).pontos;
    pares.push(...polilinha(CAMADA.CORTE, corte, true));
  } catch (erro) {
    if (!(erro instanceof ErroMotor)) throw erro;
    problemas.push({
      gravidade: 'erro',
      codigo: erro.codigo,
      mensagem: `A peca "${peca.metadados.nome}" saiu SEM linha de corte: ${erro.message}`,
      pecaId: peca.id,
    });
  }

  // Turn points: sao eles que devolvem as arestas na importacao (F5).
  for (const ponto of Object.values(peca.pontos)) {
    if (ponto.tipo !== 'contorno') continue;
    pares.push(...ponto2(CAMADA.TURN_POINT, ponto));
  }

  // Curve points: os controles das Bezier (D1).
  for (const segmento of Object.values(peca.segmentos)) {
    if (segmento.controles === undefined) continue;
    for (const controle of segmento.controles) {
      pares.push(...ponto2(CAMADA.CURVE_POINT, controle));
    }
  }

  // Piques, na camada do TIPO — e o teste que a Parte 7 deixou marcado.
  for (const pique of Object.values(peca.piques)) {
    if (peca.arestas[pique.arestaId] === undefined) {
      problemas.push({
        gravidade: 'erro',
        codigo: 'PIQUE_ORFAO',
        mensagem: `O pique "${pique.id}" aponta para a aresta "${pique.arestaId}", que nao existe.`,
        pecaId: peca.id,
      });
      continue;
    }
    try {
      const projetado = projetarPique(peca, pique.id);
      pares.push(...ponto2(camadaDoPique(pique.tipo), projetado.pontoDoCorte));
    } catch (erro) {
      if (!(erro instanceof ErroMotor)) throw erro;
      problemas.push({
        gravidade: 'erro',
        codigo: erro.codigo,
        mensagem: `O pique "${pique.id}" nao pode ser projetado: ${erro.message}`,
        pecaId: peca.id,
      });
    }
  }

  for (const gp of Object.values(peca.gradePoints)) {
    const ponto = peca.pontos[gp.pontoId];
    if (ponto !== undefined) pares.push(...ponto2(CAMADA.GRADE_POINT, ponto));
  }

  for (const eixo of Object.values(peca.eixosDobra)) {
    pares.push(...linha(CAMADA.EIXO_DOBRA, eixo.p1, eixo.p2));
  }

  for (const interna of Object.values(peca.linhasInternas)) {
    const pontos = interna.pontos.map((id) => peca.pontos[id]).filter((p) => p !== undefined);
    if (pontos.length < 2) continue;
    const camada =
      interna.tipo === 'fio'
        ? CAMADA.FIO
        : interna.tipo === 'furo'
          ? CAMADA.FURO
          : CAMADA.LINHA_INTERNA;
    if (camada === CAMADA.FURO) {
      for (const ponto of pontos) pares.push(...ponto2(CAMADA.FURO, ponto));
    } else {
      pares.push(...polilinha(camada, pontos, false));
    }
  }

  for (const recorte of Object.values(peca.recortes)) {
    const pontos = recorte.pontos.map((id) => peca.pontos[id]).filter((p) => p !== undefined);
    if (pontos.length >= 3) pares.push(...polilinha(CAMADA.RECORTE, pontos, true));
  }

  // Anotacao: nome e tamanho, no canto de baixo da peca.
  const minX = Math.min(...contorno.map((p) => p.x));
  const minY = Math.min(...contorno.map((p) => p.y));
  pares.push(
    ...texto(CAMADA.TEXTO, { x: minX, y: minY - alturaDoTexto * 1.5 }, alturaDoTexto,
      `${peca.metadados.nome} ${tamanho}`),
  );

  pares.push(par(0, 'ENDBLK'), par(8, CAMADA.CORTE));
  return pares;
}

function polilinha(camada: number, pontos: readonly Vetor2[], fechada: boolean): Par[] {
  const pares: Par[] = [
    par(0, 'POLYLINE'),
    par(8, camada),
    par(66, 1),
    par(70, fechada ? 1 : 0),
    par(10, '0.000'),
    par(20, '0.000'),
    par(30, '0.000'),
  ];
  for (const ponto of pontos) {
    pares.push(
      par(0, 'VERTEX'),
      par(8, camada),
      par(10, emMilimetros(ponto.x)),
      par(20, emMilimetros(ponto.y)),
      par(30, '0.000'),
    );
  }
  pares.push(par(0, 'SEQEND'), par(8, camada));
  return pares;
}

function ponto2(camada: number, p: Vetor2): Par[] {
  return [
    par(0, 'POINT'),
    par(8, camada),
    par(10, emMilimetros(p.x)),
    par(20, emMilimetros(p.y)),
    par(30, '0.000'),
  ];
}

function linha(camada: number, a: Vetor2, b: Vetor2): Par[] {
  return [
    par(0, 'LINE'),
    par(8, camada),
    par(10, emMilimetros(a.x)),
    par(20, emMilimetros(a.y)),
    par(30, '0.000'),
    par(11, emMilimetros(b.x)),
    par(21, emMilimetros(b.y)),
    par(31, '0.000'),
  ];
}

function texto(camada: number, em: Vetor2, altura: number, conteudo: string): Par[] {
  return [
    par(0, 'TEXT'),
    par(8, camada),
    par(10, emMilimetros(em.x)),
    par(20, emMilimetros(em.y)),
    par(30, '0.000'),
    par(40, emMilimetros(altura)),
    par(1, conteudo),
  ];
}

/** Os ids das pecas do modelo, para quem quiser exportar uma por arquivo. */
export function pecasDe(modelo: Modelo): Id[] {
  return Object.keys(modelo.pecas);
}
