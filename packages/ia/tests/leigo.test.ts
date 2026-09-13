/**
 * ESTRESSE DO LEIGO: o chat da IA na mão de quem nunca viu um CAD.
 *
 * A promessa do produto é essa: qualquer pessoa fala com a IA e trabalha no
 * molde SEM quebrar o projeto, sem peça encolhida por acidente, sem alteração
 * que ninguém pediu. Este arquivo cobra a promessa em três frentes:
 *
 *  1. FUZZ — as 28 ferramentas recebem o que o leigo manda de pior (nada,
 *     "dez" onde vai número, peça que não existe, número negativo, número de
 *     telefone onde vai milímetro). NENHUMA pode estourar: ou funciona, ou
 *     devolve `erro` com mensagem em português. Exceção que escapa derruba a
 *     rodada do chat — e o leigo lê "não consegui falar com o modelo", que é
 *     mentira e não ensina nada.
 *
 *  2. CONFIRMAÇÃO — toda ferramenta com licença de FORMA devolve `confirmar`
 *     com a consequência dita em número na pergunta. A IA não muda molde sem
 *     a pessoa ver o que vai acontecer (J5).
 *
 *  3. A JORNADA — uma sessão de trabalho inteira (medir, pence, pregas,
 *     bainha, dimensionar, redefinir, alinhar, girar) pela MESMA Sessao do
 *     mouse, com a guarda de integridade cobrada a cada passo com a licença
 *     da ferramenta usada — e no fim, desfazer devolve o molde ao byte.
 */
import { describe, expect, it } from 'vitest';

import { Sessao, type Gesto } from '@cad/editor';
import {
  MM,
  criarGeradorMonotonico,
  reconstruir,
  type Evento,
  type Modelo,
  type Vetor2,
} from '@cad/motor';

import {
  CATALOGO,
  SEM_LICENCA,
  acharFerramenta,
  conferirIntegridade,
  impressaoDoModelo,
  type Resultado,
} from '../src/index.js';

const TENANT = 'confeccao-a';
const MODELO = 'mod-1';
let contador = 0;
const envelope = (pecaId: string | null) => ({
  id: `01JLG${String(contador++).padStart(5, '0')}`,
  tenantId: TENANT,
  modeloId: MODELO,
  pecaId,
  timestamp: '2026-09-13T15:00:00.000Z',
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

function logDeTeste(): Evento[] {
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
const modeloDeTeste = (): Modelo => reconstruir(logDeTeste());

const TIPOS_VALIDOS = new Set(['gestos', 'leitura', 'acao', 'confirmar', 'erro']);

describe('1. Fuzz: nenhuma ferramenta estoura com entrada de leigo', () => {
  it('28 ferramentas × 8 baterias de entrada ruim = zero exceções escapando', () => {
    const modelo = modeloDeTeste();
    // O que o leigo manda de verdade: nada, texto onde vai número, nome que
    // não existe, número de telefone onde vai milímetro, negativo, zero...
    const baterias: Record<string, unknown>[] = [
      {},
      { peca: 'a peça azul', aresta: 'aquela de baixo', referencia: 'a outra' },
      {
        peca: 'FRENTE', aresta: 'a de baixo', quantidade: 'dez', distancia_mm: 'quatro',
        largura1_mm: 'um pouco', abertura_mm: 'média', profundidade_mm: 'funda',
        comprimento_mm: 'maior', altura_mm: 'normal', milimetros: 'poucos',
        percentual_largura: 'cento e três', graus: 'um tico', lado: 'pra lá',
      },
      { peca: 'frente', aresta: 'p1-ar-0', quantidade: -3, distancia_mm: -40, largura1_mm: -15,
        abertura_mm: -30, profundidade_mm: -100, comprimento_mm: -500, altura_mm: -25,
        milimetros: -1, percentual_largura: -103 },
      { peca: 'FRENTE', aresta: 'p1-ar-0', quantidade: 99999999, distancia_mm: 99999999,
        largura1_mm: 99999999, abertura_mm: 99999999, profundidade_mm: 99999999,
        comprimento_mm: 99999999, altura_mm: 99999999, milimetros: 99999999,
        percentual_largura: 99999999, graus: 99999999 },
      { peca: 'FRENTE', aresta: 'p1-ar-0', quantidade: 0, distancia_mm: 0, largura1_mm: 0,
        abertura_mm: 0, profundidade_mm: 0, comprimento_mm: 0, altura_mm: 0, milimetros: 0,
        percentual_largura: 0, posicao: 0 },
      { peca: 'FRENTE', aresta: 'p1-ar-0', quantidade: 2.5, posicao: 7, lado: 'diagonal',
        eixo: 'ex-fantasma', formato: 'pdf', tamanho: 'XXG', referencia: 'FRENTE' },
      { peca: null, aresta: null, quantidade: null, distancia_mm: null, largura1_mm: null },
    ];

    const estouros: string[] = [];
    let chamadas = 0;
    let errosExplicados = 0;
    for (const ferramenta of CATALOGO) {
      for (const [i, args] of baterias.entries()) {
        chamadas++;
        try {
          const r = ferramenta.executar(modelo, args);
          expect(TIPOS_VALIDOS.has(r.tipo)).toBe(true);
          if (r.tipo === 'erro') {
            errosExplicados++;
            expect(r.mensagem.length).toBeGreaterThan(10); // mensagem de verdade, nao "erro"
          }
        } catch (e) {
          estouros.push(`${ferramenta.nome} (bateria ${i}): ${String(e).slice(0, 120)}`);
        }
      }
    }
    console.log('--- fuzz de leigo ---');
    console.log(`${chamadas} chamadas (${CATALOGO.length} ferramentas x ${baterias.length} baterias)`);
    console.log(`recusas explicadas: ${errosExplicados} | excecoes que ESCAPARAM: ${estouros.length}`);
    for (const e of estouros.slice(0, 12)) console.log(`  ESTOURO: ${e}`);
    expect(estouros).toEqual([]);
  });
});

describe('2. Toda ferramenta de forma pede confirmação com o número na pergunta', () => {
  const casos: Record<string, Record<string, unknown>> = {
    dimensionar_peca: { peca: 'FRENTE', percentual_largura: 103 },
    gerar_pregas: { peca: 'MANGA', aresta: 'p2-ar-0', quantidade: 3, distancia_mm: 60, largura1_mm: 15, largura2_mm: 5 },
    abrir_pence: { peca: 'FRENTE', aresta: 'p1-ar-0', abertura_mm: 30, profundidade_mm: 100 },
    redefinir_aresta: { peca: 'MANGA', aresta: 'p2-ar-1', comprimento_mm: 520 },
    simplificar_contorno: { peca: 'FRENTE', milimetros: 1 },
  };
  // desdobrar_peca precisa de eixo tracado antes; entra na jornada, nao aqui.

  for (const [nome, args] of Object.entries(casos)) {
    it(`${nome} devolve 'confirmar', nunca gesto mudo`, () => {
      const ferramenta = acharFerramenta(nome)!;
      expect(ferramenta.licenca?.alteraForma).toBe(true);
      const r = ferramenta.executar(modeloDeTeste(), args);
      expect(r.tipo).toBe('confirmar');
      if (r.tipo === 'confirmar') {
        // A pergunta tem numero: a pessoa ve a consequencia antes de aceitar.
        expect(/\d/.test(r.pergunta)).toBe(true);
        console.log(`${nome}: "${r.pergunta.slice(0, 90)}..."`);
      }
    });
  }
});

describe('3. A jornada do leigo, com a guarda de integridade em cada passo', () => {
  it('oito pedidos reais, zero violação de licença, e o desfazer devolve o molde ao byte', () => {
    const gerar = criarGeradorMonotonico();
    const sessao = new Sessao(logDeTeste(), {
      tenantId: TENANT,
      modeloId: MODELO,
      autor: 'ia',
      gerarId: () => gerar(),
    });
    const original = impressaoDoModelo(sessao.modelo);
    const pecasOriginais = Object.keys(sessao.modelo.pecas).length;

    /** Executa como o app executa: confirmar = a pessoa disse sim. */
    const passo = (nome: string, args: Record<string, unknown>): void => {
      const ferramenta = acharFerramenta(nome);
      expect(ferramenta, `ferramenta ${nome}`).not.toBeNull();
      const antes = impressaoDoModelo(sessao.modelo);
      const r: Resultado = ferramenta!.executar(sessao.modelo, args);
      expect(r.tipo, `${nome} respondeu: ${r.tipo === 'erro' ? r.mensagem : r.tipo}`).not.toBe('erro');
      if (r.tipo === 'gestos' || r.tipo === 'confirmar') {
        sessao.aplicar(...(r.gestos as Gesto[]));
        const problemas = conferirIntegridade(
          antes,
          impressaoDoModelo(sessao.modelo),
          ferramenta!.licenca ?? SEM_LICENCA,
        );
        expect(problemas, `${nome}: ${problemas[0] ?? ''}`).toEqual([]);
      }
      // Peca nao some nem nasce na jornada inteira.
      expect(Object.keys(sessao.modelo.pecas).length).toBe(pecasOriginais);
    };

    // O leigo pergunta antes de mexer (J7)...
    const descreveu = acharFerramenta('descrever_modelo')!.executar(sessao.modelo, {});
    expect(descreveu.tipo).toBe('leitura');
    // ...e ai trabalha:
    passo('abrir_pence', { peca: 'FRENTE', aresta: 'p1-ar-0', abertura_mm: 30, profundidade_mm: 100 });
    passo('gerar_pregas', { peca: 'MANGA', aresta: 'p2-ar-0', quantidade: 3, distancia_mm: 60, largura1_mm: 15, largura2_mm: 5 });
    passo('definir_bainha', { peca: 'MANGA', aresta: 'p2-ar-2', altura_mm: 25 });
    passo('dimensionar_peca', { peca: 'FRENTE', percentual_largura: 103 });
    passo('redefinir_aresta', { peca: 'MANGA', aresta: 'p2-ar-1', comprimento_mm: 520 });
    passo('alinhar_peca', { peca: 'MANGA', referencia: 'FRENTE', lado: 'base' });
    passo('rotacionar_peca', { peca: 'FRENTE', graus: 15 });
    passo('espelhar_peca', { peca: 'MANGA', eixo: 'vertical' });

    const mexido = impressaoDoModelo(sessao.modelo);
    expect(JSON.stringify(mexido)).not.toBe(JSON.stringify(original));

    // A rede de seguranca: desfazer TUDO devolve a impressao original exata.
    let desfeitos = 0;
    while (sessao.podeDesfazer) {
      sessao.desfazer();
      desfeitos++;
    }
    const devolvido = impressaoDoModelo(sessao.modelo);
    console.log('--- a jornada do leigo ---');
    console.log('8 passos aplicados pela Sessao do mouse, guarda de integridade limpa em todos');
    console.log(`desfazer x${desfeitos}: impressao final ${JSON.stringify(devolvido) === JSON.stringify(original) ? 'IDENTICA a original' : 'DIFERENTE (falha)'}`);
    expect(JSON.stringify(devolvido)).toBe(JSON.stringify(original));
  });

  it('o pedido perigoso do leigo — "encolhe pra caber no tecido" sem licença — é desfeito', () => {
    // Simula uma ferramenta mentirosa: diz que so le, mas encolhe a peca.
    const gerar = criarGeradorMonotonico();
    const sessao = new Sessao(logDeTeste(), {
      tenantId: TENANT,
      modeloId: MODELO,
      autor: 'ia',
      gerarId: () => gerar(),
    });
    const antes = impressaoDoModelo(sessao.modelo);
    sessao.aplicar({
      tipo: 'DimensionarPeca',
      pecaId: 'p1',
      payload: { centro: { x: 0, y: 0 }, fatorX: 0.9, fatorY: 0.9 },
    } as Gesto);
    const problemas = conferirIntegridade(antes, impressaoDoModelo(sessao.modelo), SEM_LICENCA, {
      p1: 'FRENTE',
    });
    expect(problemas.length).toBeGreaterThan(0);
    console.log(`guarda acusou: "${problemas[0]!.slice(0, 100)}..."`);
    // E o protocolo e DESFAZER, nao avisar e seguir (um aplicar = um passo):
    sessao.desfazer();
    expect(JSON.stringify(impressaoDoModelo(sessao.modelo))).toBe(JSON.stringify(antes));
    console.log('desfeito: a FRENTE voltou ao tamanho — molde nao se encolhe para caber no tecido');
  });
});
