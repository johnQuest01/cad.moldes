/**
 * Fase 6 — a foto vira EVENTOS, e os eventos viram modelo.
 *
 * O teste que fecha a fase: os eventos passam pelo `reconstruir` do motor e saem
 * peças de verdade. Se algo estiver inconsistente — aresta órfã, segmento apontando
 * para ponto que não existe, contorno que não fecha —, o fold recusa, e é
 * exatamente o que se quer que aconteça.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';
import { describe, expect, it } from 'vitest';

import {
  MM,
  anelDoContorno,
  area,
  areaComSinal,
  conferirModelo,
  criarGeradorMonotonico,
  offsetMargem,
  reconstruir,
} from '@cad/motor';

import {
  aspectoDetectado,
  detectarQuadro,
  digitalizar,
  somaDaImagem,
  type Calibracao,
  type Imagem,
} from '../src/index.js';

const CAMINHO = fileURLToPath(new URL('./fixtures/parede-01.png', import.meta.url));

async function carregar(): Promise<Imagem> {
  const jimp = await Jimp.read(readFileSync(CAMINHO));
  return {
    largura: jimp.bitmap.width,
    altura: jimp.bitmap.height,
    dados: new Uint8ClampedArray(jimp.bitmap.data),
  };
}

/** Calibração PROVISÓRIA, coerente com a proporção medida na foto (ver I14). */
async function calibracaoProvisoria(): Promise<Calibracao> {
  const img = await carregar();
  const aspecto = aspectoDetectado(detectarQuadro(img).cantos)!;
  const larguraUM = 1380 * MM;
  const alturaUM = Math.round(larguraUM / aspecto);
  return {
    id: 'cal-provisoria',
    tenantId: 'confeccao-a',
    nome: 'quadro do ateliê (provisório)',
    larguraUM,
    alturaUM,
    diagonal1UM: Math.round(Math.hypot(larguraUM, alturaUM)),
    diagonal2UM: Math.round(Math.hypot(larguraUM, alturaUM)),
  };
}

const opcoesBase = (calibracao: Calibracao) => ({
  tenantId: 'confeccao-a',
  modeloId: 'mod-foto',
  autor: 'teste',
  gerarId: criarGeradorMonotonico(),
  agora: (): string => '2026-09-06T21:00:00.000Z',
  calibracao,
});

describe('A foto vira modelo', () => {
  it('os eventos reconstroem um modelo com as onze peças', async () => {
    const img = await carregar();
    const d = digitalizar(img, opcoesBase(await calibracaoProvisoria()));

    console.log('--- foto -> eventos -> modelo ---');
    console.log(
      `${d.eventos.length} eventos | ${d.pecas.length} pecas | ` +
        `${(d.umPorPixel / MM).toFixed(3)} mm por pixel | ` +
        `tolerancia ${(d.toleranciaUM / MM).toFixed(2)} mm`,
    );
    console.log(
      `quadro: ${d.marcasDoQuadro} marcas, residuo ${(d.residuoDoQuadroUM / MM).toFixed(2)} mm`,
    );

    const modelo = reconstruir([...d.eventos]);
    const pecas = Object.values(modelo.pecas);

    console.log('');
    console.log('peca                largura   altura   perimetro   pts   retas   curvas   piques');
    for (const p of d.pecas) {
      console.log(
        `${p.nome.padEnd(18)}  ` +
          `${(p.larguraUM / MM).toFixed(0).padStart(7)}   ` +
          `${(p.alturaUM / MM).toFixed(0).padStart(6)}   ` +
          `${(p.perimetroUM / MM).toFixed(0).padStart(9)}   ` +
          `${String(p.pontos).padStart(3)}   ` +
          `${String(p.retas).padStart(5)}   ` +
          `${String(p.curvas).padStart(6)}   ` +
          `${String(p.piques).padStart(6)}`,
      );
    }

    expect(pecas).toHaveLength(11);
    expect(d.pecas).toHaveLength(11);
    // Toda peça reconstruída tem contorno fechado e área positiva (CCW, D9).
    for (const peca of pecas) {
      const anel = anelDoContorno(peca);
      expect(anel.length).toBeGreaterThanOrEqual(3);
      // areaComSinal, e nao area: a absoluta e positiva ate em CW, e o teste
      // passaria com o contorno no sentido errado — que foi o que aconteceu.
      expect(areaComSinal(anel)).toBeGreaterThan(0);
    }
  });

  it('as peças passam pela conferência do motor', async () => {
    const img = await carregar();
    const d = digitalizar(img, opcoesBase(await calibracaoProvisoria()));
    const modelo = reconstruir([...d.eventos]);
    const doModelo = conferirModelo(modelo);
    const erros = doModelo.filter((p) => p.gravidade === 'erro');
    console.log(
      `conferencia do modelo: ${erros.length} erro(s), ${doModelo.length - erros.length} aviso(s)`,
    );
    for (const p of doModelo.slice(0, 3)) console.log(`  ${p.gravidade}: ${p.codigo}`);
    expect(erros).toHaveLength(0);
  });

  it('a linha de CORTE sai de todas as peças, com margem zero igual ao contorno', async () => {
    const img = await carregar();
    const d = digitalizar(img, opcoesBase(await calibracaoProvisoria()));
    const modelo = reconstruir([...d.eventos]);
    let iguais = 0;
    for (const peca of Object.values(modelo.pecas)) {
      const contorno = Math.abs(area(anelDoContorno(peca)));
      const corte = Math.abs(area(offsetMargem(peca).pontos));
      // Margem zero (I4): corte e contorno têm que dar a mesma área.
      if (Math.abs(corte - contorno) / contorno < 0.001) iguais++;
    }
    console.log(`${iguais} de ${Object.values(modelo.pecas).length} pecas com corte = contorno`);
    expect(iguais).toBe(Object.values(modelo.pecas).length);
  });

  it('avisa que a margem entrou ZERO e que a resolução não dá piques', async () => {
    const img = await carregar();
    const d = digitalizar(img, opcoesBase(await calibracaoProvisoria()));
    const codigos = d.problemas.map((p) => p.codigo);
    console.log('--- os avisos ---');
    for (const p of d.problemas) console.log(`${p.gravidade} ${p.codigo}: ${p.mensagem}`);
    expect(codigos).toContain('MARGEM_AUSENTE');
    expect(codigos).toContain('RESOLUCAO_BAIXA');
    expect(d.problemas.every((p) => p.gravidade === 'aviso')).toBe(true);
  });

  it('nomear as peças funciona, e o que faltar vira "Peça N"', async () => {
    const img = await carregar();
    const d = digitalizar(img, {
      ...opcoesBase(await calibracaoProvisoria()),
      nomes: ['FRENTE', 'COSTAS', 'MANGA'],
    });
    console.log(`nomes: ${d.pecas.map((p) => p.nome).join(', ')}`);
    expect(d.pecas[0]!.nome).toBe('FRENTE');
    expect(d.pecas[3]!.nome).toBe('Peça 4');
  });
});

describe('A digitalização RECUSA, em vez de entregar molde errado', () => {
  it('calibração com o rótulo "138 × 72 cm" não produz peça nenhuma', async () => {
    const img = await carregar();
    const rotulo: Calibracao = {
      id: 'cal-rotulo',
      tenantId: 'confeccao-a',
      nome: 'rótulo da foto',
      larguraUM: 1380 * MM,
      alturaUM: 720 * MM,
      diagonal1UM: Math.round(Math.hypot(1380 * MM, 720 * MM)),
      diagonal2UM: Math.round(Math.hypot(1380 * MM, 720 * MM)),
    };
    const d = digitalizar(img, opcoesBase(rotulo));
    console.log('--- a recusa ---');
    console.log(`${d.eventos.length} eventos, ${d.pecas.length} pecas`);
    console.log(`erro: ${d.problemas[0]?.mensagem}`);
    expect(d.eventos).toHaveLength(0);
    expect(d.pecas).toHaveLength(0);
    expect(d.problemas.some((p) => p.gravidade === 'erro')).toBe(true);
  });

  it('calibração que não fecha nas diagonais é recusada antes de olhar a foto', async () => {
    const img = await carregar();
    const torta = { ...(await calibracaoProvisoria()), diagonal2UM: 1 };
    const d = digitalizar(img, opcoesBase(torta));
    console.log(`diagonal absurda -> ${d.problemas[0]?.codigo}, ${d.eventos.length} eventos`);
    expect(d.eventos).toHaveLength(0);
  });

  it('foto sem quadro nenhum é recusada', async () => {
    const cinza = new Uint8ClampedArray(200 * 200 * 4).fill(60);
    const d = digitalizar({ largura: 200, altura: 200, dados: cinza }, opcoesBase(await calibracaoProvisoria()));
    console.log(`imagem cinza sem quadro -> ${d.problemas[0]?.codigo}`);
    expect(d.eventos).toHaveLength(0);
    expect(d.problemas[0]?.codigo).toBe('MARCAS_INSUFICIENTES');
  });
});

describe('Procedência', () => {
  it('o log guarda de que foto e de que calibração o molde veio', async () => {
    const img = await carregar();
    const d = digitalizar(img, opcoesBase(await calibracaoProvisoria()));
    const procedencia = d.eventos.find((e) => e.tipo === 'DigitalizarPorFoto');
    console.log('--- procedencia no log ---');
    console.log(JSON.stringify(procedencia?.payload, null, 2));
    expect(procedencia).toBeDefined();
    // A soma identifica a foto: a mesma imagem dá a mesma soma, sempre.
    expect(somaDaImagem(img)).toBe(somaDaImagem(await carregar()));
  });

  it('o evento de procedência não muda o estado — é registro, não operação', async () => {
    const img = await carregar();
    const d = digitalizar(img, opcoesBase(await calibracaoProvisoria()));
    const comProcedencia = reconstruir([...d.eventos]);
    const semProcedencia = reconstruir(d.eventos.filter((e) => e.tipo !== 'DigitalizarPorFoto'));
    console.log(
      `com procedencia: ${Object.keys(comProcedencia.pecas).length} pecas | ` +
        `sem: ${Object.keys(semProcedencia.pecas).length} pecas | ` +
        `estado identico: ${JSON.stringify(comProcedencia) === JSON.stringify(semProcedencia)}`,
    );
    expect(JSON.stringify(comProcedencia)).toBe(JSON.stringify(semProcedencia));
  });
});
