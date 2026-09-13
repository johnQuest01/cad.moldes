/**
 * Fase 7 — o catálogo da IA.
 *
 * A pergunta que estes testes respondem não é "o modelo é esperto?". É outra, e é a
 * única que importa aqui: **o que a IA manda fazer chega no motor como gesto
 * válido, e o que ela manda de errado é recusado com uma mensagem que ela consegue
 * entender e corrigir.**
 *
 * Por isso todo teste que produz gesto termina no `reconstruir`: se o gesto não
 * fechar, o fold recusa, e é isso que se quer.
 */
import { describe, expect, it } from 'vitest';

import { Sessao } from '@cad/editor';
import {
  MM,
  criarGeradorMonotonico,
  reconstruir,
  umParaMM,
  type Evento,
  type Modelo,
  type Vetor2,
} from '@cad/motor';

import { CATALOGO, acharFerramenta, ferramentasParaAPI, INSTRUCOES } from '../src/index.js';

const TENANT = 'confeccao-a';
const MODELO = 'mod-1';
let contador = 0;
const envelope = (pecaId: string | null) => ({
  id: `01JIA${String(contador++).padStart(5, '0')}`,
  tenantId: TENANT,
  modeloId: MODELO,
  pecaId,
  timestamp: '2026-09-06T22:00:00.000Z',
  autor: 'fixture',
  versaoSchema: 1,
});

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: '180' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

function retangulo(id: string, nome: string, lMM: number, aMM: number): Evento[] {
  const cantos: Vetor2[] = [
    { x: 0, y: 0 },
    { x: lMM * MM, y: 0 },
    { x: lMM * MM, y: aMM * MM },
    { x: 0, y: aMM * MM },
  ];
  const e: Evento[] = [
    { ...envelope(id), tipo: 'CriarPeca', payload: { nome, encaixe: ENCAIXE } } as Evento,
  ];
  cantos.forEach((c, i) =>
    e.push({
      ...envelope(id),
      tipo: 'CriarPonto',
      payload: { pontoId: `${id}-pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    e.push({
      ...envelope(id),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: `${id}-ar-${i}`,
        pontoInicioId: `${id}-pt-${i}`,
        pontoFimId: `${id}-pt-${(i + 1) % 4}`,
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    e.push({
      ...envelope(id),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `${id}-sg-${i}`,
        arestaId: `${id}-ar-${i}`,
        de: `${id}-pt-${i}`,
        para: `${id}-pt-${(i + 1) % 4}`,
        tipo: 'reta',
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    e.push({
      ...envelope(id),
      tipo: 'DefinirMargem',
      payload: { arestaId: `${id}-ar-${i}`, margemUM: 10 * MM },
    } as Evento),
  );
  return e;
}

function modeloDeTeste(): Modelo {
  contador = 0;
  return reconstruir([
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Blusa', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
    } as Evento,
    ...retangulo('p1', 'FRENTE', 400, 700),
    ...retangulo('p2', 'MANGA', 300, 500),
  ]);
}

/** Aplica os gestos numa sessão de verdade: é o mesmo caminho do mouse (J1). */
function aplicar(modelo: Modelo, gestos: readonly { tipo: string; pecaId: string | null; payload: unknown }[]) {
  const log: Evento[] = [];
  const gerar = criarGeradorMonotonico();
  // A sessão precisa do log de origem; reconstrói-se dele mesmo.
  const sessao = new Sessao(logDe(modelo), {
    tenantId: TENANT,
    modeloId: MODELO,
    autor: 'ia',
    gerarId: () => gerar(),
  });
  sessao.aplicar(...gestos);
  void log;
  return sessao.modelo;
}

/** O log que reconstrói o modelo de teste. */
function logDe(_modelo: Modelo): Evento[] {
  contador = 0;
  return [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Blusa', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
    } as Evento,
    ...retangulo('p1', 'FRENTE', 400, 700),
    ...retangulo('p2', 'MANGA', 300, 500),
  ];
}

const usar = (nome: string, args: Record<string, unknown> = {}) =>
  acharFerramenta(nome)!.executar(modeloDeTeste(), args);

describe('O catálogo', () => {
  it('toda ferramenta tem nome único, descrição de verdade e esquema', () => {
    const nomes = CATALOGO.map((f) => f.nome);
    console.log(`--- ${CATALOGO.length} ferramentas ---`);
    for (const f of CATALOGO) {
      console.log(`${f.nome.padEnd(26)} ${f.descricao.slice(0, 60)}…`);
      // Descrição curta é ferramenta usada na hora errada.
      expect(f.descricao.length).toBeGreaterThan(60);
      expect(f.esquema.type).toBe('object');
    }
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it('sai no formato que a API espera', () => {
    const api = ferramentasParaAPI();
    console.log(JSON.stringify(api[0], null, 2).split('\n').slice(0, 8).join('\n'));
    expect(api).toHaveLength(CATALOGO.length);
    expect(api.every((f) => typeof f.name === 'string' && typeof f.description === 'string')).toBe(true);
  });

  it('as instruções proíbem chutar medida, com o motivo', () => {
    console.log(INSTRUCOES.split('\n').filter((l) => l.includes('chute')).join('\n'));
    expect(INSTRUCOES).toContain('Nunca chute medida');
    expect(INSTRUCOES).toContain('fio do tecido');
  });
});

describe('Leitura: a IA age sobre fato', () => {
  it('descrever_modelo lista as peças com medida', () => {
    const r = usar('descrever_modelo');
    console.log(r.tipo === 'leitura' ? r.texto : r);
    expect(r.tipo).toBe('leitura');
    if (r.tipo === 'leitura') {
      expect(r.texto).toContain('FRENTE');
      expect(r.texto).toContain('400 × 700 mm');
      expect(r.texto).toContain('Nenhum rolo');
    }
  });

  it('medir_peca dá caixa, perímetro e margem por aresta', () => {
    const r = usar('medir_peca', { peca: 'FRENTE' });
    console.log(r.tipo === 'leitura' ? r.texto : r);
    expect(r.tipo).toBe('leitura');
    if (r.tipo === 'leitura') expect(r.texto).toContain('margem 10.0 mm');
  });

  it('peça que não existe devolve a LISTA das que existem', () => {
    const r = usar('medir_peca', { peca: 'GOLA' });
    console.log(r.tipo === 'erro' ? r.mensagem : r);
    expect(r.tipo).toBe('erro');
    if (r.tipo === 'erro') {
      expect(r.mensagem).toContain('FRENTE');
      expect(r.mensagem).toContain('MANGA');
    }
  });

  it('acha a peça pelo nome sem ligar para maiúscula', () => {
    expect(usar('medir_peca', { peca: 'frente' }).tipo).toBe('leitura');
    expect(usar('medir_peca', { peca: 'p1' }).tipo).toBe('leitura');
  });
});

describe('Edição: o gesto tem que chegar válido no motor', () => {
  it('renomear produz gesto que a sessão aceita', () => {
    const r = usar('renomear_peca', { peca: 'FRENTE', nome: 'FRENTE DIREITA' });
    expect(r.tipo).toBe('gestos');
    if (r.tipo !== 'gestos') return;
    const depois = aplicar(modeloDeTeste(), r.gestos);
    console.log(`${r.resumo} -> nome no modelo: "${depois.pecas['p1']!.metadados.nome}"`);
    expect(depois.pecas['p1']!.metadados.nome).toBe('FRENTE DIREITA');
  });

  it('definir_margem em todas as arestas de uma vez, e o corte cresce', () => {
    const r = usar('definir_margem', { peca: 'FRENTE', milimetros: 20 });
    expect(r.tipo).toBe('gestos');
    if (r.tipo !== 'gestos') return;
    const depois = aplicar(modeloDeTeste(), r.gestos);
    const margens = Object.values(depois.pecas['p1']!.margens).map((m) => umParaMM(m));
    console.log(`${r.resumo} -> margens: ${margens.join(', ')} mm`);
    expect(r.gestos).toHaveLength(4);
    expect(margens.every((m) => m === 20)).toBe(true);
  });

  it('margem negativa é recusada antes de virar gesto', () => {
    const r = usar('definir_margem', { peca: 'FRENTE', milimetros: -5 });
    console.log(r.tipo === 'erro' ? r.mensagem : r);
    expect(r.tipo).toBe('erro');
  });

  it('aresta inexistente devolve a lista das arestas da peça', () => {
    const r = usar('definir_margem', { peca: 'FRENTE', milimetros: 10, aresta: 'cava' });
    console.log(r.tipo === 'erro' ? r.mensagem : r);
    expect(r.tipo).toBe('erro');
    if (r.tipo === 'erro') expect(r.mensagem).toContain('p1-ar-0');
  });

  it('definir_encaixe_da_peca muda quantidade, par e giro', () => {
    const r = usar('definir_encaixe_da_peca', { peca: 'MANGA', quantidade: 2, par: true, giro: '90' });
    expect(r.tipo).toBe('gestos');
    if (r.tipo !== 'gestos') return;
    const depois = aplicar(modeloDeTeste(), r.gestos);
    const e = depois.pecas['p2']!.encaixe;
    console.log(`${r.resumo} -> quantidade ${e.quantidadePorModelo}, par ${e.par}, giro ${e.giro}`);
    expect(e.quantidadePorModelo).toBe(2);
    expect(e.par).toBe(true);
    expect(e.giro).toBe('90');
  });

  it('quantidade fracionária é recusada', () => {
    expect(usar('definir_encaixe_da_peca', { peca: 'MANGA', quantidade: 1.5 }).tipo).toBe('erro');
  });

  it('duplicar cria peça nova sem tocar na original', () => {
    const r = usar('duplicar_peca', { peca: 'MANGA' });
    expect(r.tipo).toBe('gestos');
    if (r.tipo !== 'gestos') return;
    const depois = aplicar(modeloDeTeste(), r.gestos);
    console.log(`${r.resumo} -> ${Object.keys(depois.pecas).length} pecas no modelo`);
    expect(Object.keys(depois.pecas)).toHaveLength(3);
  });

  it('espelhar e rotacionar chegam válidos no motor', () => {
    for (const [nome, args] of [
      ['espelhar_peca', { peca: 'FRENTE', eixo: 'vertical' }],
      ['rotacionar_peca', { peca: 'FRENTE', graus: 90 }],
    ] as const) {
      const r = usar(nome, args);
      expect(r.tipo).toBe('gestos');
      if (r.tipo !== 'gestos') continue;
      const depois = aplicar(modeloDeTeste(), r.gestos);
      console.log(`${nome}: ${r.resumo} (${Object.keys(depois.pecas).length} pecas)`);
      expect(Object.keys(depois.pecas)).toHaveLength(2);
    }
  });

  it('definir_rolo_de_papel declara o rolo que o encaixe exige', () => {
    const r = usar('definir_rolo_de_papel', { largura_mm: 1600, margem_mm: 10 });
    expect(r.tipo).toBe('gestos');
    if (r.tipo !== 'gestos') return;
    const depois = aplicar(modeloDeTeste(), r.gestos);
    console.log(`${r.resumo} -> papel: ${umParaMM(depois.papel!.larguraUM)} mm`);
    expect(umParaMM(depois.papel!.larguraUM)).toBe(1600);
  });
});

describe('O que é destrutivo PERGUNTA (J5)', () => {
  it('remover_peca devolve confirmação, não gesto solto', () => {
    const r = usar('remover_peca', { peca: 'MANGA' });
    console.log(r.tipo === 'confirmar' ? r.pergunta : r);
    expect(r.tipo).toBe('confirmar');
  });

  it('simplificar_contorno devolve confirmação', () => {
    const r = usar('simplificar_contorno', { peca: 'FRENTE', milimetros: 1 });
    console.log(r.tipo === 'confirmar' ? r.pergunta : r);
    expect(r.tipo).toBe('confirmar');
  });

  it('apagar a última peça é recusado antes de perguntar', () => {
    const so = reconstruir([
      {
        ...envelope(null),
        tipo: 'CriarModelo',
        payload: { nome: 'Um', tamanhos: ['M'], tamanhoBase: 'M' },
      } as Evento,
      ...retangulo('p1', 'UNICA', 100, 100),
    ]);
    const r = acharFerramenta('remover_peca')!.executar(so, { peca: 'UNICA' });
    console.log(r.tipo === 'erro' ? r.mensagem : r);
    expect(r.tipo).toBe('erro');
  });
});

describe('Ações da aplicação', () => {
  it('encaixar, exportar, mostrar_tamanho e enquadrar saem como ação, não como gesto', () => {
    for (const [nome, args] of [
      ['encaixar', {}],
      ['exportar', { formato: 'dxf' }],
      ['mostrar_tamanho', { tamanho: 'G' }],
      ['enquadrar', {}],
    ] as const) {
      const r = usar(nome, args);
      console.log(`${nome} -> ${r.tipo}`);
      expect(r.tipo).toBe('acao');
    }
  });
});

describe('As ferramentas do leigo', () => {
  it('desfazer, refazer, descartar, redigitalizar e otimizar saem como acao', () => {
    console.log('--- o que o leigo pede ---');
    for (const [nome, args] of [
      ['desfazer', { quantos: 2 }],
      ['refazer', {}],
      ['descartar_alteracoes', {}],
      ['redigitalizar_foto', { tolerancia_mm: 1.5, sensibilidade_cor: 50 }],
      ['otimizar_encaixe', { tentativas: 20 }],
    ] as const) {
      const r = usar(nome, args);
      console.log(`${nome.padEnd(22)} -> ${r.tipo}`);
      expect(r.tipo).toBe('acao');
      if (r.tipo === 'acao') expect(r.acao).toBe(nome);
    }
  });

  it('a descricao de otimizar promete o que a busca entrega: nunca pior', () => {
    const f = acharFerramenta('otimizar_encaixe')!;
    console.log(f.descricao);
    expect(f.descricao).toContain('MENOS TECIDO');
    expect(f.descricao).toContain('Nunca sai pior');
  });

  it('a descricao de redigitalizar fala a lingua de quem reclama', () => {
    const f = acharFerramenta('redigitalizar_foto')!;
    console.log(f.descricao);
    // Quem opera nao diz "tolerancia de Douglas-Peucker": diz "a borda ficou estranha".
    expect(f.descricao).toContain('borda estranha');
  });
});

describe('Dimensionar / Encolhimento', () => {
  it('pede confirmacao, e o gesto confirmado passa no motor com a medida exata', () => {
    const r = usar('dimensionar_peca', { peca: 'FRENTE', percentual_largura: 103, percentual_altura: 102 });
    expect(r.tipo).toBe('confirmar');
    if (r.tipo !== 'confirmar') return;
    console.log(`pergunta: "${r.pergunta}"`);
    const depois = aplicar(modeloDeTeste(), r.gestos);
    const anel = Object.values(depois.pecas['p1']!.pontos);
    const largura = Math.max(...anel.map((p) => p.x)) - Math.min(...anel.map((p) => p.x));
    const altura = Math.max(...anel.map((p) => p.y)) - Math.min(...anel.map((p) => p.y));
    console.log(`FRENTE 400 x 700 -> ${umParaMM(largura)} x ${umParaMM(altura)} mm`);
    expect(umParaMM(largura)).toBe(412);
    expect(umParaMM(altura)).toBe(714);
  });

  it('sem percentual_altura, usa o mesmo da largura', () => {
    const r = usar('dimensionar_peca', { peca: 'MANGA', percentual_largura: 110 });
    expect(r.tipo).toBe('confirmar');
    if (r.tipo !== 'confirmar') return;
    const depois = aplicar(modeloDeTeste(), r.gestos);
    const anel = Object.values(depois.pecas['p2']!.pontos);
    const altura = Math.max(...anel.map((p) => p.y)) - Math.min(...anel.map((p) => p.y));
    console.log(`MANGA 300 x 500, so largura 110 -> altura ${umParaMM(altura)} mm (acompanhou)`);
    expect(umParaMM(altura)).toBe(550);
  });

  it('percentual fora da faixa e recusado ANTES de virar gesto — o engano do "3%"', () => {
    const r = usar('dimensionar_peca', { peca: 'FRENTE', percentual_largura: 3 });
    console.log(r.tipo === 'erro' ? r.mensagem : r);
    expect(r.tipo).toBe('erro');
    if (r.tipo === 'erro') expect(r.mensagem).toContain('103');
  });
});
