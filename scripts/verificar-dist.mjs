/**
 * Confere que os pacotes CONSTRUIDOS sao importaveis e funcionam.
 *
 *   node scripts/verificar-dist.mjs
 *
 * Os testes rodam contra o fonte (ver `vitest.config.ts` dos pacotes), o que e o
 * certo: teste nao deve depender de build. Mas isso deixa um buraco — o campo
 * `exports` do package.json e o resultado do `tsc` sao parte do contrato com quem
 * consome, e nada os exercitava. E exatamente o tipo de coisa que quebra em
 * silencio e so aparece quando a Fase 2 tenta importar o motor.
 *
 * Aqui o import e pelo NOME do pacote, nao por caminho relativo: e o mesmo
 * caminho de resolucao que o editor PixiJS e o wrap Tauri vao percorrer.
 */
import assert from 'node:assert/strict';

const problemas = [];

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    console.log(`  ok   ${nome}${detalhe === undefined ? '' : ` (${detalhe})`}`);
  } else {
    console.log(`  FALHA ${nome}`);
    problemas.push(nome);
  }
}

console.log('@cad/motor');
const motor = await import('@cad/motor');

conferir('exporta as unidades', motor.MM === 1000 && motor.TOLERANCIA_TESSELACAO_UM === 100);

// Nao basta importar: o artefato tem que CALCULAR. Retangulo 100 x 200 com margem
// de 10 mm tem que dar a linha de corte de 120 x 220 (teste 1 da Parte 5).
const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: 'livre',
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};
const envelope = (i, pecaId) => ({
  id: `evt-${i}`,
  tenantId: 't',
  modeloId: 'm',
  pecaId,
  timestamp: '2026-09-04T12:00:00.000Z',
  autor: 'verificar-dist',
  versaoSchema: 1,
});
const cantos = [
  { x: 0, y: 0 },
  { x: 100 * motor.MM, y: 0 },
  { x: 100 * motor.MM, y: 200 * motor.MM },
  { x: 0, y: 200 * motor.MM },
];
let n = 0;
const log = [
  { ...envelope(n++, null), tipo: 'CriarModelo', payload: { nome: 'M', tamanhos: ['M'], tamanhoBase: 'M' } },
  { ...envelope(n++, 'p'), tipo: 'CriarPeca', payload: { nome: 'R', encaixe: ENCAIXE } },
];
cantos.forEach((c, i) =>
  log.push({ ...envelope(n++, 'p'), tipo: 'CriarPonto', payload: { pontoId: `pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' } }),
);
cantos.forEach((_, i) =>
  log.push({
    ...envelope(n++, 'p'),
    tipo: 'DefinirAresta',
    payload: { arestaId: `ar-${i}`, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
  }),
);
cantos.forEach((_, i) =>
  log.push({
    ...envelope(n++, 'p'),
    tipo: 'DefinirSegmento',
    payload: { segmentoId: `sg-${i}`, arestaId: `ar-${i}`, de: `pt-${i}`, para: `pt-${(i + 1) % 4}`, tipo: 'reta' },
  }),
);
cantos.forEach((_, i) =>
  log.push({ ...envelope(n++, 'p'), tipo: 'DefinirMargem', payload: { arestaId: `ar-${i}`, margemUM: 10 * motor.MM } }),
);

const peca = motor.reconstruir(log).pecas['p'];
const corte = motor.offsetMargem(peca).pontos;
const xs = corte.map((p) => p.x);
const ys = corte.map((p) => p.y);
const largura = Math.max(...xs) - Math.min(...xs);
const altura = Math.max(...ys) - Math.min(...ys);
conferir(
  'offsetMargem do artefato construido',
  largura === 120 * motor.MM && altura === 220 * motor.MM && corte.length === 4,
  `${largura / motor.MM} x ${altura / motor.MM} mm, ${corte.length} vertices`,
);

// Bloco 0 da Fase 2: as operacoes que o editor vai chamar tem que estar no
// `exports`, e tem que CALCULAR — importar sem executar nao prova artefato.
const curva = motor.moverControle(
  motor.converterSegmento(peca, 'sg-1', 'curva'),
  'sg-1',
  0,
  30 * motor.MM,
  0,
);
conferir(
  'moverControle do artefato construido',
  motor.medirAresta(curva, 'ar-1') > motor.medirAresta(peca, 'ar-1'),
  `${motor.umParaMM(motor.medirAresta(peca, 'ar-1'))} -> ${motor.umParaMM(motor.medirAresta(curva, 'ar-1'))} mm`,
);

const { peca: copia } = motor.duplicarPeca(peca, 'p2', 'cp', { dx: 300 * motor.MM, dy: 0 });
const mesmosIds = Object.keys(copia.pontos).filter((id) => peca.pontos[id] !== undefined);
conferir(
  'duplicarPeca do artefato construido',
  mesmosIds.length === 0 &&
    motor.area(motor.anelDoContorno(copia)) === motor.area(motor.anelDoContorno(peca)),
  `${mesmosIds.length} ids em comum, mesma area`,
);

console.log('@cad/persistencia');
const persistencia = await import('@cad/persistencia');
conferir('exporta o repositorio', typeof persistencia.RepositorioDeEventos === 'function');
conferir('exporta os executores', typeof persistencia.executorPostgres === 'function' && typeof persistencia.executorSqlite === 'function');
conferir('o DDL sai nos dois dialetos', persistencia.ddl('postgres').length === 3 && persistencia.ddl('sqlite').length === 3);

console.log('@cad/editor');
const editor = await import('@cad/editor');
const camera = new editor.Camera(800, 600);
camera.enquadrar(editor.caixaDe(motor.anelDoContorno(peca)), 32);
const idaEVolta = camera.paraMundo(camera.paraTela({ x: 42 * motor.MM, y: 77 * motor.MM }));
conferir(
  'a camera do artefato construido converte ida e volta',
  idaEVolta.x === 42 * motor.MM && idaEVolta.y === 77 * motor.MM,
  `${motor.umParaMM(idaEVolta.x)}, ${motor.umParaMM(idaEVolta.y)} mm`,
);

const sessao = new editor.Sessao(log, {
  tenantId: 't',
  modeloId: 'm',
  autor: 'verificar-dist',
  gerarId: motor.criarGeradorMonotonico(),
});
sessao.aplicar({
  tipo: 'ModificarPonto',
  pecaId: 'p',
  payload: { pontoId: 'pt-1', dx: 30 * motor.MM, dy: 0, modo: 'discreto', nVizinhos: 0 },
});
const larguraEditada = (m) => {
  const anel = motor.anelDoContorno(m.pecas['p']);
  return Math.max(...anel.map((v) => v.x)) - Math.min(...anel.map((v) => v.x));
};
const depoisDeEditar = larguraEditada(sessao.modelo);
sessao.desfazer();
conferir(
  'a sessao do artefato construido edita e desfaz',
  depoisDeEditar === 130 * motor.MM && larguraEditada(sessao.modelo) === 100 * motor.MM,
  `${motor.umParaMM(depoisDeEditar)} mm -> desfazer -> ${motor.umParaMM(larguraEditada(sessao.modelo))} mm`,
);

console.log('@cad/dxf');
const dxf = await import('@cad/dxf');
const saida = dxf.exportarDxf(motor.reconstruir(log));
const devolta = dxf.importarDxf(saida.dxf, {
  tenantId: 't',
  modeloId: 'm2',
  autor: 'verificar-dist',
  gerarId: motor.criarGeradorMonotonico(),
});
const pecaDeVolta = Object.values(motor.reconstruir(devolta.eventos).pecas)[0];
const areaOriginal = motor.area(motor.anelDoContorno(peca));
const areaDeVolta = motor.area(motor.anelDoContorno(pecaDeVolta));
conferir(
  'round-trip do DXF no artefato construido',
  areaOriginal === areaDeVolta,
  `${(areaOriginal / 1e8).toFixed(1)} cm2 -> ${(areaDeVolta / 1e8).toFixed(1)} cm2`,
);

console.log('@cad/plotter');
const plotter = await import('@cad/plotter');
const hpgl = plotter.gerarHpgl(motor.reconstruir(log));
const linhas = hpgl.hpgl.trim().split('\n');
conferir(
  'HPGL do artefato construido',
  linhas[0] === 'IN;' && linhas[linhas.length - 1] === 'IN;' && linhas.some((l) => l.startsWith('PD')),
  `${linhas.length} comandos, ${motor.umParaMM(hpgl.comprimentoUsadoUM)} mm de rolo`,
);

console.log('@cad/encaixe');
const encaixePkg = await import('@cad/encaixe');
const modeloParaEncaixar = motor.reconstruir(log);
// O modelo do fixture nao tem papel: a largura vai explicita, que e o outro
// caminho suportado — e encaixar sem largura nenhuma tem que RECUSAR.
const semRolo = encaixePkg.encaixar(modeloParaEncaixar);
const comRolo = encaixePkg.encaixar(modeloParaEncaixar, { larguraUtilUM: 1580 * motor.MM });
conferir(
  'encaixar sem largura de rolo recusa, com largura coloca',
  semRolo.colocacoes.length === 0 &&
    semRolo.problemas[0]?.codigo === 'PAPEL_INVALIDO' &&
    comRolo.colocacoes.length === 1,
  `sem rolo: ${semRolo.problemas[0]?.codigo} | com rolo: ${comRolo.colocacoes.length} peca em ` +
    `${motor.umParaMM(comRolo.comprimentoUsadoUM)} mm`,
);

// A costura entre as duas fases: o que o encaixe posiciona, o plotter desenha.
const postas = encaixePkg.aplicarEncaixe(modeloParaEncaixar, comRolo).map((c) => c.peca);
const hpglEncaixado = plotter.gerarHpgl(modeloParaEncaixar, { pecasPostas: postas });
conferir(
  'o encaixe do artefato construido cai no HPGL',
  hpglEncaixado.pecasPlotadas === 1 && hpglEncaixado.problemas.length === 0,
  `${hpglEncaixado.pecasPlotadas} peca plotada, ${motor.umParaMM(hpglEncaixado.comprimentoUsadoUM)} mm de rolo`,
);

console.log('@cad/api');
const api = await import('@cad/api');
conferir('exporta criarServidor', typeof api.criarServidor === 'function');

console.log('');
if (problemas.length > 0) {
  console.error(`${problemas.length} verificacao(oes) falharam: ${problemas.join(', ')}`);
  process.exit(1);
}
assert.equal(problemas.length, 0);
console.log('Artefatos construidos: importaveis e funcionando.');
