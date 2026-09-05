# FASE 2 · PARTE 5 — Como se testa um editor headless

> Cole junto com a Parte 0. Ao fim de **cada** bloco.

A regra da Fase 1 não muda: **todo teste é executado e o número é colado.** A dúvida legítima é
como isso se aplica a um editor, onde "funciona" parece querer dizer "eu abri e vi". A resposta é a
decisão E3: o comportamento mora em `@cad/editor`, que é TypeScript puro e roda no Node. O que
sobra de genuinamente visual é pouco, e está listado no fim.

---

## 1. O harness de ponteiro

O editor não recebe `PointerEvent`; recebe coordenadas. Então o teste dirige o editor como o mouse
dirigiria, em **UM**, sem navegador:

```ts
const editor = novoEditor({ log: logDaBlusa(), autor: 'teste', tenantId: 'confeccao-a' });
editor.ferramenta('mover');
editor.apontar({ x: 150 * MM, y: 430 * MM });
editor.arrastar({ x: 170 * MM, y: 440 * MM });
editor.soltar();

console.log(editor.sessao.pendentes.map((e) => e.tipo).join(', '));
expect(editor.sessao.pendentes).toHaveLength(1);
```

Um segundo harness dirige em **pixels**, passando pela câmera, para cobrir a conversão:

```ts
editor.camera.enquadrar(caixaDaPeca, 40);
editor.apontarEmPixels(412, 300);
```

Isso é o que torna testável a frase "arrastar o vértice do ombro em 20 mm move o ombro em 20 mm" —
que é o comportamento que interessa, e não o fato de um círculo ter sido desenhado.

## 2. O renderizador de teste

`@cad/editor` produz uma **cena** (lista de comandos); `@cad/editor-pixi` a pinta. O teste
implementa o mesmo `Pintor` gravando:

```ts
const pintor = new PintorDeTeste();
desenharCena(editor.cena(), pintor);

const marcas = pintor.comandos.filter((c) => c.camada === 'pique');
console.log(`pique desenhado em (${umParaMM(marcas[0].pontos[0].x)}, ...) mm`);
expect(marcas[0].camada).toBe('pique');
```

Dá para provar, sem pixel:
- que o pique é desenhado **na linha de corte**, e a que distância da costura;
- que o traço tem `width = espessuraPx × umPorPixel` (some com o zoom, ver teste 6 abaixo);
- que camada desligada **não emite comando**;
- que o texto vai para o overlay, nunca para o mundo espelhado (senão sairia invertido).

## 3. O teste de arquitetura

Um teste lê os `import` de `@cad/editor` e falha se algum bater na lista proibida
(`pixi.js`, `document`, `window`, `navigator`). É o guarda-costas da E3: sem ele, a primeira pressa
põe um `document.querySelector` dentro de uma ferramenta e a testabilidade acaba ali.

O mesmo teste confere que `@cad/motor` continua sem importar nada do editor — a seta só aponta para
baixo.

## 4. O que cada bloco tem que provar

| Bloco | Prova |
|---|---|
| 0 | Parte 2: os 11 eventos com replay determinístico, as 2 operações com número, o teste de exaustividade do fold, e `VERSAO_SCHEMA_ATUAL` ainda 1 num log antigo |
| 1 | `aplicar → desfazer → refazer` devolve o mesmo modelo **byte a byte**; `selar` torna o pendente vazio e o undo para no selo; o cache não é usado quando a versão muda, e é quando não muda (contador de chamadas) |
| 2 | Parte 3, testes 1–3: prioridade de hit-testing e de snap, e o `meio` por arco ≠ `t = 0.5` |
| 3 | Parte 3, teste 4: janela × cruzamento com contagem |
| 4 | Parte 4: 6 ferramentas × 3 testes + os particulares |
| 5 | Renderizador de teste: camadas, espessura, overlay, culling (peça fora da vista não gera comando) |
| 6 | Painéis: a ficha bate com `medirAresta` para cada aresta (comparação direta, não olhômetro) |
| 7 | Parte 4: 16 ferramentas × 3 + particulares |
| 8 | Salvar → `selar`; abrir → `conferirIntegridade` bate; offline → pendentes voltam iguais depois de um round-trip por IndexedDB |

## 5. Testes de propriedade (fast-check), como na Fase 1

Quatro que valem mais que dezenas de casos:

1. **Ida e volta de coordenada.** Para qualquer ponto e qualquer câmera válida,
   `paraMundo(paraTela(p))` erra no máximo 1 UM (o arredondamento).
2. **Zoom no cursor.** Para qualquer zoom e qualquer ponto de tela, o ponto do mundo sob o cursor
   não se move.
3. **Undo é involução.** Para qualquer sequência de N gestos válidos, N `desfazer` devolvem o
   modelo inicial **exatamente** (`JSON.stringify` canônico igual).
4. **Nenhum gesto recusado suja o documento.** Para qualquer gesto que o motor recuse,
   `sessao.versao` é a mesma antes e depois.

## 6. Um teste que precisa existir e é fácil de esquecer

**Espessura constante na tela.** Em três zooms diferentes, a mesma linha tem que sair com
`width × zoom` constante em pixels. Sem esse teste, a regressão aparece só na reclamação de quem
usa: "sumiu a linha de costura quando eu aproximei".

## 7. O que **não** dá para testar assim, e o que se faz

| Não testável headless | O que fica no lugar |
|---|---|
| Se o desenho está bonito | nada. É julgamento, e é do modelista |
| Antialiasing, nitidez em tela retina | `resolution: devicePixelRatio` fixado no código e uma nota; conferido no olho, uma vez |
| Desempenho real na GPU | um teste de orçamento: número de comandos de desenho por quadro num molde de 40 peças, com o número colado. Se passar do orçamento, é regressão |
| Sensação do arrasto (latência) | orçamento de tempo: um gesto completo (`apontar`→`arrastar`×20→`soltar`) numa peça real tem que caber em X ms no Node, com o número colado |

Os dois orçamentos numéricos são o que impede "ficou lento" de virar discussão de opinião.

## 8. CI

O workflow ganha os pacotes novos automaticamente (`npm test --workspaces`). Acrescentar:

```yaml
      - name: Editor (build da pagina)
        run: npm run app:build
```

pelo mesmo motivo que a demo entrou: se uma assinatura do motor mudar, tem que quebrar no CI, não
na mão de quem abrir o editor.
