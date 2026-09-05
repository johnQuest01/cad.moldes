# FASE 2 · PARTE 2 — Bloco 0: as lacunas do motor

> Cole junto com a Parte 0.

**Comece por aqui.** Antes de qualquer linha de editor, o motor precisa saber representar tudo o
que o modelista vai fazer. Hoje ele não sabe, e as faltas não são detalhe: **três operações que
existem não têm evento** (ou seja, o que elas fazem não sobrevive a um replay do log), **um gesto
central não existe em lugar nenhum** (arrastar o controle de uma Bézier) e **oito remoções não têm
como acontecer** — dá para adicionar fio, recorte, grade point, regra de graduação e par de costura,
e não dá para tirar.

Se o editor for construído por cima disso, ele vai inevitavelmente mutar `Peca` por fora do log
para preencher o buraco — e aí o log deixa de ser a fonte de verdade, que é a única coisa que
sustenta o backend, o offline e a auditoria. Por isso este é o Bloco 0.

## Levantamento

Cruzando os 28 eventos declarados em `eventos/tipos.ts` com as operações exportadas em `index.ts`:

| Operação do motor | Tem evento? |
|---|---|
| `modificarPonto`, `inserirPonto`, `excluirPonto`, `converterSegmento` | sim |
| `arredondarVertice`, `chanfrarVertice`, `simplificarContorno` | sim |
| `transladarPeca`, `rotacionarPeca`, `espelharPeca` | sim |
| `adicionarPique`, `moverPique`, `removerPique` | sim (Fase 1, fechado) |
| **`dividirPeca`** | **NÃO** |
| **`abrirPregas`** | **NÃO** |
| `offsetMargem`, `aplicarGraduacao`, `contornoDesdobrado`, `validar*`, `medir*` | derivadas — não devem ter evento |

E os gestos que o editor precisa e o motor não representa:

| Gesto | Existe? |
|---|---|
| **Arrastar o controle de uma Bézier** (dar forma à curva) | **não existe operação nem evento** |
| **Duplicar peça** (frente → costas é o começo de todo molde) | **não existe** |
| Tirar linha interna / recorte / grade point / regra / par de costura / peça | **não existe** |
| Trocar as propriedades de encaixe depois de criada a peça | **não existe** (só em `CriarPeca`) |

**Total do Bloco 0: 11 eventos e 2 operações novas.**

---

## 1. `moverControle` — a curva ganha forma

**É a lacuna mais importante.** Hoje `converterSegmento(peca, id, 'curva')` põe os dois controles a
1/3 e 2/3 da própria reta — a Bézier nasce geometricamente idêntica à reta, de propósito, para
converter não mudar medida nenhuma. Mas **não há nenhuma forma de mexer nesses controles depois**.
Sem isso, o modelista converte o segmento em curva e a curva continua reta para sempre: a cava e o
decote de qualquer molde ficam impossíveis de desenhar.

```ts
/** Move UM dos dois controles de um segmento curvo. Nao muta a entrada. */
export function moverControle(
  peca: Peca,
  segmentoId: Id,
  indice: 0 | 1,
  dx: UM,
  dy: UM,
): Peca;
```

**Regras:**
- O segmento tem que existir, ser do contorno e ser `tipo: 'curva'`; reta não tem controle.
  Recusa: `SEGMENTO_INEXISTENTE`, `CURVA_SEM_CONTROLES`.
- `indice` é 0 (controle junto de `de`) ou 1 (junto de `para`). Fora disso:
  `CONTROLE_INEXISTENTE` (código novo).
- `dx`/`dy` passam por `exigirUM`.
- **Não** mexe nos pontos extremos: mover controle muda a barriga da curva, nunca onde ela começa
  e termina. É essa separação que permite ao vizinho continuar casando.
- O resultado tem que continuar sendo uma curva não degenerada: se os dois controles caírem em
  cima do mesmo ponto de um extremo a ponto de a curva ter comprimento zero, recusa com
  `CURVA_DEGENERADA` (o motor já tem o código).

**Evento:**
```ts
export type MoverControle = Envelope<'MoverControle', {
  readonly segmentoId: Id;
  readonly indice: 0 | 1;
  readonly dx: UM;
  readonly dy: UM;
}>;
```

**Testes exigidos (com número colado):**
1. Numa reta convertida em curva, mover o controle 0 em `(0, +20 mm)` **aumenta o comprimento
   medido** da aresta, e os pontos extremos ficam **idênticos** (comparação exata de coordenada).
2. O comprimento medido bate com a tesselação: medir a mesma curva com tolerância 10 UM e com
   tolerância 100 UM dá a mesma medida dentro do orçamento da Parte 6 da Fase 1.
3. Mover o controle e desfazer o movimento (`-dx, -dy`) devolve a peça **byte a byte igual** à
   original (`JSON.stringify` idêntico) — prova que a operação é pura e reversível.
4. Sob graduação, uma curva com controle deslocado continua graduando: o `s` de um pique naquela
   aresta não muda, e a coordenada muda.
5. Recusas: segmento reto, índice 2, segmento inexistente — cada uma com seu código.

---

## 2. `duplicarPeca` — frente vira costas

Todo molde começa assim: desenha-se a frente, duplica-se, ajusta-se o decote e vira costas. Sem
isto, o modelista redesenha tudo.

```ts
/**
 * Copia a peca inteira com ids novos, derivados de `prefixoId` (D2: entropia de fora).
 * `deslocamentoUM` afasta a copia da original para as duas nao ficarem sobrepostas.
 */
export function duplicarPeca(
  peca: Peca,
  novoPecaId: Id,
  prefixoId: Id,
  deslocamento: { readonly dx: UM; readonly dy: UM },
): Peca;
```

**Regras:**
- **Todo** id interno é reescrito de forma determinística: `${prefixoId}-pt-0`, `-sg-0`, `-ar-0`,
  `-pq-0`, `-li-0`, `-rc-0`, `-ed-0`, `-gp-0`. Reaproveitar id de ponto entre duas peças faz
  `ParCostura` e regra de graduação apontarem para o lugar errado.
- As referências internas são remapeadas junto: `contorno`, `Aresta.pontoInicioId/pontoFimId`,
  `Segmento.de/para/arestaId`, `LinhaInterna.pontos`, `Recorte.pontos`, `Pique.arestaId`,
  `PontoGraduacao.pontoId`.
- **Não** copia as regras de graduação: elas vivem no `Modelo` e apontam para `gradePointId`. O
  fold é quem decide; ver o evento abaixo.
- O nome ganha sufixo: `FRENTE` → `FRENTE (copia)`. O modelista renomeia depois.
- `deslocamento` é aplicado com `transladarPeca`, que já existe e já é testado.

**Evento:**
```ts
export type DuplicarPeca = Envelope<'DuplicarPeca', {
  readonly novoPecaId: Id;
  readonly prefixoId: Id;
  readonly dx: UM;
  readonly dy: UM;
  /** Copiar tambem as regras de graduacao dos grade points? */
  readonly comGraduacao: boolean;
}>;
```
Com `comGraduacao: true`, o fold duplica cada `RegraGraduacao` cujo `pontoGraduacaoId` pertença à
peça de origem, apontando a cópia para o grade point novo, com id `${prefixoId}-r-N`.

**Testes exigidos:**
1. A cópia tem **a mesma área, o mesmo perímetro e a mesma medida por aresta** que a original
   (números colados), e **nenhum id em comum** (interseção de conjuntos vazia).
2. Editar a cópia (`modificarPonto`) **não muda a original** — comparação exata.
3. Com `comGraduacao: true`, a cópia gradua igual: `aplicarGraduacao` nos três tamanhos dá as
   mesmas larguras que a original.
4. Com `comGraduacao: false`, a cópia não gradua (fica parada) e o validador acusa
   `GRADE_POINT_SEM_REGRA`.

---

## 3. `DividirPeca` — a operação existe, o evento não

`dividirPeca(peca, eixo, margemNovaUM, prefixoId)` devolve `[Peca, Peca]` com ids
`${peca.id}-1` e `${peca.id}-2`. O fold precisa **substituir** a peça original pelas duas.

```ts
export type DividirPeca = Envelope<'DividirPeca', {
  readonly p1: Vetor2;
  readonly p2: Vetor2;
  readonly margemNovaUM: UM;
  readonly prefixoId: Id;
}>;
```

**Regras do fold:**
- A peça do envelope (`evento.pecaId`) tem que existir; ela **desaparece** e as duas partes entram
  no lugar.
- As regras de graduação que apontavam para grade points da peça original continuam válidas: os
  grade points são repartidos entre as partes por `repartirGradePoints`, que já existe. As que
  ficaram órfãs viram `GRADE_POINT_SEM_REGRA` no validador, que é o comportamento certo — a divisão
  é um ato do modelista, e ele que decida a graduação das partes novas.
- `ParCostura` que apontava para uma aresta que sobreviveu continua apontando; para uma que sumiu,
  o validador acusa. **Não** apagar silenciosamente.

**Testes exigidos:**
1. Reconstruir só pelo log com `DividirPeca` dá **exatamente** o mesmo par de peças que chamar
   `dividirPeca` na mão (comparação canônica por `JSON.stringify` ordenado).
2. Depois do evento, a peça original **não existe mais** no modelo, e existem `-1` e `-2`.
3. A soma das áreas de corte das partes é **maior** que a área de corte da inteira, pelo tanto da
   margem nova nas duas arestas de corte (número colado — a Fase 1 já mede isso na fig-10).
4. Replay duas vezes dá o mesmo resultado (determinismo).

---

## 4. `AbrirPregas` — idem

```ts
export type AbrirPregas = Envelope<'AbrirPregas', {
  readonly eixoIds: readonly Id[];
  readonly prefixoId: Id;
}>;
```
O fold chama `abrirPregas(peca, eixoIds, prefixoId)` e troca a peça. Os piques de início e fim de
cada prega, que a operação já cria, passam a existir no log — hoje eles só existem em memória.

**Testes exigidos:** reconstruir pelo log bate com a chamada direta; a largura plana bate com a
conta manual (`200 + 3 × (2 × 20) = 320 mm`, que a fig-11 já mede); os piques de prega aparecem no
modelo reconstruído.

---

## 5. As oito remoções e a propriedade de encaixe

Todos seguem o padrão que `RemoverEixoDobra` já estabeleceu no fold: exigir que a entidade exista
(`exigirDoMapa`, com o código de erro próprio) e devolver o mapa sem ela. **Não** são silenciosos:
remover o que não existe é erro, não no-op.

| Evento | Payload | Recusa se |
|---|---|---|
| `RemoverLinhaInterna` | `{ linhaId }` | a linha não existe |
| `RemoverRecorte` | `{ recorteId }` | o recorte não existe |
| `DesmarcarGradePoint` | `{ gradePointId }` | o grade point não existe |
| `RemoverRegraGraduacao` | `{ regraId }` | a regra não existe |
| `RemoverParCostura` | `{ parId }` | o par não existe |
| `RemoverPeca` | `{}` (peça no envelope) | a peça não existe |
| `RenomearPeca` | `{ nome }` | a peça não existe, ou nome vazio |
| `DefinirEncaixe` | `{ encaixe: PropriedadesEncaixe }` | a peça não existe |

**Duas regras de integridade que o fold precisa aplicar, e que não são óbvias:**

1. **`DesmarcarGradePoint` deixa regras órfãs.** O fold **não** apaga as regras junto — apagar em
   cascata esconde do modelista que ele acabou de perder a graduação daquele ponto. As regras ficam,
   e `validarModelo` passa a acusar. Se ele quiser mesmo, emite `RemoverRegraGraduacao` também.
   *(Consequência: `validarModelo` precisa de um código novo, `REGRA_SEM_GRADE_POINT`.)*

2. **`RemoverPeca` deixa `ParCostura` pendurado.** Mesma decisão, mesma razão: o par fica, e a
   conferência acusa. Um molde em que uma costura perdeu o par tem que gritar.

**Testes exigidos:** para cada um, o par (remove → sumiu) e (remove de novo → estoura com o código
certo); mais os dois testes de integridade acima, com o problema do validador colado.

---

## Códigos de erro novos

```
CONTROLE_INEXISTENTE        moverControle com indice fora de {0,1}
SEGMENTO_NAO_E_CURVA        moverControle num segmento reto
LINHA_INTERNA_INEXISTENTE   RemoverLinhaInterna
RECORTE_INEXISTENTE         RemoverRecorte
REGRA_GRADUACAO_INEXISTENTE RemoverRegraGraduacao
PAR_COSTURA_INEXISTENTE     RemoverParCostura
REGRA_SEM_GRADE_POINT       (so como Problema) regra apontando para grade point que sumiu
PECA_COM_PAR_PENDENTE       (so como Problema) ParCostura apontando para peca/aresta que sumiu
NOME_VAZIO                  RenomearPeca com nome em branco
```

## Critério de pronto do Bloco 0

- `VERSAO_SCHEMA_ATUAL` **continua 1**: só entraram tipos novos de evento, nenhum payload existente
  mudou de forma. Um log antigo reconstrói igual — e isso é um teste, não uma afirmação.
- Os 11 eventos aparecem no `TipoEvento` e têm `case` no fold; nenhum ramo morto.
- Cada operação nova é exportada em `index.ts` e coberta por `scripts/verificar-dist.mjs`.
- **Teste de exaustividade**: um teste que percorre `TipoEvento` e falha se algum tipo não tiver
  `case` no fold. Sem ele, o próximo evento esquecido só aparece em produção.
- Os 201 testes anteriores continuam passando, com o número colado.
