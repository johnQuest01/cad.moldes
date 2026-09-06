/**
 * Pinta cada regiao achada numa cor, por cima da foto.
 *
 * E a ferramenta de olhar: numero em tabela nao mostra DUAS pecas viraram uma,
 * nem um ima que abriu buraco na borda. A imagem mostra em um segundo.
 *
 * Papel que caiu FORA de toda regiao grande sai em BRANCO, de proposito: e o que
 * denuncia limiar apertado demais.
 *
 *   npm run regioes -w @cad/foto -- [foto.png]
 */
import { Jimp } from 'jimp';
import { segmentar, preencherBuracos, rotular } from '../src/index.js';

const j = await Jimp.read(process.argv[2] ?? 'tests/fixtures/parede-01.png');
const img = { largura: j.bitmap.width, altura: j.bitmap.height, dados: new Uint8ClampedArray(j.bitmap.data) };
const s = segmentar(img);
const cheia = preencherBuracos(s.papel, img.largura, img.altura);
const areaMinima = Math.round(img.largura * img.altura * 0.0005);
const { rotulos, regioes } = rotular(cheia, img.largura, img.altura, areaMinima);

const CORES = [
  [230,60,60],[60,180,80],[60,110,230],[230,180,40],[190,70,220],[40,200,200],
  [250,130,40],[150,220,60],[240,90,160],[110,110,240],[200,160,90],[80,220,140],
  [220,220,60],[160,60,60],[60,160,160],
];
const mapa = new Map(regioes.map((r, i) => [r.rotulo, CORES[i % CORES.length]]));

const saida = j.clone();
for (let i = 0; i < rotulos.length; i++) {
  const cor = mapa.get(rotulos[i]);
  const k = i * 4;
  if (cor) {
    saida.bitmap.data[k]   = Math.round(saida.bitmap.data[k]   * 0.25 + cor[0] * 0.75);
    saida.bitmap.data[k+1] = Math.round(saida.bitmap.data[k+1] * 0.25 + cor[1] * 0.75);
    saida.bitmap.data[k+2] = Math.round(saida.bitmap.data[k+2] * 0.25 + cor[2] * 0.75);
  } else if (s.papel[i] === 1) {
    // papel que caiu FORA de toda regiao grande: branco, para saltar aos olhos
    saida.bitmap.data[k] = 255; saida.bitmap.data[k+1] = 255; saida.bitmap.data[k+2] = 255;
  }
}
await saida.write('regioes.png');
console.log(`${regioes.length} regioes pintadas -> regioes.png`);
for (const [i, r] of regioes.entries()) {
  console.log(`${i+1}: rotulo ${r.rotulo} area ${r.area} caixa (${r.minX},${r.minY})-(${r.maxX},${r.maxY})`);
}
