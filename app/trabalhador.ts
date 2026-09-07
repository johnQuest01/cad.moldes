/**
 * O trabalhador: encaixe e digitalização numa linha de execução própria.
 *
 * ## Por que existe
 * Medido na máquina de desenvolvimento: otimizar o encaixe de 11 peças reais leva
 * **14,8 segundos**, e digitalizar uma foto de 10 Mpx leva **1,0 segundo**. Rodando
 * na linha da interface, isso é a tela congelada — não responde a clique, não rola,
 * o cursor vira ampulheta. E servidor mais forte não resolve nada disso, porque não
 * é o servidor que está fazendo a conta: é o navegador de quem está usando.
 *
 * Aqui a conta sai da frente. A interface continua viva, mostra progresso, e tem
 * botão de cancelar — que é `terminate()` neste trabalhador, brutal e imediato.
 *
 * ## O que atravessa a fronteira
 * Só coisa serializável: **o log de eventos** (não o modelo, que tem mapas e
 * referências) e os **pixels crus** da foto. O trabalhador reconstrói o modelo do
 * log com o mesmo `reconstruir` de sempre — é o fold puro da Fase 1 fazendo o
 * trabalho dele, e por isso os dois lados chegam ao mesmo estado sem combinar nada.
 */
import { reconstruir, type Evento } from '@cad/motor';
import { encaixar, encaixarBuscando, type Encaixe } from '@cad/encaixe';
import { digitalizar, type Calibracao, type Digitalizacao } from '@cad/foto';

export type Pedido =
  | { readonly tarefa: 'encaixar'; readonly log: Evento[]; readonly tamanho: string }
  | {
      readonly tarefa: 'otimizar';
      readonly log: Evento[];
      readonly tamanho: string;
      readonly tentativas: number;
    }
  | {
      readonly tarefa: 'digitalizar';
      readonly largura: number;
      readonly altura: number;
      readonly dados: Uint8ClampedArray;
      readonly calibracao: Calibracao;
      readonly tenantId: string;
      readonly modeloId: string;
      readonly toleranciaUM?: number;
      readonly limiarCroma?: number;
    };

export type Aviso =
  | { readonly tipo: 'progresso'; readonly feitas: number; readonly total: number; readonly melhorUM: number }
  | { readonly tipo: 'encaixe'; readonly encaixe: Encaixe; readonly simplesUM: number }
  | { readonly tipo: 'digitalizacao'; readonly saida: Digitalizacao }
  | { readonly tipo: 'falhou'; readonly mensagem: string };

const responder = (a: Aviso): void => {
  (globalThis as unknown as { postMessage: (m: Aviso) => void }).postMessage(a);
};

/**
 * O gerador de ids aqui é local ao trabalhador.
 *
 * Ids têm que ser únicos no log, e o gerador da janela principal não atravessa a
 * fronteira. O prefixo separa os dois: id de digitalização feita no trabalhador
 * nunca colide com id feito na janela, mesmo no mesmo milissegundo.
 */
function gerador(): () => string {
  let n = 0;
  const semente = Date.now().toString(36).toUpperCase();
  return () => `01W${semente}${String(n++).padStart(5, '0')}`;
}

globalThis.addEventListener('message', (evento: Event) => {
  const pedido = (evento as MessageEvent<Pedido>).data;
  try {
    if (pedido.tarefa === 'encaixar') {
      const modelo = reconstruir(pedido.log);
      const e = encaixar(modelo, { tamanho: pedido.tamanho });
      responder({ tipo: 'encaixe', encaixe: e, simplesUM: e.comprimentoUsadoUM });
      return;
    }

    if (pedido.tarefa === 'otimizar') {
      const modelo = reconstruir(pedido.log);
      const simples = encaixar(modelo, { tamanho: pedido.tamanho });
      const busca = encaixarBuscando(
        modelo,
        { tamanho: pedido.tamanho },
        pedido.tentativas,
        (feitas, total, melhorUM) => {
          responder({ tipo: 'progresso', feitas, total, melhorUM });
        },
      );
      responder({
        tipo: 'encaixe',
        encaixe: busca.melhor,
        simplesUM: simples.comprimentoUsadoUM,
      });
      return;
    }

    const saida = digitalizar(
      { largura: pedido.largura, altura: pedido.altura, dados: pedido.dados },
      {
        tenantId: pedido.tenantId,
        modeloId: pedido.modeloId,
        autor: 'modelista',
        gerarId: gerador(),
        calibracao: pedido.calibracao,
        ...(pedido.toleranciaUM === undefined ? {} : { toleranciaUM: pedido.toleranciaUM }),
        ...(pedido.limiarCroma === undefined ? {} : { limiarCroma: pedido.limiarCroma }),
      },
    );
    responder({ tipo: 'digitalizacao', saida });
  } catch (e) {
    responder({ tipo: 'falhou', mensagem: String(e) });
  }
});
