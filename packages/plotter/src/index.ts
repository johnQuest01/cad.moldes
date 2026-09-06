/**
 * @cad/plotter — HPGL para a plotadora de moldes (Fase 4).
 *
 * TypeScript puro: gera o texto. Quem manda pela serial e o wrap Tauri, porque
 * navegador nao tem porta serial confiavel no chao de fabrica (ver a decisao de
 * armazenamento offline, Parte 6 da Fase 1).
 *
 * ## A unidade do HPGL e 1/40 de milimetro
 * 1 unidade de plotter = **0,025 mm = 25 UM**. Isso e resolucao de maquina, nao
 * escolha: e o passo do motor da plotadora. A tolerancia de tesselacao do motor e
 * de 100 UM, entao **cabe com folga de 4x** — o desenho que chega ao papel nao
 * perde nada que a geometria tenha garantido.
 *
 * ## O que este pacote NAO faz
 * **Nao encaixa.** Sozinho, as pecas saem enfileiradas ao longo do rolo, na ordem
 * em que estao no modelo, com um vao entre elas. Encaixe de verdade — girar,
 * aninhar, economizar tecido — e o `@cad/encaixe` (Fase 5), e fingir que uma fila
 * e um encaixe seria vender economia que nao existe.
 *
 * Quem quer o encaixe passa as pecas prontas em `pecasPostas`: o plotter desenha
 * onde elas estao e nao enfileira nada. A dependencia fica de fora de proposito —
 * este pacote so sabe virar geometria em HPGL.
 *
 * ## Os eixos
 * A **largura do rolo e X**; a fila corre em **+Y**. E a mesma convencao do
 * `@cad/encaixe`, e por isso a saida dele cai aqui sem nenhuma conversao.
 */
import {
  ErroMotor,
  anelDoContorno,
  aplicarGraduacao,
  offsetMargem,
  projetarPique,
  rotacionarPeca,
  transladarPeca,
  type Id,
  type Modelo,
  type Peca,
  type Problema,
  type Vetor2,
} from '@cad/motor';

/** 1 unidade de plotter = 0,025 mm = 25 UM. Resolucao da maquina, nao escolha. */
export const UM_POR_UNIDADE_DE_PLOTTER = 25;

/** Caneta por tipo de linha. A plotadora troca de caneta; a cortadora ignora. */
export const CANETA = Object.freeze({
  CORTE: 1,
  COSTURA: 2,
  INTERNA: 3,
  PIQUE: 4,
});

/** Vao entre pecas na fila ao longo do rolo. 10 mm e o que a tesoura precisa. */
export const VAO_ENTRE_PECAS_UM = 10_000;

export interface OpcoesDoPlotter {
  readonly tamanho?: string;
  /** Largura util do rolo, em UM. Sem ela, nada e recusado por nao caber. */
  readonly larguraUtilUM?: number;
  readonly vaoUM?: number;
  /** Desenhar tambem a linha de costura, alem da de corte. */
  readonly comCostura?: boolean;
  /** Desenhar fio e linhas internas. */
  readonly comInternas?: boolean;
  readonly comPiques?: boolean;
  /**
   * Pecas JA POSTAS — pelo encaixe da Fase 5, ou por qualquer outra coisa.
   *
   * Quando vem, o plotter NAO enfileira: desenha cada peca exatamente onde ela
   * esta. A largura util continua sendo conferida, porque um desenho que passa da
   * borda do rolo nao sai no papel: sai pela metade.
   */
  readonly pecasPostas?: readonly Peca[];
}

export interface SaidaDoPlotter {
  readonly hpgl: string;
  readonly problemas: readonly Problema[];
  /** Quanto de rolo a fila consome, em UM. E o consumo de papel. */
  readonly comprimentoUsadoUM: number;
  /** Quantas pecas entraram de fato. */
  readonly pecasPlotadas: number;
}

/** UM -> unidade de plotter, arredondado para o passo da maquina. */
export const paraUnidades = (um: number): number => Math.round(um / UM_POR_UNIDADE_DE_PLOTTER);

/** Gera o HPGL do modelo inteiro, num tamanho, enfileirado ao longo do rolo. */
export function gerarHpgl(modelo: Modelo, opcoes: OpcoesDoPlotter = {}): SaidaDoPlotter {
  const tamanho = opcoes.tamanho ?? modelo.tamanhoBase;
  const vao = opcoes.vaoUM ?? VAO_ENTRE_PECAS_UM;
  const util = opcoes.larguraUtilUM ?? papelDoModelo(modelo);
  const problemas: Problema[] = [];

  // `IN` reinicia; `SP1` pega a primeira caneta; `PA` poe em coordenada ABSOLUTA.
  const comandos: string[] = ['IN;', 'SP1;', 'PA;'];
  let cursor = 0;
  let plotadas = 0;

  if (opcoes.pecasPostas !== undefined) {
    let fim = 0;
    for (const posta of opcoes.pecasPostas) {
      let corte: readonly Vetor2[];
      try {
        corte = offsetMargem(posta).pontos;
      } catch (erro) {
        if (!(erro instanceof ErroMotor)) throw erro;
        problemas.push(
          problema(
            'erro',
            erro.codigo,
            `A peca "${posta.metadados.nome}" nao tem linha de corte e nao foi plotada: ${erro.message}`,
            posta.id,
          ),
        );
        continue;
      }

      const caixa = caixaDe(corte);
      if (util !== null && (caixa.minX < 0 || caixa.maxX > util)) {
        problemas.push(
          problema(
            'erro',
            'PECA_MAIS_LARGA_QUE_O_PAPEL',
            `A peca "${posta.metadados.nome}" foi posta em x ${caixa.minX}..${caixa.maxX} UM, ` +
              `fora dos ${util} UM uteis do rolo. Nao foi plotada.`,
            posta.id,
          ),
        );
        continue;
      }

      comandos.push(...desenharPeca(posta, opcoes, problemas));
      fim = Math.max(fim, caixa.maxY);
      plotadas++;
    }

    comandos.push('PU;', 'SP0;', 'IN;');
    return {
      hpgl: comandos.join('\n') + '\n',
      problemas,
      comprimentoUsadoUM: fim,
      pecasPlotadas: plotadas,
    };
  }

  for (const pecaId of Object.keys(modelo.pecas)) {
    let peca: Peca;
    try {
      peca = aplicarGraduacao(modelo, pecaId, tamanho);
    } catch (erro) {
      if (!(erro instanceof ErroMotor)) throw erro;
      problemas.push(problema('erro', erro.codigo, `A peca "${pecaId}": ${erro.message}`, pecaId));
      continue;
    }

    let corte: readonly Vetor2[];
    try {
      corte = offsetMargem(peca).pontos;
    } catch (erro) {
      if (!(erro instanceof ErroMotor)) throw erro;
      problemas.push(
        problema(
          'erro',
          erro.codigo,
          `A peca "${peca.metadados.nome}" nao tem linha de corte e nao foi plotada: ${erro.message}`,
          pecaId,
        ),
      );
      continue;
    }

    const caixa = caixaDe(corte);
    const largura = caixa.maxX - caixa.minX;
    const altura = caixa.maxY - caixa.minY;

    // A LARGURA do rolo e a restricao dura. A peca e posta deitada ou de pe,
    // conforme couber — girar no PAPEL e livre; girar no tecido nao e (F/papel).
    let girar = false;
    if (util !== null && largura > util) {
      if (altura <= util) {
        girar = true;
        problemas.push(
          problema(
            'aviso',
            'PECA_SO_CABE_GIRADA',
            `A peca "${peca.metadados.nome}" mede ${largura} UM de largura de corte e so cabe ` +
              `nos ${util} UM uteis DEITADA. Foi plotada girada 90 graus.`,
            pecaId,
          ),
        );
      } else {
        problemas.push(
          problema(
            'erro',
            'PECA_MAIS_LARGA_QUE_O_PAPEL',
            `A peca "${peca.metadados.nome}" mede ${largura} x ${altura} UM e nao cabe nos ` +
              `${util} UM uteis do rolo em direcao nenhuma. Nao foi plotada.`,
            pecaId,
          ),
        );
        continue;
      }
    }

    // Encosta a peca na origem e empurra pela fila. Girar 90 graus troca os eixos.
    const posta = girar
      ? girada(peca, caixa, cursor)
      : transladarPeca(peca, -caixa.minX, cursor - caixa.minY);

    comandos.push(...desenharPeca(posta, opcoes, problemas));
    cursor += (girar ? largura : altura) + vao;
    plotadas++;
  }

  // `PU` levanta, `SP0` guarda a caneta, `IN` deixa a maquina limpa para o proximo.
  comandos.push('PU;', 'SP0;', 'IN;');
  return {
    hpgl: comandos.join('\n') + '\n',
    problemas,
    comprimentoUsadoUM: Math.max(0, cursor - vao),
    pecasPlotadas: plotadas,
  };
}

function desenharPeca(
  peca: Peca,
  opcoes: OpcoesDoPlotter,
  problemas: Problema[],
): string[] {
  const comandos: string[] = [];

  const corte = offsetMargem(peca).pontos;
  comandos.push(...caminho(CANETA.CORTE, corte, true));

  if (opcoes.comCostura === true) {
    comandos.push(...caminho(CANETA.COSTURA, anelDoContorno(peca), true));
  }

  if (opcoes.comInternas !== false) {
    for (const linha of Object.values(peca.linhasInternas)) {
      const pontos = linha.pontos
        .map((id) => peca.pontos[id])
        .filter((p): p is NonNullable<typeof p> => p !== undefined);
      if (pontos.length >= 2) comandos.push(...caminho(CANETA.INTERNA, pontos, false));
    }
    for (const recorte of Object.values(peca.recortes)) {
      const pontos = recorte.pontos
        .map((id) => peca.pontos[id])
        .filter((p): p is NonNullable<typeof p> => p !== undefined);
      if (pontos.length >= 3) comandos.push(...caminho(CANETA.CORTE, pontos, true));
    }
  }

  if (opcoes.comPiques !== false) {
    for (const pique of Object.values(peca.piques)) {
      if (peca.arestas[pique.arestaId] === undefined) continue;
      try {
        const projetado = projetarPique(peca, pique.id);
        const dentro = projetado.paraDentro;
        // O pique e um risco da borda para DENTRO, com a profundidade do notcher.
        const fundo: Vetor2 = {
          x: Math.round(projetado.pontoDoCorte.x + dentro.x * pique.alturaUM),
          y: Math.round(projetado.pontoDoCorte.y + dentro.y * pique.alturaUM),
        };
        comandos.push(...caminho(CANETA.PIQUE, [projetado.pontoDoCorte, fundo], false));
      } catch (erro) {
        if (!(erro instanceof ErroMotor)) throw erro;
        problemas.push(
          problema(
            'aviso',
            erro.codigo,
            `O pique "${pique.id}" nao foi plotado: ${erro.message}`,
            peca.id,
          ),
        );
      }
    }
  }

  return comandos;
}

/**
 * Um caminho: levanta a caneta, vai ate o inicio, abaixa e desenha o resto.
 *
 * As coordenadas vao todas num `PD` so. Um `PD` por ponto tambem funciona, mas
 * infla o arquivo e faz a maquina parar entre segmentos em plotadoras antigas.
 */
function caminho(caneta: number, pontos: readonly Vetor2[], fechado: boolean): string[] {
  if (pontos.length < 2) return [];
  const seguidos = fechado ? [...pontos, pontos[0]!] : pontos;
  const [primeiro, ...resto] = seguidos;
  return [
    `SP${caneta};`,
    `PU${paraUnidades(primeiro!.x)},${paraUnidades(primeiro!.y)};`,
    `PD${resto.map((p) => `${paraUnidades(p.x)},${paraUnidades(p.y)}`).join(',')};`,
  ];
}

interface Caixa {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function caixaDe(pontos: readonly Vetor2[]): Caixa {
  return {
    minX: Math.min(...pontos.map((p) => p.x)),
    minY: Math.min(...pontos.map((p) => p.y)),
    maxX: Math.max(...pontos.map((p) => p.x)),
    maxY: Math.max(...pontos.map((p) => p.y)),
  };
}

/**
 * Gira a peca 90 graus e encosta na origem.
 *
 * Feito com as operacoes do motor, e nao com uma matriz caseira: girar mexe em
 * ponto, controle de Bezier, pique e eixo, e reescrever isso aqui seria a segunda
 * implementacao de uma conta que ja existe testada.
 */
function girada(peca: Peca, caixa: Caixa, cursor: number): Peca {
  // `rotacionarPeca` roda em torno de um centro; depois a caixa nova e encostada.
  const centro: Vetor2 = {
    x: Math.round((caixa.minX + caixa.maxX) / 2),
    y: Math.round((caixa.minY + caixa.maxY) / 2),
  };
  const rodada = rotacionarPeca(peca, centro, 90);
  const nova = caixaDe(offsetMargem(rodada).pontos);
  return transladarPeca(rodada, -nova.minX, cursor - nova.minY);
}

function papelDoModelo(modelo: Modelo): number | null {
  const papel = modelo.papel;
  return papel === null ? null : papel.larguraUM - 2 * papel.margemDeSegurancaUM;
}

function problema(
  gravidade: 'erro' | 'aviso',
  codigo: string,
  mensagem: string,
  pecaId: Id,
): Problema {
  return { gravidade, codigo, mensagem, pecaId };
}
