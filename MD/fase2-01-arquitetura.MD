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
/** O que uma ferramenta produz: evento SEM envelope. A sessão carimba (E12, E13). */
interface Gesto {
  readonly tipo: string;
  readonly pecaId: Id | null;
  readonly payload: unknown;
}

class Sessao {
  constructor(persistido: readonly Evento[], dados: DadosDaSessao);

  /** Modelo exibido = fold(persistido + passos aplicados). Cacheado por versão. */
  get modelo(): Modelo;

  /**
   * Carimba, PROVA contra o motor e só então aplica. Tudo ou nada: se o motor
   * recusar, nada mudou e o ErroMotor sobe para a ferramenta cancelar (E7).
   * Vários gestos numa chamada são UM passo de undo.
   */
  aplicar(...gestos: readonly Gesto[]): readonly Evento[];

  desfazer(): boolean;
  refazer(): boolean;
  get podeDesfazer(): boolean;
  get podeRefazer(): boolean;

  /** O que ainda não foi para o servidor, achatado em eventos. */
  get pendentes(): readonly Evento[];
  /** Quantos PASSOS de undo existem. Um passo pode ter vários eventos. */
  get passos(): number;

  /** Depois que o servidor confirmou: sela. O selado não volta por undo (E2). */
  selar(): void;

  /** Versão monotônica do documento. É a chave do cache (E8). */
  get versao(): number;
}
```

**O rascunho é uma pilha de PASSOS, não de eventos.** Cada `aplicar` é um passo, com um ou mais
eventos dentro. É o que faz "mover as três peças selecionadas" desfazer de uma vez, e não peça por
peça — o modelista fez um gesto só. (A primeira versão contava eventos, e o teste pegou.)

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


---

## O que a implementação mostrou — Bloco 1 fechado

`@cad/editor` existe, com `Sessao` e `Camera`. **26 testes**, todos headless. Nada de DOM, nada de
Pixi — e há um teste que garante isso.

### Um erro achado pelo próprio teste

A primeira versão guardava o cursor de undo em **eventos**, não em **passos**. O teste
"vários gestos numa chamada são UM passo de undo" pegou na hora: três gestos viravam três `desfazer`.
Consertado — o rascunho é uma pilha de passos, cada `aplicar` é um passo. É exatamente o caso de
"mover as três peças selecionadas", que precisa desfazer de uma vez, porque o modelista fez um gesto
só.

### Sessão

```
--- a sessao ---
inicio: 100 mm de largura | 18 eventos | 0 pendentes
depois de puxar 30 mm: 130 mm | 1 pendente
3 gestos numa chamada: 130 mm -> 1 desfazer -> 100 mm

--- undo / redo ---
inicial == depois de desfazer: true      (comparacao canonica, byte a byte)
editado == depois de refazer:  true
depois de desfazer e agir de novo: podeRefazer = false | 105 mm

--- o selo (E2) ---
pendentes: 1 -> 0 | podeDesfazer: false | log com 19 eventos
a peca nao mudou: 130 -> 130 mm | versao 1 -> 1
puxou 30, selou, puxou -30: 100 mm | o log guarda os 2 gestos, como manda a auditoria

--- recusa do motor (E7) ---
versao 1 -> 1 | log 19 -> 19 | modelo intacto: true
tipo de gesto desconhecido -> EVENTO_VERSAO_DESCONHECIDA

--- cache (E8) ---
10 leituras sem editar -> 1 fold
1 edicao + 10 leituras -> 2 folds no total
```

A `versao` **não muda** ao selar, e isso é deliberado: o log efetivo é o mesmo de antes, e
incrementar jogaria fora um cache que continua válido.

E a propriedade que fecha o assunto do undo:

```
200 sequencias, ate 8 gestos cada: undo devolveu o inicial em todas
```

### Câmera

```
--- inversao do Y (E4) ---
centro do mundo -> (400, 300) px
100 mm ACIMA no mundo -> y = 200 px (MENOR: a tela cresce para baixo)

--- escala (E11) ---
zoom  0.5 px/mm -> 2000 UM/px | raio de captura de 10 px = 20.00 mm
zoom    1 px/mm -> 1000 UM/px | raio de captura de 10 px = 10.00 mm
zoom    2 px/mm ->  500 UM/px | raio de captura de 10 px =  5.00 mm
zoom    8 px/mm ->  125 UM/px | raio de captura de 10 px =  1.25 mm

--- enquadrar 190 x 450 mm em 800 x 600 px ---
zoom 1.1911 px/mm | 840 UM/px | cantos em (287, 568) e (513, 32) px
vista: -241..431 mm em x | a blusa aparece: true | uma peca a 5 m dali: false
```

As duas propriedades, que são onde erro de conversão aparece:

```
1000 pontos, camera aleatoria: erro maximo de ida e volta = 0 UM
1000 zooms no cursor:  o ponto sob o cursor andou no maximo 0.0622 px
3 zooms de 2x no canto do decote: desvio 0.000 px, zoom 12.800
```

O `paraMundo` arredonda (o núcleo só aceita inteiro, D1), então o desvio do zoom é medido **em
pixels**, que é o que o olho vê. Meio micrometro no mundo é desvio invisível na tela.

### O guarda-costas da E3

```
3 arquivos em @cad/editor conferidos contra 6 proibicoes
violacoes: nenhuma
arquivos do motor importando camada de cima: 0
dependencies: @cad/motor
```

O teste lê os `import` do pacote e falha em `pixi.js`, `@cad/editor-pixi`, `document`, `window`,
`navigator` e `requestAnimationFrame` — depois de tirar os comentários, porque a prosa fala de Pixi
o tempo todo e a regra é sobre código.

`scripts/verificar-dist.mjs` cobre o pacote novo, exigindo que ele **calcule** no artefato:

```
  ok   a camera do artefato construido converte ida e volta (42, 77 mm)
  ok   a sessao do artefato construido edita e desfaz (130 mm -> desfazer -> 100 mm)
```

**Próximo:** Bloco 2 — hit-testing e snap (Parte 3).
