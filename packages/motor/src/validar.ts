/**
 * Validacao de inconsistencias (Parte 2, operacao 8).
 *
 * O validador **RELATA**. Nunca conserta nada em silencio: contorno aberto,
 * auto-intersecao, pique orfao, fio ausente, grade point sem regra e margem
 * invalida sao decisoes ou descuidos do modelista, e quem decide o que fazer com
 * eles e ele, nao o motor.
 *
 * ## Por que aqui existe um `catch`
 * A regra de erro da Parte 0 proibe `catch` SILENCIOSO. Este nao e: as operacoes
 * de geometria estouram `ErroMotor` no primeiro defeito, e um validador que
 * parasse no primeiro defeito seria inutil — o modelista quer a lista inteira de
 * uma vez. O `catch` converte o erro em `Problema` **preservando codigo e
 * mensagem**, e so para `ErroMotor`: qualquer outra excecao sobe.
 *
 * ## Gravidade
 *  - `erro`  — a peca nao pode ir para o corte assim (contorno aberto,
 *    auto-intersecao, margem faltando, pique apontando para o nada);
 *  - `aviso` — e suspeito, mas pode ser intencional (peca sem fio, grade point
 *    sem regra, ponto interno sem regra numa peca que gradua).
 */
import { FillRule, union, type Paths64 } from 'clipper2-ts';

import { ErroMotor } from './erros.js';
import type { Id, Modelo, Peca, Problema, Vetor2 } from './tipos.js';
import { area } from './geometria/anel.js';
import { anelDoContorno } from './geometria/anel.js';
import { segmentosDaAresta } from './geometria/aresta.js';
import { validarCasamento } from './conferencia.js';
import { offsetMargem } from './offset.js';

/**
 * Fracao de area em que a uniao pode diferir do shoelace sem ser considerada
 * auto-intersecao. Vem do arredondamento dos vertices para inteiro (ate 0,71 UM
 * cada), que perturba a area em ~0,7 x perimetro; 0,1% cobre isso com folga e
 * ainda pega qualquer laco de verdade, que muda a area em ordens de grandeza.
 */
const FRACAO_AREA_TOLERADA = 0.001;

/**
 * Confere uma peca inteira e devolve a lista de problemas. Vazia = tudo certo.
 *
 * A assinatura da Parte 1 era `validarInconsistencias(peca)`, mas duas das
 * checagens que a Parte 2 pede — grade point sem regra e ponto interno sem regra —
 * dependem das `RegraGraduacao`, que vivem no MODELO. Passar o modelo e a unica
 * forma de fazer as duas sem duplicar a tabela de regras dentro da peca.
 */
export function validarInconsistencias(modelo: Modelo, pecaId: Id): Problema[] {
  const peca = modelo.pecas[pecaId];
  if (peca === undefined) {
    return [
      {
        gravidade: 'erro',
        codigo: 'PECA_INEXISTENTE',
        mensagem: `A peca "${pecaId}" nao existe no modelo "${modelo.nome}".`,
      },
    ];
  }

  const problemas: Problema[] = [];
  const anel = conferirContorno(peca, problemas);
  if (anel !== null) conferirAutoIntersecao(peca, anel, problemas);
  conferirMargens(peca, problemas);
  conferirArestas(peca, problemas);
  conferirPiques(peca, problemas);
  conferirFio(peca, problemas);
  conferirGraduacao(modelo, peca, problemas);
  return problemas;
}

/** Roda `validarInconsistencias` em todas as pecas e junta o que e de MODELO. */
export function validarModelo(modelo: Modelo): Problema[] {
  const problemas: Problema[] = [];
  for (const pecaId of Object.keys(modelo.pecas)) {
    problemas.push(...validarInconsistencias(modelo, pecaId));
  }
  problemas.push(...conferirModelo(modelo));
  return problemas;
}

/**
 * So o que e de NIVEL DE MODELO: casamento de costuras, referencias orfas e o
 * papel do plotter.
 *
 * Existe separado porque quem ja tem os problemas por peca em cache — o editor
 * tem — precisa juntar estes sem refazer a validacao de cada peca. Sem esta
 * porta, o editor mostrava so os problemas da peca e engolia em silencio a regra
 * de graduacao orfa, o par de costura pendente e a peca que nao cabe no papel.
 */
export function conferirModelo(modelo: Modelo): Problema[] {
  const problemas: Problema[] = [];
  problemas.push(...comoProblemas(() => validarCasamento(modelo)));
  conferirReferenciasDoModelo(modelo, problemas);
  conferirPapel(modelo, problemas);
  return problemas;
}

/**
 * A peca cabe no rolo do plotter?
 *
 * Quem tem que caber e a LINHA DE CORTE, nao a de costura: e ela que vai para o
 * papel. E a largura util e `largura - 2 x margem de seguranca`, porque nenhuma
 * plotadora imprime ate o fio do papel.
 *
 * Uma peca que nao cabe de pe mas cabe DEITADA e aviso, nao erro: girar o molde
 * no papel e livre — o que nao e livre e girar no tecido, que tem fio. Sao duas
 * rotacoes diferentes, e quem decide se pode girar no papel e o modelista.
 *
 * Sem papel declarado, nao ha o que conferir: quem nao disse qual rolo usa nao
 * recebe palpite.
 */
function conferirPapel(modelo: Modelo, problemas: Problema[]): void {
  const papel = modelo.papel;
  if (papel === null) return;
  const util = papel.larguraUM - 2 * papel.margemDeSegurancaUM;

  for (const peca of Object.values(modelo.pecas)) {
    let corte: readonly Vetor2[];
    try {
      corte = offsetMargem(peca).pontos;
    } catch (erro) {
      // Peca que nem gera linha de corte ja esta sendo acusada por outra
      // checagem; nao vale acusar duas vezes pelo mesmo defeito.
      if (!(erro instanceof ErroMotor)) throw erro;
      continue;
    }

    const largura = Math.max(...corte.map((p) => p.x)) - Math.min(...corte.map((p) => p.x));
    const altura = Math.max(...corte.map((p) => p.y)) - Math.min(...corte.map((p) => p.y));
    if (largura <= util) continue;

    const cabeGirada = altura <= util;
    problemas.push({
      gravidade: cabeGirada ? 'aviso' : 'erro',
      codigo: cabeGirada ? 'PECA_SO_CABE_GIRADA' : 'PECA_MAIS_LARGA_QUE_O_PAPEL',
      mensagem: cabeGirada
        ? `A peca "${peca.metadados.nome}" tem ${largura} UM de largura de corte e nao cabe ` +
          `nos ${util} UM uteis do papel "${papel.nome}" — mas cabe DEITADA ` +
          `(${altura} UM). Girar no papel e livre; girar no tecido nao e.`
        : `A peca "${peca.metadados.nome}" mede ${largura} x ${altura} UM na linha de corte e ` +
          `nao cabe nos ${util} UM uteis do papel "${papel.nome}" em nenhuma direcao. ` +
          `Ela nao tem como ser plotada inteira.`,
      pecaId: peca.id,
    });
  }
}

/**
 * As duas referencias que sobrevivem a uma remocao — de proposito.
 *
 * `DesmarcarGradePoint` nao apaga as regras dele em cascata, e `RemoverPeca` nao
 * apaga os pares de costura que apontavam para ela. Apagar em silencio esconderia
 * do modelista que ele acabou de perder a graduacao de um ponto, ou que uma
 * costura ficou sem par. O motor prefere gritar: e aqui que ele grita.
 */
function conferirReferenciasDoModelo(modelo: Modelo, problemas: Problema[]): void {
  const gradePoints = new Set<Id>();
  const arestas = new Map<Id, Id>();
  for (const peca of Object.values(modelo.pecas)) {
    for (const id of Object.keys(peca.gradePoints)) gradePoints.add(id);
    for (const id of Object.keys(peca.arestas)) arestas.set(id, peca.id);
  }

  for (const regra of Object.values(modelo.regrasGraduacao)) {
    if (gradePoints.has(regra.pontoGraduacaoId)) continue;
    problemas.push({
      gravidade: 'erro',
      codigo: 'REGRA_SEM_GRADE_POINT',
      mensagem:
        `A regra "${regra.id}" (${regra.deTamanho} -> ${regra.paraTamanho}) aponta para o ` +
        `grade point "${regra.pontoGraduacaoId}", que nao existe mais em nenhuma peca. ` +
        `A graduacao desse ponto foi perdida.`,
    });
  }

  for (const par of Object.values(modelo.paresCostura)) {
    for (const arestaId of [par.arestaA, par.arestaB]) {
      if (arestas.has(arestaId)) continue;
      problemas.push({
        gravidade: 'erro',
        codigo: 'PAR_COSTURA_PENDENTE',
        mensagem:
          `O par de costura "${par.id}" aponta para a aresta "${arestaId}", que nao existe ` +
          `mais no modelo. Uma costura sem par nao fecha na maquina.`,
        arestaId,
      });
    }
  }
}

/** Roda uma acao que devolve problemas, virando o ErroMotor dela em problema. */
function comoProblemas(acao: () => Problema[]): Problema[] {
  try {
    return acao();
  } catch (erro) {
    if (erro instanceof ErroMotor) {
      return [{ gravidade: 'erro', codigo: erro.codigo, mensagem: erro.message }];
    }
    throw erro;
  }
}

function conferirContorno(peca: Peca, problemas: Problema[]): Vetor2[] | null {
  try {
    return anelDoContorno(peca);
  } catch (erro) {
    if (!(erro instanceof ErroMotor)) throw erro;
    problemas.push({
      gravidade: 'erro',
      codigo: erro.codigo,
      mensagem: erro.message,
      pecaId: peca.id,
    });
    return null;
  }
}

/**
 * Auto-intersecao: compara a area do shoelace com a da uniao do proprio anel.
 * Num contorno simples as duas batem; num contorno que se cruza, a uniao separa
 * os lacos e as areas divergem — quem faz a conta e o clipper2.
 */
function conferirAutoIntersecao(peca: Peca, anel: readonly Vetor2[], problemas: Problema[]): void {
  const entrada: Paths64 = [anel.map((p) => ({ x: p.x, y: p.y }))];
  const unido = union(entrada, FillRule.NonZero);
  const areaAnel = area(anel);
  const areaUnida = unido.reduce((soma, caminho) => soma + area(caminho.map((p) => ({ x: p.x, y: p.y }))), 0);
  const desvio = Math.abs(areaUnida - areaAnel);

  if (unido.length === 1 && desvio <= areaAnel * FRACAO_AREA_TOLERADA) return;

  problemas.push({
    gravidade: 'erro',
    codigo: 'CONTORNO_AUTO_INTERSECTADO',
    mensagem:
      `O contorno da peca "${peca.metadados.nome}" cruza a si mesmo: o shoelace da ` +
      `${areaAnel} UM2 e a uniao do proprio anel da ${areaUnida} UM2 em ${unido.length} ` +
      `regiao(oes). Uma peca assim nao tem dentro e fora definidos, e o offset da margem ` +
      `sai imprevisivel.`,
    pecaId: peca.id,
  });
}

function conferirMargens(peca: Peca, problemas: Problema[]): void {
  const vistas = new Set<Id>();
  for (const segmentoId of peca.contorno) {
    const segmento = peca.segmentos[segmentoId];
    if (segmento === undefined) continue;
    if (vistas.has(segmento.arestaId)) continue;
    vistas.add(segmento.arestaId);

    const margem = peca.margens[segmento.arestaId];
    if (margem === undefined) {
      problemas.push({
        gravidade: 'erro',
        codigo: 'MARGEM_AUSENTE',
        mensagem:
          `A aresta "${segmento.arestaId}" da peca "${peca.metadados.nome}" nao tem margem ` +
          `definida. O motor nao assume zero: emita DefinirMargem, mesmo que seja para dizer ` +
          `que a margem e zero (aresta na dobra do tecido).`,
        pecaId: peca.id,
        arestaId: segmento.arestaId,
      });
    } else if (margem < 0) {
      problemas.push({
        gravidade: 'erro',
        codigo: 'MARGEM_NEGATIVA',
        mensagem:
          `A aresta "${segmento.arestaId}" da peca "${peca.metadados.nome}" tem margem ` +
          `${margem} UM. Margem negativa encolheria a peca.`,
        pecaId: peca.id,
        arestaId: segmento.arestaId,
      });
    }
  }
}

/** Aresta declarada que nao aparece no contorno, ou cujo trecho esta quebrado. */
function conferirArestas(peca: Peca, problemas: Problema[]): void {
  for (const arestaId of Object.keys(peca.arestas)) {
    try {
      segmentosDaAresta(peca, arestaId);
    } catch (erro) {
      if (!(erro instanceof ErroMotor)) throw erro;
      problemas.push({
        gravidade: 'erro',
        codigo: erro.codigo,
        mensagem: erro.message,
        pecaId: peca.id,
        arestaId,
      });
    }
  }
}

function conferirPiques(peca: Peca, problemas: Problema[]): void {
  for (const pique of Object.values(peca.piques)) {
    if (peca.arestas[pique.arestaId] === undefined) {
      problemas.push({
        gravidade: 'erro',
        codigo: 'PIQUE_ORFAO',
        mensagem:
          `O pique "${pique.id}" (tipo ${pique.tipo}) esta ancorado na aresta ` +
          `"${pique.arestaId}", que nao existe na peca "${peca.metadados.nome}". Ele nao tem ` +
          `onde ser cortado.`,
        pecaId: peca.id,
        arestaId: pique.arestaId,
      });
      continue;
    }
    if (!Number.isFinite(pique.s) || pique.s < 0 || pique.s > 1) {
      problemas.push({
        gravidade: 'erro',
        codigo: 'PIQUE_FORA_DA_ARESTA',
        mensagem:
          `O pique "${pique.id}" tem s = ${String(pique.s)}, fora de [0, 1]. ` +
          `s e fracao do comprimento de arco da aresta, entao o pique cairia fora dela.`,
        pecaId: peca.id,
        arestaId: pique.arestaId,
      });
      continue;
    }
    // O pique e cortado da borda para dentro; mais fundo que a margem, ele passa da
    // linha de costura e entra na peca acabada. Aviso, nao erro: ha ateliê que corta
    // de proposito um pique mais fundo em margem larga, e o motor nao decide isso.
    const margem = peca.margens[pique.arestaId];
    if (margem !== undefined && pique.alturaUM > margem) {
      problemas.push({
        gravidade: 'aviso',
        codigo: 'PIQUE_MAIS_FUNDO_QUE_A_MARGEM',
        mensagem:
          `O pique "${pique.id}" tem ${pique.alturaUM} UM de profundidade, mas a margem da ` +
          `aresta "${pique.arestaId}" e de ${margem} UM. O corte passa da linha de costura e ` +
          `aparece na peca acabada.`,
        pecaId: peca.id,
        arestaId: pique.arestaId,
      });
    }
  }
}

function conferirFio(peca: Peca, problemas: Problema[]): void {
  const temFio = Object.values(peca.linhasInternas).some((linha) => linha.tipo === 'fio');
  if (temFio) return;
  problemas.push({
    gravidade: 'aviso',
    codigo: 'FIO_AUSENTE',
    mensagem:
      `A peca "${peca.metadados.nome}" nao tem linha de fio. Sem ela o encaixe nao sabe a ` +
      `direcao do tecido e a peca pode ser cortada no sentido errado. E aviso e nao erro ` +
      `porque peca pequena de aviamento as vezes e cortada sem fio de proposito.`,
    pecaId: peca.id,
  });
}

/**
 * Grade point sem regra e ponto interno sem grade point.
 *
 * Os dois sao AVISO, nao erro: pela D7 "sem regra" e como se declara a ancora, e
 * uma peca que nao gradua e legitima. O que o validador faz e nao deixar passar
 * batido — que e onde mora o fio esquecido numa peca que cresce.
 */
function conferirGraduacao(modelo: Modelo, peca: Peca, problemas: Problema[]): void {
  const comRegra = new Set<Id>();
  for (const regra of Object.values(modelo.regrasGraduacao)) {
    comRegra.add(regra.pontoGraduacaoId);
  }

  const gradePoints = Object.values(peca.gradePoints);
  for (const gradePoint of gradePoints) {
    if (comRegra.has(gradePoint.id)) continue;
    problemas.push({
      gravidade: 'aviso',
      codigo: 'GRADE_POINT_SEM_REGRA',
      mensagem:
        `O grade point "${gradePoint.id}" (ponto "${gradePoint.pontoId}") nao tem nenhuma ` +
        `RegraGraduacao. Ele fica parado em todos os tamanhos — o que e a forma de declarar ` +
        `a ancora (D7), mas tambem e como uma regra esquecida se parece.`,
      pecaId: peca.id,
      pontoId: gradePoint.pontoId,
    });
  }

  // A peca so "gradua" se algum grade point dela tem regra. Numa peca que gradua,
  // ponto interno parado desalinha o fio e o furo em relacao ao contorno que cresceu.
  const pecaGradua = gradePoints.some((gp) => comRegra.has(gp.id));
  if (!pecaGradua) return;

  const marcados = new Set(gradePoints.map((gp) => gp.pontoId));
  const internos = new Set<Id>();
  for (const linha of Object.values(peca.linhasInternas)) for (const id of linha.pontos) internos.add(id);
  for (const recorte of Object.values(peca.recortes)) for (const id of recorte.pontos) internos.add(id);

  for (const pontoId of internos) {
    if (marcados.has(pontoId)) continue;
    problemas.push({
      gravidade: 'aviso',
      codigo: 'PONTO_INTERNO_SEM_REGRA',
      mensagem:
        `O ponto interno "${pontoId}" da peca "${peca.metadados.nome}" nao e grade point, ` +
        `mas a peca gradua. Ele fica parado enquanto o contorno cresce — o fio sai torto e ` +
        `o furo sai fora de lugar nos outros tamanhos.`,
      pecaId: peca.id,
      pontoId,
    });
  }
}
