# FASE 1 · PARTE 8 — Persistência e backend

> Parte **descritiva**. Fecha a última entrega da Parte 0 (*"Backend Fastify + Neon só para
> persistir/ler eventos"*) e a decisão de armazenamento offline que a Parte 4 deixou em aberto.
>
> Pacotes novos: **`@cad/persistencia`** (log + snapshot, SQL direto) e **`@cad/api`** (Fastify,
> com autenticação por JWT). **37 testes**, todos contra bancos de verdade e com tokens assinados
> de verdade. Fecha também o CI headless.

## A decisão da Parte 4: Tauri + SQLite local

A Parte 4 pedia para escolher onde os eventos ficam sem rede: **Tauri → SQLite** ou
**PWA → OPFS/IndexedDB**. Ficou **Tauri + SQLite**, e o que decide não é preferência:

- **O plotter.** O corte sai por HPGL na serial. Web Serial é só Chromium, exige gesto do usuário
  a cada sessão e não enxerga porta já aberta por outro processo. No chão de fábrica isso não se
  sustenta; o Tauri tem acesso direto a serial e a filesystem.
- **O DXF.** Importar e exportar arquivo de e para pasta de rede é rotina numa confecção, e OPFS
  não é pasta de rede.
- **Custo para o motor: zero.** `@cad/motor` continua puro e não sabe que persistência existe.

## Um esquema, dois destinos

O mesmo log tem que servir à nuvem e à máquina offline, senão o sync da Fase 10 vira conversão de
formato. As **mesmas duas tabelas**, as mesmas colunas e a mesma ordem de replay nos dois. Muda só
o mecânico:

| | Postgres (Neon) | SQLite (Tauri) |
|---|---|---|
| Marcador de parâmetro | `$1` | `?` (traduzido em um lugar só) |
| Documento | `JSONB` | `TEXT` |
| Instante | `TIMESTAMPTZ` | `TEXT` ISO |
| RLS | **sim** | não tem — ver abaixo |

**O que o SQLite não tem.** SQLite não tem Row Level Security: lá o isolamento é só o `WHERE` da
consulta. Isso é aceitável **e só é** porque o SQLite é o banco local de **uma** empresa dentro do
Tauri dela, não um banco multi-empresa. Se um dia virar compartilhado, deixa de ser aceitável — por
isso está escrito no código, e não escondido.

## Duas tabelas, e por que exatamente duas

`evento` é o log **append-only**: é a verdade. Não há `UPDATE` nem `DELETE` nele — só `INSERT` e
`SELECT`. `snapshot` é cache derivado, reescrito inteiro, nunca remendado. Se divergirem, quem está
certo é o log.

**A ordem do replay é o ULID, não um serial.** O log é lido `ORDER BY id`, e o id é ULID (D2),
ordenável por tempo. Um `BIGSERIAL` daria a ordem de chegada **naquele** banco — o que faria duas
máquinas que trabalharam offline reconstruírem estados diferentes do mesmo conjunto de eventos, e o
teste de integridade da Fase 10 falharia por construção.

## Sem driver no pacote

O repositório fala com um `Executor` de **um método**. `pg`, `@neondatabase/serverless` e o PGlite
satisfazem isso sem adaptador; o `node:sqlite` tem um de 6 linhas. Não é camada sobre o banco — é o
contrato mínimo que permite o mesmo SQL rodar nos dois destinos sem o pacote depender de driver
nenhum. Inegociável 2 (**sem ORM**) intacta: o SQL está escrito à mão, na íntegra, em `repositorio.ts`.

## Testes contra banco de verdade, não contra mock

O **PGlite** é Postgres compilado para WASM: roda em processo, sem servidor, em CI headless. Um mock
provaria que o SQL foi montado, não que ele funciona — e as duas coisas que mais podiam quebrar são
justamente do banco: o `JSONB` reordenar chaves e o `ON CONFLICT` se comportar diferente. A mesma
suíte roda nos dois destinos.

### Log e snapshot (14 testes: 7 × 2 bancos)

| Verificação | Resultado |
|---|---|
| Round-trip do log | 19 eventos gravados e lidos **idênticos**, na ordem do ULID (`01JXAA0000` → `01JXAA0018`) |
| **Teste 13 no banco** | reconstruir só pelo log **bate 100%** com o snapshot JSONB, nos dois bancos |
| A edição sobreviveu à ida e volta | `pt-2` em **(105000, 200000)** — a `ModificarPonto` proporcional atravessou o banco intacta |
| Snapshot adulterado por fora | **acusado**, com o trecho: `..."nome":"Camisa"...` × `..."nome":"Camisa ADULTERADA"...` |
| Reanexar o mesmo lote | **0 novos**, log não duplica |
| Mesmo id com conteúdo diferente | `EVENTO_DIVERGENTE` — dois eventos distintos com o mesmo ULID é gerador quebrado ou log corrompido |
| Isolamento por tenant | cada empresa lê 19 eventos, só os seus |
| Evento de outro tenant / outro modelo | `EVENTO_DE_OUTRO_TENANT` · `EVENTO_DE_OUTRO_MODELO` |
| Modelo sem log / log sem snapshot | `LOG_VAZIO` · `SNAPSHOT_AUSENTE` |

**Sobre a comparação canônica.** `JSONB` do Postgres não preserva a ordem das chaves. Comparar
`JSON.stringify(a) === JSON.stringify(b)` reprovaria um snapshot correto só porque o banco devolveu
`{y, x}` em vez de `{x, y}`. A comparação ordena as chaves recursivamente antes de serializar —
ignora **apenas** isso, que em JSON não carrega significado, e continua pegando qualquer diferença
de valor, de id ou de estrutura.

### RLS por tenant (4 testes, Postgres)

O `WHERE tenant_id = $1` do repositório já isola. O RLS existe porque filtro é código, e código tem
bug: basta **uma** consulta esquecer o `WHERE` para o molde de uma confecção aparecer na tela de
outra.

| Verificação | Resultado |
|---|---|
| `SELECT *` **sem `WHERE`**, de propósito | sessão do tenant A vê só a linha de A; a de B, só a de B |
| Sessão sem `app.tenant_id` | vê **0 linhas** — falha **fechada**, que é o lado certo para errar |
| Tenant A tentando gravar como B | recusado: *"new row violates row-level security policy"* (`WITH CHECK`) |
| Superusuário | vê as duas empresas — **por isso a aplicação não conecta como um** |

Rodar o teste como superusuário não testaria nada: superusuário **ignora** RLS. Os testes assumem o
papel `app` de propósito, que é o papel que a aplicação usa.

## Backend Fastify (10 testes)

Só persiste e lê eventos. **Nenhuma geometria**: se esta camada começasse a calcular offset ou
graduação, existiriam duas verdades sobre a mesma peça.

| Rota | O que faz |
|---|---|
| `POST /modelos/:id/eventos` | anexa ao log, regrava o snapshot e devolve o estado — **201** |
| `GET /modelos/:id` | snapshot; **404** se não houver |
| `GET /modelos/:id/eventos` | o log inteiro, na ordem do ULID — é o que o sync da Fase 10 consome |
| `GET /modelos/:id/integridade` | teste 13 sob demanda; **200** se bate, **409** se não |
| `GET /saude` | única rota sem tenant |

| Verificação | Resultado |
|---|---|
| POST de 18 eventos | **201**, 18 novos, estado devolvido com os 4 pontos da peça |
| GET do log | 18 eventos, de `01JXAA0000` a `01JXAA0017`, em ordem |
| GET integridade | **200**, `bate: true` |
| Tenant A × tenant B | dono lê **200**, o outro **404** |
| Sem `x-tenant-id` | **403** |
| Evento do tenant A na sessão de B | **403 EVENTO_DE_OUTRO_TENANT** |
| **Erro do motor** (log sem `CriarModelo`) | **400 PECA_INEXISTENTE** com a mensagem do motor — não 500 |
| Reenviar o mesmo lote (retry) | **0 novos**, log não duplica |

### De onde vem o tenant: falha fechada

O tenant vinha do cabeçalho `x-tenant-id`, que **o cliente escolhe**. Quem soubesse o nome de outra
confecção lia o molde dela trocando uma string — exatamente o que a inegociável 6 existe para
impedir. Estava marcado no código como "trocar antes de produção", e essa marcação não é proteção
nenhuma: o caminho de menor resistência era publicar assim.

Agora o servidor **não tem jeito padrão** de descobrir o tenant. Quem monta escolhe uma
`EstrategiaDeTenant`, e não escolher **não compila**:

| Estratégia | Uso | O que faz |
|---|---|---|
| `tenantPorJwt` | produção | o tenant sai de um **claim do token assinado**, que o cliente não forja sem a chave |
| `tenantDeDesenvolvimento` | dev | o cabeçalho de antes — agora com `DESENVOLVIMENTO` no nome e **aviso no log a cada subida** |

A verificação usa `jose` (zero dependências) e aceita segredo compartilhado (HS256) ou JWKS remoto.
**Quem emite o token é decisão de produto**, então entra como configuração, não como código: o
`principal.ts` liga a de produção com `JWT_SEGREDO` + `JWT_CLAIM_TENANT`, e a de desenvolvimento só
com `TENANT_POR_CABECALHO=1`, escrito de propósito. Sem nenhum dos dois, **o processo não sobe**.

Os tokens dos testes são **assinados de verdade**, com a mesma biblioteca que verifica: um token
montado à mão provaria que o código lê um objeto; o que precisa ser provado é que assinatura errada
não passa.

| Verificação | Resultado |
|---|---|
| Token válido | **404** no modelo vazio — ou seja, autorizado |
| Assinado com **outra chave** | **403** `Token invalido.` — de propósito não diz qual checagem falhou; dizer ajuda quem tenta forjar |
| Token **expirado** há 1 h | **403** |
| **Emissor** errado, com emissor exigido | certo **404**, errado **403** |
| Token **sem o claim** do tenant | **403** — o backend não adivinha a empresa a partir de outro campo |
| Só com `x-tenant-id`, sob JWT | **403** — o buraco fechou |
| Dois tenants com tokens próprios | A grava **201**, A lê **200**, B lê **404** |

## CI headless (entrega da Parte 0)

`.github/workflows/ci.yml`, em `ubuntu-latest` com Node 22. Não há banco como serviço, e isso não é
simplificação: a persistência é testada contra Postgres **de verdade** (PGlite, em processo) e
contra SQLite (`node:sqlite`). Os dois rodam sem servidor, sem porta e sem container — que é o que
"headless" quer dizer.

O pipeline é `npm run ci`, o mesmo comando localmente e no CI: **typecheck → testes → build →
artefatos → figuras**.

**Dois defeitos que só apareceram ao montar o CI:**

1. **`npm test` não rodava num clone limpo.** `@cad/persistencia` e `@cad/api` importam `@cad/motor`
   pelo `dist`, que só existe depois do build — o teste dependia da ordem de dois comandos.
   Corrigido com um alias no `vitest.config.ts` dos dois: nos testes, `@cad/motor` resolve para o
   **fonte**. Teste não deve depender de build, e o rastro de pilha passa a cair no código real.

2. **Isso abriu um buraco novo:** se os testes rodam no fonte, nada exercitava o `exports` do
   `package.json` nem a saída do `tsc` — que são o contrato com a Fase 2 e com o Tauri, e quebram em
   silêncio. Daí o passo `scripts/verificar-dist.mjs`: importa cada pacote **pelo nome** e faz o
   motor **calcular** (retângulo 100×200 com margem 10 → corte 120×220, 4 vértices). Importar sem
   executar não provaria que o artefato funciona.

O último passo regenera as figuras da Parte 7. Se elas não puderem mais ser geradas, a documentação
está descrevendo um motor que não existe mais.

## O que não tem teste, e por quê

`src/principal.ts` — a composição: lê `DATABASE_URL`, monta o pool do `pg`, sobe o Fastify. É de
propósito o arquivo mais burro do pacote, e só faria sentido testar contra uma instância real do
Neon, que não existe aqui. Tudo que daria para testar dele — rota, erro, isolamento — já está
testado contra PGlite.

```bash
DATABASE_URL=postgres://...  JWT_SEGREDO=...  JWT_CLAIM_TENANT=tenant_id  PORT=3000 CRIAR_ESQUEMA=1 node dist/principal.js
```

**A `DATABASE_URL` não deve ser a de um superusuário:** superusuário ignora RLS, e o isolamento
entre empresas passaria a depender só do `WHERE` das consultas. Use o papel `app` do `ddlRls()`.
