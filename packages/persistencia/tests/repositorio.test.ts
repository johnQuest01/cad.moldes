/**
 * Persistencia (Parte 4) — a MESMA suite rodando nos dois destinos reais:
 * Postgres (PGlite, que e Postgres de verdade compilado para WASM) e SQLite
 * (`node:sqlite`, o banco local do Tauri).
 *
 * Nao ha driver falso aqui. Um mock de banco provaria que o SQL foi montado, nao
 * que ele funciona — e as duas coisas que mais podem quebrar sao justamente do
 * banco: o `JSONB` reordenar chaves e o `ON CONFLICT` se comportar diferente.
 */
import { PGlite } from '@electric-sql/pglite';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MM, reconstruir, type Evento, type PropriedadesEncaixe } from '@cad/motor';

import {
  canonico,
  comMarcadores,
  ErroDePersistencia,
  executorPostgres,
  executorSqlite,
  RepositorioDeEventos,
  type Executor,
} from '../src/index.js';

const TENANT = 'confeccao-a';
const OUTRO_TENANT = 'confeccao-b';
const MODELO = 'mod-0001';
const PECA = 'pec-0001';

const ENCAIXE: PropriedadesEncaixe = {
  quantidadePorModelo: 1,
  giro: 'livre',
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

/**
 * Log de um retangulo 100 x 200 com margem de 10 mm, com ids em ordem ULID
 * simulada (prefixo crescente) para o `ORDER BY id` ser a ordem de emissao.
 */
function logRetangulo(tenantId = TENANT, modeloId = MODELO): Evento[] {
  let n = 0;
  const envelope = (pecaId: string | null) => ({
    id: `01JXAA${String(n++).padStart(4, '0')}`,
    tenantId,
    modeloId,
    pecaId,
    timestamp: '2026-09-04T12:00:00.000Z',
    autor: 'modelista-teste',
    versaoSchema: 1,
  });

  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Camisa', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
    },
    { ...envelope(PECA), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } },
  ];

  const cantos = [
    { x: 0, y: 0 },
    { x: 100 * MM, y: 0 },
    { x: 100 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  cantos.forEach((canto, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: canto.x, y: canto.y, tipo: 'contorno' },
    }),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirAresta',
      payload: { arestaId: `ar-${i}`, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
    }),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % 4}`,
        tipo: 'reta',
      },
    }),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM: 10 * MM },
    }),
  );
  eventos.push({
    ...envelope(PECA),
    tipo: 'ModificarPonto',
    payload: { pontoId: 'pt-2', dx: 5 * MM, dy: 0, modo: 'proporcional', nVizinhos: 1 },
  });
  return eventos;
}

// ---------------------------------------------------------------- bancos

const postgres = new PGlite();
afterAll(async () => {
  await postgres.close();
});

interface Destino {
  readonly nome: string;
  readonly criar: () => Promise<Executor>;
}

const destinos: readonly Destino[] = [
  {
    nome: 'Postgres (PGlite)',
    criar: async () => {
      await postgres.exec('DROP TABLE IF EXISTS evento; DROP TABLE IF EXISTS snapshot;');
      return executorPostgres(postgres);
    },
  },
  {
    nome: 'SQLite (node:sqlite)',
    criar: () => Promise.resolve(executorSqlite(new DatabaseSync(':memory:'))),
  },
];

for (const destino of destinos) {
  describe(`Log de eventos e snapshot — ${destino.nome}`, () => {
    let repo: RepositorioDeEventos;
    let executor: Executor;

    beforeEach(async () => {
      executor = await destino.criar();
      repo = new RepositorioDeEventos(executor);
      await repo.criarEsquema();
    });

    it('o log volta do banco identico ao que entrou, na ordem do ULID', async () => {
      const log = logRetangulo();
      const novos = await repo.anexar(TENANT, MODELO, log);
      const lido = await repo.lerLog(TENANT, MODELO);

      console.log(`--- ${destino.nome}: round-trip do log ---`);
      console.log(`gravados ${novos} eventos | lidos ${lido.length}`);
      console.log(`primeiro id: ${lido[0]!.id} | ultimo: ${lido[lido.length - 1]!.id}`);

      expect(novos).toBe(log.length);
      expect(lido).toHaveLength(log.length);
      // Comparacao canonica: JSONB nao preserva ordem de chave.
      expect(canonico(lido)).toBe(canonico(log));
      expect(lido.map((e) => e.id)).toEqual([...log].map((e) => e.id).sort());
    });

    it('TESTE 13 no banco: reconstruir so pelo log bate 100% com o snapshot JSONB', async () => {
      const log = logRetangulo();
      await repo.anexar(TENANT, MODELO, log);
      const gravado = await repo.gravarSnapshot(TENANT, MODELO);
      const integridade = await repo.conferirIntegridade(TENANT, MODELO);

      console.log(`--- ${destino.nome}: TESTE 13 (integridade) ---`);
      console.log(
        `${integridade.eventos} eventos ate "${integridade.ateEventoId}" | bate: ${integridade.bate}`,
      );
      console.log(
        `snapshot: ${Object.keys(gravado.pecas).length} peca(s), ` +
          `${Object.keys(gravado.pecas[PECA]!.pontos).length} pontos, ` +
          `ponto pt-2 em (${gravado.pecas[PECA]!.pontos['pt-2']!.x}, ${gravado.pecas[PECA]!.pontos['pt-2']!.y})`,
      );

      expect(integridade.bate).toBe(true);
      expect(integridade.eventos).toBe(log.length);
      // O snapshot lido do banco e o replay sao o MESMO estado, ids inclusive.
      const doBanco = await repo.lerSnapshot(TENANT, MODELO);
      expect(canonico(doBanco)).toBe(canonico(reconstruir(log)));
      // E a edicao proporcional sobreviveu a ida e volta pelo banco.
      expect(gravado.pecas[PECA]!.pontos['pt-2']).toMatchObject({ x: 105 * MM, y: 200 * MM });
    });

    it('snapshot adulterado e ACUSADO, com o trecho que divergiu', async () => {
      const log = logRetangulo();
      await repo.anexar(TENANT, MODELO, log);
      await repo.gravarSnapshot(TENANT, MODELO);

      // Alguem editou o snapshot POR FORA, direto no banco — que e exatamente o
      // cenario que o teste 13 existe para pegar. Nao ha metodo do repositorio
      // para isso, e nao deve haver: quem corrompe nao pede licenca.
      const corrompido = { ...(await repo.lerSnapshot(TENANT, MODELO))!, nome: 'Camisa ADULTERADA' };
      await executor.consultar(
        comMarcadores(
          'UPDATE snapshot SET estado = $1 WHERE tenant_id = $2 AND modelo_id = $3',
          executor.dialeto,
        ),
        [
          executor.dialeto === 'postgres' ? corrompido : JSON.stringify(corrompido),
          TENANT,
          MODELO,
        ],
      );

      const integridade = await repo.conferirIntegridade(TENANT, MODELO);
      console.log(`--- ${destino.nome}: snapshot adulterado ---`);
      console.log(`bate: ${integridade.bate}`);
      console.log(`  ${integridade.diferenca}`);
      expect(integridade.bate).toBe(false);
      expect(integridade.diferenca).toContain('ADULTERADA');
    });

    it('reanexar o mesmo evento e no-op; com conteudo diferente, estoura', async () => {
      const log = logRetangulo();
      await repo.anexar(TENANT, MODELO, log);

      const denovo = await repo.anexar(TENANT, MODELO, log);
      console.log(`--- ${destino.nome}: idempotencia ---`);
      console.log(`reanexar os mesmos ${log.length} eventos -> ${denovo} novos`);
      expect(denovo).toBe(0);
      expect(await repo.lerLog(TENANT, MODELO)).toHaveLength(log.length);

      const adulterado: Evento = {
        ...log[2]!,
        payload: { ...(log[2]!.payload as object), x: 999 * MM },
      } as Evento;
      const erro = await capturar(() => repo.anexar(TENANT, MODELO, [adulterado]));
      console.log(`mesmo id com conteudo diferente -> ${erro}`);
      expect(erro).toBe('EVENTO_DIVERGENTE');
    });

    it('um tenant nao ve o log do outro', async () => {
      await repo.anexar(TENANT, MODELO, logRetangulo(TENANT));
      await repo.anexar(OUTRO_TENANT, MODELO, logRetangulo(OUTRO_TENANT).map(comIdOutro));

      const doA = await repo.lerLog(TENANT, MODELO);
      const doB = await repo.lerLog(OUTRO_TENANT, MODELO);
      console.log(
        `--- ${destino.nome}: isolamento --- tenant A ve ${doA.length}, tenant B ve ${doB.length}`,
      );
      expect(doA.every((e) => e.tenantId === TENANT)).toBe(true);
      expect(doB.every((e) => e.tenantId === OUTRO_TENANT)).toBe(true);
      expect(doA).toHaveLength(logRetangulo().length);
    });

    it('recusa gravar evento de outro tenant ou de outro modelo na sessao errada', async () => {
      const log = logRetangulo();
      const tenantErrado = await capturar(() => repo.anexar(OUTRO_TENANT, MODELO, log));
      const modeloErrado = await capturar(() => repo.anexar(TENANT, 'mod-outro', log));
      console.log(`evento de outro tenant -> ${tenantErrado}`);
      console.log(`evento de outro modelo -> ${modeloErrado}`);
      expect(tenantErrado).toBe('EVENTO_DE_OUTRO_TENANT');
      expect(modeloErrado).toBe('EVENTO_DE_OUTRO_MODELO');
    });

    it('recusa conferir ou reconstruir modelo sem log, e sem snapshot', async () => {
      const semLog = await capturar(() => repo.reconstruirDoLog(TENANT, 'mod-vazio'));
      await repo.anexar(TENANT, MODELO, logRetangulo());
      const semSnapshot = await capturar(() => repo.conferirIntegridade(TENANT, MODELO));
      console.log(`modelo sem log       -> ${semLog}`);
      console.log(`log sem snapshot     -> ${semSnapshot}`);
      expect(semLog).toBe('LOG_VAZIO');
      expect(semSnapshot).toBe('SNAPSHOT_AUSENTE');
    });
  });
}

/** Muda os ids para o segundo tenant nao colidir na chave primaria. */
function comIdOutro(evento: Evento): Evento {
  return { ...evento, id: evento.id.replace('01JXAA', '01JXBB') };
}

async function capturar(acao: () => Promise<unknown>): Promise<string | null> {
  try {
    await acao();
    return null;
  } catch (erro) {
    if (erro instanceof ErroDePersistencia) return erro.codigo;
    throw erro;
  }
}
