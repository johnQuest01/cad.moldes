# FASE 4 — Plotter (HPGL) e o wrap Tauri

> Cole junto com a Parte 0 da Fase 1.

Molde que não sai no papel não serve. Esta fase gera o **HPGL** — o dialeto que a plotadora e a
cortadora entendem — e embrulha o editor num aplicativo com acesso a **porta serial**, que é o que
falta para o navegador poder mandar o arquivo para a máquina.

---

## Decisões fechadas

### G1 — A unidade do HPGL é **1/40 de milímetro**, e isso é da máquina

1 unidade de plotter = **0,025 mm = 25 UM**. Não é escolha: é o passo do motor da plotadora. A
tolerância de tesselação do motor é de **100 UM**, então **cabe com folga de 4×** — o desenho que
chega ao papel não perde nada que a geometria tenha garantido.

**Fonte:** o manual HP-GL/2 da própria HP e a documentação de formato; 40 unidades por milímetro é o
padrão de todo HP-GL.

### G2 — Uma caneta por tipo de linha

| Caneta | O quê |
|---|---|
| 1 | linha de corte, e recortes internos |
| 2 | linha de costura (opcional) |
| 3 | fio e linhas internas |
| 4 | piques |

A plotadora troca de caneta; a cortadora ignora `SP` e corta tudo. Separar por caneta é o que
permite ao mesmo arquivo servir para as duas.

### G3 — O arquivo abre e fecha como a máquina espera

`IN; SP1; PA;` no começo — inicializa, pega a caneta, entra em coordenada **absoluta**. `PU; SP0;
IN;` no fim — levanta, guarda a caneta e deixa a máquina limpa para o próximo trabalho. Máquina que
recebe arquivo sem `IN` final fica com estado do trabalho anterior.

### G4 — Um caminho é `PU` até o início e **um** `PD` com o resto

Um `PD` por ponto também funciona, mas infla o arquivo e faz plotadora antiga parar entre segmentos.

### G5 — A **largura do rolo** é a restrição dura; o comprimento é livre

Peça mais larga que a largura útil é **girada 90°** se couber deitada — com aviso, porque girar no
**papel** é livre e girar no **tecido** não é (tem fio). Não cabendo em direção nenhuma, ela **não é
plotada** e o erro é explícito. Plotar pela metade seria pior que não plotar.

### G6 — Isto **não é encaixe**

As peças saem **enfileiradas** ao longo do rolo, na ordem do modelo, com um vão de 10 mm. Encaixe de
verdade — girar, aninhar, economizar tecido — é a Fase 5. Chamar uma fila de encaixe seria vender
economia que não existe.

---

## O wrap Tauri — o que falta, e por quê

O `@cad/plotter` gera o texto; **mandar pela serial é outra história**, e é por isso que a decisão de
armazenamento offline (Parte 6 da Fase 1) já apontava para o Tauri:

- **Web Serial é só Chromium**, exige gesto do usuário a cada sessão e não enxerga porta que já
  esteja aberta por outro processo. No chão de fábrica isso é inaceitável.
- **Pasta de rede** para deixar o DXF é rotina numa confecção, e OPFS não é pasta de rede.
- O Tauri tem acesso direto a serial e a filesystem, e o custo para o motor é **zero**: nada em
  `@cad/motor`, `@cad/editor`, `@cad/dxf` ou `@cad/plotter` sabe onde nada é guardado nem por onde
  nada é enviado.

**O que o wrap precisa ter**, quando for feito: escolher a porta e o baud; mandar o HPGL em blocos
com controle de fluxo (XON/XOFF é o que a maioria dessas máquinas usa); ler o retorno para saber que
a máquina aceitou; e um botão de parada que levanta a caneta.

Enquanto ele não existe, o editor **baixa o arquivo** — HPGL e DXF — e o operador manda pela
ferramenta que já usa. Isso funciona hoje, e é o suficiente para um piloto.


---

## O que a implementação mostrou — a metade do HPGL está fechada

`@cad/plotter`: **9 testes**, TypeScript puro. **393 testes no total.**

### A unidade

```
     0 UM = 0.000 mm ->    0 un
    25 UM = 0.025 mm ->    1 un
   100 UM = 0.100 mm ->    4 un
  1000 UM = 1.000 mm ->   40 un
190000 UM = 190.000 mm -> 7600 un

resolucao da maquina 25 UM | tolerancia de tesselacao 100 UM -> folga de 4x
```

### O arquivo

```
IN; SP1; PA;   ...   PU; SP0; IN;

a linha de corte de um retangulo 100 x 200 com margem 10:
PU4800,8800;  PD0,8800,0,0,4800,0,4800,8800;
5 pontos (4 do retangulo + 1 fechando) | 4800 x 8800 un = 120 x 220 mm
```

### A fila e a largura do rolo

```
2 pecas -> inicios em y = 8800 e 16000 un
consumo de rolo: 400 mm (220 + 10 de vao + 170)

corte de 920 x 320 mm num rolo util de 880 -> 1 aviso PECA_SO_CABE_GIRADA
  e no papel ela passa a ocupar 320 mm de LARGURA

2 pecas, uma de 2 m num rolo de 90 cm -> 1 plotada, 1 erro
  PECA_MAIS_LARGA_QUE_O_PAPEL — a que nao cabe NAO sai pela metade

sem rolo declarado -> nada e recusado por largura
```

### O pique no papel

```
PU4800,4400;  PD4546,4400;
da borda para dentro: 6.35 mm — o notcher padrao (Parte 7, caso 4)
```

### No editor

Dois botões, **DXF** e **HPGL**, que baixam o arquivo do tamanho na tela. Conferido no navegador:

```
mod-blusa-M.plt -> 27 comandos, IN;SP1;PA; ... PU;SP0;IN;
mod-blusa-M.dxf -> 1326 linhas, comecando em 0|SECTION|2|HEADER
"HPGL: 1 peça(s), 565.5 mm de rolo"
```

### O que continua faltando

O **wrap Tauri**. O arquivo é gerado e baixado; mandar pela serial é a outra metade, e ela precisa de
um processo com acesso à porta — o navegador não serve para isso no chão de fábrica, pelas razões
listadas acima. Enquanto isso, o operador manda pela ferramenta que já usa, o que é suficiente para
um piloto.
