# Fase 6 — Digitalização de molde por foto

> O molde está recortado, em papel pardo, presso por ímãs numa parede preta. Uma foto de celular
> tem que virar peça editável, em milímetro real, dentro do editor.
>
> Esta é a porta de entrada que falta. Hoje o molde entra desenhado, por DXF-AAMA/ASTM ou pelo log
> de eventos. Nenhuma dessas serve para a confecção que tem duzentos moldes de papel numa gaveta.

Pacote: [`@cad/foto`](../packages/foto/). Este documento é a especificação normativa, escrita
**antes** do código. A primeira entrega — o quadro de calibração e a homografia — já está feita e
**medida** (8 testes); tudo que ainda depende de uma foto de verdade está marcado `[A MEDIR]`. É a
regra da Parte 0: "passou" sem o número não conta.

---

## Parte 0 — As decisões que não se negociam (I1 – I14)

### I1. Sem referência de tamanho conhecido, a foto é recusada

Uma imagem RGB **não tem escala**. É ambiguidade monocular, não limitação de software: a mesma
foto serve para um molde de 70 cm a 2 m e uma miniatura de 7 cm a 20 cm. Nenhum algoritmo resolve.

Então: **sem os marcadores de referência no quadro, a digitalização não acontece.** Não sai um
molde "aproximado" — sai um erro explícito. Um molde silenciosamente errado é a pior falha
possível neste projeto, e um molde fora de escala é errado em toda parte ao mesmo tempo.

### I2. A referência é a PAREDE, não o molde, e não os ímãs que seguram

O molde está **recortado**: a dimensão da folha original foi embora na tesoura. A largura do rolo
que o sistema conhece (o `Papel` da Fase 5) não tem relação nenhuma com o pedaço pendurado.

A referência são **quatro marcadores fixos na parede**, formando um retângulo medido com trena uma
única vez. Os ímãs que seguram o molde continuam segurando o molde e não entram na conta.

Três razões, e a terceira é a que decide:

1. **Plano certo.** Marcador colado na parede está no mesmo plano do papel. Ímã em cima do molde
   fica à frente pela espessura dele, e isso vira erro de escala de `espessura ÷ distância` —
   ~0,25 % a 2 m com ímã de 5 mm, que dá **1,8 mm** numa peça de 700 mm. Reprova sozinho.
2. **Trabalho zero por foto.** A parede não se mexe. O quadro está sempre lá.
3. **Base larga.** O erro de escala é aproximadamente *erro de detecção em pixels ÷ tamanho da
   referência em pixels*. Isto agora está **medido**, no quadro real de 138 × 72 cm, com câmera a
   2,5 m e 12 graus de inclinação, e o efeito de **1 px** de erro na detecção medido numa peça de
   700 mm:

   | Referência | Erro numa peça de 700 mm |
   |---|---|
   | **Quadro da parede (1380 mm)** | **0,218 mm** ✓ |
   | Ímã de 20 mm | **14,906 mm** ✗ |

   **68× melhor.** Não é diferença de refinamento: com o ímã como referência, um único pixel de
   erro já produz quinze milímetros — quinze vezes a tolerância do ofício. A referência pequena
   não é pior, é inviável.

> É a mesma razão pela qual o quadro de calibração do Digiflash é **grande**, e não um adesivo.

### I3. Os quatro marcadores se identificam sozinhos

Ímã cinza é igual a ímã cinza. Se o sistema não souber **qual canto é qual**, a homografia sai
espelhada ou girada — e um molde espelhado é catastrófico: vira a manga do lado errado.

Isto está **medido**, e o resultado é o pior tipo possível: com dois cantos trocados, um ponto que
está a 200 mm da borda é lido a **1180 mm** — espelhado —, e o **resíduo de reprojeção continua
exatamente zero**. A conta fecha. Nada na tela denuncia. É o defeito que só aparece na mesa de
corte, depois do tecido cortado.

Duas saídas, nesta ordem de preferência:

1. **O quadro já tem padrão de borda.** O quadro do ateliê (138 × 72 cm) tem a faixa branca
   recortada em semicírculos sobre o preto. Esse padrão **é** o alvo: dá os quatro cantos, dá
   orientação, e dá dezenas de pontos em vez de quatro — o que derruba ainda mais o erro de
   detecção, porque o ajuste passa a ser por mínimos quadrados sobre a borda inteira. É o caminho.
2. **Se o quadro não tiver padrão**, quatro adesivos ArUco 4×4 colados nos ímãs de referência. Uma
   folha impressa, uma vez na vida — quatro adesivos do tamanho de uma moeda, não uma lousa.

### I4. A linha fotografada é o CONTORNO, e a margem cresce para FORA

A foto dá a borda do papel. O motor trabalha com *contorno + margem*, e `offsetMargem` empurra
para fora.

Então a borda fotografada entra como **contorno**, com margem **zero** por padrão — que é o caso
da maioria das confecções, onde o molde de papel já inclui a costura. Se a fábrica trabalha com
molde sem margem, o operador declara a margem e ela **cresce para fora**, no sentido natural do
motor.

O caminho contrário — tratar a foto como linha de corte e *deduzir* o contorno encolhendo — foi
rejeitado: deslocamento paralelo **não é inversível** onde o canto arredonda, e o resultado seria
uma linha de costura inventada com cara de medida.

### I5. Geometria de biblioteca testada

Como em toda fase: elipse, homografia, retificação, contorno e correção de distorção saem do
**OpenCV** (`opencv.js`, WASM). O ajuste de Bézier sai de implementação publicada e testada
(Schneider, *Graphics Gems*), validada por um teste nosso contra um arco de raio conhecido.

Nada de conta caseira de visão computacional.

### I6. A importação produz EVENTOS

Igual ao importador de DXF. A peça digitalizada entra pelo log, e por isso **todas** as
ferramentas do editor funcionam nela sem exceção: espelhar, eixo de dobra, graduação, encaixe.

### I7. A digitalização registra a própria procedência

Um evento `DigitalizarPorFoto` guarda: qual calibração foi usada, o hash da imagem, o resíduo da
homografia e o resíduo máximo do ajuste de curva.

Daqui a dois anos, quando alguém perguntar por que aquela cava tem 3 mm a mais, a resposta está no
log — e não na memória de quem tirou a foto.

### I8. A calibração é do ATELIÊ, não do modelo

O retângulo da parede descreve a instalação, não o molde. É configuração do tenant, com
`tenant_id` como toda entidade persistida (D7), e **não** entra no log do modelo. O que entra no
log é a referência a ela.

### I9. O relatório nunca conserta em silêncio

Ímã em cima da borda, marcador faltando, foco ruim, resíduo alto: tudo vira problema explícito com
código e mensagem, dizendo **o que fazer**. Nunca um contorno "corrigido" sem avisar.

### I10. O que a foto NÃO tem, o sistema PERGUNTA

Nome da peça, quantidade, tecido, qual aresta é ombro ou cava, o que é eixo de dobra: **nada disso
está na imagem**. Aparece um formulário, não um chute.

Uma sugestão automática ("isto parece uma manga") é aceitável **como sugestão a confirmar** — e é
o gancho natural para a IA que ficou adiada. Aplicada em silêncio, não.

### I11. Precisão declarada na tela

Se o protocolo medido entregar ±0,3 mm, a tela diz ±0,3 mm. Se entregar ±3 mm, a tela diz ±3 mm —
e o molde entra com esse aviso colado nele. Precisão não medida não vira número bonito.

### I12. Tolerância alvo: ±1 mm

É a tolerância de molde do ofício. Todo teste desta fase é julgado contra ela.

### I13. Onde a regra da "biblioteca testada" começa

A decisão 3 da Parte 0 manda tirar **geometria** de biblioteca testada, e ela vale inteira:
homografia e ajuste de reta vêm do `ml-matrix`, Minkowski vem do `clipper2`, ajuste de Bézier
virá de implementação publicada.

Rotular componentes conexos, preencher buraco e andar pela borda de um conjunto de pixels são
**domínio de imagem**, não de geometria, e ficam neste pacote. A alternativa era carregar 14 MB
de OpenCV em WASM só para isso.

A troca é explícita para não virar exceção silenciosa, e o preço dela é pago em teste: cada uma
dessas funções é conferida contra **figura sintética de resposta conhecida de antemão** —
retângulo, anel, disco, dois quadrados que se tocam na quina — **antes** de ver qualquer foto.

Foi assim que o defeito apareceu: o traçado de borda devolvia **4 pontos** num retângulo de
20 × 15 px, onde a resposta certa é **66**, porque faltava o rastro do algoritmo de Moore e o
caminho cortava por dentro. Na foto ninguém teria percebido — 1103 pontos parecem plausíveis, e
lá ninguém sabe a resposta certa.

### I14. A calibração se mede com um OBJETO CONHECIDO, não com trena no quadro

Esta decisão nasceu de um achado na foto do ateliê, e ele é a melhor propaganda que a
decisão I1 podia ter.

A foto traz escrito **"138 × 72 cm"**, o que dá proporção **1,917**. O quadro medido na
própria foto, pelas 153 marcas da borda, dá **1,742** — **9,1% de diferença**.

Não é distorção da imagem: as marcas semicirculares saem **17 × 9 px** nos lados de cima e
de baixo e **8 × 16 px** nos lados esquerdo e direito, e √(2 × 0,5) = **1,0000**. Pixel
quadrado, imagem não esticada. A diferença é real.

Ou seja: **aquele rótulo não descreve o retângulo que passa pelos centros das marcas.** E o
mais perigoso é o que acontece se ele for aceito:

```
com a calibracao ERRADA, o residuo nos quatro cantos e 0.000 UM — ou seja, ZERO.
```

A homografia leva **qualquer** quadrilátero em **qualquer** retângulo. Ela fecha
perfeitamente, não reclama nunca, e entrega todo molde esticado 9% num eixo só. É o mesmo
padrão dos cantos trocados (I3): a conta fecha, e o erro só aparece na mesa de corte.

Daí a decisão, e ela troca uma medida difícil por uma fácil:

> **Não se mede o quadro com trena.** Fotografa-se **uma vez** um retângulo de papel de
> tamanho conhecido — medido com trena, que é medida de aresta e qualquer um faz certo —
> preso no quadro. Dessa foto o sistema deriva a escala e a proporção verdadeiras do
> retângulo de marcas, guarda como calibração do ateliê, e nunca mais precisa do objeto.

Duas incógnitas (escala e proporção), duas medidas conhecidas (a largura e a altura do
retângulo de papel): o sistema fecha. E a mesma foto que calibra é a que mede a precisão,
porque o erro no retângulo conhecido é o teste T1.

Enquanto a calibração não existir, `conferirQuadroContraCalibracao` compara a proporção
declarada com a medida e **recusa** acima de 8% — folga que deixa a perspectiva passar (na
foto do ateliê os lados opostos diferem 0,4% e 4,6%) e ainda pega erro de medida ou de
digitação.

### Medido no quadro da foto real

| | Resultado |
|---|---|
| Marcas de borda aceitas | **153** (de 156 manchas brancas) |
| Distribuição (baixo, direita, cima, esquerda) | **42, 27, 42, 15** |
| Maior mancha branca da imagem | **28 693 px** — a barra do programa, descartada pelo filtro de tamanho |
| Maior marca aceita | **403 px** |
| Pior desvio de uma marca à reta do lado dela | **5,06 px** |
| Proporção declarada no rótulo | **1,9167** |
| Proporção medida no quadro | **1,7415** → recusada |
| Resíduo da homografia com a calibração errada | **0,000 UM** — a prova de que ela nunca reclama |

**Uma reta por lado, e não os quatro cantos direto.** Com ~40 marcas por lado o erro de
detecção de cada marca é diluído pela raiz do número delas — algo como 6× —, e os cantos
saem do **cruzamento** das retas, sem depender de nenhuma marca isolada.

**As marcas de canto ficam de fora do ajuste.** A marca do canto é compartilhada entre dois
lados e entra torta em qualquer um que a pegue: medido, o desvio ia a 4,6 px nas
extremidades enquanto o miolo do lado ficava em 1,4 px. Descartar 8% de cada ponta resolve.

**A curvatura da lente não precisa de correção nesta resolução.** O perfil do desvio ao
longo dos lados de cima e de baixo é plano no miolo (±1,4 px) e não tem a barriga suave que
distorção de barril produziria.

---

## Parte 1 — O setup físico

### O que já existe (e joga a favor)

| | Por quê |
|---|---|
| **Papel pardo sobre parede preta** | contraste alto de verdade; o pardo tem muito mais vermelho que a parede — separa até no canal R, sem modelo nenhum |
| **Parede, e não mesa** | a foto sai de frente, em pé, recuado. Na mesa a pessoa se debruça e enviesa por construção |
| **Ímãs** | seguram o papel plano contra um plano de verdade |
| **Vários moldes de uma vez** | uma foto pode digitalizar a parede inteira |

### O quadro do ateliê

O ateliê **já tem** o quadro: fundo preto de **138 × 72 cm** com faixa branca recortada em
semicírculos na borda. Isso resolve o item mais caro da fase antes de ela começar.

Montagem (uma vez):

1. **Medir com trena: largura, altura e as DUAS diagonais.** As medidas nominais (1380 × 720) são
   ponto de partida, não verdade: quadro entorta, borda descola, e o rótulo do fabricante é
   arredondado. Se as diagonais não fecham, não é retângulo, e a homografia sai torta sem avisar. O
   app confere e recusa a calibração — e a conferência inclui Pitágoras, que é o que pega um lado
   **digitado errado** quando as duas diagonais concordam entre si.
2. Digitar as quatro medidas no app. Fim da calibração.
3. Se um dia o quadro for trocado por um sem padrão de borda: quatro adesivos ArUco (I3).

### O protocolo da foto

| Regra | Por quê |
|---|---|
| **Ímã de segurar não pisa na borda** — fica dentro da peça | ele esconde o contorno e o molde sai com uma mordida |
| **Recue 2 a 3 m; lente normal, não ultra-wide** | grande-angular entorta a borda do quadro |
| **Molde inteiro dentro do retângulo de referência** | extrapolar homografia é onde o erro explode |
| **Luz difusa, sem flash direto** | flash em papel dá brilho especular e come a borda |
| **Papel esticado, sem barriga** | homografia corrige plano, não corrige onda |

---

## Parte 2 — O pipeline

```
foto  →  1. marcadores  →  2. homografia  →  3. segmentar  →  4. tapar ímãs
      →  5. contorno em UM  →  6. cantos e curvas  →  7. piques
      →  8. internas e fio  →  9. EVENTOS + relatório
```

**1. Marcadores.** Detecta os quatro ArUco, pega o centro sub-pixel de cada um. Menos de quatro =
recusa (`REFERENCIA_INCOMPLETA`), dizendo quais faltaram.

**2. Homografia.** `findHomography` com os quatro pares (px ↔ mm reais). Guarda o **resíduo de
reprojeção**; acima do limite, recusa (`PERSPECTIVA_DUVIDOSA`). Distorção de lente: medir primeiro
o resíduo sem corrigir; se não couber na tolerância, entra uma calibração única do aparelho por
tabuleiro de xadrez.

**3. Segmentar.** Começa pelo caminho **clássico e determinístico**: limiar em espaço de cor (o
pardo se separa do preto com folga larga) + limpeza morfológica. Um modelo de segmentação tipo SAM
fica como **plano B**, para fundo ruim — não como padrão. Método determinístico é depurável; rede
neural não explica por que comeu 4 mm da cava.

**4. Tapar os ímãs.** Ímã cinza dentro da peça vira buraco na máscara. Todo buraco **inteiramente
cercado** pela peça é preenchido. Buraco que **toca a borda** é ímã sentado no contorno: recusa
(`IMA_NA_BORDA`), com a posição dele, para a pessoa mover e refotografar.

**5. Contorno em UM.** Contorno externo, refino sub-pixel, e cada ponto passa pela homografia →
coordenadas em micrômetro inteiro. A partir daqui é geometria do motor, não imagem.

**6. Cantos e curvas.** Parte o contorno nos pontos de curvatura alta (os cantos verdadeiros).
Entre cantos, ajusta **reta** se o resíduo couber, senão **Bézier cúbica** — que é exatamente o
que o modelo do motor guarda (dois controles por segmento, `moverControle` já testado). Guarda o
resíduo máximo do ajuste.

**7. Piques.** O pique é um corte em V na borda: concavidade estreita e rasa. Procura reentrâncias
com profundidade de 2 a 10 mm e largura abaixo de 4 mm (o padrão do motor é 6,35 mm de altura por
1,59 mm de largura — 1/4" × 1/16"), remove do contorno e registra como `Pique`.

> Aqui o motor já está do lado certo: pique é posicionado por **comprimento de arco `s`**, não por
> `t` de Bézier. A diferença medida no nosso próprio teste da cava foi de **16,734 mm**. Um pique
> lido da foto cai no lugar certo porque essa decisão foi tomada na Fase 1.

**8. Internas e fio.** Se estiverem desenhados em cor distinta (caneta vermelha), separa por canal
de cor, afina o traço e ajusta polilinha. Opcional: sem cor distinta, não sai — e o relatório diz
que não saiu (`FIO_AUSENTE`).

**9. Eventos e relatório.** `CriarPeca`, `CriarPonto`, `DefinirAresta`, `DefinirSegmento`,
`AdicionarPique`, mais o `DigitalizarPorFoto` de procedência (I7). O relatório traz resíduos,
contagens, e cada recusa com o que fazer.

---

## Parte 3 — O que falta no motor

| Lacuna | Por quê |
|---|---|
| `ajustarBezier(pontos, tolerância)` | hoje o motor **desenha** Bézier; não sabe **encontrar** uma que passe por uma nuvem de pontos |
| `detectarCantos(anel, ângulo)` | separar canto verdadeiro de ruído de contorno |
| Evento `DigitalizarPorFoto` | procedência (I7) |
| `Calibracao` como configuração de tenant | I8 |

Nada disso mexe em decisão tomada. É acréscimo.

---

## Parte 4 — Os testes, e os números que têm que ser colados

Todos com **os ímãs, a parede e a luz do ateliê real**. Bancada sintética aqui não prova nada:
o que se está medindo é o conjunto.

| # | O quê | Critério |
|---|---|---|
| T1 | Retângulo de papel pardo **300 × 500 mm**, medido com trena | erro em cada dimensão, no perímetro e nos ângulos dos cantos `[A MEDIR]`, alvo ≤ 1 mm |
| T2 | **Repetibilidade**: 5 fotos do mesmo molde, sem mexer em nada | desvio entre as cinco `[A MEDIR]` |
| T3 | Peça grande (~700 mm) **no canto** do quadro — pior caso de distorção | erro `[A MEDIR]` |
| T4 | Arco de **raio conhecido** | erro de raio, e resíduo do ajuste de Bézier `[A MEDIR]` |
| T5 | **Cinco piques** em distâncias medidas na borda | erro de posição em `s` `[A MEDIR]` |
| T6 | Ímã **sentado na borda** | tem que RECUSAR com `IMA_NA_BORDA` |
| T7 | **Três** marcadores visíveis | tem que RECUSAR com `REFERENCIA_INCOMPLETA` |
| T8 | Foto **tremida / desfocada** | tem que RECUSAR, não entregar contorno ondulado |
| T9 | Digitaliza → exporta DXF → reimporta | área igual, como no round-trip da Fase 3 |
| T10 | Peça digitalizada entra no **encaixe** e no **HPGL** | fecha o ciclo: foto → tecido |
### Já medido (`@cad/foto`, 8 testes)

O que não depende de foto nenhuma já está provado, com câmera de furo de agulha simulada — a 2,5 m,
inclinada 12 graus, sobre o quadro real de 138 × 72 cm (1,165 px/mm):

| | Resultado |
|---|---|
| Pixel → milímetro, em 15 pontos espalhados pelo quadro | **erro 0 UM** — só o arredondamento para inteiro |
| Resíduo de reprojeção nos quatro cantos | **0,000 UM** |
| 1 px de erro, referência = quadro de 1380 mm | **0,218 mm** numa peça de 700 mm |
| 1 px de erro, referência = ímã de 20 mm | **14,906 mm** — 68× pior |
| Quatro pontos alinhados | recusado |
| Dois cantos trocados | ponto de 200 mm lido a **1180 mm**, resíduo **zero** |
| Diagonais fora por 9 mm | `DIAGONAIS_DESIGUAIS` |
| Largura digitada 1350 em vez de 1380, diagonais concordando | `NAO_E_RETANGULO` (pego por Pitágoras) |

### Medido na foto real (`parede-01.png`, 1025 × 630 px)

O pipeline até o contorno rodou na foto do ateliê — quadro de 138 × 72 cm, treze… **onze**
moldes de papel pardo, ímãs, sombra, reflexo e escrita à mão:

| | Resultado |
|---|---|
| Papel pardo detectado | **44,1%** da imagem |
| Branco neutro (a borda recortada do quadro) | **7,9%** |
| Peças achadas | **11**, todas separadas, nenhuma grudada na vizinha |
| Buracos tapados (ímãs) | **14** |
| Contorno da maior peça | **1103 pontos**, caixa 419 × 215 px |
| Caixa do contorno × caixa da região | **idênticas** — o passeio não cortou caminho por dentro |
| Marcas brancas da borda | **156** com 20 px ou mais |

A conferência visual está em `npm run regioes -w @cad/foto`, que pinta cada região por cima da
foto. Papel que sobra fora de toda região sai em **branco**, de propósito: é o que denuncia limiar
apertado demais. Na foto do ateliê não sobrou nada.

### O achado que mudou o método: **croma, não brilho**

O palpite natural é limiar de brilho — papel claro sobre fundo escuro. Medido, é o caminho errado.
Luminância dentro do quadro sai espalhada, sem vale:

```
lum  16:8,4%  32:11,4%  48:16,0%  64:4,9%  80:3,1%  96:2,4%  112:3,9%  128:4,1%
    144:9,2%  160:14,0%  176:17,2%  192:4,4%
```

O motivo é físico: o quadro preto tem **reflexo especular** e o papel tem **sombra**. Os dois
invadem a faixa de brilho um do outro — na foto do ateliê existe reflexo no preto **mais claro**
que papel em sombra. Qualquer limiar de brilho que pegue o papel pega o reflexo junto.

Já `R − B` — o quanto o pixel puxa para o quente — é limpo:

```
R−B   0:15,2%   8:12,3%  16:10,5%  24:5,4% | 32:1,8%  40:0,9%  48:0,8%  56:0,8%
     64:0,9%  72:0,9%  80:1,0%  88:1,4% | 96:3,5%  104:26,6%  112:17,1%  120:0,9%
      └─ fundo preto e borda branca: 38% ─┘  vale 7,7%  └─── papel pardo: 48% ───┘
```

Sombra não muda o croma do pardo, e reflexo não pinta o preto de marrom. O limiar fica em **60**,
que é o meio do vale — não número escolhido a dedo.

Para a borda branca, o mesmo tratamento, olhando só os pixels neutros: o preto do quadro morre em
96, a borda começa em 224, e o limiar fica em **160**.

### Uma limitação da foto que já está medida

Esta foto tem 1025 px para 1380 mm: **1 px = 1,35 mm**. Serve para desenvolver e depurar o pipeline
inteiro — e serviu —, mas **não** serve para o teste de precisão T1: o erro do contorno sairia
dominado pela resolução, não pelo método. O T1 exige o arquivo original da câmera.

Se T1 não couber em 1 mm, o protocolo muda até caber — mais marcadores, mais distância, calibração
de lente. Se ainda assim não couber, o número vai **na tela** (I11).

---

### Do passeio de pixels ao contorno do motor

A ordem das etapas não é a óbvia, e a razão é o **pique**. Ele é um corte de ~6 mm de fundo
por ~1,6 mm de boca; qualquer ajuste de curva que passe por cima dele o transforma numa
ondulação da cava e ele **some sem avisar**. Então:

1. **simplificar** o passeio de pixels (Douglas-Peucker do `clipper2`, a mesma implementação
   que o motor usa — tolerância ligada ao tamanho do pixel, porque abaixo dela não existe
   desenho, existe escada de quantização);
2. **achar e tirar os piques**, guardando a posição de cada um em comprimento de arco;
3. **achar os cantos** no que sobrou;
4. **ajustar** reta ou Bézier cúbica entre cantos consecutivos (Schneider, *Graphics Gems*,
   pela `fit-curve`).

O critério do pique é o do ofício, não estatístico: **boca estreita, fundo na faixa do
notcher, e para DENTRO**. Recorte de verdade é largo; ondulação de cava é rasa; pique é fundo
e estreito.

### Medido em figura sintética

| | Resultado |
|---|---|
| Retângulo tesselado de 400 pontos, simplificado | **5 pontos** |
| Pique de 6,35 × 1,60 mm | achado, **fundo 6,35 mm, boca 1,60 mm** |
| Cinco piques numa borda | **cinco achados**, nenhum confundido com canto |
| Recorte de 30 mm de boca | **não** confundido com pique |
| Ondulação de 0,8 mm de fundo | **não** confundida com pique |
| Retângulo 200 × 100 | **4 cantos** |
| Círculo de raio 50 mm | **0 cantos** |
| Trecho reto | vira **reta**, resíduo **0** |
| Arco de 90° e raio 80 mm | 4 Béziers, **pior erro de raio 0,0121 mm** (tolerância pedida 0,200) |

### Dois defeitos que só a figura sintética pegaria

**O `s` do pique saía 5,6 mm fora do lugar.** Medido no anel cru, o comprimento acumulado
passa pelo fundo do V e leva junto os 6,4 mm de descida e os 6,4 de subida: um pique a
80,8 mm era registrado a **86,4 mm**. O `s` tem que ser medido ao longo da **aresta**, que é o
contorno já sem o pique — e é o que `removerPiques` agora recalcula. Num molde, 5,6 mm de
erro na posição de um pique é costura que não casa.

**Os quatro cantos de um retângulo viravam um canto só.** A junção de cantos vizinhos estava
por índice, e num anel já simplificado dois índices seguidos podem estar a 200 mm um do
outro. Passou a ser por **distância de arco**.

Nenhum dos dois apareceria na foto: lá ninguém sabe a resposta certa.

### O caminho inteiro na foto real

Com escala **provisória** (largura do quadro assumida em 1380 mm, altura vinda da proporção
medida 1,7415 → 792 mm), resolução de **1,414 mm por pixel**, tolerância de trabalho
**2,12 mm**:

```
peca   largura   altura   perimetro   pontos   cantos   trechos   piques
   1       576      299        1572       27        7        24        0
   2       347      252        1134       12        8        10        0
   3       417      201        1094       26        9        20        0
   4       538      145        1261       21        7        20        0
   5       129      455        1080       16        6        13        0
   6       346      169         944       17        9        13        0
   7       321      174         911       16        5        14        0
   8       182      227         723       19       10        18        0
   9       421       71         944       13        7        11        0
  10       159      134         517       14        5        13        0
  11        90      124         379       11        7         9        0

total: 11 pecas, 192 pontos, 165 trechos (retas + Beziers), 0 piques
```

**Zero piques, e o motivo é a resolução, não o método.** Um pique de 1,6 mm de boca ocupa
**um** pixel nesta foto, e a simplificação a 2,12 mm o apaga junto com a escada. Nesta
resolução, pique não é detectável — e o sistema não vai fingir que é. Com o arquivo original
da câmera (~0,35 mm/px), a boca passa a ter 4 a 5 pixels e a detecção que já está testada
passa a ter o que ver.

**As medidas em milímetro são ordem de grandeza**, não medida: dependem da largura assumida
de 1380 mm, que é justamente o número que ainda não está confirmado. Conferi-las com a trena
é, aliás, um caminho válido para achar a escala — se a peça 1 mede outra coisa, a largura do
quadro sai por regra de três.

## Parte 5 — O que esta fase NÃO faz

- **Não adivinha semântica.** Nome, quantidade, tecido, qual aresta é o quê: formulário (I10).
- **Não lê molde amassado ou com barriga.** Homografia corrige plano, não corrige onda.
- **Não costura várias fotos.** Peça maior que o quadro de referência fica para depois.
- **Não lê molde escrito a lápis.** Marcação interna precisa de cor distinta.
- **Não substitui mesa digitalizadora** onde a exigência for menor que meio milímetro.
