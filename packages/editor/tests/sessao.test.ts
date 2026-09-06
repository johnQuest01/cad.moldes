/**
 * Bloco 1 — a sessao (E1, E2, E7, E8).
 *
 * O que precisa ficar provado aqui, com numero:
 *  - o documento e o fold do log, e nao uma copia paralela;
 *  - `aplicar -> desfazer -> refazer` devolve o modelo BYTE A BYTE igual;
 *  - `selar` faz o undo parar no selo (o log e append-only, e essa e a razao);
 *  - um gesto que o motor recusa nao suja o documento;
 *  - o cache do fold nao roda de novo quando a versao nao mudou.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ErroMotor,
  MM,
  anelDoContorno,
  area,
  criarGeradorMonotonico,
  medirAresta,
  umParaMM,
  type Evento,
  type Modelo,
} from '@cad/motor';

import { Sessao, tentar, type Gesto } from '../src/index.js';

const TENANT = 'confeccao-a';
const MODELO = 'mod-1';
const PECA = 'pec-1';

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: 'livre' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

/** Log de um retangulo 100 x 200 mm com margem de 10 mm, ja "persistido". */
function logPersistido(): Evento[] {
  const cantos = [
    { x: 0, y: 0 },
    { x: 100 * MM, y: 0 },
    { x: 100 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  let n = 0;
  const envelope = (pecaId: string | null) => ({
    id: `01JXBASE${String(n++).padStart(4, '0')}`,
    tenantId: TENANT,
    modeloId: MODELO,
    pecaId,
    timestamp: '2026-09-05T12:00:00.000Z',
    autor: 'fixture',
    versaoSchema: 1,
  });
  const log: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Modelo', tamanhos: ['M'], tamanhoBase: 'M' },
    },
    { ...envelope(PECA), tipo: 'CriarPeca', payload: { nome: 'RETANGULO', encaixe: ENCAIXE } },
  ] as Evento[];
  cantos.forEach((c, i) =>
    log.push({
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    log.push({
      ...envelope(PECA),
      tipo: 'DefinirAresta',
      payload: { arestaId: `ar-${i}`, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    log.push({
      ...envelope(PECA),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % 4}`,
        tipo: 'reta',
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    log.push({
      ...envelope(PECA),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM: 10 * MM },
    } as Evento),
  );
  return log;
}

function novaSessao(): Sessao {
  const gerar = criarGeradorMonotonico();
  let relogio = 0;
  return new Sessao(logPersistido(), {
    tenantId: TENANT,
    modeloId: MODELO,
    autor: 'modelista',
    gerarId: () => gerar(),
    agora: () => new Date(Date.UTC(2026, 8, 5, 12, 0, relogio++)).toISOString(),
  });
}

const puxar = (mm: number): Gesto => ({
  tipo: 'ModificarPonto',
  pecaId: PECA,
  payload: { pontoId: 'pt-1', dx: mm * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
});

const largura = (modelo: Modelo): number => {
  const anel = anelDoContorno(modelo.pecas[PECA]!);
  return Math.max(...anel.map((p) => p.x)) - Math.min(...anel.map((p) => p.x));
};

/** Comparacao canonica: os mapas do motor nao tem ordem garantida. */
function canonico(valor: unknown): string {
  return JSON.stringify(valor, (_c, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

describe('O documento e o fold do log (E1)', () => {
  it('a sessao comeca no persistido, e o gesto muda o que o motor mede', () => {
    const sessao = novaSessao();
    console.log('--- a sessao ---');
    console.log(
      `inicio: ${umParaMM(largura(sessao.modelo))} mm de largura | ` +
        `${sessao.log.length} eventos | ${sessao.pendentes.length} pendentes`,
    );

    sessao.aplicar(puxar(30));
    console.log(
      `depois de puxar 30 mm: ${umParaMM(largura(sessao.modelo))} mm | ` +
        `${sessao.pendentes.length} pendente`,
    );

    expect(umParaMM(largura(sessao.modelo))).toBe(130);
    expect(sessao.pendentes).toHaveLength(1);
  });

  it('o evento sai carimbado com tenant, modelo, autor e id monotonico (E12, E13)', () => {
    const sessao = novaSessao();
    const [a] = sessao.aplicar(puxar(10));
    const [b] = sessao.aplicar(puxar(10));
    console.log(`ids: ${a!.id} -> ${b!.id} | crescente: ${b!.id > a!.id}`);
    console.log(`tenant ${a!.tenantId} | modelo ${a!.modeloId} | autor ${a!.autor}`);
    expect(b!.id > a!.id).toBe(true);
    expect(a!.tenantId).toBe(TENANT);
    expect(a!.autor).toBe('modelista');
  });

  it('varios gestos numa chamada sao UM passo de undo', () => {
    const sessao = novaSessao();
    sessao.aplicar(puxar(10), puxar(10), puxar(10));
    const depois = umParaMM(largura(sessao.modelo));
    sessao.desfazer();
    console.log(`3 gestos numa chamada: ${depois} mm -> 1 desfazer -> ${umParaMM(largura(sessao.modelo))} mm`);
    expect(depois).toBe(130);
    expect(umParaMM(largura(sessao.modelo))).toBe(100);
  });
});

describe('Undo, redo e o selo (E2)', () => {
  it('aplicar, desfazer e refazer devolvem o modelo BYTE A BYTE igual', () => {
    const sessao = novaSessao();
    const inicial = canonico(sessao.modelo);

    sessao.aplicar(puxar(30));
    const editado = canonico(sessao.modelo);
    sessao.desfazer();
    const voltou = canonico(sessao.modelo);
    sessao.refazer();
    const refez = canonico(sessao.modelo);

    console.log('--- undo / redo ---');
    console.log(`inicial == depois de desfazer: ${inicial === voltou}`);
    console.log(`editado == depois de refazer:  ${editado === refez}`);
    expect(voltou).toBe(inicial);
    expect(refez).toBe(editado);
  });

  it('uma acao nova depois de desfazer trunca a cauda de refazer', () => {
    const sessao = novaSessao();
    sessao.aplicar(puxar(30));
    sessao.desfazer();
    expect(sessao.podeRefazer).toBe(true);
    sessao.aplicar(puxar(5));
    console.log(
      `depois de desfazer e agir de novo: podeRefazer = ${sessao.podeRefazer} | ` +
        `${umParaMM(largura(sessao.modelo))} mm`,
    );
    expect(sessao.podeRefazer).toBe(false);
    expect(umParaMM(largura(sessao.modelo))).toBe(105);
  });

  it('selar esvazia os pendentes e o undo PARA no selo — o log e append-only', () => {
    const sessao = novaSessao();
    sessao.aplicar(puxar(30));
    const antesDoSelo = umParaMM(largura(sessao.modelo));
    const versaoAntes = sessao.versao;

    sessao.selar();
    console.log('--- o selo ---');
    console.log(
      `pendentes: 1 -> ${sessao.pendentes.length} | podeDesfazer: ${sessao.podeDesfazer} | ` +
        `log com ${sessao.log.length} eventos`,
    );
    console.log(
      `a peca nao mudou: ${antesDoSelo} -> ${umParaMM(largura(sessao.modelo))} mm | ` +
        `versao ${versaoAntes} -> ${sessao.versao} (nao muda: o log efetivo e o mesmo)`,
    );

    expect(sessao.pendentes).toHaveLength(0);
    expect(sessao.podeDesfazer).toBe(false);
    expect(sessao.desfazer()).toBe(false);
    expect(umParaMM(largura(sessao.modelo))).toBe(antesDoSelo);
    expect(sessao.versao).toBe(versaoAntes);
  });

  it('depois do selo, desfazer e fazer a operacao INVERSA — e isso e uma edicao normal', () => {
    const sessao = novaSessao();
    sessao.aplicar(puxar(30));
    sessao.selar();
    sessao.aplicar(puxar(-30));
    console.log(
      `puxou 30, selou, puxou -30: ${umParaMM(largura(sessao.modelo))} mm | ` +
        `o log guarda os ${sessao.log.length - logPersistido().length} gestos, como manda a auditoria`,
    );
    expect(umParaMM(largura(sessao.modelo))).toBe(100);
    expect(sessao.log.length - logPersistido().length).toBe(2);
  });
});

describe('Recusa do motor nao suja o documento (E7)', () => {
  it('um gesto invalido deixa versao, log e modelo intactos', () => {
    const sessao = novaSessao();
    sessao.aplicar(puxar(30));
    const versao = sessao.versao;
    const antes = canonico(sessao.modelo);
    const eventos = sessao.log.length;

    const resultado = tentar(() =>
      sessao.aplicar({
        tipo: 'ModificarPonto',
        pecaId: PECA,
        payload: { pontoId: 'pt-nao-existe', dx: 1000, dy: 0, modo: 'discreto', nVizinhos: 0 },
      }),
    );

    console.log('--- recusa ---');
    console.log(`resultado: ${resultado.ok ? 'passou (ERRADO)' : resultado.erro.codigo}`);
    console.log(
      `versao ${versao} -> ${sessao.versao} | log ${eventos} -> ${sessao.log.length} | ` +
        `modelo intacto: ${antes === canonico(sessao.modelo)}`,
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro).toBeInstanceOf(ErroMotor);
    expect(sessao.versao).toBe(versao);
    expect(sessao.log).toHaveLength(eventos);
    expect(canonico(sessao.modelo)).toBe(antes);
  });

  it('gesto de tipo desconhecido tambem e recusado, e nao entra no log', () => {
    const sessao = novaSessao();
    const resultado = tentar(() =>
      sessao.aplicar({ tipo: 'FerramentaQueNaoExiste', pecaId: PECA, payload: {} }),
    );
    console.log(`tipo desconhecido -> ${resultado.ok ? 'passou (ERRADO)' : resultado.erro.codigo}`);
    expect(resultado.ok).toBe(false);
    expect(sessao.pendentes).toHaveLength(0);
  });
});

describe('Cache do fold (E8)', () => {
  it('ler o modelo dez vezes sem mudar nada roda o fold UMA vez', () => {
    const sessao = novaSessao();
    for (let i = 0; i < 10; i++) void sessao.modelo;
    const depoisDeLer = sessao.foldsFeitos;

    sessao.aplicar(puxar(10));
    for (let i = 0; i < 10; i++) void sessao.modelo;
    const depoisDeEditar = sessao.foldsFeitos;

    console.log('--- cache ---');
    console.log(`10 leituras sem editar          -> ${depoisDeLer} fold`);
    console.log(`1 edicao + 10 leituras          -> ${depoisDeEditar} folds no total`);
    expect(depoisDeLer).toBe(1);
    expect(depoisDeEditar).toBe(2);
  });

  it('desfazer invalida o cache — senao a tela mostraria o estado antigo', () => {
    const sessao = novaSessao();
    sessao.aplicar(puxar(30));
    void sessao.modelo;
    sessao.desfazer();
    console.log(`depois de desfazer: ${umParaMM(largura(sessao.modelo))} mm (nao 130)`);
    expect(umParaMM(largura(sessao.modelo))).toBe(100);
  });
});

describe('Propriedade: undo e involucao', () => {
  it('para qualquer sequencia de N gestos validos, N desfazer devolvem o modelo inicial', () => {
    let maiorN = 0;
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -20, max: 20 }).filter((v) => v !== 0), {
          minLength: 1,
          maxLength: 8,
        }),
        (passos) => {
          const sessao = novaSessao();
          const inicial = canonico(sessao.modelo);
          for (const passo of passos) sessao.aplicar(puxar(passo));
          for (let i = 0; i < passos.length; i++) sessao.desfazer();
          maiorN = Math.max(maiorN, passos.length);
          return canonico(sessao.modelo) === inicial && !sessao.podeDesfazer;
        },
      ),
      { numRuns: 200 },
    );
    console.log(`200 sequencias, ate ${maiorN} gestos cada: undo devolveu o inicial em todas`);
  });

  it('a area da peca so depende do log efetivo, nao do caminho ate ele', () => {
    const direto = novaSessao();
    direto.aplicar(puxar(30));

    const comIdaEVolta = novaSessao();
    comIdaEVolta.aplicar(puxar(50));
    comIdaEVolta.desfazer();
    comIdaEVolta.aplicar(puxar(30));

    const a = area(anelDoContorno(direto.modelo.pecas[PECA]!));
    const b = area(anelDoContorno(comIdaEVolta.modelo.pecas[PECA]!));
    console.log(
      `direto ${(a / 1e8).toFixed(1)} cm2 | com ida e volta ${(b / 1e8).toFixed(1)} cm2 | ` +
        `bainha ${umParaMM(medirAresta(direto.modelo.pecas[PECA]!, 'ar-0'))} mm`,
    );
    expect(b).toBe(a);
  });
});
