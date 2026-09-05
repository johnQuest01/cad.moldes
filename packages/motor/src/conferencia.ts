/**
 * Conferencia (Parte 2, operacoes 6 e 7).
 *
 *  6. `validarCasamento` — para cada `ParCostura` do Modelo (D3), as duas arestas
 *     precisam ter o mesmo comprimento EM TODOS OS TAMANHOS da grade.
 *  7. `compararPerimetros` — dado um conjunto de arestas soma (+) e outro
 *     subtracao (-), devolve `Total(+)`, `Total(-)` e a diferenca para cada
 *     tamanho. E como o modelista prova que a costura fecha.
 *
 * As duas operacoes RELATAM. Nenhuma delas conserta nada: uma peca que nao casa e
 * decisao de modelagem, nao defeito a ser corrigido pelo motor em silencio.
 *
 * ## O par de costura e DADO DECLARADO, nunca inferido
 * Duas arestas com o mesmo comprimento nao formam um par; um par e o que o
 * modelista declarou com `DefinirParCostura`. Inferir pela geometria acertaria por
 * acaso no molde simples e erraria feio no molde de verdade, onde varias arestas
 * medem parecido.
 *
 * ## Por que graduar aqui e nao so medir o base
 * Casamento no tamanho base nao prova nada: o erro classico e a regra de graduacao
 * abrir a cava da frente e nao a da manga, e a peca so nao fecha no GG. Por isso a
 * validacao percorre a grade inteira.
 */
import { ErroMotor, exigir } from './erros.js';
import { medirAresta } from './geometria/medir.js';
import { aplicarGraduacao } from './graduacao.js';
import type { Id, Modelo, Peca, Problema } from './tipos.js';
import { TOLERANCIA_CASAMENTO_UM, type UM } from './unidades.js';

/** Uma linha da tabela `tamanho x medida` da conferencia de perimetros. */
export interface LinhaDeConferencia {
  readonly mais: UM;
  readonly menos: UM;
  readonly dif: UM;
}

/**
 * Confere todos os pares de costura do modelo, em todos os tamanhos da grade.
 * Lista vazia = tudo casa.
 *
 * Estoura (em vez de relatar) quando a peca nao pode nem ser graduada — aresta
 * inexistente, tamanho quebrado, peca com linha interna. Nesses casos nao existe
 * medida para comparar, e devolver "nenhum problema" seria mentira.
 */
export function validarCasamento(modelo: Modelo): Problema[] {
  const problemas: Problema[] = [];
  const cache = new Map<string, Peca>();

  for (const par of Object.values(modelo.paresCostura)) {
    const pecaA = pecaDaAresta(modelo, par.arestaA);
    const pecaB = pecaDaAresta(modelo, par.arestaB);

    for (const tamanho of modelo.tamanhos) {
      const comprimentoA = medirAresta(noTamanho(modelo, pecaA.id, tamanho, cache), par.arestaA);
      const comprimentoB = medirAresta(noTamanho(modelo, pecaB.id, tamanho, cache), par.arestaB);

      // O que tem que fechar nao e a igualdade, e a SOBRA declarada (D9).
      const sobra = comprimentoB - comprimentoA;
      const desvio = sobra - par.embebidoUM;

      if (Math.abs(desvio) <= TOLERANCIA_CASAMENTO_UM) continue;

      const esperado =
        par.embebidoUM === 0
          ? 'mesmo comprimento'
          : `"${par.arestaB}" ${par.embebidoUM} UM maior (embebido declarado)`;
      problemas.push({
        gravidade: 'erro',
        codigo: 'CASAMENTO_DIVERGENTE',
        mensagem:
          `No tamanho ${tamanho}, a aresta "${par.arestaA}" da peca "${pecaA.metadados.nome}" ` +
          `mede ${comprimentoA} UM e a aresta "${par.arestaB}" da peca "${pecaB.metadados.nome}" ` +
          `mede ${comprimentoB} UM — sobra de ${sobra > 0 ? '+' : ''}${sobra} UM. ` +
          `O par "${par.id}" espera ${esperado}, entao esta ` +
          `${desvio > 0 ? '+' : ''}${desvio} UM fora, acima da tolerancia de ` +
          `${TOLERANCIA_CASAMENTO_UM} UM.`,
        pecaId: pecaA.id,
        arestaId: par.arestaA,
      });
    }
  }

  return problemas;
}

/**
 * Tabela `tamanho -> { mais, menos, dif }`.
 *
 * As arestas podem estar em pecas diferentes — e o caso normal: a conferencia
 * classica soma o decote da frente com o das costas e subtrai a gola.
 */
export function compararPerimetros(
  modelo: Modelo,
  mais: readonly Id[],
  menos: readonly Id[],
): Record<string, LinhaDeConferencia> {
  exigir(
    mais.length > 0 || menos.length > 0,
    'CONFERENCIA_SEM_ARESTAS',
    `A conferencia de perimetros do modelo "${modelo.nome}" veio sem nenhuma aresta ` +
      `nos dois lados. Nao ha o que somar nem o que subtrair.`,
    { modeloId: modelo.id },
  );

  // Resolve as pecas antes de graduar: aresta inexistente tem que estourar na
  // primeira leitura, nao no meio da tabela com metade das linhas prontas.
  const donaDaAresta = new Map<Id, Id>();
  for (const arestaId of [...mais, ...menos]) {
    donaDaAresta.set(arestaId, pecaDaAresta(modelo, arestaId).id);
  }

  const cache = new Map<string, Peca>();
  const tabela: Record<string, LinhaDeConferencia> = {};

  for (const tamanho of modelo.tamanhos) {
    const somar = (arestas: readonly Id[]): UM =>
      arestas.reduce((total, arestaId) => {
        const pecaId = donaDaAresta.get(arestaId)!;
        return total + medirAresta(noTamanho(modelo, pecaId, tamanho, cache), arestaId);
      }, 0);

    const totalMais = somar(mais);
    const totalMenos = somar(menos);
    tabela[tamanho] = { mais: totalMais, menos: totalMenos, dif: totalMais - totalMenos };
  }

  return tabela;
}

/** Peca graduada, memorizada por (peca, tamanho): a mesma peca serve varios pares. */
function noTamanho(modelo: Modelo, pecaId: Id, tamanho: string, cache: Map<string, Peca>): Peca {
  const chave = `${pecaId}|${tamanho}`;
  const guardada = cache.get(chave);
  if (guardada !== undefined) return guardada;
  const graduada = aplicarGraduacao(modelo, pecaId, tamanho);
  cache.set(chave, graduada);
  return graduada;
}

/** Encontra a peca dona de uma aresta. Aresta e do modelo inteiro, nao de uma peca so. */
function pecaDaAresta(modelo: Modelo, arestaId: Id): Peca {
  for (const peca of Object.values(modelo.pecas)) {
    if (peca.arestas[arestaId] !== undefined) return peca;
  }
  throw new ErroMotor(
    'ARESTA_INEXISTENTE',
    `A aresta "${arestaId}" nao existe em nenhuma peca do modelo "${modelo.nome}".`,
    { modeloId: modelo.id, arestaId },
  );
}
