# FASE 3 — DXF-AAMA/ASTM: importar e exportar

> Cole junto com a Parte 0 da Fase 1. As decisões D1–D10 e E1–E14 continuam valendo.

## Por que esta fase vem antes do plotter e do encaixe

Sem DXF o sistema é uma ilha. O cliente não traz o acervo dele, não manda arquivo para a facção nem
para a cortadora, e não tem como sair se quiser. **É o DXF que permite pôr numa confecção como
piloto** — e é por isso que ele vale mais que qualquer ferramenta a mais no editor.

**Fonte da norma:** ASTM **D6673** (*Standard Practice for Sewn Products Pattern Data Interchange*),
retirada em 2019 mas ainda o formato de troca de fato entre Audaces, Gerber, Lectra e Optitex. A
tabela de camadas foi levantada no **Caso 1 da Parte 7 da Fase 1** e o modelo já foi construído para
mapear 1:1 — três buracos (piques *check* e *U*, recortes internos, linha de referência de
graduação) foram fechados lá, justamente para esta fase não precisar reescrever nada.

---

## Decisões fechadas

### F1 — Exporta **DXF R12 ASCII**, com `POLYLINE`/`VERTEX`, não `LWPOLYLINE`

`LWPOLYLINE` é de R14 e é mais curta, mas o parque de CAD de molde lê R12. Compatibilidade máxima
vale mais que arquivo menor num formato cujo propósito inteiro é ser lido por outro programa.

### F2 — A unidade do arquivo é **milímetro com 3 casas decimais**

E isso não é escolha estética: **0,001 mm é exatamente 1 UM**. Com três casas, `UM → mm → UM` é
**sem perda**, e o round-trip pode ser exigido byte a byte em vez de "dentro da tolerância". Menos
casas perderia micrometro; mais casas seria ruído. O cabeçalho declara `$INSUNITS = 4` (milímetros).

### F3 — Uma peça = um **BLOCK**; a colocação é um **INSERT**

É como a ASTM agrupa os elementos de uma peça. O nome do bloco é o nome da peça, saneado para o que
o DXF aceita (maiúsculas, sem espaço). Peças com nomes que saneiam para o mesmo bloco ganham sufixo
numérico — **duas peças nunca compartilham bloco**, porque isso as fundiria na importação.

### F4 — Importar produz **EVENTOS**, nunca uma `Peca` montada à mão

A regra E1 vale aqui inteira: o documento é o fold do log. Um importador que montasse `Peca` direto
criaria o caminho paralelo que o projeto inteiro existe para não ter — e o arquivo importado não
sobreviveria a um replay.

### F5 — Os **turn points** (camada 2) definem as **arestas**

É para isso que a camada 2 existe na norma. O trecho do contorno entre dois turn points consecutivos
vira uma `Aresta` (D3), que é o que sustenta margem por aresta, `ParCostura` e âncora de pique.

Arquivo **sem** camada 2 é importado com **uma aresta por corda** e um aviso: o molde funciona, mas
margem e pique ficam ancorados em arestas de um segmento só, e o modelista vai querer juntar.

### F6 — A margem é **medida**, não adivinhada

Quando o arquivo traz a camada 1 (corte) além da 14 (costura), a margem de cada aresta é medida
lançando a normal externa do meio da aresta até o anel de corte — a **mesma conta de
`projetarPique`**, reusada. Sem a camada 1, a margem entra como **zero** e o validador acusa
`MARGEM_AUSENTE`: o motor não assume margem, porque assumir errado custa tecido.

O valor medido é arredondado para **0,5 mm**, que é como a indústria trabalha; a medida crua vai no
relatório da importação para conferência.

### F7 — Round-trip é **teste, não promessa**

Exportar e reimportar tem que devolver as mesmas medidas — perímetro, área e comprimento por aresta
— com os números colados. E os cinco tipos de pique (camadas 4, 80, 81, 82, 83) têm que sobreviver
**sem colapsar num tipo só**, que é o teste que a Parte 7 deixou marcado.

### F8 — O importador **relata**, e nunca conserta em silêncio

Camada desconhecida, entidade não suportada, polilinha aberta onde deveria ser fechada, peça sem
fio: tudo vira `Problema` no relatório da importação. Arquivo de outro CAD sempre traz surpresa, e
esconder a surpresa é como um molde errado entra na produção.

---

## Mapa camada ↔ modelo

| Camada | Entidade | No modelo |
|---|---|---|
| 1 | `POLYLINE` fechada | linha de corte (`offsetMargem`) — na importação, serve para **medir** a margem |
| 2 | `POINT` | turn point → fronteira de `Aresta` |
| 3 | `POINT` | curve point → controles da Bézier (D1) |
| 4 | `POINT` | pique `I`, `V`, `V1`, `V2` |
| 5 | `POINT` / `LINE` | grade point e linha de referência de graduação |
| 6 | `LINE` | eixo de dobra / espelho |
| 7 | `LINE` | fio do tecido |
| 8 | `POLYLINE` | linha interna (pence, referência) |
| 11 | `POLYLINE` fechada | recorte interno |
| 13 | `POINT` | furo de broca |
| 14 | `POLYLINE` fechada | linha de costura — **o contorno** |
| 15 | `TEXT` | nome da peça e tamanho |
| 80–83 | `POINT` | pique `T`, `MX`/`M+`/`MX2`, `CHECK`, `U` |

Camadas **9 e 10** (referência de listra e xadrez) continuam abertas: são de encaixe, e esperam a
Fase 5.

---

## O que esta fase NÃO faz

- **Não** exporta a grade inteira num arquivo só. Um arquivo por tamanho, que é o que o parque lê
  sem discussão. Exportar a grade encaixada num DXF é assunto de outra rodada.
- **Não** lê DXF binário. ASCII é o que a troca usa.
- **Não** interpreta `SPLINE`. A D1 fechou a curva em Bézier cúbica; `SPLINE` de grau alto vira
  polilinha tesselada, com aviso.


---

## O que a implementação mostrou — Fase 3 fechada

`@cad/dxf`: **14 testes**, TypeScript puro. **384 testes no total.**

### O arquivo

```
203 pares | 1 BLOCK, 1 INSERT, 3 POLYLINE, 12 POINT, 1 LINE, 1 TEXT
versao AC1009 (R12) | INSUNITS 4 (milimetros)

POLYLINE nas camadas 1, 7, 14   (corte, fio, costura)
POINT    nas camadas 2, 5       (turn point, grade point)
LINE     na camada  6           (eixo de dobra)
TEXT     na camada  15          (anotacao)

duas pecas chamadas "FRENTE" -> blocos FRENTE e FRENTE_2 (F3)
```

### A conversão é sem perda (F2)

```
     0 UM ->    0.000 mm ->      0 UM
     1 UM ->    0.001 mm ->      1 UM
  6350 UM ->    6.350 mm ->   6350 UM
190000 UM ->  190.000 mm -> 190000 UM
-45678 UM ->  -45.678 mm -> -45678 UM
```

### Round-trip (F7)

```
perimetro 1186.48 -> 1186.48 mm
area         782.00 -> 782.00 cm2
pontos            6 -> 6 | 0 avisos

comprimento por aresta
  antes:  180.0, 300.2, 136.0, 92.2, 78.1, 400.0 mm
  depois: 180.0, 300.2, 136.0, 92.2, 78.1, 400.0 mm
```

**A margem medida bateu exata**, aresta por aresta — a normal externa do meio da aresta até o anel
de corte devolveu os valores originais sem arredondamento nenhum:

```
ar-0: medida 40.00 mm -> gravada 40 mm
ar-1: medida 12.00 mm -> gravada 12 mm
ar-2: medida 10.00 mm -> gravada 10 mm
ar-3: medida 12.00 mm -> gravada 12 mm
ar-4: medida  8.00 mm -> gravada  8 mm
ar-5: medida  0.00 mm -> gravada  0 mm
```

### Os cinco piques — o teste que a Parte 7 deixou marcado

```
no arquivo, camadas: 4, 80, 81, 82, 83
de volta: CHECK@0.660, MX@0.490, T@0.320, U@0.830, V@0.150
```

Cinco tipos entraram, cinco voltaram, cada um no seu `s`. **Nenhum colapsou num tipo só** — que era
exatamente o risco que a Parte 7 apontou quando acrescentou `CHECK` e `U` ao modelo.

### O importador relata (F8)

```
sem a camada 1  -> margens 0, 0, 0, 0, 0, 0 mm + [aviso] MARGEM_AUSENTE
sem a camada 2  -> 6 arestas (uma por corda) + [aviso] ARESTA_SEM_SEGMENTOS
SPLINE          -> ignorada + [aviso] CURVA_SEM_CONTROLES
bloco sem contorno -> pulado, o resto do arquivo continua sendo lido
arquivo truncado   -> ESTOURA, em vez de ler o que der
```

### Um defeito que o próprio round-trip encontrou

O exportador escreve o fio como `POLYLINE` (a norma admite `LINE` **ou** `POLYLINE` na camada 7) e o
importador só lia `LINE`. Resultado: o fio sumia ao reimportar o arquivo que o próprio sistema tinha
gerado. Agora o importador aceita as duas formas nas camadas internas — e o aviso de `FIO_AUSENTE`
também passou a olhar as duas, senão avisava de um fio que estava lá.

**Próximo:** plotter/HPGL (Fase 4, com o wrap Tauri) e encaixe (Fase 5).
