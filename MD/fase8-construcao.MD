# Fase 8 — Construção: desenhar molde do zero

> É a maior lacuna frente ao Audaces, medida na comparação de 2026-09-13: a aba
> CONSTRUÇÃO inteira. Hoje peça nova entra por **foto, DXF ou IA** — não a lápis. Sem
> desenhar na tela, não nasce modelagem nova dentro do programa, e o modelista continua
> preso ao software antigo para criar.

Especificação escrita **antes** do código, como as outras. Nenhum número medido ainda:
tudo que exigir medida está marcado `[A MEDIR]`.

---

## Parte 0 — As decisões que não se negociam (K1 – K9)

### K1. Desenhar é EMITIR OS MESMOS EVENTOS de sempre

A ferramenta de desenho não ganha caminho novo no motor. Cada clique vira
`CriarPonto`/`DefinirAresta`/`DefinirSegmento` — os mesmos eventos que o DXF, a foto e a
IA já emitem, pelo mesmo `sessao.aplicar` que reconstrói o log antes de aceitar. O motor
não muda **nada** nesta fase; a fase é do editor.

Consequência de graça: desfazer, rascunho que sobrevive a travamento, conferência (E14) e
a guarda da IA valem para o desenho no dia zero.

### K2. Peça em construção é um estado da FERRAMENTA, não do modelo

Enquanto o contorno não fecha, não existe peça — existe uma poligonal na mão da
ferramenta (pura, testável headless, como toda ferramenta da Fase 2). O modelo só recebe
os eventos quando o contorno FECHA, num passo único de desfazer. O motor nunca vê contorno
aberto, então nenhuma invariante (CCW, anel fechado, aresta com margem) precisa de exceção
"temporária" — exceção temporária é onde invariante morre.

### K3. Fechar o contorno é clicar no primeiro ponto — e o snap de vértice já faz isso

Sem botão "fechar". O snap de vértice (raio em pixels, decisão E11) pega o primeiro ponto;
clicou nele, fechou. Se o winding sair CW, normaliza na emissão (D4) — o modelista desenha
no sentido que quiser.

### K4. Toda medida digitável, nenhuma obrigatória

O croqui a mão livre e a régua convivem: clica-se solto OU digita-se `Dx/Dy`, comprimento e
ângulo exatos (E10 — o campo já existe). O snap ortogonal já trava horizontal/vertical; o
"Por ângulo" do Audaces é o mesmo campo com ângulo digitado.

### K5. Reta e Bézier cúbica. Arco de círculo vira Bézier COM O ERRO DITO

O modelo do motor tem dois tipos de segmento e isso não muda (decisão da Fase 1: Bézier,
não NURBS). A ferramenta de arco existe para o operador ("arco por raio"), mas o que entra
no modelo é a Bézier que aproxima o arco — erro máximo de um quarto de círculo aproximado
por uma cúbica: **0,027% do raio** (fórmula conhecida; raio de 100 mm → 27 µm). O teste
imprime esse erro medido `[A MEDIR]`, e acima da tolerância do ofício o arco é subdividido.

### K6. Retângulo é açúcar

Dois cliques viram 4 pontos + 4 arestas + 4 segmentos, uma aresta por lado — porque margem
e pique ancoram em aresta (D3). Nada de "primitiva retângulo" no modelo.

### K7. Estender é esticar ATÉ, nunca além do digitado

"Estender reta", "estender até elemento": o ponto final anda ao longo da direção da reta
até a interseção calculada (`cruzarSegmentos`, que já existe) ou até o comprimento
digitado. É `MoverPonto` com alvo calculado — evento velho, gesto novo.

### K8. Texto no molde é LINHA INTERNA de tipo novo, não desenho

`TipoLinhaInterna` ganha `'texto'` com o conteúdo no payload. O texto acompanha a peça
(gira, espelha, escala) porque é dela; plotar texto vira caneta 3 no HPGL e camada 8 no
DXF `[A MEDIR: round-trip]`. Única mudança de modelo da fase, e é aditiva.

### K9. O que fica de fora, dito agora

Espiral, curvas cadastradas/pré-definidas (biblioteca de curvas do usuário) e "extrair
molde" de risco base ficam para depois — nenhum bloqueia criar modelagem nova. Entram como
K10+ quando alguém sentir falta com um caso real na mão.

---

## Parte 1 — As ferramentas, uma a uma

| Ferramenta | Atalho | O que emite ao fechar/aplicar |
|---|---|---|
| **Desenhar contorno** (reta ponto a ponto, `Shift` trava orto, clique no 1º fecha) | W | `CriarPeca` + pontos/arestas/segmentos |
| **Curva no desenho** (segue do último ponto como Bézier, alças arrastáveis) | dentro do W, tecla B alterna | segmento `curva` com controles |
| **Retângulo** (2 cliques ou largura×altura digitadas) | O | peça retangular completa |
| **Arco por raio** (centro, raio, varredura — digitáveis) | dentro do W, tecla A alterna | Bézier(s) aproximando, erro conferido |
| **Estender** (reta até elemento / até comprimento) | J | `MoverPonto` calculado |
| **Texto** (clica, digita) | Y | `AdicionarLinhaInterna` tipo `texto` |

Cantos vivos viram depois fillet/chanfro com as ferramentas que **já existem** (F/H); ponto
por interseção/perímetro/distância já são os snaps existentes (interseção, no-contorno,
meio, ortogonal) mais a entrada numérica.

## Parte 2 — Aceitação `[A MEDIR]`

1. Desenhar um retângulo 400 × 200 digitado → `medirAresta` devolve 400,00 e 200,00 exatos.
2. Fechar no snap de vértice a 8 px de distância do 1º ponto → fecha; a 20 px → não fecha.
3. Contorno desenhado em CW entra CCW no modelo (área com sinal positiva).
4. Arco de raio 100 mm → pior desvio da Bézier ao círculo verdadeiro, colado no teste.
5. Peça desenhada → margem, pique, graduação, encaixe e HPGL funcionam sem caso especial
   (o teste roda o ciclo inteiro).
6. Desfazer após fechar remove a peça INTEIRA (um passo).
7. Texto sobrevive a espelhar/rotacionar/dimensionar e ao round-trip DXF.

## Parte 3 — Estimativa honesta

A fase é quase toda `@cad/editor` + app (ferramenta pura + desenho na tela + atalhos).
Motor: só K8. É a maior fase de editor desde a 2 — na ordem de uma semana de trabalho
contínuo, não de um dia.
