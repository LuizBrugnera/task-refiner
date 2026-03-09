# 🔮 Task Refiner

Refinamento automático de tasks com IA + revisão humana + publicação no Notion.

## Fluxo

```
Input (Web UI) → Queue → Claude API → Revisão humana → Notion
```

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite o .env com suas chaves
```

### 3. Configurar Notion

Crie um banco de dados no Notion com estas propriedades:

| Propriedade     | Tipo        |
|-----------------|-------------|
| Name            | Title       |
| Status          | Select      |
| Effort          | Select      |
| Points          | Number      |
| Epic            | Rich text   |
| Labels          | Multi-select|
| Assignee Role   | Select      |

Depois:
1. Crie uma integration em https://notion.so/my-integrations
2. Conecte a integration ao banco de dados (Share → Invite)
3. Copie o Database ID da URL do banco

### 4. Contexto do projeto

Edite o arquivo `context/project.md` com as informações do seu projeto:
- Stack tecnológica
- Padrões e convenções
- Épicos ativos
- Times

Você pode criar múltiplos arquivos `.md` na pasta `context/` — todos serão lidos.

### 5. Rodar

```bash
npm run dev   # desenvolvimento (hot reload)
npm start     # produção
```

Acesse: http://localhost:3000

## Como usar

1. Cole uma ou mais tasks na textarea (uma por linha)
2. Clique em **Adicionar à fila** ou use `Ctrl+Enter`
3. Aguarde o processamento (Claude vai refinar automaticamente)
4. Revise a task refinada no painel direito
5. Clique em **Aprovar & Publicar no Notion** ou **Rejeitar**

## Estrutura

```
task-refiner/
├── context/          ← Coloque seus arquivos de contexto aqui
│   └── project.md
├── src/
│   ├── server.js         ← Entry point Express
│   ├── queue/
│   │   └── taskQueue.js  ← Queue em memória com EventEmitter
│   ├── refiner/
│   │   ├── refiner.js    ← Chama Claude API
│   │   └── contextLoader.js
│   ├── notion/
│   │   └── notionPublisher.js
│   └── routes/
│       └── tasks.js      ← REST + SSE endpoints
└── public/
    └── index.html        ← Frontend completo
```

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/tasks | Adiciona tasks à fila |
| GET | /api/tasks | Lista todos os jobs |
| GET | /api/tasks/stats | Estatísticas da fila |
| GET | /api/tasks/:id | Detalhe de um job |
| POST | /api/tasks/:id/approve | Aprova e publica no Notion |
| POST | /api/tasks/:id/reject | Rejeita um job |
| GET | /api/tasks/stream/events | SSE para updates em tempo real |
