# FASE 2 · PARTE 1 — Arquitetura do editor

> Cole junto com a Parte 0.

## Os dois pacotes (E3)

```
@cad/motor        geometria pura            (Fase 1, 164 testes)
      ▲
      │ importa
@cad/editor       COMPORTAMENTO puro        ← sessão, câmera, snap, seleção, ferramentas
      ▲                                       sem DOM, sem Pixi, roda no Node
      │ importa
@cad/editor-pixi  RENDER e ENTRADA          ← PixiJS 8, camadas, overlay
      ▲
      │ importa
app/              a página                  ← painéis, menus, Vite, fala com @cad/api
```

A regra que faz isso valer alguma coisa: **`@cad/editor` não pode importar `pixi.js` nem tocar em
`document`**. Um teste de arquitetura verifica isso lendo os `import` do pacote e falhando se algum
bater na lista proibida — a mesma disciplina que manteve o motor puro.

**Por que separar:** o comportamento de um editor é onde estão os bugs caros (o snap pegou o ponto
errado, o undo comeu uma edição, a ferramenta emitiu evento em cima de erro). Se ele morar dentro
de um handler de `pointerdown`, só se verifica abrindo o navegador e olhando — e a Fase 1 inteira
foi construída sobre a regra de que "passou" sem número não conta.

---

## Sessão: o documento é o fold do log (E1, E2)

```ts
class Sessao {
  constructor(persistido: readonly Evento[], gerarId: () => Id, autor: string, tenantId: TenantId);

  /** Modelo exibido = fold(persistido + rascunho[0..cursor]). Cacheado. */
  get modelo(): Modelo;

  /** Emite. Trunca a cauda de refazer, avança o cursor, invalida o cache. */
  aplicar(...eventos: readonly Evento[]): void;

  desfazer(): void;     // cursor--
  refazer(): void;      // cursor++
  get podeDesfazer(): boolean;
  get podeRefazer(): boolean;

  /** O que ainda não foi para o servidor. */
  get pendentes(): readonly Evento[];

  /** Depois que o servidor confirmou: sela. O selado não volta por undo (E2). */
  selar(): void;

  /** Versão monotônica do documento. É a chave do cache (E8). */
  get versao(): number;
}
```

**Por que o undo não desfaz o que foi salvo.** O log é append-only: é isso que dá auditoria, sync
offline e a possibilidade de dois postos de trabalho no futuro. Um "undo" que apaga evento já
gravado quebra as três coisas de uma vez. Dentro da sessão, antes de salvar, desfazer é barato e
seguro — é só não incluir o evento no `fold`. Depois de salvo, desfazer é **fazer a operação
inversa**, que é uma edição normal, com evento próprio e autor registrado. O modelista percebe a
diferença por um marco visível na lista de eventos: *"salvo às 14:32"*.

**Cache (E8).** `modelo` refaz o fold só quando `versao` mudou. Além dele, um cache por peça:

```ts
interface Derivados {
  readonly contorno: readonly Vetor2[];     // tesselarContorno
  readonly corte: readonly Vetor2[];        // offsetMargem
  readonly tabelas: ReadonlyMap<Id, TabelaArco>;   // por aresta, para snap e medida
  readonly piques: readonly PiqueProjetado[];
  readonly problemas: readonly Problema[];
}
```
chaveado por `(pecaId, versao, tamanhoExibido)`. Invalidação é **por evento**, nunca por tempo;
`requestAnimationFrame` só desenha o que já está pronto. Sem isso, arrastar um ponto re-tesselaria a
peça inteira 60 vezes por segundo, e uma peça real tem centenas de segmentos.

**Arrasto em curso não é evento.** Enquanto o botão está apertado, a ferramenta mantém um
**preview**: aplica a operação do motor sobre a peça base e desenha o resultado, **sem** tocar na
sessão. Só no `aoSoltar` nasce o evento — um por gesto, não um por pixel. (A demo da Fase 1 já
funciona assim, e é o que mantém o log legível.)

---

## Câmera e coordenadas (E4, E5, E6)

```ts
class Camera {
  centro: Vetor2;      // em UM, no mundo
  zoom: number;        // pixels de tela por 1000 UM (1 mm)

  paraTela(p: Vetor2): { x: number; y: number };
  paraMundo(x: number, y: number): Vetor2;   // devolve UM inteiro (arredondado)
  get umPorPixel(): number;

  aproximarNoPonto(pontoDeTela: {x,y}, fator: number): void;  // zoom no cursor, não no centro
  enquadrar(caixa: Caixa, folgaPx: number): void;             // "ver tudo", "ver a peça"
}
```

**Zoom no cursor, não no centro.** O ponto do mundo sob o cursor tem que continuar sob o cursor
depois do zoom. É a diferença entre um CAD e um visualizador de imagem.

**Limites:** `zoom` entre "a peça inteira cabe" e "1 UM ≈ 1 px" (não há o que ver abaixo do
micrometro). Pan sem limite — o modelista precisa afastar uma peça para longe.

**A inversão do Y acontece em um lugar só (E4).** `mundo.scale.set(zoom/1000, -zoom/1000)`. Nada
fora daí nega coordenada. Consequências que o código tem que respeitar:

- **Texto e alças vão no overlay (E5).** Dentro do container espelhado, texto sai de cabeça para
  baixo, e uma alça de 6 px vira 6 UM ao dar zoom. O overlay é um `Container` Y-down, sem escala,
  cujos filhos são posicionados por `camera.paraTela`.
- **Traço em pixels (E6).** `strokeStyle.width = espessuraPx * camera.umPorPixel`. Como as
  `Graphics` do Pixi 8 guardam a geometria em coordenadas do mundo, mudar o zoom exige **redesenhar
  as linhas** — por isso o redesenho é disparado por mudança de câmera, além de por mudança de
  versão.

| Elemento | Espessura |
|---|---|
| linha de costura | 1.6 px |
| linha de corte | 1.2 px |
| fio, linha interna | 1.2 px |
| pique | 1.0 px |
| grade de fundo (5 cm) | 0.5 px |
| tamanho fantasma (graduação encaixada) | 1.0 px, tracejado |

---

## Camadas (E4 da Fase 1 · compatibilidade DXF ASTM)

Ordem de desenho fixa, de baixo para cima. Cada uma liga/desliga e pode ser **travada** (visível,
mas não selecionável) — travar é o que impede de arrastar o fio sem querer ao mexer no contorno.

| # | Camada | Camada ASTM | Conteúdo |
|---|---|---|---|
| 0 | `grade` | — | papel quadriculado de 5 cm, barra de escala |
| 1 | `fantasma` | — | os outros tamanhos da graduação |
| 2 | `corte` | 1 | `offsetMargem` |
| 3 | `costura` | 14 | `tesselarContorno` |
| 4 | `recorte` | 11 | recortes internos |
| 5 | `interna` | 7/13 | fio, pences, furos |
| 6 | `pique` | 4/80/81/82/83 | marcas de pique, projetadas no corte |
| 7 | `gradePoint` | 5 | pontos de graduação |
| 8 | `texto` | 15 | nome da peça, tamanho, quantidade, medidas |
| 9 | `overlay` | — | alças, seleção, marquee, cotas, snap |

As camadas 0–8 vivem no container do mundo; a 9 é o overlay em pixels. Cada camada é um `Container`
com `isRenderGroup: true` — o Pixi 8 trata cada uma como um lote próprio, e mexer no overlay não
força o resto a ser reenviado para a GPU.

**Culling:** peças fora da vista são puladas por `cullable` com `cullArea` = a caixa da peça em
coordenadas do mundo. Num molde com 40 peças isso é a diferença entre 60 fps e travar.

---

## Render (`@cad/editor-pixi`)

```ts
interface Pintor {                       // a fronteira testável (Parte 5)
  linha(camada: Camada, pontos: readonly Vetor2[], estilo: Estilo): void;
  poligono(camada: Camada, pontos: readonly Vetor2[], estilo: Estilo): void;
  marca(camada: Camada, em: Vetor2, forma: Forma, estilo: Estilo): void;
  texto(em: Vetor2, conteudo: string, estilo: EstiloTexto): void;   // sempre no overlay
}
```

`@cad/editor` produz uma **cena** — a lista de coisas a desenhar — e o `@cad/editor-pixi`
implementa `Pintor` com `Graphics`. O teste implementa `Pintor` gravando as chamadas. Isso é o que
torna verificável a frase "o pique é desenhado na linha de corte, entrando para dentro": o teste
lê os comandos e confere as coordenadas, sem abrir navegador.

**Inicialização (Pixi 8):** `await new Application().init({ antialias: true, resolution:
devicePixelRatio, autoDensity: true, preference: 'webgl' })`. `resolution` é obrigatório: sem ele o
traço de 1 px fica borrado em tela retina, e num CAD isso é inaceitável.

**Interação:** só o `Container` raiz tem `eventMode: 'static'`. O hit-testing é do `@cad/editor`
(Parte 3), contra a geometria em UM — **não** contra os objetos do Pixi. Deixar o Pixi decidir o
que foi clicado significaria hit-testing contra a espessura do traço desenhado, que muda com o
zoom; e significaria que o comportamento não é testável headless.

---

## Painéis

| Painel | Conteúdo | Liga em |
|---|---|---|
| Camadas | as 10 camadas, visível/travada | `Camadas` |
| Peças | lista, com nome, quantidade, tamanho ativo; duplicar, renomear, remover | `DuplicarPeca`, `RenomearPeca`, `RemoverPeca` |
| Propriedades | da seleção: margem da aresta, tipo/profundidade do pique, encaixe da peça | `DefinirMargem`, `DefinirEncaixe`, … |
| Ficha | medidas **medidas**: por aresta, perímetro, área, área desdobrada | `medirAresta`, `area`, `areaDesdobrada` |
| Graduação | grade de tamanhos, tamanho base, regra por grade point | `DefinirRegraGraduacao`, `RemoverRegraGraduacao` |
| Conferência | `validarModelo` + `validarCasamento`, clicável (E14) | — |
| Log | os eventos da sessão, com o marco de "salvo" | — |

**A ficha nunca digita número.** Todo valor exibido sai de uma função de medida do motor. Se um dia
divergir do que o motor calcula, é bug do motor — e é exatamente isso que se quer.

---

## Persistência e offline (Bloco 8)

- **Salvar** = `POST /modelos/:id/eventos` com os pendentes; em `201`, `selar()`.
- **Abrir** = `GET /modelos/:id` (snapshot) + o log; o editor reconstrói e confere contra o
  snapshot com `conferirIntegridade`, que já existe. Divergência é erro na cara, não recuperação
  silenciosa.
- **Sem rede:** os pendentes ficam em IndexedDB (no navegador) ou no SQLite (sob Tauri, Fase 4), com
  a mesma forma do log. Ao voltar a rede, anexa; o repositório já é idempotente por id de evento
  (reanexar o mesmo evento é no-op; com conteúdo diferente, estoura).
- **Autosave** a cada 30 s de inatividade **ou** a cada 20 eventos, o que vier primeiro. Salvar é
  barato (append) e perder trabalho não é.

## Critério de pronto de cada bloco

O bloco só está pronto quando: os testes dele rodaram com número colado; nenhum comportamento novo
mora fora de `@cad/editor`; nenhuma ferramenta altera peça sem evento; e os testes anteriores
continuam verdes.
