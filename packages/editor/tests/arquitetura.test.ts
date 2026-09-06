/**
 * O guarda-costas da E3: PixiJS fica na borda.
 *
 * Este teste le os `import` de `@cad/editor` e falha se algum bater na lista
 * proibida. Sem ele, a primeira pressa poe um `document.querySelector` dentro de
 * uma ferramenta e a testabilidade do pacote acaba ali — em silencio, e so se
 * descobre quando alguem tenta rodar os testes e o Node nao tem DOM.
 *
 * Confere tambem a seta da dependencia: o motor nao pode importar o editor.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const EDITOR = join(AQUI, '..', 'src');
const MOTOR = join(AQUI, '..', '..', 'motor', 'src');

/** O que `@cad/editor` NAO pode importar nem tocar. */
const PROIBIDOS = [
  { nome: "import de 'pixi.js'", padrao: /from\s+['"]pixi\.js/ },
  { nome: "import de '@cad/editor-pixi'", padrao: /from\s+['"]@cad\/editor-pixi/ },
  { nome: 'uso de `document`', padrao: /\bdocument\s*\./ },
  { nome: 'uso de `window`', padrao: /\bwindow\s*\./ },
  { nome: 'uso de `navigator`', padrao: /\bnavigator\s*\./ },
  { nome: 'uso de `requestAnimationFrame`', padrao: /\brequestAnimationFrame\b/ },
] as const;

function arquivos(raiz: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(raiz)) {
    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho));
    else if (nome.endsWith('.ts')) achados.push(caminho);
  }
  return achados;
}

/** Tira comentarios: a regra e sobre CODIGO, e a prosa fala de Pixi o tempo todo. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('E3 — PixiJS e o DOM ficam na borda', () => {
  it('nenhum arquivo de @cad/editor toca no DOM nem no Pixi', () => {
    const fontes = arquivos(EDITOR);
    const violacoes: string[] = [];

    for (const caminho of fontes) {
      const codigo = semComentarios(readFileSync(caminho, 'utf8'));
      for (const { nome, padrao } of PROIBIDOS) {
        if (padrao.test(codigo)) violacoes.push(`${caminho.split(/[\\/]/).pop()}: ${nome}`);
      }
    }

    console.log('--- arquitetura ---');
    console.log(`${fontes.length} arquivos em @cad/editor conferidos contra ${PROIBIDOS.length} proibicoes`);
    console.log(`violacoes: ${violacoes.length === 0 ? 'nenhuma' : violacoes.join(' | ')}`);
    expect(violacoes).toEqual([]);
    expect(fontes.length).toBeGreaterThan(0);
  });

  it('a seta so aponta para baixo: o motor nao conhece o editor', () => {
    const violacoes = arquivos(MOTOR).filter((caminho) =>
      /from\s+['"]@cad\/(editor|persistencia|api)/.test(semComentarios(readFileSync(caminho, 'utf8'))),
    );
    console.log(`arquivos do motor importando camada de cima: ${violacoes.length}`);
    expect(violacoes).toEqual([]);
  });

  it('o pacote so declara @cad/motor como dependencia de producao', () => {
    const pacote = JSON.parse(
      readFileSync(join(AQUI, '..', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const deps = Object.keys(pacote.dependencies);
    console.log(`dependencies: ${deps.join(', ')}`);
    expect(deps).toEqual(['@cad/motor']);
  });
});
