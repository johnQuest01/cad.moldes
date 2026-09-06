# Fase 6 — Digitalização de molde por foto

> O molde está recortado, em papel pardo, presso por ímãs numa parede preta. Uma foto de celular
> tem que virar peça editável, em milímetro real, dentro do editor.
>
> Esta é a porta de entrada que falta. Hoje o molde entra desenhado, por DXF-AAMA/ASTM ou pelo log
> de eventos. Nenhuma dessas serve para a confecção que tem duzentos moldes de papel numa gaveta.

Pacote a criar: `@cad/foto`. **Nenhum número aqui foi medido ainda** — este documento é a
especificação normativa, escrita antes do código, e cada número que ele exige está marcado como
`[A MEDIR]`. É a regra da Parte 0: "passou" sem o número não conta.

---

## Parte 0 — As decisões que não se negociam (I1 – I12)

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
   referência em pixels*. Uma base de 1200 mm contra um ímã de 20 mm é 60× melhor. Não é detalhe —
   é a diferença entre 0,3 mm e 7 mm de erro.

> É a mesma razão pela qual o quadro de calibração do Digiflash é **grande**, e não um adesivo.

### I3. Os quatro marcadores se identificam sozinhos

Ímã cinza é igual a ímã cinza. Se o sistema não souber **qual canto é qual**, a homografia sai
espelhada ou girada — e um molde espelhado é catastrófico: vira a manga do lado errado.

Cada marcador de referência leva um **adesivo impresso com código** (ArUco 4×4, quatro códigos
diferentes). Imprime-se uma folha, uma vez, na vida. Isso resolve identidade, ordem e orientação
de uma vez, e ainda dá detecção sub-pixel de graça.

Não é uma lousa: são quatro adesivos do tamanho de uma moeda, colados nos ímãs que já ficam na
parede.

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

---

## Parte 1 — O setup físico

### O que já existe (e joga a favor)

| | Por quê |
|---|---|
| **Papel pardo sobre parede preta** | contraste alto de verdade; o pardo tem muito mais vermelho que a parede — separa até no canal R, sem modelo nenhum |
| **Parede, e não mesa** | a foto sai de frente, em pé, recuado. Na mesa a pessoa se debruça e enviesa por construção |
| **Ímãs** | seguram o papel plano contra um plano de verdade |
| **Vários moldes de uma vez** | uma foto pode digitalizar a parede inteira |

### O que precisa ser montado (uma vez)

1. **Quatro ímãs de referência** fixos na parede, formando um retângulo. Sugestão: ~1200 × 800 mm,
   ou o maior que couber com folga em volta dos moldes.
2. **Adesivo ArUco** em cada um (I3).
3. **Medir com trena: largura, altura e as DUAS diagonais.** Se as diagonais não baterem, não é
   retângulo, e a homografia sai torta sem avisar. O app confere e recusa a calibração.
4. Digitar as quatro medidas no app. Fim da calibração.

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

Se T1 não couber em 1 mm, o protocolo muda até caber — mais marcadores, mais distância, calibração
de lente. Se ainda assim não couber, o número vai **na tela** (I11).

---

## Parte 5 — O que esta fase NÃO faz

- **Não adivinha semântica.** Nome, quantidade, tecido, qual aresta é o quê: formulário (I10).
- **Não lê molde amassado ou com barriga.** Homografia corrige plano, não corrige onda.
- **Não costura várias fotos.** Peça maior que o quadro de referência fica para depois.
- **Não lê molde escrito a lápis.** Marcação interna precisa de cor distinta.
- **Não substitui mesa digitalizadora** onde a exigência for menor que meio milímetro.
