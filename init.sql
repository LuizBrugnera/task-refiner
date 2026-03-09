-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(10) DEFAULT '🤖',
  system_prompt TEXT NOT NULL,
  context_text LONGTEXT,
  output_format TEXT,
  model VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
  max_tokens INT DEFAULT 4000,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Agent images (context images)
CREATE TABLE IF NOT EXISTS agent_images (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  filename VARCHAR(255),
  mime_type VARCHAR(100),
  data LONGBLOB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(36) PRIMARY KEY,
  raw_task TEXT NOT NULL,
  title VARCHAR(500),
  description TEXT,
  epic VARCHAR(255),
  effort VARCHAR(10),
  effort_points INT,
  suggested_assignee_role VARCHAR(50),
  status ENUM('waiting', 'processing', 'review', 'approved', 'published', 'rejected', 'error') DEFAULT 'waiting',
  result JSON,
  error TEXT,
  reject_reason TEXT,
  version INT DEFAULT 1,
  parent_id VARCHAR(36),
  improvement_notes TEXT,
  agent_id VARCHAR(36),
  pipeline_mode ENUM('simple', 'pipeline') DEFAULT 'simple',
  validator_agent_id VARCHAR(36),
  validation_status VARCHAR(20),
  validation_notes JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
  FOREIGN KEY (validator_agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

-- Conversation history
CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Task images (images attached to individual tasks)
CREATE TABLE IF NOT EXISTS task_images (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL,
  filename VARCHAR(255),
  mime_type VARCHAR(100),
  data LONGBLOB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Token usage tracking
CREATE TABLE IF NOT EXISTS token_usage (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36),
  agent_id VARCHAR(36),
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cache_creation_tokens INT DEFAULT 0,
  cache_read_tokens INT DEFAULT 0,
  pipeline_step ENUM('refiner', 'validator') DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

-- Default agent
INSERT IGNORE INTO agents (id, name, description, icon, system_prompt, context_text, output_format, is_default) VALUES (
  'default-agent-001',
  'Tech Lead Refinador',
  'Agente padrão especializado em refinamento de tasks para times ágeis. Transforma tasks brutas em tasks técnicas e acionáveis.',
  '🎯',
  'Você é um Tech Lead sênior especializado em refinamento de tasks para times ágeis.\nSeu papel é pegar uma task bruta e transformá-la em uma task bem definida, técnica e acionável.\n\nINSTRUÇÕES:\n- Use o contexto do projeto para tornar a task específica para a stack e padrões do time\n- Quebre tasks grandes em subtasks concretas e executáveis\n- Estime esforço com base na complexidade técnica real\n- Identifique dependências e riscos técnicos\n- Escreva critérios de aceite no formato Given/When/Then',
  NULL,
  '{\n  \"title\": \"título claro e objetivo da task\",\n  \"description\": \"contexto do problema, objetivo e abordagem técnica recomendada\",\n  \"epic\": \"épico relacionado ou null\",\n  \"subtasks\": [\n    { \"title\": \"subtask 1\", \"description\": \"detalhe técnico\" }\n  ],\n  \"acceptance_criteria\": [\n    { \"given\": \"...\", \"when\": \"...\", \"then\": \"...\" }\n  ],\n  \"effort\": \"P | M | G | GG\",\n  \"effort_points\": 1,\n  \"dependencies\": [\"dependência 1\"],\n  \"risks\": [\"risco técnico 1\"],\n  \"labels\": [\"label1\"],\n  \"suggested_assignee_role\": \"Frontend | Backend | DevOps | Fullstack\"\n}',
  TRUE
);

-- Default validator agent
INSERT IGNORE INTO agents (id, name, description, icon, system_prompt, context_text, output_format, is_default) VALUES (
  'default-validator-001',
  'Task Validator',
  'Agente validador que revisa tasks refinadas para garantir completude, consistência e qualidade técnica. Corrige e complementa campos faltantes.',
  '✅',
  'Você é um QA Lead sênior especializado em validação de tasks técnicas refinadas.\nSeu papel é receber uma task bruta original e o JSON refinado por outro agente, e validar se o resultado está completo, consistente e pronto para produção.\n\nCHECKLIST DE VALIDAÇÃO OBRIGATÓRIA:\n1. Todos os campos obrigatórios estão presentes e não-vazios: title, description, subtasks, acceptance_criteria, effort, effort_points, risks, dependencies, labels, suggested_assignee_role\n2. acceptance_criteria seguem o formato Given/When/Then com cenários concretos (não genéricos)\n3. subtasks são acionáveis, específicas e não genéricas (ex: \"Implementar endpoint POST /api/users\" em vez de \"Implementar backend\")\n4. risks e dependencies não são placeholders genéricos (ex: \"Risco de performance\" sem contexto não é aceitável)\n5. effort_points é consistente com a complexidade das subtasks (P=1, M=3, G=5, GG=8)\n6. description contém contexto técnico suficiente para um dev começar a trabalhar\n7. labels são relevantes e específicas\n8. suggested_assignee_role é coerente com o tipo de trabalho\n\nCOMPORTAMENTO:\n- Se TODOS os critérios estão satisfeitos: retorne o JSON original EXATAMENTE como recebido, adicionando apenas \"validation_status\": \"approved\" e \"validation_notes\": []\n- Se ALGUM critério falhou: corrija e complete os campos problemáticos, retornando o JSON completo corrigido com \"validation_status\": \"patched\" e \"validation_notes\": [\"descrição de cada correção feita\"]\n\nRETORNE APENAS o JSON válido, sem markdown, sem explicações fora do JSON.',
  NULL,
  NULL,
  FALSE
);
