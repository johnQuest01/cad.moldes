# FASE 1 · PARTE 3 — Operações de edição do motor (9 a 14)

> Cole junto com a **Parte 0** e a **Parte 1**. São as operações que o modelista mais usa — e as que mais destroem uma peça se saírem erradas.

9. **Modificar ponto — discreto e proporcional** (a operação mais usada pelo modelista):
   - *Discreto*: aplica `(dx, dy)` só ao ponto alvo.
   - *Proporcional*: aplica `(dx, dy)` ao alvo e frações decrescentes aos `N` vizinhos de cada lado **ao longo do contorno**.
   - **Função de decaimento — implemente exatamente esta, não invente:** para o vizinho de índice `i` (1..N), fator `f(i) = (1 + cos(π · i / (N+1))) / 2`. Vai de quase 1 (vizinho colado) a quase 0 (último vizinho), suavemente. O alvo recebe fator 1; pontos além de `N` recebem 0. **Documente a fórmula no código** e teste os números.

10. **Arredondar / chanfrar** (fillet e chamfer) num vértice, com raio ou distância em mm.

11. **Simplificar contorno / reduzir pontos de curva**: Douglas-Peucker (ou equivalente) com **tolerância explícita**. A peça simplificada **nunca** desvia da original além da tolerância — **valide medindo**, não confie.

12. **Converter trecho reto ↔ curva** preservando os extremos.

13. **Inserir / excluir ponto** no meio de um segmento. O editor da Fase 2 usa direto; precisa existir no motor com evento próprio (ver Parte 4).

14. **Dobra (eixo de dobra) — genérica:**
   - **Eixo livre:** dois pontos ou ponto + ângulo, qualquer inclinação.
   - **Dobra simples (na dobra do tecido):** a peça desenhada é metade; a **geometria de corte** é a peça espelhada nesse eixo. Perímetro, área e encaixe usam a peça **desdobrada** — fonte clássica de erro de consumo (compra-se metade do tecido necessário).
   - **Dobra múltipla (N partes / pregas):** `N` eixos paralelos (ou individuais), **direção por eixo** (dentro/fora, alternada = sanfona) e **profundidade** por prega. Gera os **piques** de início/fim de cada dobra.
   - Eixos de dobra são **entidade persistida**: sobrevivem à edição, graduam em posição relativa, exportam como linha interna no DXF.
   - **Validação:** eixo fora do contorno, dobras que se cruzam, `N` que não cabe → erro claro.

15. **Dividir / seccionar peça em N partes separadas** (**distinta da dobra** — aqui vira `N` peças independentes):
   - Linha de corte por **eixo livre**, por `N` divisões iguais, ou **curva**.
   - **Regra crítica:** cada parte recebe **margem de costura própria na nova aresta**. A soma das partes consome **mais** tecido que a original — isso é correto. Nunca gerar sem a margem nova: a peça sai pequena e não fecha.
   - Gerar **piques de casamento** nas arestas correspondentes.
   - Cada parte herda fio, material, quantidade, propriedades de encaixe, e recebe **nome derivado** (`FRENTE_1`, `FRENTE_2`).
   - **Graduação:** regras redistribuídas para a parte correta; linha de divisão em **posição relativa**, acompanhando a grade.
   - **Validação:** linha que não atravessa o contorno de lado a lado, ou parte de área zero → erro claro.
