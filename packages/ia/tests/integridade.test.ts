/**
 * Fase 7 — a guarda de integridade.
 *
 * O teste responde à pergunta que qualquer um faz antes de deixar uma IA perto de
 * um molde: **e se ela encolher a peça para caber melhor no tecido?**
 *
 * A resposta não pode ser "eu pedi para ela não fazer". Tem que ser: se ela fizer,
 * é pego e desfeito. É isso que está medido aqui — inclusive tentando o corte de
 * propósito, para ver a guarda pegar.
 */
import { describe, expect, it } from 'vitest';

import { Sessao } from '@cad/editor';
import { MM, reconstruir, type Evento, type Modelo, type Vetor2 } from '@cad/motor';

import {
  CATALOGO,
  SEM_LICENCA,
  TOLERANCIA_DE_FORMA,
  conferirIntegridade,
  impressaoDoModelo,
} from '../src/index.js';

let contador = 0;
const envelope = (pecaId: string | null) => ({
  id: `01JG${String(contador++).padStart(6, '0')}`,
  tenantId: 't',
  modeloId: 'm',
  pecaId,
  timestamp: '2026-09-07T00:00:00.000Z',
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

/** Uma peça com muitos pontos: é onde o arredondamento do giro mais aparece. */
function pecaRedonda(id: string, nome: string, raioMM: number, lados: number): Evento[] {
  const pontos: Vetor2[] = [];
  for (let i = 0; i < lados; i++) {
    const t = (i / lados) * 2 * Math.PI;
    pontos.push({
      x: Math.round(raioMM * MM * (1 + Math.cos(t))),
      y: Math.round(raioMM * MM * (1 + Math.sin(t))),
    });
  }
  const e: Evento[] = [
    { ...envelope(id), tipo: 'CriarPeca', payload: { nome, encaixe: ENCAIXE } } as Evento,
  ];
  pontos.forEach((p, i) =>
    e.push({
      ...envelope(id),
      tipo: 'CriarPonto',
      payload: { pontoId: `${id}-pt-${i}`, x: p.x, y: p.y, tipo: 'contorno' },
    } as Evento),
  );
  pontos.forEach((_, i) =>
    e.push({
      ...envelope(id),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: `${id}-ar-${i}`,
        pontoInicioId: `${id}-pt-${i}`,
        pontoFimId: `${id}-pt-${(i + 1) % pontos.length}`,
      },
    } as Evento),
  );
  pontos.forEach((_, i) =>
    e.push({
      ...envelope(id),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `${id}-sg-${i}`,
        arestaId: `${id}-ar-${i}`,
        de: `${id}-pt-${i}`,
        para: `${id}-pt-${(i + 1) % pontos.length}`,
        tipo: 'reta',
      },
    } as Evento),
  );
  pontos.forEach((_, i) =>
    e.push({
      ...envelope(id),
      tipo: 'DefinirMargem',
      payload: { arestaId: `${id}-ar-${i}`, margemUM: 10 * MM },
    } as Evento),
  );
  return e;
}

function log(): Evento[] {
  contador = 0;
  return [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Blusa', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    ...pecaRedonda('p1', 'CAVA', 200, 60),
  ];
}
const modeloBase = (): Modelo => reconstruir(log());

function sessaoNova(): Sessao {
  let n = 0;
  return new Sessao(log(), {
    tenantId: 't',
    modeloId: 'm',
    autor: 'ia',
    gerarId: () => `01JX${String(n++).padStart(6, '0')}`,
  });
}

const nomes = { p1: 'CAVA' };

describe('O que é rígido passa', () => {
  it('girar 30 graus não conta como mudança de forma — e aqui está a folga usada', () => {
    const antes = impressaoDoModelo(modeloBase());
    const s = sessaoNova();
    s.aplicar({
      tipo: 'RotacionarPeca',
      pecaId: 'p1',
      payload: { centro: { x: 200 * MM, y: 200 * MM }, anguloGraus: 30 },
    });
    const depois = impressaoDoModelo(s.modelo);

    const dArea = Math.abs(depois['p1']!.areaUM - antes['p1']!.areaUM) / antes['p1']!.areaUM;
    const dPer =
      Math.abs(depois['p1']!.perimetroUM - antes['p1']!.perimetroUM) / antes['p1']!.perimetroUM;
    console.log('--- giro de 30 graus numa peca de 60 pontos ---');
    console.log(`area variou   ${(dArea * 100).toFixed(5)}%`);
    console.log(`perimetro     ${(dPer * 100).toFixed(5)}%`);
    console.log(`tolerancia    ${(TOLERANCIA_DE_FORMA * 100).toFixed(3)}%`);
    expect(conferirIntegridade(antes, depois, SEM_LICENCA, nomes)).toHaveLength(0);
  });

  it('espelhar também passa', () => {
    const antes = impressaoDoModelo(modeloBase());
    const s = sessaoNova();
    s.aplicar({
      tipo: 'EspelharPeca',
      pecaId: 'p1',
      payload: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 1000 } },
    });
    expect(conferirIntegridade(antes, impressaoDoModelo(s.modelo), SEM_LICENCA, nomes)).toHaveLength(0);
  });

  it('mudar a MARGEM não é mudar a forma: o contorno é o mesmo', () => {
    const antes = impressaoDoModelo(modeloBase());
    const s = sessaoNova();
    s.aplicar({
      tipo: 'DefinirMargem',
      pecaId: 'p1',
      payload: { arestaId: 'p1-ar-0', margemUM: 30 * MM },
    });
    console.log('margem de 10 para 30 mm -> a linha de CORTE muda, o contorno nao');
    expect(conferirIntegridade(antes, impressaoDoModelo(s.modelo), SEM_LICENCA, nomes)).toHaveLength(0);
  });
});

describe('O que a IA NÃO pode fazer, e a guarda pega', () => {
  it('encolher a peça para caber no tecido é PEGO', () => {
    // O cenário que dá medo: a IA "otimiza" puxando o contorno para dentro.
    const antes = impressaoDoModelo(modeloBase());
    const s = sessaoNova();
    s.aplicar({
      tipo: 'ModificarPonto',
      pecaId: 'p1',
      payload: { pontoId: 'p1-pt-0', dx: -5 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });
    const problemas = conferirIntegridade(antes, impressaoDoModelo(s.modelo), SEM_LICENCA, nomes);
    console.log('--- a IA puxa um ponto 5 mm para dentro ---');
    console.log(problemas.join('\n'));
    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas[0]).toContain('mudou de FORMA');
  });

  it('apagar ponto do contorno nem chega na guarda: o MOTOR recusa antes', () => {
    // Descoberto ao escrever este teste, e é boa notícia: a guarda é a camada de
    // cima. Embaixo dela o motor já recusa apagar ponto que é extremo de aresta,
    // porque isso deixaria a margem e o par de costura apontando para o lugar
    // errado. São duas defesas independentes, e a IA esbarra na primeira.
    const s = sessaoNova();
    let recusa: string | null = null;
    try {
      s.aplicar({ tipo: 'ExcluirPonto', pecaId: 'p1', payload: { pontoId: 'p1-pt-5' } });
    } catch (e) {
      recusa = String(e);
    }
    console.log(recusa);
    expect(recusa).toContain('PONTO_NOTAVEL_NAO_REMOVIVEL');
  });

  it('a licença é o que separa o permitido do proibido — a guarda em si', () => {
    // Direto na guarda, sem passar pelo motor: uma peça que perdeu pontos e
    // encolheu 8% de área. Sem licença, recusado; com licença, passa.
    const antes = { p1: { pontos: 60, areaUM: 1_000_000, perimetroUM: 4000 } };
    const depois = { p1: { pontos: 12, areaUM: 920_000, perimetroUM: 3800 } };
    const sem = conferirIntegridade(antes, depois, SEM_LICENCA, nomes);
    const com = conferirIntegridade(
      antes,
      depois,
      { alteraForma: true, criaPeca: false, removePeca: false },
      nomes,
    );
    console.log('--- 60 pontos viram 12, area cai 8% ---');
    console.log(`sem licenca: ${sem.length} recusa(s)`);
    console.log(`  "${sem[0]}"`);
    console.log(`com licenca: ${com.length} recusa(s)`);
    expect(sem).toHaveLength(1);
    expect(com).toHaveLength(0);
  });

  it('simplificar com tolerância absurda não come o desenho — o motor não deixa', () => {
    // Outra boa notícia medida aqui: `simplificarContorno` do motor só mexe em
    // trechos de RETAS CONSECUTIVAS dentro de uma mesma aresta. Numa peça em que
    // cada aresta tem um segmento, uma tolerância de 20 mm — absurda — não apaga
    // nada. O estrago que se imagina, "simplifica até virar um polígono grosseiro",
    // não está ao alcance dela.
    const antes = impressaoDoModelo(modeloBase());
    const s = sessaoNova();
    s.aplicar({ tipo: 'SimplificarContorno', pecaId: 'p1', payload: { toleranciaUM: 20 * MM } });
    const depois = impressaoDoModelo(s.modelo);
    console.log(
      `tolerancia de 20 mm: ${antes['p1']!.pontos} pontos -> ${depois['p1']!.pontos} pontos, ` +
        `area ${((depois['p1']!.areaUM / antes['p1']!.areaUM) * 100).toFixed(3)}% da original`,
    );
    expect(depois['p1']!.pontos).toBe(antes['p1']!.pontos);
  });

  it('apagar peça sem licença é PEGO', () => {
    const antes = impressaoDoModelo(modeloBase());
    const s = sessaoNova();
    s.aplicar({ tipo: 'RemoverPeca', pecaId: 'p1', payload: {} });
    const problemas = conferirIntegridade(antes, impressaoDoModelo(s.modelo), SEM_LICENCA, nomes);
    console.log(problemas.join('\n'));
    expect(problemas[0]).toContain('SUMIU');
  });
});

describe('Quem tem licença, e é pouca gente', () => {
  it('só quatro ferramentas têm licença, e as de mexer no desenho são DUAS', () => {
    const comLicenca = CATALOGO.filter((f) => f.licenca !== undefined);
    console.log('--- licencas do catalogo ---');
    for (const f of comLicenca) {
      console.log(
        `${f.nome.padEnd(22)} forma:${f.licenca!.alteraForma ? 'SIM' : 'nao'} ` +
          `cria:${f.licenca!.criaPeca ? 'SIM' : 'nao'} remove:${f.licenca!.removePeca ? 'SIM' : 'nao'}`,
      );
    }
    const mexemNaForma = CATALOGO.filter((f) => f.licenca?.alteraForma === true);
    console.log(
      `${CATALOGO.length} ferramentas no total | ${comLicenca.length} com licenca | ` +
        `${mexemNaForma.length} pode mexer no desenho`,
    );
    // O censo e deliberado: quem entra aqui entra NOMEADO, com o criterio dito.
    // dimensionar_peca entrou em 2026-09-13 — e o Encolhimento do oficio, opera
    // com percentual explicito e pede confirmacao humana antes de acontecer.
    expect(mexemNaForma.map((f) => f.nome).sort()).toEqual([
      'dimensionar_peca',
      'simplificar_contorno',
    ]);
    expect(comLicenca).toHaveLength(4);
  });

  it('nenhuma ferramenta de encaixe ou exportação tem licença nenhuma', () => {
    for (const nome of ['encaixar', 'otimizar_encaixe', 'exportar', 'definir_margem', 'espelhar_peca']) {
      const f = CATALOGO.find((x) => x.nome === nome)!;
      expect(f.licenca).toBeUndefined();
    }
    console.log('encaixar e otimizar_encaixe: sem licenca — encaixe decide POSICAO, nunca forma');
  });
});
