# FASE 2 · PARTE 3 — Interação: hit-testing, snap, seleção, atalhos

> Cole junto com a Parte 0. Blocos 2, 3 e 8.

Tudo nesta parte é **`@cad/editor` puro** (E3): entra coordenada, sai decisão. Nada aqui sabe o que
é um `PointerEvent`.

---

## Hit-testing

O alvo é sempre procurado **em UM**, contra a geometria do motor — nunca contra o objeto desenhado,
cuja espessura muda com o zoom (Parte 1).

```ts
type Alvo =
  | { tipo: 'ponto';    pecaId: Id; pontoId: Id }
  | { tipo: 'controle'; pecaId: Id; segmentoId: Id; indice: 0 | 1 }
  | { tipo: 'pique';    pecaId: Id; piqueId: Id }
  | { tipo: 'aresta';   pecaId: Id; arestaId: Id; s: number; ponto: Vetor2 }
  | { tipo: 'interna';  pecaId: Id; linhaId: Id }
  | { tipo: 'peca';     pecaId: Id };

function acharAlvo(cena: Cena, alvo: Vetor2, raioUM: UM, camadas: EstadoDasCamadas): Alvo | null;
```

**Ordem de prioridade** — do alvo menor e mais difícil de acertar para o maior:

1. `controle` (alça de Bézier — só aparece com o segmento selecionado)
2. `ponto` do contorno
3. `pique`
4. `interna` (fio, pence)
5. `aresta` (via `localizarNoContorno`, que a Fase 1 já entrega)
6. `peca` (o cursor está dentro do contorno)

Camada travada ou invisível **não entra na busca**. `raioUM = RAIO_DE_CAPTURA_PX × umPorPixel`, com
`RAIO_DE_CAPTURA_PX = 10`.

Empate resolve pela **peça de cima** na ordem de desenho, e dentro dela pela ordem acima. Nunca por
`Object.keys` — ordem de mapa não é determinística o bastante para virar comportamento.

---

## Snap (E11)

Snap é decisão de interface: o motor entrega geometria, quem decide que o cursor "agarrou" é o
editor. **Alt segurado desliga tudo.**

```ts
type Snap =
  | { tipo: 'vertice';      ponto: Vetor2; pecaId: Id; pontoId: Id }
  | { tipo: 'meio';         ponto: Vetor2; pecaId: Id; arestaId: Id }
  | { tipo: 'noContorno';   ponto: Vetor2; pecaId: Id; arestaId: Id; s: number }
  | { tipo: 'intersecao';   ponto: Vetor2 }
  | { tipo: 'ortogonal';    ponto: Vetor2; anguloGraus: number }
  | { tipo: 'grade';        ponto: Vetor2 }
  | { tipo: 'eixo';         ponto: Vetor2; eixoId: Id };
```

| # | Tipo | O que agarra | Raio |
|---|---|---|---|
| 1 | `vertice` | ponto do contorno, ponta de fio, grade point | 12 px |
| 2 | `intersecao` | cruzamento de duas arestas / eixo com contorno | 10 px |
| 3 | `meio` | meio por **comprimento de arco** da aresta (`s = 0.5`) | 10 px |
| 4 | `eixo` | eixo de dobra e eixos de prega | 8 px |
| 5 | `ortogonal` | 0°, 45°, 90° a partir do ponto de origem do gesto | 8 px de desvio |
| 6 | `noContorno` | qualquer ponto do contorno (projeção perpendicular) | 8 px |
| 7 | `grade` | interseção da grade de 5 cm | 6 px |

**A ordem é de prioridade, não de proximidade.** Um vértice a 11 px ganha de um ponto de grade a
2 px: o modelista que aproximou o cursor de um canto quer o canto. Dentro do mesmo tipo, vence o
mais próximo.

**`meio` é por arco, não pelo `t` da Bézier** — o bônus da D1 vale aqui igual: `t = 0.5` não é o
meio da curva, e "pique no meio da cava" é um gesto real.

O snap ativo aparece na tela: um símbolo por tipo (quadrado para vértice, X para interseção,
triângulo para meio) mais o nome, no overlay. Sem realimentação visual, snap vira mistério.

**Configurável:** cada tipo liga/desliga num painel, e a preferência é do usuário, não do documento
— não entra no log.

---

## Seleção (Bloco 3)

```ts
class Selecao {
  readonly itens: readonly Alvo[];
  clicar(alvo: Alvo | null, mod: Modificadores): void;
  marquee(de: Vetor2, ate: Vetor2, mod: Modificadores): void;
  limpar(): void;
}
interface Modificadores { shift: boolean; ctrl: boolean; alt: boolean; }
```

- **Clique** sem modificador: substitui a seleção. No vazio: limpa.
- **Shift+clique**: alterna (adiciona se fora, tira se dentro).
- **Ctrl+clique**: adiciona sem tirar.
- **Marquee — a convenção de CAD, que é o oposto da de desenho:**
  - arrasto **da esquerda para a direita** = **janela**: pega só o que está **inteiramente** dentro;
    retângulo de linha cheia.
  - arrasto **da direita para a esquerda** = **cruzamento**: pega tudo o que a caixa **toca**;
    retângulo tracejado.

  Quem vem do AutoCAD, do Audaces ou do Gerber espera exatamente isso. Inverter confunde para
  sempre.
- **Duplo clique numa aresta**: seleciona a aresta inteira (todos os segmentos dela).
- **Duplo clique numa peça**: seleciona a peça inteira.
- `Esc` limpa; `Ctrl+A` seleciona todas as peças visíveis.

**Seleção heterogênea é permitida** (dois pontos e um pique), mas as ferramentas declaram o que
aceitam, e a barra mostra por que uma ferramenta está desabilitada — nunca falha em silêncio.

---

## Entrada numérica (E10) — o que separa CAD de desenho

**Toda ferramenta de arrasto aceita valor digitado no meio do gesto.** Começou a arrastar, apareceu
uma caixa flutuante com o valor corrente; digitar substitui, `Tab` alterna entre os campos, `Enter`
confirma, `Esc` cancela o gesto inteiro.

| Ferramenta | Campos |
|---|---|
| mover ponto / mover peça | `dx`, `dy` (mm) — e `Tab` alterna para `distância`, `ângulo` |
| rotacionar | `ângulo` (graus) |
| pique | `s` (0–1) ou `distância desde o início da aresta` (mm) |
| inserir ponto | `distância desde o início do segmento` (mm) |
| fillet / chanfro | `raio` / `distância` (mm) |
| margem | `mm` |
| dividir | `distância` do eixo, `ângulo` |

**A unidade da caixa é milímetro** (ou centímetro, por preferência) — o micrometro é interno e nunca
aparece na tela. Converte com `mmParaUM` na borda, como manda a D1.

Sem entrada numérica a ferramenta **não está pronta**: "arrastei mais ou menos 2 cm" não existe em
modelagem.

---

## Atalhos

Escolhidos para caber na mão esquerda, com a direita no mouse.

| Tecla | Ação |
|---|---|
| `V` | selecionar |
| `M` | mover ponto |
| `G` | mover peça (*grab*) |
| `N` | pique (*notch*) |
| `I` | inserir ponto |
| `C` | converter reta ↔ curva |
| `R` | rotacionar |
| `E` | espelhar |
| `F` | fillet |
| `H` | chanfro (*chamfer*) |
| `L` | medir (régua) |
| `T` | fio (*grainline*) |
| `Espaço` (segurado) | pan temporário, volta à ferramenta ao soltar |
| roda | zoom no cursor |
| `Ctrl+roda` | zoom fino (fator menor) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | desfazer / refazer (só o rascunho, E2) |
| `Ctrl+S` | salvar (sela) |
| `Ctrl+D` | duplicar peça |
| `Delete` | remover o selecionado |
| `Esc` | cancelar gesto; se não há gesto, limpar seleção |
| `Alt` (segurado) | desliga o snap |
| `Shift` (segurado) | restringe a ortogonal (0/45/90) |
| `1`–`9` | liga/desliga a camada n |
| `0` | enquadrar tudo |
| `.` | enquadrar a seleção |
| `Tab` | próximo tamanho da grade (só visualização, E9) |

`Esc` cancelando o gesto **sem emitir evento** é o mesmo mecanismo do erro do motor (E7): o
documento fica exatamente como estava.

---

## Cursores

| Estado | Cursor |
|---|---|
| selecionar | seta |
| sobre alça arrastável | mão aberta |
| arrastando | mão fechada |
| pique, inserir ponto | cruz |
| medir | cruz com régua |
| pan | mão |
| ferramenta bloqueada pela seleção | seta com proibido |

---

## Testes desta parte (todos headless)

1. **Prioridade do hit-testing:** um ponto e um pique a distâncias fixas, com o cursor entre os
   dois; conferir qual sai, e que camada travada some da busca. Números colados.
2. **Prioridade do snap:** vértice a 11 px × grade a 2 px → sai o vértice. Alt segurado → sai nada.
3. **`meio` por arco:** numa cava (Bézier assimétrica), o snap de meio cai em `s = 0.5` medido por
   arco, e **não** no ponto de `t = 0.5` — a distância entre os dois é colada, provando que a
   distinção importa.
4. **Marquee:** a mesma caixa em janela e em cruzamento pegando conjuntos diferentes, com a
   contagem colada.
5. **Zoom no cursor:** o ponto do mundo sob o cursor antes e depois do zoom é o mesmo, com erro
   ≤ 1 UM, para 5 fatores de zoom.
6. **Ida e volta de coordenada:** `paraMundo(paraTela(p)) == p` para 1000 pontos aleatórios, com o
   erro máximo colado (deve ser ≤ 1 UM, o arredondamento).
7. **Entrada numérica:** digitar `dx = 20 mm` no meio de um arrasto produz um evento
   `ModificarPonto` com `dx = 20000` exato — não o valor do último pixel.
8. **`Esc` no meio do gesto:** nenhum evento na sessão, e `sessao.versao` inalterada.
