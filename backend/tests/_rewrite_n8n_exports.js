const fs = require('fs');

function read(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function write(path, workflow) {
  delete workflow.pinData;
  workflow.active = false;
  fs.writeFileSync(path, JSON.stringify(workflow, null, 2) + '\n');
}

function byName(workflow, name) {
  const result = workflow.nodes.find((node) => node.name === name);
  if (!result) throw new Error(`Missing node ${name}`);
  return result;
}

function removeNodes(workflow, names) {
  const removed = new Set(names);
  workflow.nodes = workflow.nodes.filter((node) => !removed.has(node.name));
  for (const name of removed) delete workflow.connections[name];
  for (const connection of Object.values(workflow.connections)) {
    for (const branches of Object.values(connection)) {
      for (const branch of branches) {
        for (let index = branch.length - 1; index >= 0; index -= 1) {
          if (removed.has(branch[index].node)) branch.splice(index, 1);
        }
      }
    }
  }
}

function connection(...targets) {
  return { main: [targets.map(([node, index = 0]) => ({ node, type: 'main', index }))] };
}

function addTenantHeaders(parameters, sourceExpression, includeJob = false) {
  const headers = [
    { name: 'X-Tenant-Context', value: `={{ ${sourceExpression}.tenant_context_token }}` },
  ];
  if (includeJob) {
    headers.push({ name: 'X-Job-Id', value: `={{ ${sourceExpression}.job_id }}` });
  }
  parameters.sendHeaders = true;
  parameters.headerParameters = { parameters: headers };
}

function addMetaHeaders(parameters, source = "$('normalizar eventos Meta').item.json") {
  parameters.sendHeaders = true;
  parameters.headerParameters = {
    parameters: [
      {
        name: 'X-Meta-Phone-Number-Id',
        value: `={{ ${source}.phone_number_id }}`,
      },
      {
        name: 'X-Meta-Event-Id',
        value: `={{ ${source}.event_key }}`,
      },
    ],
  };
}

function rewriteMeta() {
  const path = 'webhook meta cloud api.json';
  const workflow = read(path);
  const normalizer = byName(workflow, 'normalizar eventos Meta');
  normalizer.parameters.jsCode = `const backendUrl = String($env.BACKEND_URL || '').replace(/\\/$/, '');
if (!backendUrl) throw new Error('BACKEND_URL no esta configurado');

const output = [];
const clean = (value) => value == null ? null : String(value).trim() || null;
const jid = (waId) => clean(waId) ? clean(waId) + '@s.whatsapp.net' : null;

for (const input of $input.all()) {
  const body = input.json.body || input.json;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = clean(value.metadata && value.metadata.phone_number_id);
      if (!phoneNumberId) throw new Error('Evento Meta sin metadata.phone_number_id');

      const contacts = new Map((value.contacts || [])
        .filter((contact) => clean(contact && contact.wa_id))
        .map((contact) => [clean(contact.wa_id), contact]));

      const base = (kind, eventId) => ({
        _kind: kind,
        provider: 'meta_cloud_api',
        phone_number_id: phoneNumberId,
        event_key: phoneNumberId + ':' + kind + ':' + clean(eventId),
        backend_url: backendUrl,
      });

      for (const status of value.statuses || []) {
        output.push({ json: {
          ...base('status', status.id),
          wa_message_id: clean(status.id),
          status: clean(status.status),
          chat_jid: jid(status.recipient_id),
          from_me: true,
          sent_at: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : null,
          payload: { status },
        }});
      }

      for (const message of value.messages || []) {
        const from = clean(message.from);
        const contact = contacts.get(from) || {};
        const profile = contact.profile || {};
        const rawUsername = clean(profile.username);
        const common = {
          ...base(message.type === 'reaction' ? 'reaction' : 'message', message.id),
          wa_message_id: clean(message.id),
          chat_jid: jid(from),
          push_name: clean(profile.name),
          username: rawUsername ? '@' + rawUsername.replace(/^@+/, '') : null,
          sent_at: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : null,
          quoted_wa_message_id: clean(message.context && message.context.id),
          origen: message.referral ? 'meta_ad' : 'meta_cloud_api',
        };

        if (message.type === 'reaction') {
          output.push({ json: {
            ...common,
            target_wa_message_id: clean(message.reaction && message.reaction.message_id),
            emoji: clean(message.reaction && message.reaction.emoji) || '',
            payload: { reaction: message.reaction || {} },
          }});
          continue;
        }

        let content = null;
        let mediaId = null;
        let filename = null;
        const type = clean(message.type) || 'unsupported';
        if (type === 'text') content = clean(message.text && message.text.body);
        else if (['image', 'video'].includes(type)) {
          mediaId = clean(message[type] && message[type].id);
          content = clean(message[type] && message[type].caption);
        } else if (['audio', 'sticker'].includes(type)) {
          mediaId = clean(message[type] && message[type].id);
        } else if (type === 'document') {
          mediaId = clean(message.document && message.document.id);
          filename = clean(message.document && message.document.filename);
          content = clean(message.document && (message.document.caption || message.document.filename));
        } else if (type === 'location') {
          const location = message.location || {};
          content = clean(location.name || location.address) ||
            (location.latitude != null && location.longitude != null
              ? location.latitude + ',' + location.longitude : null);
        } else if (type === 'contacts') {
          content = JSON.stringify(message.contacts || []);
        } else if (type === 'interactive') {
          const reply = (message.interactive || {}).button_reply || (message.interactive || {}).list_reply || {};
          content = clean(reply.title || reply.id);
        } else if (type === 'button') {
          content = clean(message.button && (message.button.text || message.button.payload));
        }

        output.push({ json: {
          ...common,
          message_type: type,
          content,
          media_id: mediaId,
          filename,
          payload: { message, referral: message.referral || null },
        }});
      }
    }
  }
}

return output;`;

  byName(workflow, 'etiquetar ejecucion').parameters.dataToSave.values.push(
    { key: 'phone_number_id', value: '={{ $json.phone_number_id || error("Falta phone_number_id") }}' },
    { key: 'event_key', value: '={{ $json.event_key || error("Falta event_key") }}' },
  );

  const resolverBody = `={{ JSON.stringify({
  provider: 'meta_cloud_api',
  phone_number_id: $json.phone_number_id,
  data: {
    key: { remoteJid: $json.chat_jid, fromMe: false },
    pushName: $json.push_name,
    userName: $json.username
  }
}) }}`;
  byName(workflow, 'resolver identidad').parameters.jsonBody = resolverBody;
  byName(workflow, 'resolver identidad (reaccion)').parameters.jsonBody = resolverBody;

  const httpNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
  for (const node of httpNodes) {
    addMetaHeaders(node.parameters);
    node.parameters = JSON.parse(
      JSON.stringify(node.parameters).replaceAll(
        "$('normalizar eventos Meta')",
        "$('evento Meta activo')",
      ),
    );
  }

  byName(workflow, 'tiene adjunto?').parameters = JSON.parse(
    JSON.stringify(byName(workflow, 'tiene adjunto?').parameters).replaceAll(
      "$('normalizar eventos Meta')",
      "$('evento Meta activo')",
    ),
  );

  const template = JSON.parse(JSON.stringify(byName(workflow, 'avisar al backend')));
  const inbox = {
    ...template,
    id: '10000000-0000-4000-8000-000000000001',
    name: 'registrar evento Meta en inbox',
    position: [-1400, 420],
  };
  inbox.parameters.method = 'POST';
  inbox.parameters.url = "={{ $json.backend_url }}/api/webhooks/meta-events/inbox";
  inbox.parameters.jsonBody = `={{ JSON.stringify({ events: [{
    event_key: $json.event_key,
    event_type: $json._kind,
    phone_number_id: $json.phone_number_id,
    payload: $json
  }] }) }}`;
  addMetaHeaders(inbox.parameters);

  const merge = {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'unir evento con resultado inbox',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3.2,
    position: [-1160, 300],
    parameters: { mode: 'combine', combineBy: 'combineByPosition', options: {} },
  };
  const active = {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'evento Meta activo',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-700, 300],
    parameters: { jsCode: `const output = [];
for (const item of $input.all()) {
  const value = item.json;
  if (Array.isArray(value.items)) {
    const record = value.items.find((candidate) => candidate.event_key === value.event_key);
    if (!record || !record.accepted) continue;
    const payload = { ...value };
    delete payload.items;
    output.push({ json: { ...payload, inbox_id: record.id } });
    continue;
  }
  if (value.id && value.payload) {
    output.push({ json: { ...value.payload, inbox_id: value.id } });
  }
}
return output;` },
  };

  const schedule = {
    id: '10000000-0000-4000-8000-000000000004',
    name: 'reintentar inbox Meta',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [-1420, 760],
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } },
  };
  const claim = {
    ...JSON.parse(JSON.stringify(template)),
    id: '10000000-0000-4000-8000-000000000005',
    name: 'reclamar eventos Meta pendientes',
    position: [-1180, 760],
  };
  claim.parameters.method = 'POST';
  claim.parameters.url = "={{ $env.BACKEND_URL.replace(/\\/$/, '') + '/api/webhooks/meta-events/inbox/claim' }}";
  claim.parameters.jsonBody = '={{ JSON.stringify({ limit: 100 }) }}';
  delete claim.parameters.sendHeaders;
  delete claim.parameters.headerParameters;

  const splitClaim = {
    id: '10000000-0000-4000-8000-000000000006',
    name: 'separar eventos Meta reclamados',
    type: 'n8n-nodes-base.splitOut',
    typeVersion: 1,
    position: [-940, 760],
    parameters: { fieldToSplitOut: 'items', options: {} },
  };
  const complete = {
    ...JSON.parse(JSON.stringify(template)),
    id: '10000000-0000-4000-8000-000000000007',
    name: 'marcar evento Meta completo',
    position: [1540, 300],
  };
  complete.parameters.method = 'POST';
  complete.parameters.url = "={{ $env.BACKEND_URL.replace(/\\/$/, '') + '/api/webhooks/meta-events/inbox/' + $('evento Meta activo').item.json.inbox_id + '/complete' }}";
  complete.parameters.jsonBody = '={{ JSON.stringify({ event_key: $(\'evento Meta activo\').item.json.event_key }) }}';
  addMetaHeaders(complete.parameters, "$('evento Meta activo').item.json");

  workflow.nodes.push(inbox, merge, active, schedule, claim, splitClaim, complete);

  workflow.connections['Meta eventos (POST)'] = connection(['normalizar eventos Meta']);
  workflow.connections['normalizar eventos Meta'] = {
    main: [[
      { node: 'registrar evento Meta en inbox', type: 'main', index: 0 },
      { node: 'unir evento con resultado inbox', type: 'main', index: 0 },
    ]],
  };
  workflow.connections['registrar evento Meta en inbox'] = connection(['unir evento con resultado inbox', 1]);
  workflow.connections['unir evento con resultado inbox'] = connection(['responder 200 a Meta']);
  workflow.connections['responder 200 a Meta'] = connection(['evento Meta activo']);
  workflow.connections['reintentar inbox Meta'] = connection(['reclamar eventos Meta pendientes']);
  workflow.connections['reclamar eventos Meta pendientes'] = connection(['separar eventos Meta reclamados']);
  workflow.connections['separar eventos Meta reclamados'] = connection(['evento Meta activo']);
  workflow.connections['evento Meta activo'] = connection(['etiquetar ejecucion']);
  workflow.connections['mensaje nuevo?'].main[1] = [{ node: 'avisar al backend', type: 'main', index: 0 }];
  workflow.connections['avisar al backend'] = connection(['marcar evento Meta completo']);
  workflow.connections['actualizar estado'] = connection(['marcar evento Meta completo']);
  workflow.connections['guardar reaccion'] = connection(['marcar evento Meta completo']);

  write(path, workflow);
}

function rewriteAnalyst() {
  const path = 'analista.json';
  const workflow = read(path);
  const httpCredentials = JSON.parse(JSON.stringify(byName(workflow, 'actualizar estado lead').credentials || {}));
  const trigger = byName(workflow, 'Datos del mensaje');
  trigger.parameters = {
    workflowInputs: {
      values: [
        { name: 'operation', type: 'string' },
        { name: 'job_id', type: 'string' },
        { name: 'tenant_context_token', type: 'string' },
        { name: 'expected_revision', type: 'string' },
        { name: 'chat_id', type: 'string' },
      ],
    },
  };

  removeNodes(workflow, [
    'Aggregate4', 'Merge6', 'get messages1', 'get lead4', 'Edit Fields1',
    'update lead', 'update lead4', 'Merge7', 'actualizar estado lead',
    'ultimo mensaje1', 'es el ultimo1',
  ]);

  const wait = byName(workflow, 'debounce analista1');
  wait.parameters = { resume: 'timeInterval', amount: 15, unit: 'seconds' };

  const validate = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'validar solicitud analista',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1220, 160],
    parameters: { jsCode: `const request = $input.first().json;
const required = ['job_id', 'tenant_context_token', 'expected_revision', 'chat_id'];
if (request.operation !== 'analyst') throw new Error('operation debe ser analyst');
for (const field of required) {
  if (request[field] === undefined || request[field] === null || String(request[field]).trim() === '') {
    throw new Error('Falta input requerido: ' + field);
  }
}
return [{ json: { ...request, operation: 'analyst' } }];` },
  };

  const context = {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'cargar contexto autorizado',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [-780, 160],
    parameters: {
      url: "={{ $env.BACKEND_URL.replace(/\\/$/, '') + '/api/webhooks/analysis-context' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'chat_id', value: "={{ $('validar solicitud analista').item.json.chat_id }}" },
        { name: 'limit', value: '500' },
      ] },
      options: {},
    },
    credentials: httpCredentials,
  };
  addTenantHeaders(context.parameters, "$('validar solicitud analista').item.json", true);

  const current = {
    id: '20000000-0000-4000-8000-000000000003',
    name: 'contexto vigente?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-560, 160],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        conditions: [
          {
            id: '20000000-0000-4000-8000-000000000004',
            leftValue: '={{ $json.operation }}', rightValue: 'analyst',
            operator: { type: 'string', operation: 'equals' },
          },
          {
            id: '20000000-0000-4000-8000-000000000005',
            leftValue: '={{ String($json.job_id) }}',
            rightValue: "={{ String($('validar solicitud analista').item.json.job_id) }}",
            operator: { type: 'string', operation: 'equals' },
          },
          {
            id: '20000000-0000-4000-8000-000000000006',
            leftValue: '={{ String($json.context_revision) }}',
            rightValue: "={{ String($('validar solicitud analista').item.json.expected_revision) }}",
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  };

  const prepare = {
    id: '20000000-0000-4000-8000-000000000007',
    name: 'preparar contexto analista',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-340, 120],
    parameters: { jsCode: `const context = $input.first().json;
return [{ json: {
  ...(context.lead || {}),
  data: context.messages || [],
  tenant_config: context.tenant_config || {},
  job_id: context.job_id,
  context_revision: context.context_revision,
  chat_id: $('validar solicitud analista').item.json.chat_id,
  tenant_context_token: $('validar solicitud analista').item.json.tenant_context_token
} }];` },
  };

  const agent = byName(workflow, 'agente analista1');
  agent.parameters.text = String(agent.parameters.text).replace(/\$\('Merge6'\)/g, "$('preparar contexto analista')");
  agent.parameters.options.systemMessage = String(agent.parameters.options.systemMessage).replace(
    /^=/,
    `=# CONTEXTO AUTORIZADO DEL NEGOCIO\nLa configuracion recibida en tenant_config es la unica fuente para identidad, moneda, catalogo, politicas y reglas del negocio. Nunca mezcles datos, servicios ni politicas de otro negocio. Si falta una regla, no la inventes.\nConfiguracion: {{ ($json.tenant_config ?? {}).toJsonString() }}\n\n`,
  );

  const normalize = byName(workflow, 'Vaciar a null');
  normalize.parameters.jsCode = normalize.parameters.jsCode.replace(
    /if \(digitos\.length === 9\) digitos = '51' \+ digitos;\s*telefono = '\+' \+ digitos;/,
    `const teniaPrefijo = String(telefono).trim().startsWith('+');
      telefono = teniaPrefijo ? '+' + digitos : digitos;`,
  );

  const apply = {
    id: '20000000-0000-4000-8000-000000000008',
    name: 'aplicar analisis vigente',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [260, 120],
    parameters: {
      method: 'POST',
      url: "={{ $env.BACKEND_URL.replace(/\\/$/, '') + '/api/webhooks/analysis-jobs/' + $('cargar contexto autorizado').item.json.job_id + '/apply' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ (() => {
  const output = $json.output;
  const fields = Object.fromEntries(Object.entries({
    nombre: output.nombre,
    telefono: output.telefono,
    servicio_interes: output.servicio_interes,
    notas: output.notas,
    razon_perdido: output.razon_perdido,
    fecha_recontacto: output.fecha_recontacto,
    tipo_objecion: output.tipo_objecion,
    proxima_cita: output.proxima_cita,
    con_especialista: output.con_especialista
  }).filter(([, value]) => value !== null && value !== undefined));
  return JSON.stringify({
    chat_id: $('validar solicitud analista').item.json.chat_id,
    context_revision: $('cargar contexto autorizado').item.json.context_revision,
    fields,
    estado: output.estado,
    razonamiento: output.razonamiento
  });
})() }}`,
      options: {},
    },
    credentials: JSON.parse(JSON.stringify(context.credentials || {})),
  };
  addTenantHeaders(apply.parameters, "$('validar solicitud analista').item.json", true);

  workflow.nodes.push(validate, context, current, prepare, apply);
  workflow.connections['Datos del mensaje'] = connection(['validar solicitud analista']);
  workflow.connections['validar solicitud analista'] = connection(['debounce analista1']);
  workflow.connections['debounce analista1'] = connection(['cargar contexto autorizado']);
  workflow.connections['cargar contexto autorizado'] = connection(['contexto vigente?']);
  workflow.connections['contexto vigente?'] = connection(['preparar contexto analista']);
  workflow.connections['preparar contexto analista'] = connection(['agente analista1']);
  workflow.connections['Vaciar a null'] = connection(['aplicar analisis vigente']);

  write(path, workflow);
}

function rewriteRag() {
  const path = 'rag.json';
  const workflow = read(path);
  const trigger = byName(workflow, 'When Executed by Another Workflow');
  trigger.parameters = {
    workflowInputs: {
      values: [
        { name: 'operation', type: 'string' },
        { name: 'job_id', type: 'string' },
        { name: 'tenant_context_token', type: 'string' },
        { name: 'context_revision', type: 'string' },
        { name: 'chat_id', type: 'string' },
        { name: 'instruction', type: 'string' },
      ],
    },
  };

  removeNodes(workflow, [
    'datos para el analista', 'Call analista', 'Code in JavaScript1',
    'Supabase Vector Store1', 'Embeddings OpenAI3', 'Default Data Loader1',
    'Token Splitter1', 'Embeddings OpenAI2',
  ]);

  const normalize = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'normalizar solicitud RAG',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1460, -420],
    parameters: { jsCode: `const input = $input.first().json;
const query = input.query || input;
const headers = input.headers || {};
const request = {
  operation: query.operation || 'rag',
  job_id: query.job_id || headers['x-job-id'],
  tenant_context_token: query.tenant_context_token || headers['x-tenant-context'],
  context_revision: query.context_revision,
  chat_id: query.chat_id,
  instruction: query.instruction || '',
  invocation: input.query ? 'webhook' : 'subworkflow'
};
for (const field of ['job_id', 'tenant_context_token', 'context_revision', 'chat_id']) {
  if (request[field] === undefined || request[field] === null || String(request[field]).trim() === '') {
    throw new Error('Falta input requerido: ' + field);
  }
}
if (request.operation !== 'rag') throw new Error('operation debe ser rag');
return [{ json: request }];` },
  };

  const execution = byName(workflow, 'Execution Data1');
  execution.parameters.dataToSave.values = [
    { key: 'chat_id', value: '={{ $json.chat_id }}' },
    { key: 'job_id', value: '={{ $json.job_id }}' },
    { key: 'context_revision', value: '={{ $json.context_revision }}' },
    { key: 'flow', value: 'sugerencia' },
  ];

  for (const name of ['get lead1', 'get messages']) {
    const request = byName(workflow, name);
    for (const parameter of request.parameters.queryParameters.parameters) {
      if (parameter.name === 'chat_id') parameter.value = "={{ $('normalizar solicitud RAG').item.json.chat_id }}";
    }
    request.parameters.queryParameters.parameters.push(
      { name: 'operation', value: 'rag' },
      { name: 'job_id', value: "={{ $('normalizar solicitud RAG').item.json.job_id }}" },
      { name: 'context_revision', value: "={{ $('normalizar solicitud RAG').item.json.context_revision }}" },
    );
    request.parameters.url = request.parameters.url.replace(/^https?:\/\/[^/]+/, "={{ $env.BACKEND_URL.replace(/\\/$/, '') + '") + "' }}";
    addTenantHeaders(request.parameters, "$('normalizar solicitud RAG').item.json", true);
  }

  const rag = byName(workflow, 'RAG1');
  rag.type = 'n8n-nodes-base.httpRequestTool';
  rag.typeVersion = 4.2;
  rag.parameters = {
    toolDescription: 'Busca conocimiento autorizado del negocio actual. Nunca consulta documentos fuera del contexto tenant del job.',
    method: 'POST',
    url: "={{ $env.BACKEND_URL.replace(/\\/$/, '') + '/api/webhooks/rag-search' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'X-Tenant-Context', value: "={{ $('normalizar solicitud RAG').item.json.tenant_context_token }}" },
      { name: 'X-Job-Id', value: "={{ $('normalizar solicitud RAG').item.json.job_id }}" },
    ] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({
  query: $fromAI('query', 'Consulta para la base de conocimiento', 'string'),
  job_id: $('normalizar solicitud RAG').item.json.job_id,
  context_revision: $('normalizar solicitud RAG').item.json.context_revision,
  top_k: 5
}) }}`,
    options: {},
  };
  rag.credentials = JSON.parse(JSON.stringify((byName(workflow, 'get lead1').credentials || {})));

  const catalog = byName(workflow, 'precios1');
  catalog.parameters.url = "={{ $env.BACKEND_URL.replace(/\\/$/, '') + '/api/webhooks/catalog' }}";
  catalog.parameters.authentication = 'genericCredentialType';
  catalog.parameters.genericAuthType = 'httpHeaderAuth';
  addTenantHeaders(catalog.parameters, "$('normalizar solicitud RAG').item.json", true);
  catalog.credentials = JSON.parse(JSON.stringify((byName(workflow, 'get lead1').credentials || {})));

  const agent = byName(workflow, 'Agente Copiloto Ventas1');
  agent.parameters.text = String(agent.parameters.text).replace(
    /\$\('Webhook1'\)\.item\.json\.query\.instruction/g,
    "$('normalizar solicitud RAG').item.json.instruction",
  );
  agent.parameters.options.systemMessage = String(agent.parameters.options.systemMessage).replace(
    /^=/,
    `=# AISLAMIENTO DEL NEGOCIO\nUsa solo el contexto, catalogo y conocimiento devueltos por las herramientas autorizadas para este job. Nunca asumas identidad, moneda, precios, politicas ni servicios de otro negocio.\n\n`,
  );

  const routeResult = {
    id: '30000000-0000-4000-8000-000000000002',
    name: 'respuesta por webhook?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [1080, -420],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: '30000000-0000-4000-8000-000000000003',
          leftValue: "={{ $('normalizar solicitud RAG').item.json.invocation }}",
          rightValue: 'webhook',
          operator: { type: 'string', operation: 'equals' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  };
  const returnResult = {
    id: '30000000-0000-4000-8000-000000000004',
    name: 'devolver resultado RAG',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [1320, -340],
    parameters: { assignments: { assignments: [] }, includeOtherFields: true, options: {} },
  };
  workflow.nodes.push(normalize, routeResult, returnResult);

  workflow.connections.Webhook1 = {
    main: [
      [{ node: 'normalizar solicitud RAG', type: 'main', index: 0 }],
      [{ node: 'normalizar solicitud RAG', type: 'main', index: 0 }],
    ],
  };
  workflow.connections['When Executed by Another Workflow'] = connection(['normalizar solicitud RAG']);
  workflow.connections['normalizar solicitud RAG'] = connection(['Execution Data1']);
  workflow.connections['Agente Copiloto Ventas1'] = connection(['respuesta por webhook?']);
  workflow.connections['respuesta por webhook?'] = {
    main: [
      [{ node: 'Respond to Webhook1', type: 'main', index: 0 }],
      [{ node: 'devolver resultado RAG', type: 'main', index: 0 }],
    ],
  };

  write(path, workflow);
}

function pruneRagToCopilot() {
  const path = 'rag.json';
  const workflow = read(path);
  const keep = new Set(['Webhook1', 'When Executed by Another Workflow']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [source, groups] of Object.entries(workflow.connections)) {
      if (keep.has(source)) {
        for (const branches of Object.values(groups)) {
          for (const branch of branches) {
            for (const edge of branch) {
              if (!keep.has(edge.node)) {
                keep.add(edge.node);
                changed = true;
              }
            }
          }
        }
      }
      for (const [kind, branches] of Object.entries(groups)) {
        if (kind === 'main') continue;
        if (branches.some((branch) => branch.some((edge) => keep.has(edge.node))) && !keep.has(source)) {
          keep.add(source);
          changed = true;
        }
      }
    }
  }
  removeNodes(workflow, workflow.nodes.filter((node) => !keep.has(node.name)).map((node) => node.name));
  write(path, workflow);
}

pruneRagToCopilot();
