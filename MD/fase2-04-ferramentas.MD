# FASE 2 · PARTE 4 — Catálogo das ferramentas

> Cole junto com a Parte 0. Blocos 4 e 7.

## O contrato (E7)

Toda ferramenta é uma máquina de estados pura. Sem DOM, sem Pixi, sem acesso à sessão a não ser
para **emitir**.

```ts
interface Ferramenta {
  readonly nome: string;
  readonly atalho: string;
  /** O que precisa estar selecionado. Vazio = funciona sem seleção. */
  readonly exige: readonly Alvo['tipo'][];

  aoEntrar(ctx: Contexto): void;
  aoApontar(ctx: Contexto, em: Vetor2, mod: Modificadores): void;   // pointerdown
  aoArrastar(ctx: Contexto, em: Vetor2, mod: Modificadores): void;  // pointermove com botão
  aoSoltar(ctx: Contexto, em: Vetor2, mod: Modificadores): void;    // pointerup
  aoTecla(ctx: Contexto, tecla: string, mod: Modificadores): void;
  aoNumero(ctx: Contexto, campos: Record<string, number>): void;    // entrada numérica (E10)
  aoSair(ctx: Contexto): void;
}

interface Contexto {
  readonly modelo: Modelo;
  readonly selecao: Selecao;
  readonly camera: Camera;
  readonly snap: (em: Vetor2, mod: Modificadores) => Snap | null;
  readonly alvo: (em: Vetor2) => Alvo | null;
  /** Desenho provisório do gesto; NÃO entra no log. */
  previsualizar(peca: Peca | null): void;
  /** Único caminho para mudar o documento. */
  emitir(...eventos: readonly Evento[]): void;
  /** Recusa do motor: mostra e cancela o gesto, sem emitir (E7). */
  recusar(erro: ErroMotor): void;
}
```

**As três regras que valem para todas:**

1. **Um gesto = um evento** (ou nenhum). Arrastar de A a B emite um `ModificarPonto` de `(dx, dy)`
   total, não sessenta.
2. **Erro do motor cancela.** Toda chamada é envolta em `try/catch (ErroMotor)`; no `catch`,
   `ctx.recusar(erro)` — a previsualização some, nada é emitido, e a mensagem aparece com o código.
3. **`Esc` cancela**, `aoSair` limpa a previsualização. O documento fica intacto.

---

## Bloco 4 — as seis essenciais

### 1. Selecionar · `V`
Clique, shift/ctrl, marquee janela × cruzamento (Parte 3). Não emite evento nenhum. Duplo clique
seleciona a aresta ou a peça inteira.

### 2. Mover ponto · `M`
> `modificarPonto(peca, pontoId, dx, dy, modo, nVizinhos)` → `ModificarPonto`

O gesto central da modelagem. Barra de opções: **modo** (discreto / proporcional) e **vizinhos**
(0–6 de cada lado). No proporcional os vizinhos acompanham com o decaimento `(1+cos(πi/(N+1)))/2`,
que é a conta que não deixa bico na curva.

- `Shift` restringe a ortogonal; `Alt` desliga o snap.
- Aceita `dx`/`dy` digitados, ou `distância`+`ângulo`.
- Arrastar **grade point** move o ponto; a regra de graduação continua onde está (as regras são
  deslocamentos, não coordenadas).
- **Edita sempre o tamanho base (E9)**, mesmo com outro tamanho na tela.

*Recusas a tratar:* `PONTO_INEXISTENTE`, `N_VIZINHOS_EXCEDE_CONTORNO`, `PONTO_FORA_DO_CONTORNO`.

### 3. Mover peça · `G`
> `transladarPeca` → `TransladarPeca`

Arrasta a peça inteira. Com várias peças selecionadas, emite um evento por peça, **todos no mesmo
gesto** (um `emitir(...)` só) — assim o undo desfaz o movimento inteiro, não peça por peça.

### 4. Pique · `N`
> `adicionarPique` / `moverPique` / `removerPique` → os três eventos

- Clique no contorno crava na posição `s` (`localizarNoContorno`).
- Arrastar um pique existente desliza na **mesma** aresta; puxar para outra aresta não faz nada —
  trocar de aresta é apagar e recravar, e isso o modelista faz de propósito.
- `Delete` tira o selecionado.
- Barra de opções: **tipo** (`I V V1 V2 T MX M+ MX2 CHECK U`, com a camada ASTM ao lado),
  **profundidade** (padrão 6,35 mm) e **largura** (padrão 1,59 mm) — o notcher 1/4″ × 1/16″.
- Aviso ao vivo se a profundidade passar da margem da aresta
  (`PIQUE_MAIS_FUNDO_QUE_A_MARGEM`).
- O pique é desenhado **na linha de corte**, entrando para dentro, com a haste da projeção
  perpendicular até a costura.

### 5. Inserir ponto · `I`
> `inserirPonto(peca, segmentoId, s, prefixoId)` → `InserirPonto`

Clique no contorno; o segmento vira dois. `s` é **estritamente** entre 0 e 1 — os extremos já são
pontos. Aceita distância digitada a partir do início do segmento.
`Alt+clique` num ponto do meio de uma aresta faz o inverso: `excluirPonto` → `ExcluirPonto`, que
funde os dois segmentos vizinhos.

*Recusas:* `S_FORA_DA_FAIXA`, `PONTO_NOTAVEL_NAO_REMOVIVEL`, `GRADE_POINT_NAO_REMOVIVEL`,
`MERGE_DE_CURVA_NAO_REPRESENTAVEL`.

### 6. Medir · `L`
> `medirAresta`, `medirSegmento`, `compararPerimetros` — não emite evento

Clique em duas entidades e a cota aparece no overlay: distância reta, e comprimento **por arco** se
forem pontos da mesma aresta. Clicar numa aresta dá o comprimento dela. Clicar em duas arestas
pareadas mostra a diferença e o embebido esperado (`ParCostura.embebidoUM`, D9).

A régua é onde se confere que a tela não mente: **todo número vem de uma função de medida do motor.**

---

## Bloco 7 — as dezesseis restantes

### Forma da peça

| # | Ferramenta | Operação | Evento | Notas |
|---|---|---|---|---|
| 7 | **Controle da curva** | `moverControle` | `MoverControle` | Bloco 0. Alças aparecem no segmento selecionado; arrastar dá forma à cava e ao decote. Os extremos não se movem. |
| 8 | **Converter reta ↔ curva** · `C` | `converterSegmento` | `ConverterSegmento` | reta→curva não muda medida nenhuma (controles a 1/3 e 2/3); curva→reta muda, e é o que foi pedido. |
| 9 | **Fillet** · `F` | `arredondarVertice` | `ArredondarVertice` | raio digitado ou arrastado. Recusa `FILLET_NAO_CABE`, `FILLET_EM_CURVA_NAO_SUPORTADO`. |
| 10 | **Chanfro** · `H` | `chanfrarVertice` | `ChanfrarVertice` | duas distâncias. |
| 11 | **Simplificar** | `simplificarContorno` | `SimplificarContorno` | tolerância em mm, com o **antes/depois de contagem de pontos e de área** na tela antes de confirmar. Operação destrutiva: pede confirmação. |

### Peça

| # | Ferramenta | Operação | Evento |
|---|---|---|---|
| 12 | **Rotacionar** · `R` | `rotacionarPeca` | `RotacionarPeca` |
| 13 | **Espelhar** · `E` | `espelharPeca` | `EspelharPeca` |
| 14 | **Duplicar** · `Ctrl+D` | `duplicarPeca` (Bloco 0) | `DuplicarPeca` |
| 15 | **Dividir** | `dividirPeca` | `DividirPeca` (Bloco 0) |
| 16 | **Renomear / remover** | — | `RenomearPeca`, `RemoverPeca` (Bloco 0) |

Rotacionar mostra o ângulo ao vivo e aceita digitado; `Shift` prende em 15°. O centro padrão é o
centro da caixa da peça, e pode ser recolocado clicando antes de arrastar.

### Costura, dobra, prega

| # | Ferramenta | Operação | Evento |
|---|---|---|---|
| 17 | **Margem** | — | `DefinirMargem` | por aresta, em mm; aceita várias arestas selecionadas de uma vez |
| 18 | **Eixo de dobra** | — | `DefinirEixoDobra` / `RemoverEixoDobra` | dois cliques; a peça desdobrada aparece em fantasma |
| 19 | **Pregas** | `abrirPregas` | `AbrirPregas` (Bloco 0) | seleciona N eixos paralelos e abre; mostra a abertura somada |
| 20 | **Par de costura** | — | `DefinirParCostura` / `RemoverParCostura` (Bloco 0) | clica duas arestas, **de peças diferentes** (D3); campo de embebido (D9); a conferência mostra na hora se casam |

### Geometria interna e graduação

| # | Ferramenta | Operação | Evento |
|---|---|---|---|
| 21 | **Fio / linha interna** · `T` | — | `CriarPonto` + `AdicionarLinhaInterna` / `RemoverLinhaInterna` | os pontos são `Ponto` de verdade (D10), então a linha gradua pela mesma regra do contorno |
| 22 | **Grade point e regra** | — | `MarcarGradePoint` / `DesmarcarGradePoint` / `DefinirRegraGraduacao` / `RemoverRegraGraduacao` | tabela por tamanho consecutivo (D8); a âncora é o grade point sem regra (D7) |

O painel de graduação mostra os tamanhos encaixados enquanto se digita a regra — é assim que se
percebe um salto errado antes de cortar.

---

## O que cada ferramenta precisa provar (Parte 5)

Para **cada** ferramenta, três testes, todos headless, com o número colado:

1. **O gesto emite o evento certo.** Um roteiro de ponteiro (`apontar → arrastar → soltar`) produz
   exatamente um evento, do tipo certo, com o payload numérico esperado.
2. **A recusa não emite nada.** Um gesto que o motor recusa deixa `sessao.versao` inalterada, e o
   código do `ErroMotor` chega na interface.
3. **`Esc` no meio cancela.** Nem evento, nem previsualização pendurada.

Mais, por ferramenta, um teste do que ela tem de particular — o decaimento nos vizinhos, o `s` por
arco do pique, o fillet que não cabe, o `reta→curva` que não muda medida.

**Contagem esperada ao fim do Bloco 7:** 22 ferramentas × 3 + os particulares ≈ **80 testes** só de
ferramenta, sobre os 201 que já existem.
