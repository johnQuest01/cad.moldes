/**
 * ESTRESSE: rajada determinística de operações encadeadas.
 *
 * Teste unitário prova que cada operação funciona sozinha. O que quebra em
 * produção é a INTERAÇÃO: uma pence numa aresta que já foi redefinida numa peça
 * que já foi dimensionada, girada e espelhada. Aqui uma rajada de 150 operações
 * sorteadas (com semente FIXA — mesmo estresse em qualquer máquina, sempre)
 * encadeia tudo, e as invariantes do núcleo são cobradas depois de CADA passo:
 *
 *  - área positiva e winding CCW (D4);
 *  - o validador não acha erro;
 *  - a linha de corte continua saindo (offset não explode);
 *  - o LOG reconstrói o mesmo estado byte a byte no fim (o fold é puro).
 *
 * Recusa não é falha: operação sorteada que o motor recusa (pence em cima de
 * canto, fator fora da faixa) conta no placar e a rajada segue — é exatamente o
 * comportamento esperado na mão de um usuário real.
 */
import { describe, expect, it } from 'vitest';

import {
  ErroMotor,
  MM,
  abrirPence,
  anelDoContorno,
  area,
  areaComSinal,
  dimensionarPeca,
  espelharPeca,
  medirAresta,
  offsetMargem,
  reconstruir,
  redefinirComprimentoDaAresta,
  rotacionarPeca,
  transladarPeca,
  validarInconsistencias,
  type Evento,
  type Modelo,
  type Peca,
} from '../src/index.js';

/** PRNG determinístico (mulberry32): mesma semente, mesma rajada, sempre. */
function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENCAIXE = {
  quantidadePorModelo: 1,
  giro: '180' as const,
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

let n = 0;
const envelope = (pecaId: string | null) => ({
  id: `01STR${String(n++).padStart(6, '0')}`,
  tenantId: 't',
  modeloId: 'm',
  pecaId,
  timestamp: '2026-09-13T12:00:00.000Z',
  autor: 'estresse',
  versaoSchema: 1,
});

function eventosBase(): Evento[] {
  n = 0;
  const cantos = [
    { x: 0, y: 0 },
    { x: 500 * MM, y: 0 },
    { x: 500 * MM, y: 400 * MM },
    { x: 0, y: 400 * MM },
  ];
  const lista: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Estresse', tamanhos: ['M'], tamanhoBase: 'M' },
    } as Evento,
    { ...envelope('p'), tipo: 'CriarPeca', payload: { nome: 'COBAIA', encaixe: ENCAIXE } } as Evento,
  ];
  cantos.forEach((c, i) =>
    lista.push({
      ...envelope('p'),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    lista.push({
      ...envelope('p'),
      tipo: 'DefinirAresta',
      payload: { arestaId: `ar-${i}`, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    lista.push({
      ...envelope('p'),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % 4}`,
        ...(i === 1
          ? {
              tipo: 'curva',
              controles: [
                { x: 540 * MM, y: 130 * MM },
                { x: 540 * MM, y: 270 * MM },
              ],
            }
          : { tipo: 'reta' }),
      },
    } as Evento),
  );
  cantos.forEach((_, i) =>
    lista.push({
      ...envelope('p'),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM: 10 * MM },
    } as Evento),
  );
  return lista;
}

interface Placar {
  aceitas: Record<string, number>;
  recusadas: Record<string, number>;
}

let cortesPincados = 0;

/**
 * A linha divisoria das invariantes e a filosofia do motor:
 *  - o CONTORNO corrompido (winding, auto-intersecao) NUNCA pode acontecer —
 *    operacao que faria isso tem que recusar (a pence ganhou essa guarda
 *    exatamente porque esta rajada pegou o caso);
 *  - a LINHA DE CORTE derivada pode ficar inviavel (pence funda + margem
 *    larga belisca o offset) — igual a uma margem exagerada definida a mao.
 *    Ai o offset recusa com ErroMotor EXPLICITO e o validador aponta como
 *    lint; lixo silencioso e que seria falha.
 */
function conferirInvariantes(modelo: Modelo, peca: Peca, passo: number, op: string): void {
  const anel = anelDoContorno(peca);
  const a = areaComSinal(anel);
  if (!(a > 0)) {
    throw new Error(`passo ${passo} (${op}): area com sinal ${a} — winding quebrou`);
  }
  const erros = validarInconsistencias({ ...modelo, pecas: { p: peca } }, 'p').filter(
    (p) => p.gravidade === 'erro' && !p.codigo.startsWith('OFFSET_'),
  );
  if (erros.length > 0) {
    throw new Error(`passo ${passo} (${op}): validador acusou ${erros[0]!.codigo}`);
  }
  try {
    const corte = offsetMargem(peca);
    if (corte.pontos.length < 3) {
      throw new Error(`passo ${passo} (${op}): a linha de corte sumiu sem erro`);
    }
  } catch (e) {
    if (!(e instanceof ErroMotor)) throw e;
    cortesPincados++; // recusa explicita: comportamento certo, e contado
  }
}

describe('Rajada determinística de 150 operações', () => {
  it('nenhum passo corrompe a peça, e o log reconstrói o estado final', () => {
    const rnd = prng(20260913);
    const modelo = reconstruir(eventosBase());
    let peca = modelo.pecas['p']!;
    const eventosDaRajada: Evento[] = [];
    const placar: Placar = { aceitas: {}, recusadas: {} };
    const marcar = (lado: keyof Placar, op: string): void => {
      placar[lado][op] = (placar[lado][op] ?? 0) + 1;
    };

    const OPS = ['dimensionar', 'rotacionar', 'espelhar', 'transladar', 'pence', 'redefinir'];
    let pences = 0;

    for (let passo = 0; passo < 150; passo++) {
      const op = OPS[Math.floor(rnd() * OPS.length)]!;
      let aceitou = false;
      try {
        if (op === 'dimensionar') {
          const fx = 0.92 + rnd() * 0.16;
          const fy = 0.92 + rnd() * 0.16;
          peca = dimensionarPeca(peca, { x: 0, y: 0 }, fx, fy);
          eventosDaRajada.push({
            ...envelope('p'),
            tipo: 'DimensionarPeca',
            payload: { centro: { x: 0, y: 0 }, fatorX: fx, fatorY: fy },
          } as Evento);
        } else if (op === 'rotacionar') {
          const graus = Math.round((rnd() - 0.5) * 90);
          peca = rotacionarPeca(peca, { x: 0, y: 0 }, graus);
          eventosDaRajada.push({
            ...envelope('p'),
            tipo: 'RotacionarPeca',
            payload: { centro: { x: 0, y: 0 }, anguloGraus: graus },
          } as Evento);
        } else if (op === 'espelhar') {
          peca = espelharPeca(peca, { p1: { x: 0, y: 0 }, p2: { x: 0, y: 1000 } });
          eventosDaRajada.push({
            ...envelope('p'),
            tipo: 'EspelharPeca',
            payload: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 1000 } },
          } as Evento);
        } else if (op === 'transladar') {
          const dx = Math.round((rnd() - 0.5) * 100) * MM;
          const dy = Math.round((rnd() - 0.5) * 100) * MM;
          peca = transladarPeca(peca, dx, dy);
          eventosDaRajada.push({
            ...envelope('p'),
            tipo: 'TransladarPeca',
            payload: { dx, dy },
          } as Evento);
        } else if (op === 'pence') {
          const arestas = Object.keys(peca.arestas);
          const arestaId = arestas[Math.floor(rnd() * arestas.length)]!;
          const s = 0.15 + rnd() * 0.7;
          const abertura = Math.round(8 + rnd() * 25) * MM;
          const profundidade = Math.round(30 + rnd() * 80) * MM;
          const prefixo = `st${pences++}`;
          peca = abrirPence(peca, arestaId, s, abertura, profundidade, prefixo);
          eventosDaRajada.push({
            ...envelope('p'),
            tipo: 'AbrirPence',
            payload: { arestaId, s, aberturaUM: abertura, profundidadeUM: profundidade, prefixoId: prefixo },
          } as Evento);
        } else {
          const arestas = Object.keys(peca.arestas);
          const arestaId = arestas[Math.floor(rnd() * arestas.length)]!;
          const atual = medirAresta(peca, arestaId);
          const alvo = Math.round(atual * (0.9 + rnd() * 0.2));
          peca = redefinirComprimentoDaAresta(peca, arestaId, alvo);
          eventosDaRajada.push({
            ...envelope('p'),
            tipo: 'RedefinirAresta',
            payload: { arestaId, comprimentoUM: alvo },
          } as Evento);
        }
        aceitou = true;
        marcar('aceitas', op);
      } catch {
        // Recusa do MOTOR e comportamento certo; corrupcao nao e.
        marcar('recusadas', op);
      }
      // As invariantes ficam FORA do try: qualquer erro aqui e falha REAL,
      // com a mensagem original do motor na cara.
      if (aceitou) conferirInvariantes(modelo, peca, passo, op);
    }

    const totalAceitas = Object.values(placar.aceitas).reduce((s, v) => s + v, 0);
    const totalRecusadas = Object.values(placar.recusadas).reduce((s, v) => s + v, 0);
    console.log('--- rajada de 150 operacoes (semente 20260913) ---');
    console.log(
      `aceitas ${totalAceitas}: ` +
        Object.entries(placar.aceitas)
          .map(([k, v]) => `${k}=${v}`)
          .join(' '),
    );
    console.log(
      `recusadas ${totalRecusadas}: ` +
        (Object.entries(placar.recusadas)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ') || '(nenhuma)'),
    );
    console.log(`passos com a linha de corte recusada explicitamente: ${cortesPincados}`);
    console.log(
      `peca final: ${Object.keys(peca.pontos).length} pontos, ` +
        `${Object.keys(peca.arestas).length} arestas, area ${(area(anelDoContorno(peca)) / 1e8).toFixed(1)} cm2`,
    );

    expect(totalAceitas + totalRecusadas).toBe(150);
    expect(totalAceitas).toBeGreaterThan(100);

    // A prova final: o LOG da rajada reconstroi exatamente o estado da memoria.
    const doLog = reconstruir([...eventosBase(), ...eventosDaRajada]).pecas['p']!;
    const iguais = JSON.stringify(doLog) === JSON.stringify(peca);
    console.log(`log com ${eventosDaRajada.length} eventos reconstroi o estado: ${iguais ? 'IDENTICO' : 'DIFERENTE'}`);
    expect(iguais).toBe(true);
  }, 60_000);
});
