/**
 * COMANDOS: o que se faz por botao, e nao por gesto de ponteiro.
 *
 * Duplicar peca, renomear, remover, definir margem da selecao, simplificar
 * contorno, abrir pregas e mexer na regra de graduacao nao sao arrastos — sao
 * cliques de botao e valores digitados. Forcar cada um a virar `Ferramenta`
 * criaria maquina de estados para o que nao tem estado.
 *
 * Cada comando e uma FUNCAO PURA que devolve os gestos. Quem aplica e a sessao, e
 * e o mesmo caminho de sempre: nada aqui muda peca por baixo. Sendo puros, sao
 * testados headless como o resto.
 */
import {
  mmParaUM,
  type Id,
  type Modelo,
  type Peca,
  type PropriedadesEncaixe,
  type TipoPique,
} from '@cad/motor';

import type { Gesto } from './sessao.js';
import type { Referencia } from './selecao.js';

/** Quanto a copia se afasta da original, para as duas nao nascerem sobrepostas. */
export const AFASTAMENTO_DA_COPIA_UM = 50_000;

/**
 * Duplica a peca. `comGraduacao` decide se as regras vao junto — sem elas a copia
 * nasce parada, e o validador acusa `GRADE_POINT_SEM_REGRA`.
 */
export function duplicarPeca(
  modelo: Modelo,
  pecaId: Id,
  semente: string,
  comGraduacao = true,
): Gesto[] {
  const peca = exigirPeca(modelo, pecaId);
  const larguraDaPeca = larguraDe(peca);
  return [
    {
      tipo: 'DuplicarPeca',
      pecaId,
      payload: {
        novoPecaId: `${pecaId}-${semente}`,
        prefixoId: semente,
        dx: larguraDaPeca + AFASTAMENTO_DA_COPIA_UM,
        dy: 0,
        comGraduacao,
      },
    },
  ];
}

export function renomearPeca(modelo: Modelo, pecaId: Id, nome: string): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [{ tipo: 'DefinirMetadados', pecaId, payload: { nome } }];
}

export function removerPeca(modelo: Modelo, pecaId: Id): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [{ tipo: 'RemoverPeca', pecaId, payload: {} }];
}

export function definirEncaixe(
  modelo: Modelo,
  pecaId: Id,
  encaixe: PropriedadesEncaixe,
): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [{ tipo: 'DefinirEncaixe', pecaId, payload: { encaixe } }];
}

/** Margem de TODAS as arestas selecionadas, de uma vez. Um passo de undo. */
export function definirMargem(selecionadas: readonly Referencia[], milimetros: number): Gesto[] {
  const margemUM = mmParaUM(milimetros);
  return selecionadas
    .filter((ref): ref is Extract<Referencia, { tipo: 'aresta' }> => ref.tipo === 'aresta')
    .map((ref) => ({
      tipo: 'DefinirMargem',
      pecaId: ref.pecaId,
      payload: { arestaId: ref.arestaId, margemUM },
    }));
}

/** Douglas-Peucker no contorno. Destrutivo: a interface pede confirmacao antes. */
export function simplificarContorno(modelo: Modelo, pecaId: Id, milimetros: number): Gesto[] {
  exigirPeca(modelo, pecaId);
  return [
    { tipo: 'SimplificarContorno', pecaId, payload: { toleranciaUM: mmParaUM(milimetros) } },
  ];
}

/** Abre as pregas dos eixos dados e deixa a peca plana, com os piques de prega. */
export function abrirPregas(
  modelo: Modelo,
  pecaId: Id,
  eixoIds: readonly Id[],
  semente: string,
): Gesto[] {
  exigirPeca(modelo, pecaId);
  if (eixoIds.length === 0) return [];
  return [{ tipo: 'AbrirPregas', pecaId, payload: { eixoIds: [...eixoIds], prefixoId: semente } }];
}

/**
 * A regra de graduacao de um grade point entre DOIS TAMANHOS CONSECUTIVOS (D8).
 *
 * Trocar a regra e remover a antiga e por a nova: `DefinirRegraGraduacao` recusa
 * id repetido e recusa duas regras para o mesmo par de tamanhos. Os dois eventos
 * saem no mesmo passo, entao um desfazer devolve a regra que estava la.
 */
export function definirRegraGraduacao(
  modelo: Modelo,
  gradePointId: Id,
  deTamanho: string,
  paraTamanho: string,
  dxMM: number,
  dyMM: number,
  semente: string,
): Gesto[] {
  const antiga = Object.values(modelo.regrasGraduacao).find(
    (r) =>
      r.pontoGraduacaoId === gradePointId &&
      r.deTamanho === deTamanho &&
      r.paraTamanho === paraTamanho,
  );
  const gestos: Gesto[] = [];
  if (antiga !== undefined) {
    gestos.push({ tipo: 'RemoverRegraGraduacao', pecaId: null, payload: { regraId: antiga.id } });
  }
  gestos.push({
    tipo: 'DefinirRegraGraduacao',
    pecaId: null,
    payload: {
      regraId: `r-${semente}`,
      pontoGraduacaoId: gradePointId,
      deTamanho,
      paraTamanho,
      dx: mmParaUM(dxMM),
      dy: mmParaUM(dyMM),
    },
  });
  return gestos;
}

/** Tira a regra, deixando o grade point parado (a ancora da peca, D7). */
export function removerRegraGraduacao(modelo: Modelo, regraId: Id): Gesto[] {
  if (modelo.regrasGraduacao[regraId] === undefined) return [];
  return [{ tipo: 'RemoverRegraGraduacao', pecaId: null, payload: { regraId } }];
}

/** Muda o tipo e a dimensao de um pique ja cravado: remove e recrava no mesmo `s`. */
export function trocarPique(
  modelo: Modelo,
  pecaId: Id,
  piqueId: Id,
  tipo: TipoPique,
  profundidadeMM: number,
  larguraMM: number,
): Gesto[] {
  const pique = exigirPeca(modelo, pecaId).piques[piqueId];
  if (pique === undefined) return [];
  return [
    { tipo: 'RemoverPique', pecaId, payload: { piqueId } },
    {
      tipo: 'AdicionarPique',
      pecaId,
      payload: {
        piqueId,
        arestaId: pique.arestaId,
        s: pique.s,
        tipo,
        alturaUM: mmParaUM(profundidadeMM),
        larguraUM: mmParaUM(larguraMM),
        anguloGraus: pique.anguloGraus,
      },
    },
  ];
}

/** Os pares de tamanhos consecutivos da grade. E a tabela do painel de graduacao. */
export function passosDaGrade(modelo: Modelo): (readonly [string, string])[] {
  const passos: [string, string][] = [];
  for (let i = 0; i + 1 < modelo.tamanhos.length; i++) {
    passos.push([modelo.tamanhos[i]!, modelo.tamanhos[i + 1]!]);
  }
  return passos;
}

function exigirPeca(modelo: Modelo, pecaId: Id): Peca {
  const peca = modelo.pecas[pecaId];
  if (peca === undefined) {
    throw new Error(`A peca "${pecaId}" nao existe no modelo "${modelo.nome}".`);
  }
  return peca;
}

function larguraDe(peca: Peca): number {
  const xs = Object.values(peca.pontos).map((p) => p.x);
  return xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs);
}
