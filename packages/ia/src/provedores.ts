/**
 * Os provedores de modelo.
 *
 * ## Por que a conversa é guardada num formato NEUTRO
 * Cada provedor tem o seu jeito de escrever a mesma coisa. A Anthropic põe o
 * resultado de ferramenta num bloco `tool_result` dentro de uma mensagem de
 * usuário; a OpenAI cria um papel `tool` só para isso; o Gemini usa
 * `functionResponse` dentro de `parts`. Guardar a conversa no formato de um deles
 * amarraria o programa a esse um — e trocar de provedor no meio de uma conversa
 * viraria impossível.
 *
 * Então a conversa vive como `Turno[]`, que não é de ninguém, e cada provedor
 * **serializa a conversa inteira** na hora de mandar. Trocar de modelo no meio da
 * conversa passa a funcionar de graça.
 *
 * ## O que é nativo e o que é genérico
 * Três provedores têm adaptador próprio — Anthropic, OpenAI e Google. O quarto,
 * **compatível com OpenAI**, cobre o resto do mercado de uma vez: DeepSeek,
 * Mistral, Groq, xAI, OpenRouter, Together, e qualquer servidor local (Ollama, LM
 * Studio). Quase todo mundo implementa aquele formato, e escrever um adaptador por
 * empresa seria manutenção sem fim para nenhum ganho.
 *
 * ## O aviso do navegador
 * Chamar a API do modelo direto do navegador expõe a chave a quem tiver acesso
 * àquele computador, e alguns provedores barram a chamada por CORS. É por isso que
 * cada provedor traz uma `observacao` — e é uma das coisas que o wrap Tauri
 * resolve, porque lá não há navegador no meio.
 */
import type { Esquema } from './tipos.js';

/** Uma chamada de ferramenta pedida pelo modelo. */
export interface Chamada {
  /** Id da chamada. O Gemini não manda id, e aí este é sintetizado a partir do nome. */
  readonly id: string;
  readonly nome: string;
  readonly argumentos: Record<string, unknown>;
}

export interface ResultadoDeFerramenta {
  readonly id: string;
  readonly nome: string;
  readonly texto: string;
  readonly falhou: boolean;
}

/** A conversa, no formato que não é de nenhum provedor. */
export type Turno =
  | { readonly papel: 'pessoa'; readonly texto: string }
  | { readonly papel: 'assistente'; readonly texto: string; readonly chamadas: readonly Chamada[] }
  | { readonly papel: 'ferramenta'; readonly resultados: readonly ResultadoDeFerramenta[] };

/** O que o provedor entendeu da resposta. */
export interface Resposta {
  readonly texto: string;
  readonly chamadas: readonly Chamada[];
}

export interface DescricaoDeFerramenta {
  readonly nome: string;
  readonly descricao: string;
  readonly esquema: Esquema;
}

export interface Pedido {
  readonly modelo: string;
  readonly instrucoes: string;
  readonly ferramentas: readonly DescricaoDeFerramenta[];
  readonly conversa: readonly Turno[];
  readonly maxTokens?: number;
}

export interface Provedor {
  readonly id: string;
  readonly nome: string;
  /** Onde pegar a chave, para a tela poder dizer. */
  readonly ondePegarAChave: string;
  /** Modelos conhecidos. A tela deixa digitar outro: nome de modelo muda toda hora. */
  readonly modelos: readonly { readonly id: string; readonly nome: string }[];
  /** Precisa de uma URL base digitada (o caso do "compatível com OpenAI"). */
  readonly exigeBase: boolean;
  readonly observacao: string;
  readonly url: (pedido: Pedido, chave: string, base?: string) => string;
  readonly cabecalhos: (chave: string) => Record<string, string>;
  readonly corpo: (pedido: Pedido) => Record<string, unknown>;
  readonly ler: (json: unknown) => Resposta;
}

const MAX_PADRAO = 2048;

// ------------------------------------------------------------------ Anthropic

const anthropic: Provedor = {
  id: 'anthropic',
  nome: 'Anthropic (Claude)',
  ondePegarAChave: 'console.anthropic.com',
  exigeBase: false,
  observacao:
    'Chamada direta do navegador é permitida, mas exige o cabeçalho de consentimento — ' +
    'a chave fica exposta a quem usar este computador.',
  modelos: [
    { id: 'claude-sonnet-5', nome: 'Claude Sonnet 5 — rápido e bom' },
    { id: 'claude-opus-5', nome: 'Claude Opus 5 — o mais capaz' },
    { id: 'claude-haiku-4-5-20251001', nome: 'Claude Haiku 4.5 — o mais barato' },
  ],
  url: () => 'https://api.anthropic.com/v1/messages',
  cabecalhos: (chave) => ({
    'content-type': 'application/json',
    'x-api-key': chave,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }),
  corpo: (p) => ({
    model: p.modelo,
    max_tokens: p.maxTokens ?? MAX_PADRAO,
    system: p.instrucoes,
    tools: p.ferramentas.map((f) => ({
      name: f.nome,
      description: f.descricao,
      input_schema: f.esquema,
    })),
    messages: p.conversa.map((t) => {
      if (t.papel === 'pessoa') return { role: 'user', content: t.texto };
      if (t.papel === 'assistente') {
        const blocos: unknown[] = [];
        if (t.texto !== '') blocos.push({ type: 'text', text: t.texto });
        for (const c of t.chamadas) {
          blocos.push({ type: 'tool_use', id: c.id, name: c.nome, input: c.argumentos });
        }
        return { role: 'assistant', content: blocos };
      }
      return {
        role: 'user',
        content: t.resultados.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.texto,
          is_error: r.falhou,
        })),
      };
    }),
  }),
  ler: (json) => {
    const r = json as { content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] };
    const texto = (r.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
    const chamadas = (r.content ?? [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id ?? '', nome: b.name ?? '', argumentos: b.input ?? {} }));
    return { texto, chamadas };
  },
};

// ------------------------------------------------------------------ OpenAI

/** Serializa a conversa no formato de mensagens da OpenAI — usado por ela e pelos compatíveis. */
function mensagensOpenAI(p: Pedido): unknown[] {
  const saida: unknown[] = [{ role: 'system', content: p.instrucoes }];
  for (const t of p.conversa) {
    if (t.papel === 'pessoa') {
      saida.push({ role: 'user', content: t.texto });
    } else if (t.papel === 'assistente') {
      saida.push({
        role: 'assistant',
        content: t.texto === '' ? null : t.texto,
        ...(t.chamadas.length === 0
          ? {}
          : {
              tool_calls: t.chamadas.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.nome, arguments: JSON.stringify(c.argumentos) },
              })),
            }),
      });
    } else {
      // A OpenAI cria um papel só para o resultado, e uma mensagem POR chamada.
      for (const r of t.resultados) {
        saida.push({ role: 'tool', tool_call_id: r.id, content: r.texto });
      }
    }
  }
  return saida;
}

function ferramentasOpenAI(p: Pedido): unknown[] {
  return p.ferramentas.map((f) => ({
    type: 'function',
    function: { name: f.nome, description: f.descricao, parameters: f.esquema },
  }));
}

function lerOpenAI(json: unknown): Resposta {
  const r = json as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
  };
  const msg = r.choices?.[0]?.message;
  const chamadas = (msg?.tool_calls ?? []).map((c) => {
    let argumentos: Record<string, unknown> = {};
    try {
      argumentos = JSON.parse(c.function?.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      // Argumento ilegivel: vai vazio, e a ferramenta reclama do que faltou — que é
      // uma mensagem melhor do que "JSON invalido" para quem está do outro lado.
    }
    return { id: c.id ?? '', nome: c.function?.name ?? '', argumentos };
  });
  return { texto: (msg?.content ?? '').trim(), chamadas };
}

const openai: Provedor = {
  id: 'openai',
  nome: 'OpenAI (ChatGPT)',
  ondePegarAChave: 'platform.openai.com',
  exigeBase: false,
  observacao: 'A chave fica exposta a quem usar este computador.',
  modelos: [
    { id: 'gpt-5', nome: 'GPT-5' },
    { id: 'gpt-5-mini', nome: 'GPT-5 mini — mais barato' },
    { id: 'gpt-4.1', nome: 'GPT-4.1' },
    { id: 'gpt-4o', nome: 'GPT-4o' },
    { id: 'o4-mini', nome: 'o4-mini — raciocínio' },
  ],
  url: () => 'https://api.openai.com/v1/chat/completions',
  cabecalhos: (chave) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${chave}`,
  }),
  corpo: (p) => ({
    model: p.modelo,
    max_completion_tokens: p.maxTokens ?? MAX_PADRAO,
    messages: mensagensOpenAI(p),
    tools: ferramentasOpenAI(p),
  }),
  ler: lerOpenAI,
};

const compativel: Provedor = {
  ...openai,
  id: 'compativel',
  nome: 'Outro compatível com OpenAI',
  ondePegarAChave: 'o painel do provedor que você escolher',
  exigeBase: true,
  observacao:
    'Serve para DeepSeek, Mistral, Groq, xAI, OpenRouter, Together e servidores locais ' +
    '(Ollama, LM Studio). Cole o endereço base — ex.: https://api.deepseek.com/v1 — e o ' +
    'nome do modelo. Modelo sem suporte a ferramentas não vai conseguir operar o programa.',
  modelos: [
    { id: 'deepseek-chat', nome: 'DeepSeek — api.deepseek.com/v1' },
    { id: 'mistral-large-latest', nome: 'Mistral — api.mistral.ai/v1' },
    { id: 'llama3.1', nome: 'Local (Ollama) — localhost:11434/v1' },
  ],
  url: (_p, _chave, base) => `${(base ?? '').replace(/\/+$/, '')}/chat/completions`,
};

// ------------------------------------------------------------------ Google

const google: Provedor = {
  id: 'google',
  nome: 'Google (Gemini)',
  ondePegarAChave: 'aistudio.google.com',
  exigeBase: false,
  observacao: 'A chave vai na URL da chamada; use uma chave restrita e não a compartilhe.',
  modelos: [
    { id: 'gemini-2.5-pro', nome: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', nome: 'Gemini 2.5 Flash — rápido e barato' },
    { id: 'gemini-2.0-flash', nome: 'Gemini 2.0 Flash' },
  ],
  url: (p, chave) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${p.modelo}:generateContent?key=${encodeURIComponent(chave)}`,
  cabecalhos: () => ({ 'content-type': 'application/json' }),
  corpo: (p) => ({
    systemInstruction: { parts: [{ text: p.instrucoes }] },
    tools: [
      {
        functionDeclarations: p.ferramentas.map((f) => ({
          name: f.nome,
          description: f.descricao,
          // O Gemini recusa esquema de objeto sem propriedade nenhuma: nesses casos
          // o campo some, e a ferramenta fica sem argumento — que é o que ela é.
          ...(Object.keys(f.esquema.properties).length === 0
            ? {}
            : { parameters: f.esquema }),
        })),
      },
    ],
    contents: p.conversa.map((t) => {
      if (t.papel === 'pessoa') return { role: 'user', parts: [{ text: t.texto }] };
      if (t.papel === 'assistente') {
        const partes: unknown[] = [];
        if (t.texto !== '') partes.push({ text: t.texto });
        for (const c of t.chamadas) {
          partes.push({ functionCall: { name: c.nome, args: c.argumentos } });
        }
        return { role: 'model', parts: partes };
      }
      return {
        role: 'user',
        parts: t.resultados.map((r) => ({
          functionResponse: {
            name: r.nome,
            response: { resultado: r.texto, erro: r.falhou },
          },
        })),
      };
    }),
  }),
  ler: (json) => {
    const r = json as {
      candidates?: {
        content?: { parts?: { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }[] };
      }[];
    };
    const partes = r.candidates?.[0]?.content?.parts ?? [];
    const texto = partes
      .map((p) => p.text ?? '')
      .join('\n')
      .trim();
    // O Gemini não manda id de chamada. O id é sintetizado a partir do nome e da
    // ordem, e é ele que amarra a resposta de volta — sem isso, duas chamadas à
    // mesma ferramenta na mesma rodada se confundiriam.
    const chamadas = partes
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.functionCall !== undefined)
      .map(({ p, i }) => ({
        id: `${p.functionCall?.name ?? 'f'}-${i}`,
        nome: p.functionCall?.name ?? '',
        argumentos: p.functionCall?.args ?? {},
      }));
    return { texto, chamadas };
  },
};

export const PROVEDORES: readonly Provedor[] = [anthropic, openai, google, compativel];

export function acharProvedor(id: string): Provedor | null {
  return PROVEDORES.find((p) => p.id === id) ?? null;
}
