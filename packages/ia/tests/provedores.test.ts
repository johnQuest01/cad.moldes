/**
 * Fase 7 — os provedores.
 *
 * O que precisa ficar provado: a MESMA conversa vira o corpo certo para cada
 * provedor, e a resposta de cada um volta para o mesmo formato neutro. É isso que
 * permite trocar de modelo no meio de uma conversa sem perder o que já foi dito —
 * e é isso que quebraria em silêncio se a conversa fosse guardada no formato de um
 * deles.
 */
import { describe, expect, it } from 'vitest';

import { PROVEDORES, acharProvedor, type Pedido, type Turno } from '../src/index.js';

/** Uma conversa com os três tipos de turno, que é onde os formatos divergem. */
const CONVERSA: Turno[] = [
  { papel: 'pessoa', texto: 'põe 1 cm de costura na frente' },
  {
    papel: 'assistente',
    texto: 'Vou ver as peças primeiro.',
    chamadas: [{ id: 'c1', nome: 'descrever_modelo', argumentos: {} }],
  },
  {
    papel: 'ferramenta',
    resultados: [{ id: 'c1', nome: 'descrever_modelo', texto: '2 peças: FRENTE, MANGA', falhou: false }],
  },
];

const PEDIDO: Pedido = {
  modelo: 'modelo-x',
  instrucoes: 'Você opera um CAD de moldes.',
  ferramentas: [
    {
      nome: 'definir_margem',
      descricao: 'Define a margem em mm.',
      esquema: {
        type: 'object',
        properties: { milimetros: { type: 'number', description: 'A margem.' } },
        required: ['milimetros'],
      },
    },
    { nome: 'enquadrar', descricao: 'Ajusta o zoom.', esquema: { type: 'object', properties: {}, required: [] } },
  ],
  conversa: CONVERSA,
};

describe('Cada provedor monta o corpo do jeito dele', () => {
  it('Anthropic: tool_use e tool_result em blocos', () => {
    const c = acharProvedor('anthropic')!.corpo(PEDIDO) as {
      system: string;
      tools: { name: string; input_schema: unknown }[];
      messages: { role: string; content: unknown }[];
    };
    console.log('--- anthropic ---');
    console.log(JSON.stringify(c.messages, null, 1).slice(0, 420));
    expect(c.system).toContain('CAD de moldes');
    expect(c.tools[0]!.name).toBe('definir_margem');
    expect(c.messages).toHaveLength(3);
    // O resultado de ferramenta vira mensagem de USUARIO com bloco tool_result.
    const ultima = c.messages[2]!;
    expect(ultima.role).toBe('user');
    expect(JSON.stringify(ultima.content)).toContain('tool_result');
  });

  it('OpenAI: tool_calls no assistente e papel "tool" no resultado', () => {
    const c = acharProvedor('openai')!.corpo(PEDIDO) as {
      messages: { role: string; content?: unknown; tool_calls?: unknown }[];
      tools: { type: string; function: { name: string } }[];
    };
    console.log('--- openai ---');
    console.log(JSON.stringify(c.messages, null, 1).slice(0, 420));
    // Sistema vira MENSAGEM, nao campo separado — e a primeira diferenca de forma.
    expect(c.messages[0]!.role).toBe('system');
    expect(c.messages[2]!.tool_calls).toBeDefined();
    expect(c.messages[3]!.role).toBe('tool');
    expect(c.tools[0]!.type).toBe('function');
    expect(c.tools[0]!.function.name).toBe('definir_margem');
  });

  it('Google: papel "model", functionCall e functionResponse em parts', () => {
    const c = acharProvedor('google')!.corpo(PEDIDO) as {
      systemInstruction: unknown;
      contents: { role: string; parts: unknown[] }[];
      tools: { functionDeclarations: { name: string; parameters?: unknown }[] }[];
    };
    console.log('--- google ---');
    console.log(JSON.stringify(c.contents, null, 1).slice(0, 420));
    expect(c.systemInstruction).toBeDefined();
    expect(c.contents[1]!.role).toBe('model');
    expect(JSON.stringify(c.contents[1]!.parts)).toContain('functionCall');
    expect(JSON.stringify(c.contents[2]!.parts)).toContain('functionResponse');
    // Ferramenta sem argumento nenhum sai SEM `parameters`: o Gemini recusa objeto
    // de propriedades vazias, e mandar assim derruba a chamada inteira.
    const enquadrar = c.tools[0]!.functionDeclarations.find((f) => f.name === 'enquadrar')!;
    console.log(`enquadrar (sem argumentos) -> parameters: ${JSON.stringify(enquadrar.parameters)}`);
    expect(enquadrar.parameters).toBeUndefined();
  });

  it('o compatível manda para a URL base que a pessoa digitou', () => {
    const p = acharProvedor('compativel')!;
    const url = p.url(PEDIDO, 'chave', 'https://api.deepseek.com/v1/');
    console.log(`base "https://api.deepseek.com/v1/" -> ${url}`);
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(p.exigeBase).toBe(true);
  });
});

describe('Cada resposta volta para o mesmo formato neutro', () => {
  it('Anthropic', () => {
    const r = acharProvedor('anthropic')!.ler({
      content: [
        { type: 'text', text: 'Pronto.' },
        { type: 'tool_use', id: 'x1', name: 'definir_margem', input: { milimetros: 10 } },
      ],
    });
    console.log(`anthropic -> texto "${r.texto}", ${r.chamadas.length} chamada(s)`);
    expect(r.texto).toBe('Pronto.');
    expect(r.chamadas[0]).toEqual({ id: 'x1', nome: 'definir_margem', argumentos: { milimetros: 10 } });
  });

  it('OpenAI, com os argumentos vindo como TEXTO', () => {
    const r = acharProvedor('openai')!.ler({
      choices: [
        {
          message: {
            content: 'Pronto.',
            tool_calls: [
              { id: 'x1', function: { name: 'definir_margem', arguments: '{"milimetros":10}' } },
            ],
          },
        },
      ],
    });
    console.log(`openai -> texto "${r.texto}", argumentos ${JSON.stringify(r.chamadas[0]?.argumentos)}`);
    expect(r.chamadas[0]!.argumentos).toEqual({ milimetros: 10 });
  });

  it('OpenAI com argumento ilegível não derruba a rodada', () => {
    const r = acharProvedor('openai')!.ler({
      choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'f', arguments: '{quebrado' } }] } }],
    });
    console.log(`argumento quebrado -> ${JSON.stringify(r.chamadas[0])}`);
    // Vai vazio, e a ferramenta reclama do que faltou — mensagem melhor para quem
    // esta do outro lado do que "JSON invalido".
    expect(r.chamadas[0]!.argumentos).toEqual({});
  });

  it('Google, que não manda id de chamada', () => {
    const r = acharProvedor('google')!.ler({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Pronto.' },
              { functionCall: { name: 'definir_margem', args: { milimetros: 10 } } },
              { functionCall: { name: 'definir_margem', args: { milimetros: 20 } } },
            ],
          },
        },
      ],
    });
    console.log(`google -> ids sintetizados: ${r.chamadas.map((c) => c.id).join(', ')}`);
    expect(r.chamadas).toHaveLength(2);
    // Duas chamadas a mesma ferramenta na mesma rodada precisam de ids DIFERENTES,
    // senao a resposta de uma volta amarrada na outra.
    expect(r.chamadas[0]!.id).not.toBe(r.chamadas[1]!.id);
  });
});

describe('O catálogo de provedores', () => {
  it('todos trazem modelos, aviso e onde pegar a chave', () => {
    console.log('--- provedores ---');
    for (const p of PROVEDORES) {
      console.log(
        `${p.nome.padEnd(30)} ${p.modelos.length} modelo(s) | base própria: ${p.exigeBase ? 'sim' : 'não'}`,
      );
      console.log(`  ${p.modelos.map((m) => m.id).join(', ')}`);
      expect(p.modelos.length).toBeGreaterThan(0);
      expect(p.observacao.length).toBeGreaterThan(20);
      expect(p.ondePegarAChave.length).toBeGreaterThan(3);
    }
    expect(PROVEDORES).toHaveLength(4);
  });

  it('trocar de provedor no meio da conversa não perde nada', () => {
    // A mesma conversa, dois corpos diferentes: e a prova de que o formato neutro
    // esta fazendo o trabalho dele.
    const a = JSON.stringify(acharProvedor('anthropic')!.corpo(PEDIDO));
    const b = JSON.stringify(acharProvedor('openai')!.corpo(PEDIDO));
    const g = JSON.stringify(acharProvedor('google')!.corpo(PEDIDO));
    console.log(`mesma conversa -> ${a.length}, ${b.length} e ${g.length} bytes de corpo`);
    for (const corpo of [a, b, g]) {
      expect(corpo).toContain('põe 1 cm de costura na frente');
      expect(corpo).toContain('2 peças: FRENTE, MANGA');
    }
    expect(a).not.toBe(b);
  });
});
