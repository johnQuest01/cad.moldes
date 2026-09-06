/**
 * Blocos 6 e 8 — comandos de painel e persistencia.
 *
 * Os comandos sao funcoes puras que devolvem gestos: entra o modelo e o que se
 * escolheu, sai a lista de eventos. Da para testar sem tela nenhuma, e e por isso
 * que o painel de graduacao pode ser conferido com numero em vez de olhometro.
 */
import { describe, expect, it } from 'vitest';

import { MM, anelDoContorno, umParaMM, type Evento, type Modelo } from '@cad/motor';

import {
  Cena,
  Sessao,
  abrir,
  abrirPregas,
  apagarRascunho,
  armazemDeMemoria,
  definirMargem,
  definirRegraGraduacao,
  duplicarPeca,
  guardarRascunho,
  lerRascunho,
  passosDaGrade,
  removerPeca,
  removerRegraGraduacao,
  renomearPeca,
  salvar,
  simplificarContorno,
  trocarPique,
  type Rede,
  type Referencia,
} from '../src/index.js';

import { MODELO, PECA, TENANT, dadosDaSessao, logDaBlusa, sessaoDaBlusa } from './fixtures.js';

/**
 * Largura da peca. Aceita `Modelo` (peca base) ou `Cena` (peca ja GRADUADA para o
 * tamanho exibido) — sao coisas diferentes, e confundir as duas foi o que fez este
 * teste passar por engano na primeira escrita.
 */
const larguraDe = (de: Modelo | Cena, pecaId: string): number => {
  const peca = de instanceof Cena ? de.derivados(pecaId).peca : de.pecas[pecaId]!;
  const anel = anelDoContorno(peca);
  return Math.max(...anel.map((p) => p.x)) - Math.min(...anel.map((p) => p.x));
};

describe('Painel de pecas', () => {
  it('duplicar poe a copia ao lado, sem sobrepor, e com a graduacao junto', () => {
    const sessao = sessaoDaBlusa();
    sessao.aplicar(...duplicarPeca(sessao.modelo, PECA, 'cp'));
    const cena = new Cena(sessao);
    const copia = `${PECA}-cp`;

    const larguras = ['P', 'M', 'G'].map((t) => {
      cena.tamanho = t;
      return `${t} ${umParaMM(larguraDe(cena, copia))}`;
    });

    console.log('--- duplicar ---');
    console.log(`pecas: ${Object.keys(sessao.modelo.pecas).join(', ')}`);
    console.log(
      `a copia comeca em x = ${umParaMM(
        Math.min(...anelDoContorno(sessao.modelo.pecas[copia]!).map((p) => p.x)),
      )} mm (a original vai ate 190)`,
    );
    console.log(`e gradua junto: ${larguras.join(' | ')} mm`);

    expect(Object.keys(sessao.modelo.pecas)).toHaveLength(2);
    expect(larguras).toEqual(['P 184', 'M 190', 'G 196']);
  });

  it('duplicar sem graduacao deixa a copia parada, e o validador acusa', () => {
    const sessao = sessaoDaBlusa();
    sessao.aplicar(...duplicarPeca(sessao.modelo, PECA, 'cp', false));
    const cena = new Cena(sessao);
    const copia = `${PECA}-cp`;
    const larguras = ['P', 'M', 'G'].map((t) => {
      cena.tamanho = t;
      return umParaMM(larguraDe(cena, copia));
    });
    const avisos = cena.problemas.filter((p) => p.codigo === 'GRADE_POINT_SEM_REGRA');
    console.log(`sem graduacao: ${larguras.join(', ')} mm | ${avisos.length} avisos`);
    expect(new Set(larguras).size).toBe(1);
    expect(avisos.length).toBeGreaterThan(0);
  });

  it('renomear e remover', () => {
    const sessao = sessaoDaBlusa();
    sessao.aplicar(...renomearPeca(sessao.modelo, PECA, 'FRENTE DIREITA'));
    const nome = sessao.modelo.pecas[PECA]!.metadados.nome;
    sessao.aplicar(...removerPeca(sessao.modelo, PECA));
    console.log(`renomeou para "${nome}" | depois de remover: ${sessao.modelo.pecas[PECA] === undefined ? 'sumiu' : 'ainda esta la'}`);
    expect(nome).toBe('FRENTE DIREITA');
    expect(sessao.modelo.pecas[PECA]).toBeUndefined();
  });

  it('remover peca que nao existe estoura em vez de fingir que fez', () => {
    const sessao = sessaoDaBlusa();
    expect(() => removerPeca(sessao.modelo, 'pec-fantasma')).toThrow(/nao existe/);
  });
});

describe('Margem da selecao, de uma vez', () => {
  it('varias arestas num passo so de undo', () => {
    const sessao = sessaoDaBlusa();
    const selecionadas: Referencia[] = [
      { tipo: 'aresta', pecaId: PECA, arestaId: 'ar-bainha' },
      { tipo: 'aresta', pecaId: PECA, arestaId: 'ar-lateral' },
      { tipo: 'aresta', pecaId: PECA, arestaId: 'ar-ombro' },
      { tipo: 'ponto', pecaId: PECA, pontoId: 'pt-0' },
    ];
    const gestos = definirMargem(selecionadas, 15);
    sessao.aplicar(...gestos);

    const peca = sessao.modelo.pecas[PECA]!;
    console.log('--- margem da selecao ---');
    console.log(
      `4 selecionados (3 arestas + 1 ponto) -> ${gestos.length} gestos | ` +
        `bainha ${umParaMM(peca.margens['ar-bainha']!)} mm, ` +
        `lateral ${umParaMM(peca.margens['ar-lateral']!)} mm, ` +
        `cava (nao selecionada) ${umParaMM(peca.margens['ar-cava']!)} mm`,
    );
    expect(gestos).toHaveLength(3);
    expect(sessao.passos).toBe(1);
    expect(umParaMM(peca.margens['ar-bainha']!)).toBe(15);
    expect(umParaMM(peca.margens['ar-cava']!)).toBe(10);
  });
});

describe('Painel de graduacao', () => {
  it('os passos da grade sao os pares CONSECUTIVOS (D8)', () => {
    const sessao = sessaoDaBlusa();
    const passos = passosDaGrade(sessao.modelo);
    console.log(`grade ${sessao.modelo.tamanhos.join('-')} -> passos ${passos.map((p) => p.join('→')).join(', ')}`);
    expect(passos).toEqual([
      ['P', 'M'],
      ['M', 'G'],
    ]);
  });

  it('trocar a regra remove a antiga e poe a nova, num passo so', () => {
    const sessao = sessaoDaBlusa();
    const cena = new Cena(sessao);
    /** O x de pt-1 em cada tamanho. E ELE que a regra de gp-1 comanda. */
    const xDePt1 = (): number[] =>
      ['P', 'M', 'G'].map((t) => {
        cena.tamanho = t;
        return umParaMM(cena.derivados(PECA).peca.pontos['pt-1']!.x);
      });

    const antes = xDePt1();
    // gp-1 e o canto da bainha com a lateral: 6 mm por tamanho vira 20.
    const gestos = definirRegraGraduacao(sessao.modelo, 'gp-1', 'P', 'M', 20, 0, 'nova');
    sessao.aplicar(...gestos);
    const depois = xDePt1();

    console.log('--- regra de graduacao ---');
    console.log(`gestos: ${gestos.map((g) => g.tipo).join(', ')}`);
    console.log(`x de pt-1 antes:  ${antes.join(', ')} mm (salto P→M de ${antes[1]! - antes[0]!})`);
    console.log(`x de pt-1 depois: ${depois.join(', ')} mm (salto P→M de ${depois[1]! - depois[0]!})`);

    expect(gestos.map((g) => g.tipo)).toEqual([
      'RemoverRegraGraduacao',
      'DefinirRegraGraduacao',
    ]);
    expect(sessao.passos).toBe(1);
    expect(antes[1]! - antes[0]!).toBe(6);
    expect(depois[1]! - depois[0]!).toBe(20);
    // O passo M→G nao foi tocado: continua 6.
    expect(depois[2]! - depois[1]!).toBe(6);
  });

  it('tirar a regra deixa o ponto parado, e a conferencia acusa', () => {
    const sessao = sessaoDaBlusa();
    const regra = Object.values(sessao.modelo.regrasGraduacao).find(
      (r) => r.pontoGraduacaoId === 'gp-1' && r.deTamanho === 'P',
    )!;
    sessao.aplicar(...removerRegraGraduacao(sessao.modelo, regra.id));
    const avisos = new Cena(sessao).problemas.filter((p) => p.codigo === 'GRADE_POINT_SEM_REGRA');
    console.log(`tirou ${regra.id} -> ${avisos.length} aviso(s) GRADE_POINT_SEM_REGRA`);
    expect(avisos.length).toBeGreaterThan(0);
  });
});

describe('Trocar o pique ja cravado', () => {
  it('remove e recrava no MESMO s, com o tipo novo', () => {
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'AdicionarPique',
      pecaId: PECA,
      payload: {
        piqueId: 'pq-1',
        arestaId: 'ar-lateral',
        s: 0.42,
        tipo: 'V',
        alturaUM: 6350,
        larguraUM: 1590,
        anguloGraus: 0,
      },
    });
    sessao.aplicar(...trocarPique(sessao.modelo, PECA, 'pq-1', 'T', 9, 2));
    const pique = sessao.modelo.pecas[PECA]!.piques['pq-1']!;
    console.log(
      `V 6.35 mm em s=0.42 -> ${pique.tipo} ${umParaMM(pique.alturaUM)} x ` +
        `${umParaMM(pique.larguraUM)} mm em s=${pique.s}`,
    );
    expect(pique.tipo).toBe('T');
    expect(pique.s).toBe(0.42);
    expect(umParaMM(pique.alturaUM)).toBe(9);
  });
});

describe('Simplificar e pregas', () => {
  it('simplificar tira pontos e o comando diz a tolerancia em UM', () => {
    const sessao = sessaoDaBlusa();
    const gestos = simplificarContorno(sessao.modelo, PECA, 2);
    console.log(
      `tolerancia 2 mm -> ${gestos[0]!.tipo} com ` +
        `${(gestos[0]!.payload as { toleranciaUM: number }).toleranciaUM} UM`,
    );
    expect((gestos[0]!.payload as { toleranciaUM: number }).toleranciaUM).toBe(2 * MM);
  });

  it('abrir pregas sem eixo selecionado nao emite nada', () => {
    const sessao = sessaoDaBlusa();
    console.log(`nenhum eixo escolhido -> ${abrirPregas(sessao.modelo, PECA, [], 'pg').length} gestos`);
    expect(abrirPregas(sessao.modelo, PECA, [], 'pg')).toHaveLength(0);
  });
});

// ===========================================================================
// Bloco 8 — persistencia
// ===========================================================================

describe('O rascunho sobrevive a um travamento', () => {
  it('guardar e ler devolve os mesmos eventos', () => {
    const armazem = armazemDeMemoria();
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-3', dx: 20 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });

    const guardou = guardarRascunho(armazem, TENANT, MODELO, sessao.pendentes);
    const lido = lerRascunho(armazem, TENANT, MODELO);

    console.log('--- rascunho ---');
    console.log(
      `guardou ${sessao.pendentes.length} evento(s): ${guardou} | ` +
        `leu de volta ${lido.length}: ${lido.map((e) => e.tipo).join(', ')}`,
    );
    expect(guardou).toBe(true);
    expect(JSON.stringify(lido)).toBe(JSON.stringify(sessao.pendentes));
  });

  it('rascunho de OUTRO modelo ou tenant nao e lido — isolamento vale aqui tambem', () => {
    const armazem = armazemDeMemoria();
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-3', dx: 10 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });
    guardarRascunho(armazem, TENANT, MODELO, sessao.pendentes);

    const deOutroTenant = lerRascunho(armazem, 'confeccao-b', MODELO);
    const deOutroModelo = lerRascunho(armazem, TENANT, 'mod-outro');
    console.log(
      `outro tenant -> ${deOutroTenant.length} eventos | outro modelo -> ${deOutroModelo.length}`,
    );
    expect(deOutroTenant).toHaveLength(0);
    expect(deOutroModelo).toHaveLength(0);
  });

  it('lixo no armazem nao derruba a abertura', () => {
    const armazem = armazemDeMemoria();
    armazem.gravar(`cad.moldes:rascunho:${TENANT}:${MODELO}`, '{isso nao e json');
    console.log(`armazem corrompido -> ${lerRascunho(armazem, TENANT, MODELO).length} eventos, sem estourar`);
    expect(lerRascunho(armazem, TENANT, MODELO)).toHaveLength(0);
  });

  it('apagar limpa; salvar zero pendentes tambem limpa', () => {
    const armazem = armazemDeMemoria();
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-3', dx: 10 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });
    guardarRascunho(armazem, TENANT, MODELO, sessao.pendentes);
    guardarRascunho(armazem, TENANT, MODELO, []);
    const depoisDeVazio = lerRascunho(armazem, TENANT, MODELO).length;
    apagarRascunho(armazem, TENANT, MODELO);
    console.log(`guardar lista vazia ja limpa: ${depoisDeVazio} eventos`);
    expect(depoisDeVazio).toBe(0);
  });
});

describe('Salvar no servidor', () => {
  /** Uma rede de mentira, que responde o que o teste mandar. */
  function redeQue(resposta: { ok: boolean; status: number; corpo?: unknown }): {
    rede: Rede;
    chamadas: { url: string; corpo: unknown }[];
  } {
    const chamadas: { url: string; corpo: unknown }[] = [];
    const rede: Rede = async (url, init) => {
      chamadas.push({ url, corpo: init.body === undefined ? null : JSON.parse(init.body) });
      return {
        ok: resposta.ok,
        status: resposta.status,
        json: async () => resposta.corpo ?? {},
      };
    };
    return { rede, chamadas };
  }

  const opcoes = (rede: Rede) => ({
    base: 'https://api.exemplo',
    tenantId: TENANT,
    token: 'jwt-assinado',
    rede,
  });

  it('o 201 SELA a sessao; o undo para ali (E2)', async () => {
    const { rede, chamadas } = redeQue({ ok: true, status: 201 });
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-3', dx: 20 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });

    const resultado = await salvar(sessao, MODELO, opcoes(rede));
    console.log('--- salvar ---');
    console.log(
      `POST ${chamadas[0]!.url} com ` +
        `${(chamadas[0]!.corpo as { eventos: Evento[] }).eventos.length} evento(s)`,
    );
    console.log(
      `resultado: ${JSON.stringify(resultado)} | pendentes ${sessao.pendentes.length} | ` +
        `podeDesfazer ${sessao.podeDesfazer}`,
    );
    expect(resultado).toEqual({ ok: true, gravados: 1 });
    expect(sessao.pendentes).toHaveLength(0);
    expect(sessao.podeDesfazer).toBe(false);
  });

  it('o servidor recusando NAO sela — o trabalho continua pendente', async () => {
    const { rede } = redeQue({ ok: false, status: 403, corpo: { mensagem: 'Token invalido.' } });
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-3', dx: 20 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });

    const resultado = await salvar(sessao, MODELO, opcoes(rede));
    console.log(
      `403 -> ${JSON.stringify(resultado)} | pendentes ${sessao.pendentes.length} ` +
        `(o trabalho NAO se perde)`,
    );
    expect(resultado.ok).toBe(false);
    expect(sessao.pendentes).toHaveLength(1);
    expect(sessao.podeDesfazer).toBe(true);
  });

  it('sem rede, o trabalho continua pendente e guardado', async () => {
    const rede: Rede = async () => {
      throw new Error('failed to fetch');
    };
    const sessao = sessaoDaBlusa();
    sessao.aplicar({
      tipo: 'ModificarPonto',
      pecaId: PECA,
      payload: { pontoId: 'pt-3', dx: 20 * MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
    });
    const resultado = await salvar(sessao, MODELO, opcoes(rede));
    console.log(`sem rede -> ${JSON.stringify(resultado)} | pendentes ${sessao.pendentes.length}`);
    expect(resultado.ok).toBe(false);
    expect(sessao.pendentes).toHaveLength(1);
  });

  it('nada pendente nao chama o servidor', async () => {
    const { rede, chamadas } = redeQue({ ok: true, status: 201 });
    const resultado = await salvar(sessaoDaBlusa(), MODELO, opcoes(rede));
    console.log(`sem pendentes -> ${JSON.stringify(resultado)}, ${chamadas.length} chamadas`);
    expect(resultado).toEqual({ ok: true, gravados: 0 });
    expect(chamadas).toHaveLength(0);
  });

  it('abrir traz o log e a sessao reconstroi a peca', async () => {
    const { rede } = redeQue({ ok: true, status: 200, corpo: { eventos: logDaBlusa() } });
    const eventos = await abrir(MODELO, opcoes(rede));
    const sessao = new Sessao(eventos, dadosDaSessao());
    console.log(
      `abriu ${eventos.length} eventos -> ${Object.keys(sessao.modelo.pecas).length} peca, ` +
        `${umParaMM(larguraDe(sessao.modelo, PECA))} mm de largura`,
    );
    expect(umParaMM(larguraDe(sessao.modelo, PECA))).toBe(190);
  });
});
