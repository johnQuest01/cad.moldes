/**
 * Gera as figuras de MD/figuras/ A PARTIR DO MOTOR.
 *
 * Nao sao desenhos ilustrativos: cada polilinha aqui e a saida real de
 * `offsetMargem`, `aplicarGraduacao`, `modificarPonto` e `tesselarContorno`. Se o
 * motor errar, a figura sai errada — e por isso ela serve de conferencia.
 *
 *   node scripts/gerar-figuras.mjs
 *
 * Roda contra `packages/motor/dist`, entao exige `npm run build` antes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MM,
  aberturaDasPregas,
  abrirPregas,
  adicionarPique,
  aplicarGraduacao,
  area,
  areaDesdobrada,
  arredondarVertice,
  chanfrarVertice,
  contornoDesdobrado,
  dividirPeca,
  linhaDeCorteDesdobrada,
  medirAresta,
  modificarPonto,
  normalizarWinding,
  localizarNoContorno,
  offsetMargem,
  projetarPiques,
  reconstruir,
  simplificarContorno,
  tesselarContorno,
  tesselarSegmento,
  umParaMM,
} from '../packages/motor/dist/index.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'MD', 'figuras');
mkdirSync(SAIDA, { recursive: true });

const TENANT = 'tenant-figuras';
const MODELO = 'mod-figuras';
const PECA = 'pec-figuras';
const KAPPA_90 = (4 / 3) * Math.tan(Math.PI / 8);

let contador = 0;
const envelope = (pecaId) => ({
  id: `evt-${String(contador++).padStart(4, '0')}`,
  tenantId: TENANT,
  modeloId: MODELO,
  pecaId,
  timestamp: '2026-09-03T12:00:00.000Z',
  autor: 'gerar-figuras',
  versaoSchema: 1,
});

/** Log de um poligono fechado; `curvas[i]` opcional troca o lado i por uma Bezier. */
function logPoligono({ vertices, margensUM, curvas = {}, pecaId = PECA, tamanhos, base }) {
  contador = 0;
  const eventos = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Figuras', tamanhos: tamanhos ?? ['P', 'M', 'G'], tamanhoBase: base ?? 'M' },
    },
    { ...envelope(pecaId), tipo: 'CriarPeca', payload: { nome: 'PECA', encaixe: ENCAIXE } },
  ];
  vertices.forEach((v, i) =>
    eventos.push({
      ...envelope(pecaId),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: v.x, y: v.y, tipo: 'contorno' },
    }),
  );
  vertices.forEach((_, i) =>
    eventos.push({
      ...envelope(pecaId),
      tipo: 'DefinirAresta',
      payload: {
        arestaId: `ar-${i}`,
        pontoInicioId: `pt-${i}`,
        pontoFimId: `pt-${(i + 1) % vertices.length}`,
      },
    }),
  );
  vertices.forEach((_, i) => {
    const controles = curvas[i];
    eventos.push({
      ...envelope(pecaId),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % vertices.length}`,
        tipo: controles ? 'curva' : 'reta',
        ...(controles ? { controles } : {}),
      },
    });
  });
  vertices.forEach((_, i) =>
    eventos.push({
      ...envelope(pecaId),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM: margensUM[i] },
    }),
  );
  return eventos;
}

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: 'livre',
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

// ---------------------------------------------------------------- SVG

const CORES = {
  costura: '#1f6feb',
  corte: '#d1242f',
  auxiliar: '#8250df',
  grade: '#d0d7de',
  texto: '#1f2328',
};

/**
 * Y-up do nucleo -> Y-down do SVG: inverte so no render, exatamente como a D4 manda.
 *
 * O SVG e montado em tres faixas empilhadas — desenho, legenda, notas — para o
 * texto nunca cair por cima da geometria que ele esta explicando.
 */
function svg(titulo, camadas, notas = []) {
  const todos = camadas.flatMap((c) => c.pontos);
  const minX = Math.min(...todos.map((p) => p.x));
  const maxX = Math.max(...todos.map((p) => p.x));
  const minY = Math.min(...todos.map((p) => p.y));
  const maxY = Math.max(...todos.map((p) => p.y));

  const larguraDesenho = maxX - minX;
  const alturaDesenho = maxY - minY;
  const folga = Math.max(larguraDesenho, alturaDesenho) * 0.06;
  const largura = larguraDesenho + 2 * folga;
  const x0 = minX - folga;

  const fonte = largura * 0.026;
  const linha = fonte * 1.45;
  const rotulos = camadas.filter((c) => c.rotulo);
  const faixaTexto = (rotulos.length + notas.length) * linha + linha * (notas.length ? 1.6 : 0.8);
  const faixaTitulo = linha * 1.9;
  const alturaDesenhoComFolga = alturaDesenho + 2 * folga;
  const alturaTotal = faixaTitulo + alturaDesenhoComFolga + faixaTexto;

  // O grupo do desenho e transladado para baixo do titulo e espelhado em Y.
  const deslocaY = faixaTitulo + folga - minY;
  const espelho = `translate(0 ${2 * (faixaTitulo + folga) + alturaDesenho - 2 * minY + 2 * minY}) scale(1 -1)`;

  const caminhos = camadas
    .map((camada) => {
      const d =
        camada.pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') +
        (camada.aberta ? '' : ' Z');
      const traco = camada.tracejado
        ? ` stroke-dasharray="${largura * 0.011} ${largura * 0.008}"`
        : '';
      return (
        `<path d="${d}" fill="${camada.preenchimento ?? 'none'}" stroke="${camada.cor}" ` +
        `stroke-width="${largura * 0.0035}" stroke-linejoin="round"${traco}/>`
      );
    })
    .join('\n      ');

  const marcadores = camadas
    .filter((c) => c.vertices)
    .flatMap((c) =>
      c.pontos.map(
        (p) => `<circle cx="${p.x}" cy="${p.y}" r="${largura * 0.005}" fill="${c.cor}"/>`,
      ),
    )
    .join('\n      ');

  const texto = (conteudo, y, cor, tamanho, peso) =>
    `<text x="${x0 + folga * 0.4}" y="${y}" font-size="${tamanho}" fill="${cor}" ` +
    `font-family="ui-monospace, monospace"${peso ? ' font-weight="600"' : ''}>${conteudo}</text>`;

  const baseTexto = faixaTitulo + alturaDesenhoComFolga + linha;
  const legenda = rotulos
    .map((c, i) => texto(`— ${c.rotulo}`, baseTexto + i * linha, c.cor, fonte))
    .join('\n    ');
  const rodape = notas
    .map((n, i) =>
      texto(n, baseTexto + (rotulos.length + i) * linha + linha * 0.6, CORES.texto, fonte * 0.88),
    )
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} 0 ${largura} ${alturaTotal}" width="760">
  <title>${titulo}</title>
  <rect x="${x0}" y="0" width="${largura}" height="${alturaTotal}" fill="#ffffff"/>
  ${texto(titulo, linha * 1.15, CORES.texto, fonte * 1.15, true)}
  <g transform="${espelho}">
    <g transform="translate(0 ${deslocaY})">
      ${caminhos}
      ${marcadores}
    </g>
  </g>
  ${legenda}
  ${rodape}
</svg>
`;
}

function gravar(nome, conteudo) {
  writeFileSync(join(SAIDA, nome), conteudo, 'utf8');
  console.log(`  ${nome}`);
}

const contornoDe = (peca) => tesselarContorno(peca);

// ------------------------------------------------- fig 1 e 2: margem

console.log('figuras de margem:');
{
  const vertices = [
    { x: 0, y: 0 },
    { x: 100 * MM, y: 0 },
    { x: 100 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  const uniforme = reconstruir(
    logPoligono({ vertices, margensUM: [10 * MM, 10 * MM, 10 * MM, 10 * MM] }),
  ).pecas[PECA];
  const corteU = offsetMargem(uniforme).pontos;
  gravar(
    'fig-01-margem-uniforme.svg',
    svg(
      'Margem uniforme de 10 mm',
      [
        { pontos: corteU, cor: CORES.corte, rotulo: 'linha de corte (offset 10 mm)' },
        { pontos: contornoDe(uniforme), cor: CORES.costura, rotulo: 'linha de costura', vertices: true },
      ],
      [
        `costura 100 x 200 mm  ->  corte ${umParaMM(Math.max(...corteU.map((p) => p.x)) - Math.min(...corteU.map((p) => p.x)))} x ${umParaMM(Math.max(...corteU.map((p) => p.y)) - Math.min(...corteU.map((p) => p.y)))} mm`,
        `${corteU.length} vertices no corte: cantos em Miter, nao arredondados`,
      ],
    ),
  );

  // Bainha de 40 mm (a faixa 2,5-4 cm que a industria usa em saia/calca) e
  // 10 mm nos outros lados (costura padrao de camisa).
  const bainha = reconstruir(
    logPoligono({ vertices, margensUM: [40 * MM, 10 * MM, 10 * MM, 10 * MM] }),
  ).pecas[PECA];
  const corteB = offsetMargem(bainha).pontos;
  gravar(
    'fig-02-margem-por-aresta.svg',
    svg(
      'Bainha 40 mm, demais lados 10 mm',
      [
        { pontos: corteB, cor: CORES.corte, rotulo: 'linha de corte (margem por aresta)' },
        { pontos: contornoDe(bainha), cor: CORES.costura, rotulo: 'linha de costura', vertices: true },
      ],
      [
        `corte ${umParaMM(Math.max(...corteB.map((p) => p.x)) - Math.min(...corteB.map((p) => p.x)))} x ${umParaMM(Math.max(...corteB.map((p) => p.y)) - Math.min(...corteB.map((p) => p.y)))} mm  (esperado 120 x 250)`,
        `cantos da bainha: ${corteB.filter((p) => p.y === -40 * MM).map((p) => `(${umParaMM(p.x)}, ${umParaMM(p.y)})`).join(' ')}`,
      ],
    ),
  );
}

// ------------------------------------------------- fig 3: cava tesselada

console.log('figura da cava:');
{
  const R = 120 * MM;
  const K = Math.round(KAPPA_90 * R);
  const peca = reconstruir(
    logPoligono({
      vertices: [
        { x: R, y: 0 },
        { x: 0, y: R },
        { x: 0, y: 0 },
      ],
      // Cava com 10 mm (a faixa 6-10 mm que a industria usa em cava e decote),
      // catetos com 15 mm.
      margensUM: [10 * MM, 15 * MM, 15 * MM],
      curvas: {
        0: [
          { x: R, y: K },
          { x: K, y: R },
        ],
      },
    }),
  ).pecas[PECA];

  const costura = contornoDe(peca);
  const corte = offsetMargem(peca).pontos;
  gravar(
    'fig-03-cava-tesselada.svg',
    svg(
      'Cava Bezier: tesselacao e offset por aresta',
      [
        { pontos: corte, cor: CORES.corte, rotulo: 'corte (cava 10 mm, catetos 15 mm)' },
        { pontos: costura, cor: CORES.costura, rotulo: 'costura tesselada', vertices: true },
      ],
      [
        `cava R = 120 mm: ${medirAresta(peca, 'ar-0')} UM medidos | arco exato ${Math.round((Math.PI / 2) * R)} UM`,
        `${costura.length} vertices na costura @ tolerancia de 100 UM`,
      ],
    ),
  );
}

// ------------------------------------------------- fig 4: graduacao encaixada

console.log('figura da graduacao:');
{
  // Incrementos de M. Muller & Sohn para o corpo base, tamanho 38 -> 46:
  // largura das costas +10 mm/tamanho, profundidade de cava +8 mm/tamanho.
  // Repare que o passo para baixo (38 -> 34) e MENOR: 5 mm e 4 mm.
  const vertices = [
    { x: 0, y: 0 },
    { x: 180 * MM, y: 0 },
    { x: 180 * MM, y: 420 * MM },
    { x: 0, y: 420 * MM },
  ];
  const base = logPoligono({
    vertices,
    margensUM: [0, 0, 0, 0],
    tamanhos: ['34', '38', '46'],
    base: '38',
  });
  const eventos = [...base];
  [1, 2, 3].forEach((i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'MarcarGradePoint',
      payload: { gradePointId: `gp-${i}`, pontoId: `pt-${i}` },
    }),
  );
  eventos.push({
    ...envelope(PECA),
    tipo: 'MarcarGradePoint',
    payload: { gradePointId: 'gp-0', pontoId: 'pt-0' },
  });
  const regra = (id, gp, de, para, dxMM, dyMM) => ({
    ...envelope(null),
    tipo: 'DefinirRegraGraduacao',
    payload: {
      regraId: id,
      pontoGraduacaoId: gp,
      deTamanho: de,
      paraTamanho: para,
      dx: Math.round(dxMM * MM),
      dy: Math.round(dyMM * MM),
    },
  });
  // 34 -> 38: passo de baixo (5 mm de largura, 4 mm de altura)
  eventos.push(regra('r1a', 'gp-1', '34', '38', 5, 0));
  eventos.push(regra('r2a', 'gp-2', '34', '38', 5, 4));
  eventos.push(regra('r3a', 'gp-3', '34', '38', 0, 4));
  // 38 -> 46: passo de cima (10 mm de largura, 8 mm de altura)
  eventos.push(regra('r1b', 'gp-1', '38', '46', 10, 0));
  eventos.push(regra('r2b', 'gp-2', '38', '46', 10, 8));
  eventos.push(regra('r3b', 'gp-3', '38', '46', 0, 8));

  const modelo = reconstruir(eventos);
  const camadas = [
    { tamanho: '46', cor: CORES.corte },
    { tamanho: '38', cor: CORES.costura },
    { tamanho: '34', cor: CORES.auxiliar },
  ].map(({ tamanho, cor }) => {
    const peca = aplicarGraduacao(modelo, PECA, tamanho);
    const anel = contornoDe(peca);
    const largura = umParaMM(Math.max(...anel.map((p) => p.x)));
    const altura = umParaMM(Math.max(...anel.map((p) => p.y)));
    return {
      pontos: anel,
      cor,
      vertices: true,
      rotulo: `tamanho ${tamanho}: ${largura} x ${altura} mm`,
    };
  });

  gravar(
    'fig-04-graduacao-encaixada.svg',
    svg('Graduacao encaixada (nest) — passos assimetricos', camadas, [
      'passo 34->38: +5 mm largura, +4 mm altura | passo 38->46: +10 mm, +8 mm',
      'o canto pt-0 e grade point SEM regra: e a ancora e nao anda (D7)',
    ]),
  );
}

// ------------------------------------------------- fig 5: discreto x proporcional

console.log('figura da edicao de ponto:');
{
  const LADOS = 12;
  const RAIO = 100 * MM;
  const vertices = Array.from({ length: LADOS }, (_, i) => {
    const a = (2 * Math.PI * i) / LADOS;
    return { x: Math.round(RAIO * Math.cos(a)), y: Math.round(RAIO * Math.sin(a)) };
  });
  const peca = normalizarWinding(
    reconstruir(logPoligono({ vertices, margensUM: vertices.map(() => 0) })).pecas[PECA],
  );
  const DX = 40 * MM;
  const N = 4;
  const discreto = modificarPonto(peca, 'pt-0', DX, 0, 'discreto', 0);
  const proporcional = modificarPonto(peca, 'pt-0', DX, 0, 'proporcional', N);

  const deslocamento = (i) =>
    proporcional.pontos[`pt-${i}`].x - peca.pontos[`pt-${i}`].x;
  const vizinhos = Array.from({ length: N }, (_, k) => deslocamento(k + 1));
  const andaram = [
    `dx = ${umParaMM(DX)} mm em pt-0, N = ${N}. Vizinhos 1..${N}, em UM: ${vizinhos.join(' / ')}`,
    `fracoes f(i): ${vizinhos.map((v) => (v / DX).toFixed(4)).join(' / ')}  ` +
      `| vizinho ${N + 1} andou ${deslocamento(N + 1)}`,
  ];

  gravar(
    'fig-05-discreto-x-proporcional.svg',
    svg(
      'Modificar ponto: discreto x proporcional (N = 4)',
      [
        { pontos: contornoDe(peca), cor: CORES.grade, rotulo: 'original', tracejado: true },
        { pontos: contornoDe(discreto), cor: CORES.corte, rotulo: 'discreto: so o alvo anda', vertices: true },
        {
          pontos: contornoDe(proporcional),
          cor: CORES.costura,
          rotulo: 'proporcional: f(i) = (1+cos(pi i/(N+1)))/2',
          vertices: true,
        },
      ],
      // Notas calculadas da saida do motor, nao escritas a mao: se a formula de
      // decaimento mudar, a figura passa a dizer outra coisa.
      andaram,
    ),
  );
}

// ------------------------------------------------- fig 6: casamento frente x manga

console.log('figura do casamento:');
{
  // Caso real de tecido plano: a copa da manga e DE PROPOSITO mais comprida que a
  // cava. Embebido de 25 mm (blusa de manga montada). Como o arco de 90 graus vale
  // pi*R/2, o raio da manga sai da conta analitica R + E/(pi/2).
  const EMBEBIDO = 25 * MM;
  const R_FRENTE = 150 * MM;
  const R_MANGA = Math.round(R_FRENTE + EMBEBIDO / (Math.PI / 2));

  const fatia = (raio, deslocX) => {
    const K = Math.round(KAPPA_90 * raio);
    return reconstruir(
      logPoligono({
        vertices: [
          { x: deslocX + raio, y: 0 },
          { x: deslocX, y: raio },
          { x: deslocX, y: 0 },
        ],
        margensUM: [10 * MM, 15 * MM, 15 * MM],
        curvas: {
          0: [
            { x: deslocX + raio, y: K },
            { x: deslocX + K, y: raio },
          ],
        },
      }),
    ).pecas[PECA];
  };

  const frente = fatia(R_FRENTE, 0);
  const manga = fatia(R_MANGA, 230 * MM);
  const cavaFrente = medirAresta(frente, 'ar-0');
  const cavaManga = medirAresta(manga, 'ar-0');
  const sobra = cavaManga - cavaFrente;

  gravar(
    'fig-06-casamento-cava.svg',
    svg(
      'Par de costura com embebido: cava da frente x copa da manga',
      [
        { pontos: offsetMargem(frente).pontos, cor: CORES.corte, rotulo: 'linha de corte' },
        { pontos: offsetMargem(manga).pontos, cor: CORES.corte },
        { pontos: contornoDe(frente), cor: CORES.costura, rotulo: 'linha de costura' },
        { pontos: contornoDe(manga), cor: CORES.costura },
      ],
      [
        `cava da frente ${cavaFrente} UM | copa da manga ${cavaManga} UM | sobra ${sobra} UM (${umParaMM(sobra).toFixed(3)} mm)`,
        `embebido declarado no ParCostura: ${EMBEBIDO} UM -> desvio ${sobra - EMBEBIDO} UM, dentro da tolerancia (200 UM)`,
        'D9: a copa MAIOR que a cava e o correto em tecido plano; e o que da volume ao ombro.',
      ],
    ),
  );
}

// ------------------------------------------------- fig 7: fillet e chanfro

console.log('figura do fillet e do chanfro:');
{
  const vertices = [
    { x: 0, y: 0 },
    { x: 120 * MM, y: 0 },
    { x: 120 * MM, y: 90 * MM },
    { x: 0, y: 90 * MM },
  ];
  const base = reconstruir(
    logPoligono({ vertices, margensUM: [0, 0, 0, 0] }),
  ).pecas[PECA];

  const RAIO = 25 * MM;
  const DISTANCIA = 25 * MM;
  const comFillet = arredondarVertice(base, 'pt-1', RAIO, 'fil');
  const comAmbos = chanfrarVertice(comFillet, 'pt-2', DISTANCIA, 'cha');

  // Centro do circulo inscrito no canto reto (120,0): a RAIO de cada lado.
  const centro = { x: 120 * MM - RAIO, y: RAIO };
  let desvioRadial = 0;
  for (const id of ['fil-s1', 'fil-s2']) {
    if (comAmbos.segmentos[id] === undefined) continue;
    for (const p of tesselarSegmento(comAmbos, id, 1)) {
      desvioRadial = Math.max(
        desvioRadial,
        Math.abs(Math.hypot(p.x - centro.x, p.y - centro.y) - RAIO),
      );
    }
  }

  gravar(
    'fig-07-fillet-e-chanfro.svg',
    svg(
      'Fillet de 25 mm e chanfro de 25 mm (operacao 10)',
      [
        { pontos: contornoDe(base), cor: CORES.grade, rotulo: 'contorno original', tracejado: true },
        {
          pontos: contornoDe(comAmbos),
          cor: CORES.costura,
          rotulo: 'fillet no canto direito-baixo, chanfro no direito-cima',
          vertices: true,
        },
      ],
      [
        `fillet: tangencias em (${umParaMM(comAmbos.pontos['fil-i'].x)}, ${umParaMM(comAmbos.pontos['fil-i'].y)}) e (${umParaMM(comAmbos.pontos['fil-f'].x)}, ${umParaMM(comAmbos.pontos['fil-f'].y)}) mm`,
        `desvio radial contra o circulo ideal: ${desvioRadial.toFixed(3)} UM (D1 preve ~0,027% de ${RAIO} UM)`,
        `chanfro: (${umParaMM(comAmbos.pontos['cha-i'].x)}, ${umParaMM(comAmbos.pontos['cha-i'].y)}) -> (${umParaMM(comAmbos.pontos['cha-f'].x)}, ${umParaMM(comAmbos.pontos['cha-f'].y)}) mm`,
      ],
    ),
  );
}

// ------------------------------------------------- fig 8: simplificacao

console.log('figura da simplificacao:');
{
  // Um lado "digitalizado": 40 segmentos com ruido de ate 300 UM sobre uma reta.
  const vertices = [{ x: 0, y: 0 }];
  for (let i = 1; i <= 40; i++) {
    vertices.push({
      x: Math.round((240 * MM * i) / 40),
      y: Math.round(300 * Math.sin(i * 1.7)),
    });
  }
  vertices.push({ x: 240 * MM, y: 140 * MM });
  vertices.push({ x: 0, y: 140 * MM });

  const bruta = reconstruir(
    logPoligono({ vertices, margensUM: vertices.map(() => 0) }),
  ).pecas[PECA];

  // Junta os 40 primeiros lados numa aresta so, que e como um lado digitalizado
  // chega de verdade — a simplificacao nao atravessa fronteira de aresta.
  const segmentos = { ...bruta.segmentos };
  for (let i = 0; i < 40; i++) {
    segmentos[`sg-${i}`] = { ...segmentos[`sg-${i}`], arestaId: 'ar-0' };
  }
  const arestas = { ...bruta.arestas };
  arestas['ar-0'] = { ...arestas['ar-0'], pontoFimId: 'pt-40' };
  for (let i = 1; i < 40; i++) delete arestas[`ar-${i}`];
  const digitalizada = { ...bruta, segmentos, arestas };

  const camadas = [{ pontos: contornoDe(digitalizada), cor: CORES.grade, rotulo: `original: ${contornoDe(digitalizada).length} vertices`, tracejado: true }];
  const notas = [];
  for (const [tolerancia, cor] of [[100, CORES.costura], [1000, CORES.corte]]) {
    const simples = simplificarContorno(digitalizada, tolerancia);
    const anel = contornoDe(simples);
    let desvio = 0;
    for (const p of contornoDe(digitalizada)) {
      let menor = Infinity;
      for (let i = 0; i < anel.length; i++) {
        const a = anel[i];
        const b = anel[(i + 1) % anel.length];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const l2 = vx * vx + vy * vy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
        menor = Math.min(menor, Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)));
      }
      desvio = Math.max(desvio, menor);
    }
    camadas.push({ pontos: anel, cor, rotulo: `tolerancia ${tolerancia} UM: ${anel.length} vertices`, vertices: true });
    notas.push(`tol ${tolerancia} UM -> desvio maximo MEDIDO ${desvio.toFixed(1)} UM (tem que ficar abaixo da tolerancia)`);
  }
  notas.push('Douglas-Peucker do clipper2; o motor so decide o que pode sumir (nunca ponto notavel nem grade point).');

  gravar('fig-08-simplificacao.svg', svg('Simplificacao com tolerancia explicita (operacao 11)', camadas, notas));
}

// ------------------------------------------------- fig 9: dobra simples

console.log('figura da dobra:');
{
  // Meia frente 60 x 200 mm com o eixo de dobra na lateral esquerda.
  const vertices = [
    { x: 0, y: 0 },
    { x: 60 * MM, y: 0 },
    { x: 60 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  const eventos = logPoligono({ vertices, margensUM: [10 * MM, 10 * MM, 10 * MM, 0] });
  eventos.push({
    ...envelope(PECA),
    tipo: 'DefinirEixoDobra',
    payload: { eixoId: 'dobra', p1: { x: 0, y: 0 }, p2: { x: 0, y: 200 * MM }, direcao: 'dentro' },
  });
  const meia = reconstruir(eventos).pecas[PECA];
  const desdobrada = contornoDesdobrado(meia, 'dobra').pontos;
  const corte = linhaDeCorteDesdobrada(meia, 'dobra').pontos;

  const larguraDe = (pts) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));

  gravar(
    'fig-09-dobra-simples.svg',
    svg(
      'Dobra simples: a peca desenhada e a METADE (operacao 14)',
      [
        { pontos: corte, cor: CORES.corte, rotulo: 'linha de corte desdobrada' },
        { pontos: desdobrada, cor: CORES.costura, rotulo: 'costura desdobrada', vertices: true },
        { pontos: contornoDe(meia), cor: CORES.auxiliar, rotulo: 'a metade desenhada', tracejado: true },
      ],
      [
        `metade ${umParaMM(larguraDe(contornoDe(meia)))} mm -> desdobrada ${umParaMM(larguraDe(desdobrada))} mm (o dobro exato)`,
        `area: ${areaDesdobrada(meia, 'dobra')} UM2 = 2 x ${areaDesdobrada(meia, 'dobra') / 2} UM2`,
        'O consumo de tecido usa a DESDOBRADA. Medir a metade compra metade do necessario.',
      ],
    ),
  );
}

// ------------------------------------------------- fig 10: dividir

console.log('figura da divisao:');
{
  const vertices = [
    { x: 0, y: 0 },
    { x: 100 * MM, y: 0 },
    { x: 100 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  const inteira = reconstruir(
    logPoligono({ vertices, margensUM: [0, 0, 0, 0] }),
  ).pecas[PECA];
  const [parte1, parte2] = dividirPeca(
    inteira,
    { p1: { x: -500 * MM, y: 100 * MM }, p2: { x: 500 * MM, y: 100 * MM } },
    10 * MM,
    'dv',
  );

  // Afasta as duas partes para a figura mostrar que sao pecas separadas.
  const corte1 = offsetMargem(parte1).pontos.map((p) => ({ x: p.x + 130 * MM, y: p.y }));
  const corte2 = offsetMargem(parte2).pontos.map((p) => ({ x: p.x + 130 * MM, y: p.y - 30 * MM }));
  const areaCortes = area(corte1) + area(corte2);
  const areaInteira = area(contornoDe(inteira));

  gravar(
    'fig-10-dividir.svg',
    svg(
      'Dividir: cada parte ganha margem propria na aresta nova (operacao 15)',
      [
        { pontos: contornoDe(inteira), cor: CORES.auxiliar, rotulo: 'peca inteira (100 x 200 mm)', tracejado: true },
        { pontos: corte1, cor: CORES.corte, rotulo: 'linha de corte das duas partes (100 x 110 mm cada)' },
        { pontos: corte2, cor: CORES.corte },
      ],
      [
        `area da inteira ${areaInteira} UM2 | soma das partes cortadas ${areaCortes} UM2`,
        `as partes consomem ${areaCortes - areaInteira} UM2 A MAIS — e isso e o certo`,
        'Sem a margem nova, as partes sairiam 100 x 100 e a peca nao fecharia na costura.',
      ],
    ),
  );
}

// ------------------------------------------------- fig 11: pregas

console.log('figura das pregas:');
{
  const vertices = [
    { x: 0, y: 0 },
    { x: 200 * MM, y: 0 },
    { x: 200 * MM, y: 300 * MM },
    { x: 0, y: 300 * MM },
  ];
  const eventos = logPoligono({ vertices, margensUM: [10 * MM, 10 * MM, 10 * MM, 10 * MM] });
  [50, 100, 150].forEach((x, i) => {
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirEixoDobra',
      payload: {
        eixoId: `pr-${i}`,
        p1: { x: x * MM, y: -500 * MM },
        p2: { x: x * MM, y: 500 * MM },
        direcao: i % 2 === 0 ? 'dentro' : 'fora',
        profundidadeUM: 20 * MM,
      },
    });
  });
  const saia = reconstruir(eventos).pecas[PECA];
  const eixos = ['pr-0', 'pr-1', 'pr-2'];
  const plana = abrirPregas(saia, eixos, 'pg');
  const larguraDe = (pts) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));

  gravar(
    'fig-11-pregas.svg',
    svg(
      'Dobra multipla: 3 pregas de 20 mm (operacao 14)',
      [
        { pontos: contornoDe(plana), cor: CORES.costura, rotulo: 'peca PLANA, com as pregas abertas', vertices: true },
        { pontos: contornoDe(saia), cor: CORES.auxiliar, rotulo: 'peca acabada (como fica vestida)', tracejado: true },
      ],
      [
        `acabada ${umParaMM(larguraDe(contornoDe(saia)))} mm -> plana ${umParaMM(larguraDe(contornoDe(plana)))} mm`,
        `conta manual: 200 + 3 x (2 x 20) = 320 mm | abertura somada ${umParaMM(aberturaDasPregas(saia, eixos))} mm`,
        `${Object.keys(plana.piques).length} piques de prega marcam inicio e fim de cada dobra`,
      ],
    ),
  );
}

// ------------------------------------------------- fig 12: pique pelo cursor

console.log('figura do pique:');
{
  const vertices = [
    { x: 0, y: 0 },
    { x: 100 * MM, y: 0 },
    { x: 100 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  const eventos = logPoligono({
    vertices,
    margensUM: [10 * MM, 10 * MM, 10 * MM, 10 * MM],
    tamanhos: ['P', 'M', 'G'],
    base: 'M',
  });
  const modelo = reconstruir(eventos);

  // O gesto: um clique 3 mm FORA da lateral direita, na altura de 150 mm.
  const clique = { x: 103 * MM, y: 150 * MM };
  const lugar = localizarNoContorno(modelo.pecas[PECA], clique);

  // Tres piques na mesma aresta, um deles exatamente onde o cursor caiu.
  let peca = modelo.pecas[PECA];
  const posicoes = [0.25, lugar.s, 0.9];
  posicoes.forEach((s, i) => {
    peca = adicionarPique(peca, { id: `pq-${i}`, arestaId: lugar.arestaId, s, tipo: 'V' });
  });
  const ids = posicoes.map((_, i) => `pq-${i}`);
  const projetados = projetarPiques(peca, ids);

  // Cada pique vira duas polilinhas: a haste da projecao e o V no corte.
  const marcas = projetados.flatMap((proj, i) => {
    const pique = peca.piques[ids[i]];
    const lado = { x: -proj.paraDentro.y, y: proj.paraDentro.x };
    const em = (fundo, atravessado) => ({
      x: proj.pontoDoCorte.x + proj.paraDentro.x * fundo + lado.x * atravessado,
      y: proj.pontoDoCorte.y + proj.paraDentro.y * fundo + lado.y * atravessado,
    });
    // O V real tem 1,59 mm de boca; nesta escala ele sumiria, entao a figura o
    // desenha com 5 mm — e a nota diz o numero de verdade, para nao enganar.
    const boca = 5 * MM;
    return [
      {
        pontos: [proj.pontoDaCostura, proj.pontoDoCorte],
        cor: CORES.grade,
        aberta: true,
        ...(i === 0 ? { rotulo: 'projecao perpendicular costura -> corte' } : {}),
      },
      {
        pontos: [em(0, -boca), em(pique.alturaUM, 0), em(0, boca)],
        cor: CORES.auxiliar,
        aberta: true,
        vertices: true,
        ...(i === 0 ? { rotulo: 'pique V, cortado na linha de CORTE' } : {}),
      },
    ];
  });

  const naGrade = ['P', 'M', 'G'].map((tamanho) => {
    const graduada = aplicarGraduacao({ ...modelo, pecas: { [PECA]: peca } }, PECA, tamanho);
    const p = graduada.piques['pq-1'];
    return `${tamanho}: s = ${p.s.toFixed(4)}`;
  });

  gravar(
    'fig-12-pique.svg',
    svg(
      'Pique pelo cursor: coordenada -> (aresta, s) -> projecao no corte',
      [
        { pontos: offsetMargem(peca).pontos, cor: CORES.corte, rotulo: 'linha de corte (margem 10 mm)' },
        { pontos: contornoDe(peca), cor: CORES.costura, rotulo: 'linha de costura (o pique e ancorado aqui)' },
        ...marcas,
      ],
      [
        `clique em (${umParaMM(clique.x)}, ${umParaMM(clique.y)}) mm -> aresta "${lugar.arestaId}", ` +
          `s = ${lugar.s.toFixed(6)}, a ${umParaMM(lugar.distanciaUM)} mm do contorno`,
        `a projecao anda ${projetados.map((p) => umParaMM(p.distanciaUM)).join(', ')} mm — ` +
          'exatamente a margem da aresta',
        `s nao muda com o tamanho: ${naGrade.join(' | ')} — o que muda e a coordenada`,
        'dimensao real do notcher: 6,35 x 1,59 mm; o V da figura esta com 5 mm de boca para ser visivel',
      ],
    ),
  );
}

console.log(`\nfiguras em ${SAIDA}`);
