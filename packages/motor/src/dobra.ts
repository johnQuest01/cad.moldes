/**
 * Dobra (Parte 3, operacao 14).
 *
 * ## Dobra simples: a peca desenhada e METADE
 * O modelista desenha meia frente com o eixo de dobra na lateral que cai na dobra
 * do tecido. A geometria que vai para o corte, e principalmente **o consumo e a
 * area do encaixe**, e a peca DESDOBRADA. A Parte 3 chama isso de "fonte classica
 * de erro de consumo": quem mede a metade compra metade do tecido necessario.
 *
 * ## Por que devolve poligono, e nao Peca
 * O desdobrado e geometria DERIVADA — como a linha de corte. A peca continua sendo
 * a metade desenhada: e ela que o modelista edita, gradua e cujo contorno tem
 * aresta, margem e ParCostura. Devolver uma `Peca` desdobrada obrigaria a inventar
 * arestas e margens para o lado espelhado, e a proxima edicao teria duas verdades
 * concorrentes sobre a mesma peca.
 *
 * ## O que e validado
 * O eixo tem que deixar a peca inteira de UM LADO so (tocar o eixo e permitido, e
 * o normal: a aresta da dobra fica em cima dele). Se parte da peca cruzasse o
 * eixo, o espelho cairia por cima dela e a area desdobrada sairia menor que o
 * dobro — errado, e sem aviso.
 */
import { FillRule, trimCollinear, union, type Paths64 } from 'clipper2-ts';

import { ErroMotor, exigir, exigirDoMapa } from './erros.js';
import type { Id, Peca, Poligono, Vetor2 } from './tipos.js';
import { area, areaComSinal } from './geometria/anel.js';
import { anelDoContorno } from './geometria/anel.js';
import { offsetMargem } from './offset.js';
import { direcaoDoEixo, ladoDoEixo, refletirPonto, type Eixo } from './transformar.js';

/**
 * Tolerancia de "em cima do eixo", em UM. Um vertice a menos disto do eixo conta
 * como estando nele, nao do outro lado: sao os 0,71 UM de arredondamento para
 * inteiro mais folga, nao uma frouxidao de criterio.
 */
const NA_LINHA_UM = 2;

/** Contorno da peca DESDOBRADA (linha de costura), em UM inteiro, CCW. */
export function contornoDesdobrado(peca: Peca, eixoDobraId: Id): Poligono {
  const eixo = eixoDaPeca(peca, eixoDobraId);
  return desdobrarAnel(peca, eixo, anelDoContorno(peca), 'contorno');
}

/** Linha de CORTE da peca desdobrada: o offset por aresta, espelhado no eixo. */
export function linhaDeCorteDesdobrada(peca: Peca, eixoDobraId: Id): Poligono {
  const eixo = eixoDaPeca(peca, eixoDobraId);
  // Valida contra a linha de costura: e ela que precisa estar de um lado so.
  // A de corte pode passar do eixo pela margem, e isso e legitimo — a margem da
  // aresta que cai na dobra costuma ser zero justamente por isso.
  exigirDeUmLadoSo(peca, eixo, anelDoContorno(peca));
  return desdobrarAnel(peca, eixo, offsetMargem(peca).pontos, 'linha de corte', false);
}

/** Area da peca desdobrada, em UM^2. E ela que o encaixe e o consumo usam. */
export function areaDesdobrada(peca: Peca, eixoDobraId: Id): number {
  return area(contornoDesdobrado(peca, eixoDobraId).pontos);
}

function eixoDaPeca(peca: Peca, eixoDobraId: Id): Eixo {
  const eixo = exigirDoMapa(peca.eixosDobra, eixoDobraId, 'EIXO_DOBRA_INEXISTENTE', 'Eixo de dobra');
  return { p1: eixo.p1, p2: eixo.p2 };
}

function desdobrarAnel(
  peca: Peca,
  eixo: Eixo,
  anel: readonly Vetor2[],
  oQue: string,
  validar = true,
): Poligono {
  const direcao = direcaoDoEixo(eixo, peca.id);
  if (validar) exigirDeUmLadoSo(peca, eixo, anel);

  const espelhado = anel.map((p) => refletirPonto(p, eixo, direcao));
  // A reflexao inverte a orientacao; a uniao exige os dois aneis no mesmo sentido.
  if (areaComSinal(espelhado) < 0) espelhado.reverse();

  const entrada: Paths64 = [
    anel.map((p) => ({ x: p.x, y: p.y })),
    espelhado.map((p) => ({ x: p.x, y: p.y })),
  ];
  const unido = union(entrada, FillRule.NonZero);

  exigir(
    unido.length === 1,
    'DESDOBRA_NAO_FECHOU',
    `Desdobrar o ${oQue} da peca "${peca.metadados.nome}" produziu ${unido.length} aneis. ` +
      `A metade e o seu espelho tem que encostar no eixo e virar uma peca so.`,
    { pecaId: peca.id, aneis: unido.length },
  );

  const desdobrado = trimCollinear(unido[0]!).map((p) => ({ x: p.x, y: p.y }));
  const areaMetade = area(anel);
  const areaTotal = area(desdobrado);
  if (!(areaTotal > areaMetade)) {
    throw new ErroMotor(
      'DESDOBRA_NAO_CRESCEU',
      `O ${oQue} desdobrado da peca "${peca.metadados.nome}" tem area ${areaTotal} UM2, que ` +
        `nao e maior que a metade (${areaMetade} UM2). O espelho caiu por cima da propria ` +
        `peca — o consumo de tecido sairia menor que o real.`,
      { pecaId: peca.id, areaMetade, areaTotal },
    );
  }
  return { pontos: desdobrado };
}

/**
 * Exige que a peca esteja toda de um lado do eixo. Vertice EM CIMA do eixo e o
 * caso normal (a aresta da dobra), nao erro.
 */
function exigirDeUmLadoSo(peca: Peca, eixo: Eixo, anel: readonly Vetor2[]): void {
  const direcao = direcaoDoEixo(eixo, peca.id);
  let positivos = 0;
  let negativos = 0;
  let piorPositivo = 0;
  let piorNegativo = 0;

  for (const ponto of anel) {
    const lado = ladoDoEixo(ponto, eixo, direcao);
    if (lado > NA_LINHA_UM) {
      positivos++;
      piorPositivo = Math.max(piorPositivo, lado);
    } else if (lado < -NA_LINHA_UM) {
      negativos++;
      piorNegativo = Math.min(piorNegativo, lado);
    }
  }

  exigir(
    positivos === 0 || negativos === 0,
    'EIXO_DOBRA_ATRAVESSA_A_PECA',
    `O eixo de dobra atravessa a peca "${peca.metadados.nome}": ${positivos} vertice(s) de um ` +
      `lado (ate ${Math.round(piorPositivo)} UM) e ${negativos} do outro (ate ` +
      `${Math.round(-piorNegativo)} UM). Numa dobra simples a peca desenhada e a METADE e ` +
      `fica toda de um lado; espelhar assim colocaria o reflexo por cima dela mesma.`,
    { pecaId: peca.id, positivos, negativos },
  );
  exigir(
    positivos > 0 || negativos > 0,
    'EIXO_DOBRA_FORA_DO_CONTORNO',
    `Todos os vertices da peca "${peca.metadados.nome}" estao em cima do eixo de dobra. ` +
      `A peca nao tem area de um lado para espelhar.`,
    { pecaId: peca.id },
  );
}
