# Fase 5 — Encaixe (nesting)

> É a fase que carrega o ROI. Economia de tecido é o único retorno que uma confecção calcula na
> ponta do lápis: o rolo custa dinheiro toda vez que passa pela mesa de corte. Também é a mais
> difícil das cinco — *nesting* de polígonos irregulares em faixa contínua, com o fio do tecido
> restringindo a rotação.

Pacote: [`@cad/encaixe`](../packages/encaixe/). **11 testes rodados, com número colado.**

---

## As decisões que não se negociam (H1 – H8)

### H1. No-Fit Polygon, e não força bruta

Para saber onde uma peça cabe ao lado de outra existe uma resposta exata e conhecida, e não é
testar posições numa grade:

```
NFP(fixa, móvel) = fixa ⊕ (−móvel)
```

Uma posição da móvel **colide** com a fixa se, e só se, o ponto de referência dela cai **dentro**
do NFP. As posições que **encostam sem sobrepor** são exatamente os **vértices** do NFP. Isso
transforma uma busca contínua num punhado de candidatos — e é a diferença entre um encaixe que
roda em 70 ms e um que roda em minutos.

A soma de Minkowski vem do **clipper2**, como manda a decisão inegociável 3 da Parte 0: geometria
de biblioteca testada, nunca conta caseira.

> **Pegadinha medida:** `minkowskiDiff(a, b)` do clipper2 calcula `b ⊕ (−a)`, e não o contrário.
> Então `NFP(fixa, móvel)` é `minkowskiDiff(móvel, fixa)`. Foi determinado empiricamente antes de
> escrever uma linha do algoritmo — trocar isso dá um encaixe que parece certo e sobrepõe peças.

### H2. O FIO manda na rotação

É o que separa encaixe de roupa de encaixe genérico de polígonos. Uma peça de tecido plano **não
pode girar 90 graus**: o fio ficaria atravessado e a peça deformaria no uso, depois da primeira
lavagem. O que pode girar sai de `PropriedadesEncaixe.giro`, que **o modelista declarou** — este
pacote obedece, não adivinha.

| `giro` | o que quer dizer | ângulos |
|---|---|---|
| `forcar` | posição travada; nem virar de cabeça para baixo | 0 |
| `180` | pode virar de cabeça para baixo — o fio é uma LINHA, não uma seta | 0, 180 |
| `90` | pode deitar: só tecido sem direção de fio (malha, não-tecido) | 0, 90, 180, 270 |
| `livre` | qualquer ângulo; aqui em passos de 90 | 0, 90, 180, 270 |
| `esquerda` / `direita` | inclinar só para um lado, até `faixaGiroGraus` | 0, 180 e a inclinação |

`esquerda` e `direita` existem para tecido com listra ou xadrez, em que a peça pode ser levemente
enviesada **para um lado só** — inclinar para o outro trocaria o sentido do desenho do tecido.

### H3. Os eixos: a largura do rolo é **X**, a faixa corre em **+Y**

Mesma convenção do `@cad/plotter`. Não é detalhe de gosto: as duas fases falam do mesmo rolo, e
discordar de qual eixo é a largura seria a receita de um molde silenciosamente errado — o pior
tipo de falha que este projeto admite. Por isso `aplicarEncaixe` entrega as peças já postas **no
sistema que o HPGL consome**, sem nenhuma conversão pelo caminho.

Tem teste só para isso ([a costura entre as fases](#7-a-costura-com-o-hpgl)), porque uma
discordância de eixo **não apareceria em nenhum teste de pacote isolado**. Apareceria no papel,
com meia peça cortada.

### H4. Meia folga em cada peça, nunca a folga inteira

A folga padrão é **2 mm** — o que a faca precisa para não morder a vizinha. Ela é aplicada
inflando o contorno de **cada** peça em `folga / 2`, com `inflatePaths` do clipper2. Meia folga em
cada uma dá a folga inteira entre duas, e assim ela entra **uma vez só** na conta, em vez de
dobrar sem ninguém perceber.

### H5. Simplificar antes de encaixar, com a tolerância abaixo da folga

Uma cava tesselada tem centenas de vértices, e Minkowski entre dois polígonos de centenas de
vértices é caro sem ganho nenhum. O contorno é simplificado a **0,5 mm** antes de entrar no
encaixe.

0,5 mm está **muito abaixo** da folga de 2 mm: o erro é absorvido inteiro e nenhuma peça encosta
na outra por causa dele. A relação entre os dois números é a justificativa, não a conveniência.

### H6. Bottom-left com as maiores primeiro, e desempate determinístico

Heurística clássica: ordena as peças por área decrescente e coloca cada uma na posição de menor
avanço no rolo. O desempate é por `pecaId` e depois por número da cópia — **o mesmo modelo tem que
dar exatamente o mesmo encaixe**, senão o log não reproduz o que foi cortado.

### H7. O encaixe só decide POSIÇÃO e ÂNGULO

Ele não inventa geometria. Quem move a peça são as operações do motor (`rotacionarPeca`,
`espelharPeca`, `transladarPeca`), que já têm teste com número. `aplicarEncaixe` é uma composição
dessas, e nada mais.

### H8. Sem largura de rolo declarada, o encaixe RECUSA

Encaixar sem saber a largura do rolo não quer dizer nada — o resultado seria um número de metros
que não corresponde a rolo nenhum. Devolve `PAPEL_INVALIDO` e zero colocações.

---

## Os números medidos

Todos saíram de `npx vitest run` em `packages/encaixe`. **11 passando.**

### 1. O fio libera exatamente os ângulos que o ofício permite

```
forcar   -> 0 graus
180      -> 0, 180 graus
90       -> 0, 90, 180, 270 graus
livre    -> 0, 90, 180, 270 graus
```

### 2. Tecido plano NÃO deita para caber — e o encaixe recusa

Peça de corte 920 × 320 mm num rolo de 900 mm (880 úteis). Só caberia deitada:

```
giro "180" (tecido plano) -> 0 colocada, 1 erro: PECA_MAIS_LARGA_QUE_O_PAPEL
giro "90"  (malha)        -> 1 colocada, girada 90 graus
```

A mesma peça, o mesmo rolo: o que muda é **só** o fio declarado. É a decisão H2 valendo dinheiro —
a alternativa (deitar para caber) produziria um encaixe lindo e uma peça de roupa torta.

### 3. Doze peças, nenhuma encostando na outra

Blusa completa: 2 frentes, 2 costas, 2 mangas (par), 4 golas, 2 punhos, rolo de 1,60 m.

```
12 colocadas | faixa de 1580 mm | consumo 1.444 m
aproveitamento 73.6%
pares de caixas se sobrepondo: 0
```

**Zero sobreposição** é a única coisa que não pode falhar aqui, e é medida sobre a linha de CORTE
de cada peça já posta — não sobre o contorno que o algoritmo usou internamente.

### 4. Todas ficam dentro da faixa

```
largura util 0..1580 mm | x das pecas: 0-420, 422-842, 844-1264, 0-320, 322-642, 644-964
fora da faixa: 0
```

Lê-se a folga: 420 → 422, 842 → 844. **2 mm exatos** entre peças vizinhas, que é a decisão H4
aparecendo no número.

### 5. O encaixe ganha da fila da Fase 4

Frente ×2, manga ×2, gola ×4:

```
enfileirado (Fase 4): 3.056 m de rolo
encaixado   (Fase 5): 0.806 m | aproveitamento 83.3%
economia: 73.6% de tecido
```

Este é **o** número da fase. A fila da Fase 4 nunca foi um encaixe e a documentação dela diz isso
com todas as letras — mas agora existe a comparação, e ela é de 3,06 m para 0,81 m no mesmo molde.

> Para calibrar expectativa: 73,6% é a economia contra **enfileirar**, que é o pior caso possível.
> Contra um encaixe manual competente a diferença é muito menor — o ganho real de um CAD costuma
> ficar em poucos pontos percentuais, e poucos pontos percentuais de rolo, no ano, é o que paga o
> sistema. Vender 73% de economia contra o trabalho de uma encaixadeira experiente seria mentira.

### 6. O mesmo modelo dá o mesmo encaixe

```
duas execucoes: 7 colocacoes cada | identicas: true
```

Comparação por `JSON.stringify` das colocações inteiras. Sem isso o log não reproduz o corte.

### 7. A costura com o HPGL

```
encaixadas 8 pecas em 0.804 m de rolo | problemas: 0
enfileiradas 3 pecas (uma de cada: a fila nao repete copia) em 1.400 m de rolo
o encaixe diz 806 mm; o HPGL mede 804 mm (diferenca de 2.0 mm, dentro da folga de 2 mm)
```

Os 2 mm de diferença são exatamente a meia folga que o encaixe inflou em volta da peça e que o
corte real não tem. O `@cad/plotter` ganhou uma opção `pecasPostas`: quando ela vem, ele **não
enfileira** — desenha cada peça onde ela está. A dependência ficou de fora de propósito; o plotter
só sabe virar geometria em HPGL, e quem compõe as duas coisas é o app.

### 8. Par e conjuntos

```
manga com par=true, quantidade 2 -> 2 colocadas, 1 espelhada(s)
1 conjunto -> 2 pecas, 0.422 m | 3 conjuntos -> 6 pecas, 0.844 m
```

`par` faz metade das cópias sair espelhada — manga direita e esquerda do mesmo molde. `conjuntos`
multiplica o molde inteiro, que é como se encaixa uma grade de produção.

### 9. Sem rolo declarado, recusa

```
sem papel -> PAPEL_INVALIDO, 0 colocacoes
```

---

## No editor

Painel **Encaixe**, ao lado do de Arquivo:

- **encaixar** — roda e mostra a conta: peças colocadas, metros de rolo, largura útil,
  aproveitamento, e as peças recusadas com o motivo.
- **ver risco** — o risco em SVG por cima do editor: a faixa tracejada é a largura útil do rolo, o
  desenho é a linha de CORTE, cada peça com o nome no meio. Tem **baixar SVG** para imprimir.
- **HPGL** — o mesmo HPGL da Fase 4, mas com as peças encaixadas em vez de enfileiradas.

As três ações falam do **mesmo** encaixe guardado. Recalcular a cada clique daria três arranjos
parecidos e diferentes, e o operador cortaria por um enquanto olha outro.

> O risco aparece **por cima do editor**, e não numa aba nova: aba nova morre em bloqueador de
> popup, e vai morrer de novo dentro do wrap Tauri, onde não há aba nenhuma.

---

## Um defeito encontrado no caminho

Ligar o encaixe ao editor expôs um problema antigo no `@cad/editor-pixi`, e ele não tinha nada a
ver com encaixe:

O `resizeTo` do Pixi **só escuta o resize da janela**. Mas o canvas mora numa grade, e ela muda de
tamanho **sem a janela mudar**: fonte que termina de carregar, painel que abre, a própria montagem
da página. Quando isso acontecia a câmera ficava com o tamanho velho — medido, a câmera ficou
travada em **800 × 28** enquanto o canvas já era **1028 × 698**.

É o mesmo defeito que fazia o pique não pegar no contorno, por outra porta: o cursor mira num
lugar diferente do que a pessoa vê. A conferência de desenvolvimento (`conferirCamera`) já gritava
no console — ela existe justamente para isso —, mas ninguém tinha ligado o motivo.

Corrigido na raiz, para todo consumidor: um `ResizeObserver` no elemento pai, que reajusta a
câmera e redesenha. Depois da correção:

```
canvas: 1028 x 698   camera: 1028 x 698.4
```

Os 0,4 px são arredondamento de `devicePixelRatio`, dentro da tolerância de 1 px da conferência.

---

## O que esta fase NÃO faz

- **Não busca o ótimo.** Bottom-left com as maiores primeiro é heurística, não otimização.
  Encaixe ótimo de polígonos irregulares é NP-difícil; o que os CADs bons fazem é rodar muitas
  ordens e guardar a melhor. Aqui roda **uma** ordem, determinística. Melhorar isso é trocar a
  ordenação por uma busca (têmpera simulada ou genético sobre a permutação) — o NFP, que é a parte
  difícil e cara, já está pronto e não muda.
- **Não encaixa em rolo com defeito** (marcar trechos ruins do tecido para pular).
- **Não faz encaixe de listra casada** (alinhar a listra entre peças que se costuram).
- **Não gira em ângulo livre** — `livre` hoje anda de 90 em 90.
