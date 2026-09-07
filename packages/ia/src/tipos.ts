/**
 * @cad/ia — o catálogo de ferramentas que a IA usa para operar o CAD.
 *
 * ## As decisões que não se negociam (J1 – J8)
 *
 * ### J1. A IA não tem caminho paralelo
 * Toda ação dela vira **gesto**, e todo gesto passa pela mesma `Sessao.aplicar` que
 * o mouse usa — que, antes de aceitar, reconstrói o log inteiro para provar que o
 * resultado é consistente. Uma ação errada da IA falha **alto**, com a mensagem do
 * próprio motor, e essa mensagem volta para o modelo como resultado da ferramenta.
 *
 * Se houvesse um atalho — a IA escrevendo direto no estado — todas as garantias das
 * cinco fases anteriores valeriam só para o mouse.
 *
 * ### J2. Desfazer vale para a IA
 * Cada rodada da IA entra como **um passo** no rascunho. `Ctrl+Z` desfaz o que ela
 * fez exatamente como desfaz o que a pessoa fez. É essa rede que torna a coisa
 * aceitável: nada que a IA faça é irreversível por acidente.
 *
 * ### J3. A chave é do cliente, e fica no navegador
 * Quem paga o modelo é o cliente, com a chave dele. Ela é guardada no navegador e
 * só viaja para o provedor do modelo. Não há servidor nosso no caminho, então não
 * há onde vazar.
 *
 * ### J4. A IA não inventa medida
 * Toda ferramenta que mexe em geometria pede **número explícito em milímetro**.
 * "Aumenta um pouco a cava" não tem tradução: o modelo tem que perguntar quanto.
 * Um molde silenciosamente errado é a pior falha possível, e um chute de 5 mm numa
 * cava é exatamente isso.
 *
 * ### J5. O que é destrutivo pede confirmação
 * Apagar peça, simplificar contorno, trocar o modelo inteiro: a ferramenta devolve
 * `confirmar`, e quem pergunta é a interface. A IA não confirma por conta própria.
 *
 * ### J6. O catálogo é puro
 * Nada aqui faz rede, lê arquivo ou toca no DOM. Entra modelo e argumento, sai
 * gesto ou texto. É o que permite testar cada ferramenta com o modelo na mão e
 * cobrar o evento que ela produziu.
 *
 * ### J7. A IA lê o estado, não adivinha
 * Existe ferramenta de leitura para tudo — peças, medidas, problemas, papel. O
 * modelo age sobre fato, não sobre suposição.
 *
 * ### J8. Erro do motor volta em português
 * O motor já escreve mensagens de erro que explicam o que fazer. Elas voltam
 * inteiras para o modelo, que as traduz para a pessoa em vez de inventar um "não
 * consegui".
 */
import type { Gesto } from '@cad/editor';
import type { Modelo } from '@cad/motor';

/** O que uma ferramenta devolve. A interface é quem executa. */
export type Resultado =
  | {
      readonly tipo: 'gestos';
      readonly gestos: readonly Gesto[];
      /** O que dizer à pessoa. Vira também o texto do passo de desfazer. */
      readonly resumo: string;
    }
  | { readonly tipo: 'leitura'; readonly texto: string }
  | {
      /** Ação da aplicação, não do modelo: encaixar, exportar, trocar tamanho. */
      readonly tipo: 'acao';
      readonly acao: string;
      readonly argumentos: Readonly<Record<string, unknown>>;
      readonly resumo: string;
    }
  | {
      readonly tipo: 'confirmar';
      readonly pergunta: string;
      readonly gestos: readonly Gesto[];
      readonly resumo: string;
    }
  | { readonly tipo: 'erro'; readonly mensagem: string };

/** Esquema JSON simples — o suficiente para descrever os argumentos ao modelo. */
export interface Esquema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly required?: readonly string[];
}

export interface Ferramenta {
  readonly nome: string;
  /** Em português, e específica: é o que o modelo lê para decidir se usa. */
  readonly descricao: string;
  readonly esquema: Esquema;
  /** Puro. Recebe o modelo do momento e os argumentos; devolve o que fazer. */
  readonly executar: (modelo: Modelo, args: Record<string, unknown>) => Resultado;
}

/** Contexto que a interface entrega junto — o que não está no modelo. */
export interface Contexto {
  readonly tamanho: string;
  readonly pecaAtiva: string | null;
}
