import { summarySchema, turnSchema } from '../../ai-testing/preGP/backend/schemas.ts';

const providerDefaults = {
  bedrock: {
    model: process.env.GITWATCHER_AI_BEDROCK_MODEL || 'amazon.nova-pro-v1:0',
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-2',
  },
  openai: { model: process.env.GITWATCHER_AI_OPENAI_MODEL || 'gpt-6-luna' },
  claude: { model: process.env.GITWATCHER_AI_CLAUDE_MODEL || 'claude-sonnet-5-5' },
};

function withoutAdditionalProperties(schema) {
  if (Array.isArray(schema)) return schema.map(withoutAdditionalProperties);
  if (schema && typeof schema === 'object') {
    return Object.fromEntries(Object.entries(schema)
      .filter(([key]) => key !== 'additionalProperties')
      .map(([key, value]) => [key, withoutAdditionalProperties(value)]));
  }
  return schema;
}

function apiError(provider, status) {
  if (status === 401 || status === 403) return `${provider} rejected the API key. Check the key and model access.`;
  if (status === 429) return `${provider} is rate limiting this account. Wait a moment and try again.`;
  return `${provider} returned an error (${status}). Check the model configuration and try again.`;
}

async function requestJson(url, headers, body, provider) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error(`${provider} took too long to respond.`);
    throw new Error(`Could not reach ${provider}. Check the bot’s network connection.`);
  }
  if (!response.ok) throw new Error(apiError(provider, response.status));
  try {
    return await response.json();
  } catch {
    throw new Error(`${provider} returned an unreadable response.`);
  }
}

function providerMessages(messages) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content.trim()).filter(Boolean);
  const turns = [];
  for (const message of messages) {
    if (message.role === 'system' || !message.content.trim()) continue;
    const last = turns.at(-1);
    if (last?.role === message.role) last.content += `\n${message.content.trim()}`;
    else turns.push({ role: message.role, content: message.content.trim() });
  }
  if (turns[0]?.role !== 'user') turns.unshift({ role: 'user', content: 'Please begin the conversation.' });
  if (turns.at(-1)?.role !== 'user') turns.push({ role: 'user', content: 'Please continue.' });
  return { system, turns };
}

function toolDescription() {
  return 'Return the response as this structured object. Fill every field; use null only where the schema allows it.';
}

async function chatBedrock(config, request) {
  const { system, turns } = providerMessages(request.messages);
  const body = {
    system: system.map((text) => ({ text })),
    messages: turns.map((message) => ({ role: message.role, content: [{ text: message.content }] })),
    inferenceConfig: { maxTokens: request.maxTokens, temperature: request.temperature ?? 0.4 },
    toolConfig: {
      tools: [{ toolSpec: {
        name: request.schemaName,
        description: toolDescription(),
        inputSchema: { json: withoutAdditionalProperties(request.schema) },
      } }],
      toolChoice: { tool: { name: request.schemaName } },
    },
  };
  const data = await requestJson(
    `https://bedrock-runtime.${providerDefaults.bedrock.region}.amazonaws.com/model/${encodeURIComponent(request.model)}/converse`,
    { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
    body,
    'Amazon Bedrock',
  );
  if (data.stopReason === 'max_tokens') throw new Error('The Bedrock response was cut short. Please try again.');
  const block = data.output?.message?.content?.find((item) => item.toolUse?.name === request.schemaName);
  if (!block?.toolUse?.input || typeof block.toolUse.input !== 'object') throw new Error('Bedrock returned an unexpected structured response.');
  return { content: block.toolUse.input, model: request.model };
}

async function chatOpenAI(config, request) {
  const schema = request.schemaName === 'pregp_turn' ? turnSchema : summarySchema;
  const data = await requestJson('https://api.openai.com/v1/chat/completions', {
    'content-type': 'application/json', authorization: `Bearer ${config.key}`,
  }, {
    model: request.model,
    messages: request.messages,
    max_completion_tokens: request.maxTokens,
    reasoning_effort: 'none',
    temperature: request.temperature ?? 0.4,
    parallel_tool_calls: false,
    tools: [{ type: 'function', function: { name: request.schemaName, description: toolDescription(), parameters: schema, strict: true } }],
    tool_choice: { type: 'function', function: { name: request.schemaName } },
  }, 'OpenAI');
  const call = data.choices?.[0]?.message?.tool_calls?.find((item) => item.function?.name === request.schemaName);
  if (!call?.function?.arguments) throw new Error('OpenAI returned an unexpected structured response.');
  try {
    return { content: JSON.parse(call.function.arguments), model: data.model || request.model };
  } catch {
    throw new Error('OpenAI returned malformed structured data.');
  }
}

async function chatClaude(config, request) {
  const schema = request.schemaName === 'pregp_turn' ? turnSchema : summarySchema;
  const { system, turns } = providerMessages(request.messages);
  const data = await requestJson('https://api.anthropic.com/v1/messages', {
    'content-type': 'application/json',
    'x-api-key': config.key,
    'anthropic-version': '2023-06-01',
  }, {
    model: request.model,
    max_tokens: request.maxTokens,
    system: `${system.join('\n\n')}\n\nWhen responding, invoke the ${request.schemaName} tool with the complete structured output. Never answer in plain text.`,
    messages: turns,
    tools: [{ name: request.schemaName, description: toolDescription(), input_schema: schema, strict: true }],
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
  }, 'Claude');
  if (data.stop_reason === 'max_tokens') throw new Error('The Claude response was cut short. Please try again.');
  const result = data.content?.find((item) => item.type === 'tool_use' && item.name === request.schemaName);
  if (result?.input && typeof result.input === 'object') return { content: result.input, model: data.model || request.model };
  const text = data.content?.find((item) => item.type === 'text')?.text?.trim();
  if (text) {
    try {
      return { content: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')), model: data.model || request.model };
    } catch {
      // The caller will report an unusable structured response without exposing the API key.
    }
  }
  throw new Error('Claude returned an unexpected structured response.');
}

export function providerModel(provider) {
  return providerDefaults[provider]?.model;
}

export function createAiClient(config) {
  if (!config?.key || !providerDefaults[config.provider]) throw new Error('Configure an AI provider first.');
  return {
    async chatJson(request) {
      const model = providerModel(config.provider);
      const normalized = { ...request, model };
      if (config.provider === 'bedrock') return chatBedrock(config, normalized);
      if (config.provider === 'openai') return chatOpenAI(config, normalized);
      return chatClaude(config, normalized);
    },
  };
}
