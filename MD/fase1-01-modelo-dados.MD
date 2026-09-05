# FASE 1 · PARTE 1 — Modelo de dados, vocabulário e assinaturas

> Cole junto com a **Parte 0**. Esta parte define **o quê existe**; as Partes 2 e 3 definem **o que se faz com isso**.

## Decisões fechadas (eram os 4 pontos em aberto — não reabra, não "melhore")

**D1 — Curva = Bézier cúbico. NÃO NURBS.**
Justificativa: DXF-AAMA exporta **polilinha**, não spline — a curva é tesselada na exportação de qualquer forma, então a representação interna só precisa sobreviver ao save/load próprio. NURBS só ganharia para cônicas exatas (círculo perfeito), e cava/decote não são cônicas. Em troca, NURBS obrigaria carregar vetor de nós e pesos em toda edição, graduação e ancoragem de pique.
- **Entrada pelo editor:** o modelista clica pontos **na** linha → usar **Catmull-Rom** (interpola os pontos clicados) e converter exatamente para Bézier cúbico no armazenamento. Não exponha handles de Bézier como modelo mental do usuário.
- **Fillet (Parte 3, op. 10)** aproxima arco de círculo com `κ = 4/3·tan(θ/4)`. Erro radial máximo em arco de 90° ≈ 0,027% do raio → fillet de 10 mm erra ~2,7 µm, contra `TOLERANCIA_TESSELACAO_UM = 100` µm. Folga de ~37×; aceito.

**D2 — IDs vêm no payload do evento. O fold é função pura.**
`(estado, evento) → estado`, sem `randomUUID()`, sem `Date.now()`, sem I/O dentro do fold. Toda entropia (id, timestamp, autor) é gerada por **quem emite** o evento e viaja no payload. Sem isso, replay produz IDs diferentes do snapshot e o teste de integridade falha por construção.
- Usar **UUIDv7 ou ULID** (ordenáveis por tempo) — ajuda a ordenação de eventos no sync da Fase 10 de graça.

**D3 — `Aresta` é entidade persistida com ID estável; `ParCostura` vive no `Modelo`.**
Derivar aresta dinamicamente dos pontos notáveis parece elegante e é armadilha: inserir um ponto notável renumera as arestas e faz **margem por aresta** e **par de costura** apontarem para o lugar errado, em silêncio. O ID precisa sobreviver à edição.
`ParCostura` pertence ao `Modelo` (não à `Peca`) porque cava-frente e cava-manga estão em **peças diferentes**.

**D4 — Contorno CCW, núcleo Y-up, delta positivo = pra fora, junção Miter.**
- **Winding:** contorno sempre **CCW**, normalizado na entrada (área por shoelace; negativa → inverter). Nunca confie no sentido que veio do DXF.
- **Eixo:** núcleo em **Y-up** (convenção DXF). O editor PixiJS é Y-down e inverte **só no render**. Núcleo Y-down trocaria o sinal do winding e mandaria o offset pra dentro.
- **Offset:** delta positivo = **pra fora** (linha de costura → linha de corte).
- **JoinType = Miter** (com limite), **não Round**: junção redonda arredondaria os cantos do retângulo do teste 1 e transformaria margem de canto em curva — errado para molde.
- **Assertion dentro de `offsetMargem`** (não só no teste): `área(corte) > área(costura)`, sempre. Inverteu o sentido → estoura na hora, em vez de mandar molde pequeno pro corte.

## ⚠ Lacuna ainda aberta
**Projeção do pique costura → corte.** O pique é ancorado na linha de **costura**, mas a cortadora corta na linha de **corte** (offset). Definir como o pique é transferido. Sem isso o pique sai deslocado na peça cortada — é erro de geometria, não de acabamento. **Pergunte antes de implementar.**

## Modelo de dados
- **Ponto**: `{ id, nome, x, y }` em micrômetros inteiros. Tipo: `contorno` | `construcao` | `interno`.
- **Segmento**: liga dois pontos. Tipo `reta` **ou** `curva` (Bézier cúbico: dois pontos de controle — ver D1). Pertence a uma `Aresta`.
- **Aresta** (**D3**): `{ id, pecaId, pontoInicioId, pontoFimId }` — sequência de segmentos entre dois pontos *notáveis* (ex.: a cava inteira). **ID estável**, sobrevive à inserção/remoção de pontos. É o que se mede, compara e recebe margem.
- **Peca**: contorno = lista ordenada de segmentos formando a **linha de costura** (polígono fechado CCW, possivelmente com curvas). Contém: pontos, segmentos, arestas, margens por aresta, linhas internas, grade points, metadados (nome, tecido, quantidade a cortar, par/espelho, sentido de fio).
- **Material/Tecido**: entidade própria com nome, **largura (mm)**, **gramatura (g/m²)** e modo (aberto / tubular). Gramatura é obrigatória: o **peso por pacote** no encaixe (Fase 5) é `área × gramatura`.
- **Margem de costura**: valor (mm) **por aresta** — arestas diferentes podem ter margens diferentes. A **linha de corte** é derivada por offset, nunca desenhada à mão. **Não confundir** com a *margem de segurança entre moldes* (distância mínima entre peças no risco), que é conceito do encaixe (Fase 5).
- **LinhaInterna**: `fio` (sentido do tecido), `pence`, `furo`. Cada uma com semântica própria — o fio não é "só uma linha", é a direção do tecido.
- **Pique (notch)**: **entidade parametrizada**, não um risco solto. Campos: **tipo** (`I` slit, `V`, `V1`, `V2`, `T`, `MX` castle, `M+`, `MX2` — nomes confirmados no sistema do cliente), **altura (mm)**, **largura (mm)**, **ângulo (°)**, e âncora (segmento + posição).
  - **⚠ A posição é `s` — normalizada por COMPRIMENTO DE ARCO, nunca o parâmetro `t` de Bézier.** Em curva, `t = 0.5` **não** é o meio da curva; o pique se posiciona por distância medida sobre a costura. Implementar com tabela de comprimento acumulado no tesselado + busca binária. Usar `t` cru aqui é erro silencioso clássico.
  - Consequências obrigatórias: o pique **segue a curva** se ela for editada e **sobrevive à graduação** (posição relativa, não coordenada absoluta).
  - Suportar **fundir pique ao contorno** e **substituição em lote** (trocar todos os piques do tipo X pelo tipo Y, em várias peças, com altura/largura/ângulo aplicados).
  - **Mapeamento ASTM D6673 (essencial para o DXF da Fase 3):** camada 4 = slit/V-notch, 80 = T-notch, 81 = castle, 82 = check, 83 = U-notch. O tipo tem que sobreviver ao round-trip, não virar "risco genérico".
- **ParCostura** (**D3**, vive no `Modelo`): `{ id, modeloId, arestaA, arestaB }` — declara que duas arestas costuram juntas. É a entrada de `validarCasamento`.
- **Propriedades de encaixe da peça** (campos próprios, confirmados na tela do cliente): `tecido` (referência ao Material), `quantidade por modelo`, `giro` (livre / 180° / 90° / forçar giro / à esquerda / à direita), `faixa de giro (°)`, `par`, `espelhado`, `dobra horizontal`, `dobra vertical`.
- **Derivados calculados:** `perímetro (cm)` e `área (cm²)`, sempre recomputados da geometria (nunca digitados).
- **PontoGraduacao**: marca um ponto do contorno como graduável.
- **RegraGraduacao**: por grade point, o incremento `(dx, dy)` entre tamanhos consecutivos. **Regra como dado** (linha de tabela), não código.
- **Modelo**: coleção de `Peca` + grade de tamanhos (ex.: PP–P–M–G–GG) + tabela de medidas + `ParCostura[]`. Um tamanho é o **base**; os outros são calculados pelas regras.

## Vocabulário (use estes termos exatos no código — não invente sinônimos)
- **Segmento**: ligação entre dois pontos consecutivos (reta ou curva Bézier). Unidade mínima.
- **Aresta**: entidade com ID estável, agrupando os segmentos entre dois pontos notáveis. Recebe margem, é medida e comparada.
- **Contorno**: o ciclo fechado de segmentos = linha de costura, em CCW.
- **Linha de costura**: o contorno desenhado. **Linha de corte**: derivada por offset da margem. Nunca desenhada à mão.
- `TOLERANCIA_TESSELACAO_UM = 100` (0,1 mm em micrômetros) — constante única para tesselar curva e simplificar. Não espalhar números mágicos.

## Orçamento de tolerância (preencher — hoje cada operação usa uma linguagem diferente)
Tabela única: operação → desvio máximo aceito → justificativa. Sem ela, "passou no teste" vira discussão. Mínimo a definir: tesselação de curva, round-trip de DXF, casamento de costura (referência real observada: 0,00–0,02 cm), simplificação, digitalização por foto.

## Assinaturas esperadas (esqueleto — implemente exatamente esta forma)
```ts
type UM = number;              // micrômetro inteiro. NUNCA float de mm.
const MM = 1000;               // 1 mm = 1000 UM
const TOLERANCIA_TESSELACAO_UM: UM = 100;

interface Ponto { id: string; nome?: string; x: UM; y: UM; tipo: 'contorno'|'construcao'|'interno' }

// D1: curva = Bézier cúbico. Exatamente 2 pontos de controle quando tipo==='curva'.
interface Segmento {
  id: string; arestaId: string;
  de: string; para: string;
  tipo: 'reta'|'curva';
  controles?: [{x:UM,y:UM}, {x:UM,y:UM}];
}

// D3: ID estável, não derivado de índice.
interface Aresta { id: string; pecaId: string; pontoInicioId: string; pontoFimId: string }
interface ParCostura { id: string; modeloId: string; arestaA: string; arestaB: string }

// s = posição normalizada por COMPRIMENTO DE ARCO (0..1), nunca o t de Bézier.
interface Pique {
  id: string; tipo: 'I'|'V'|'V1'|'V2'|'T'|'MX'|'M+'|'MX2';
  alturaUM: UM; larguraUM: UM; anguloGraus: number;
  arestaId: string; s: number;
}

interface EixoDobra { id: string; p1:{x:UM,y:UM}; p2:{x:UM,y:UM}; direcao:'dentro'|'fora'; profundidadeUM?: UM }

function offsetMargem(peca: Peca): Poligono          // clipper2, Miter, delta>0 = fora, assert área↑
function medirAresta(peca: Peca, arestaId: string): UM
function pontoEmS(peca: Peca, arestaId: string, s: number): {x:UM,y:UM}   // via comprimento de arco
function aplicarGraduacao(peca: Peca, tamanho: string): Peca
function modificarPonto(peca: Peca, pontoId: string, dx: UM, dy: UM, modo: 'discreto'|'proporcional', nVizinhos: number): Peca
function compararPerimetros(modelo: Modelo, mais: string[], menos: string[]): Record<string, {mais:UM, menos:UM, dif:UM}>
function validarCasamento(modelo: Modelo): Problema[]                     // usa ParCostura
function validarInconsistencias(peca: Peca): Problema[]
function dobrar(peca: Peca, eixos: EixoDobra[]): Peca
function dividir(peca: Peca, linha: LinhaDivisao, margemNovaUM: UM): Peca[]
function normalizarWinding(peca: Peca): Peca                              // shoelace → força CCW
```
Se algo aqui conflitar com uma escolha melhor, **pare e pergunte** — não altere por conta própria.
