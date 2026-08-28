"""Añade a un workflow n8n los mensajes prioritarios de WhatsApp Business.

Incluye interactivos/listas, PTV, encuestas V2-V5 y snapshots, productos,
pagos, visualización única, actualizaciones de voto, ubicación en vivo,
stickers animados (Lottie) y fijar/desfijar mensaje. Es idempotente y
conserva el fallback como última salida del Switch.
"""

from __future__ import annotations

import argparse
import copy
import json
import uuid
from pathlib import Path
from typing import Any


SWITCH = "Switch Control type1"
FALLBACK = "unsupported content"


def _node(workflow: dict[str, Any], name: str) -> dict[str, Any]:
    try:
        return next(node for node in workflow["nodes"] if node.get("name") == name)
    except StopIteration as exc:
        raise ValueError(f"Falta el nodo requerido: {name}") from exc


def _id(label: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"dermicapro:n8n:priority:{label}"))


def _assignments(node: dict[str, Any]) -> list[dict[str, Any]]:
    return node["parameters"]["assignments"]["assignments"]


def _set(node: dict[str, Any], name: str, value: Any, value_type: str) -> None:
    item = next((item for item in _assignments(node) if item.get("name") == name), None)
    if item is None:
        item = {"id": _id(f"{node['name']}:{name}"), "name": name}
        _assignments(node).append(item)
    item.update({"value": value, "type": value_type})


def _condition(message_type: str) -> dict[str, Any]:
    return {
        "id": _id(f"condition:{message_type}"),
        "leftValue": "={{ $json.body.data.messageType }}",
        "rightValue": message_type,
        "operator": {"type": "string", "operation": "equals", "name": "filter.operator.equals"},
    }


def _rule(key: str, message_types: list[str]) -> dict[str, Any]:
    return {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
            "conditions": [_condition(message_type) for message_type in message_types],
            "combinator": "or" if len(message_types) > 1 else "and",
        },
        "renameOutput": True,
        "outputKey": key,
    }


def _upsert_rule(workflow: dict[str, Any], key: str, types: list[str], target: str) -> None:
    switch = _node(workflow, SWITCH)
    rules = switch["parameters"]["rules"]["values"]
    outputs = workflow["connections"][SWITCH]["main"]
    index = next((i for i, rule in enumerate(rules) if rule.get("outputKey") == key), None)
    if index is None:
        index = len(rules)
        rules.append(_rule(key, types))
        outputs.insert(index, [])
    else:
        rules[index] = _rule(key, types)
    outputs[index] = [{"node": target, "type": "main", "index": 0}]


def _content_node(workflow: dict[str, Any], name: str, y_offset: int) -> dict[str, Any]:
    try:
        return _node(workflow, name)
    except ValueError:
        node = copy.deepcopy(_node(workflow, FALLBACK))
        node.update({"id": _id(name), "name": name})
        x, y = _node(workflow, FALLBACK).get("position", [6944, 8448])
        node["position"] = [x, y + y_offset]
        workflow["nodes"].append(node)
        workflow["connections"][name] = copy.deepcopy(workflow["connections"][FALLBACK])
        return node


INTERACTIVE_TYPES = [
    "listMessage", "listResponseMessage", "interactiveMessage",
    "interactiveResponseMessage", "templateButtonReplyMessage",
]
POLL_CREATION_TYPES = [
    "pollCreationMessage", "pollCreationMessageV2", "pollCreationMessageV3",
    "pollCreationMessageV4", "pollCreationMessageV5",
]
POLL_SNAPSHOT_TYPES = ["pollResultSnapshotMessage", "pollResultSnapshotMessageV3"]
PAYMENT_TYPES = [
    "invoiceMessage", "requestPaymentMessage", "sendPaymentMessage",
    "paymentInviteMessage", "cancelPaymentRequestMessage", "declinePaymentRequestMessage",
]
VIEW_ONCE_TYPES = [
    "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
]
LOCATION_TYPES = ["locationMessage", "liveLocationMessage"]
STICKER_TYPES = ["stickerMessage", "lottieStickerMessage"]
PIN_TYPES = ["pinInChatMessage"]


# Esta transformación es deliberadamente un Code node. El parser de
# expresiones del Set 3.4 de n8n 2.31.6 rechaza construcciones válidas al
# procesar payloads complejos; el Code node ejecuta JavaScript real y permite
# tolerar paramsJson defectuosos sin tumbar el workflow.
INTERACTIVE_CODE = r"""const input = $input.first().json;
const data = ((input.body || {}).data || {});
const message = data.message || {};
const messageType = data.messageType || 'interactiveMessage';
const value = message[messageType] || {};

function safeJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

const nativeResponse = value.nativeFlowResponseMessage || {};
const response = safeJson(nativeResponse.paramsJson);
const single = value.singleSelectReply || {};
const rows = [];
for (const section of Array.isArray(value.sections) ? value.sections : []) {
  for (const row of Array.isArray(section.rows) ? section.rows : []) {
    rows.push({
      id: row.rowId || row.id || null,
      text: row.title || row.name || null,
      description: row.description || null,
    });
  }
}

const sourceButtons = ((value.nativeFlowMessage || {}).buttons || value.buttons || []);
const buttons = [];
for (const button of Array.isArray(sourceButtons) ? sourceButtons : []) {
  const params = safeJson(button.buttonParamsJson);
  buttons.push({
    id: button.buttonId || button.id || params.id || null,
    text: ((button.buttonText || {}).displayText) || button.text || params.display_text || null,
    url: button.url || params.url || null,
  });
}

const body = ((value.body || {}).text) || value.contentText || value.description || null;
const title = value.title || ((value.header || {}).title) || null;
const selectedText = value.selectedDisplayText || value.selected_text || response.display_text || response.title || null;
const content = selectedText || title || body || single.selectedRowId || 'Mensaje interactivo';
const rawTimestamp = Number(data.messageTimestamp);
const timestampMillis = rawTimestamp > 1000000000000 ? rawTimestamp : rawTimestamp * 1000;
const timestamp = Number.isFinite(timestampMillis) ? new Date(timestampMillis).toISOString() : null;
const identity = $('Resolver identidad WhatsApp').first().json || {};
const parsedInput = input.parsed || {};

return [{
  json: {
    content,
    message_type: 'interactive',
    payload: {
      original_type: messageType,
      title,
      body,
      footer: ((value.footer || {}).text) || value.footerText || null,
      options: rows,
      buttons,
      selected_id: value.selectedButtonId || single.selectedRowId || response.id || response.selected_id || null,
      selected_text: selectedText,
    },
    timestamp,
    media_url: null,
    chat_id: identity.chat_id,
    message_id: (data.key || {}).id || null,
    status: data.status || null,
    origen: 'WhatsApp',
    last_sender: parsedInput.last_sender || null,
    minutes_since_last_message: parsedInput.minutes_since_last_message ?? null,
    quoted_wa_message_id: ((value.contextInfo || {}).stanzaId) || null,
  },
  pairedItem: { item: 0 },
}];"""

PRODUCT_CONTENT = "={{ (() => { const p=(((($json.body||{}).data||{}).message||{}).productMessage||{}); const x=p.product||{}; return x.title||p.body||'Producto de WhatsApp'; })() }}"
PRODUCT_PAYLOAD = "={{ (() => { const p=(((($json.body||{}).data||{}).message||{}).productMessage||{}); const x=p.product||{}; const long=v=>v==null?null:(typeof v==='object'&&Number.isInteger(v.low)?String((Number.isInteger(v.high)?v.high:0)*4294967296+(v.low>>>0)):v); return {original_type:'productMessage',product_id:x.productId||null,retailer_id:x.retailerId||null,title:x.title||null,description:x.description||null,body:p.body||null,footer:p.footer||null,price_amount_1000:long(x.priceAmount1000),sale_price_amount_1000:long(x.salePriceAmount1000),currency:x.currencyCode||null,url:x.url||x.signedUrl||null,image_url:(x.productImage||{}).url||null}; })() }}"

PAYMENT_CONTENT = "={{ (() => { const data=(($json.body||{}).data||{}); const t=data.messageType; const p=(data.message||{})[t]||{}; return p.noteMessage||p.note||p.message||p.status||'Pago de WhatsApp'; })() }}"
PAYMENT_PAYLOAD = "={{ (() => { const data=(($json.body||{}).data||{}); const t=data.messageType; const p=(data.message||{})[t]||{}; const long=v=>v==null?null:(typeof v==='object'&&Number.isInteger(v.low)?String((Number.isInteger(v.high)?v.high:0)*4294967296+(v.low>>>0)):v); return {original_type:t,payment_kind:t.replace(/Message$/,''),transaction_id:p.transactionId||p.paymentRequestId||null,amount_1000:long(p.amount1000??p.amount),currency:p.currencyCode||p.currency||null,note:p.noteMessage||p.note||p.message||null,status:p.status??p.serviceType??null,expiry_timestamp:long(p.expiryTimestamp)}; })() }}"

POLL_CONTENT = "={{ (() => { const m=((($json.body||{}).data||{}).message||{}); const p=m.pollCreationMessage||m.pollCreationMessageV2||m.pollCreationMessageV3||m.pollCreationMessageV4||m.pollCreationMessageV5||{}; return p.name||'Encuesta'; })() }}"
POLL_PAYLOAD = "={{ (() => { const data=(($json.body||{}).data||{}); const m=data.message||{}; const p=m.pollCreationMessage||m.pollCreationMessageV2||m.pollCreationMessageV3||m.pollCreationMessageV4||m.pollCreationMessageV5||{}; return {original_type:data.messageType,values:(p.options||[]).map(o=>o.optionName||o.name).filter(Boolean),selectable_count:p.selectableOptionsCount??null}; })() }}"

SNAPSHOT_CONTENT = "={{ (() => { const data=(($json.body||{}).data||{}); const s=(data.message||{})[data.messageType]||{}; return s.name||'Resultados de encuesta'; })() }}"
SNAPSHOT_PAYLOAD = "={{ (() => { const data=(($json.body||{}).data||{}); const s=(data.message||{})[data.messageType]||{}; return {original_type:data.messageType,results:(s.pollVotes||[]).map(v=>({option:v.optionName||v.option||v.name||'',count:Array.isArray(v.voters)?v.voters.length:Number(v.count)||0,voters:Array.isArray(v.voters)?v.voters:[]})).filter(v=>v.option)}; })() }}"

# No se copian URL, directPath, claves ni bytes del adjunto view-once. El CRM
# solo conserva su subtipo y caption para poder explicarle al agente qué llegó.
VIEW_ONCE_CONTENT = "={{ (() => { const data=(($json.body||{}).data||{}); const root=((data.message||{})[data.messageType]||{}); const keys=['imageMessage','videoMessage','ptvMessage','audioMessage','documentMessage']; const find=(node,depth=0)=>{if(!node||typeof node!=='object'||depth>6)return null; for(const key of keys){if(node[key]&&typeof node[key]==='object')return node[key];} for(const key of ['message','ephemeralMessage','documentWithCaptionMessage']){const found=find(node[key],depth+1);if(found)return found;} return null;}; const media=find(root)||{}; return typeof media.caption==='string'&&media.caption.trim()?media.caption.trim():null; })() }}"
VIEW_ONCE_PAYLOAD = "={{ (() => { const data=(($json.body||{}).data||{}); const root=((data.message||{})[data.messageType]||{}); const kinds={imageMessage:'image',videoMessage:'video',ptvMessage:'ptv',audioMessage:'audio',documentMessage:'document'}; const find=(node,depth=0)=>{if(!node||typeof node!=='object'||depth>6)return 'unknown'; for(const [key,kind] of Object.entries(kinds)){if(node[key]&&typeof node[key]==='object')return kind;} for(const key of ['message','ephemeralMessage','documentWithCaptionMessage']){const found=find(node[key],depth+1);if(found!=='unknown')return found;} return 'unknown';}; return {original_type:data.messageType,inner_type:find(root)}; })() }}"
VIEW_ONCE_QUOTE = "={{ (() => { const data=(($json.body||{}).data||{}); const root=((data.message||{})[data.messageType]||{}); const find=(node,depth=0)=>{if(!node||typeof node!=='object'||depth>6)return null; if(node.contextInfo&&node.contextInfo.stanzaId)return node.contextInfo.stanzaId; for(const key of ['message','imageMessage','videoMessage','ptvMessage','audioMessage','documentMessage']){const found=find(node[key],depth+1);if(found)return found;} return null;}; return find(root); })() }}"


# `locationMessage` y `liveLocationMessage` comparten los campos de coordenadas;
# la variante en vivo no trae `name`/`address` pero sí hay que marcarla para
# que el frontend muestre el badge "En vivo".
LOCATION_PAYLOAD = "={{ (() => { /*ADREF*/ const data=(($json.body||{}).data||{}); const t=data.messageType; const src=((data.message||{})[t])||{}; const live=t==='liveLocationMessage'; const base={ latitude: src.degreesLatitude, longitude: src.degreesLongitude, name: live?null:(src.name||null), address: live?null:(src.address||null) }; if (live) base.live=true; let ad = null; (function find(o){ if (!o || typeof o !== 'object' || ad) return; if (o.externalAdReply) { ad = o.externalAdReply; return; } for (const k in o) find(o[k]); })(data); const adref = ad ? { ad_referral: { title: ad.title || null, body: ad.body || null, source_url: ad.sourceUrl || null, source_id: ad.sourceId || null, source_type: ad.sourceType || null, source_app: ad.sourceApp || null, media_type: ad.mediaType != null ? ad.mediaType : null, media_url: ad.mediaUrl || null, thumbnail_url: ad.thumbnailUrl || null, ctwa_clid: ad.ctwaClid || null } } : null; return Object.assign({}, base, adref || {}); })() }}"

# `pinInChatMessage.type` llega como 1 (PIN_FOR_ALL) o 2 (UNPIN_FOR_ALL); a
# veces Evolution lo serializa como el nombre del enum en vez del número.
PIN_CONTENT = "={{ (() => { const p=((($json.body||{}).data||{}).message||{}).pinInChatMessage||{}; return (p.type===2||p.type==='UNPIN_FOR_ALL')?'Desfijó un mensaje':'Fijó un mensaje'; })() }}"
PIN_PAYLOAD = "={{ (() => { const p=((($json.body||{}).data||{}).message||{}).pinInChatMessage||{}; const action=(p.type===2||p.type==='UNPIN_FOR_ALL')?'unpin':'pin'; return {action, target_wa_message_id: ((p.key||{}).id)||null}; })() }}"
# El mensaje que se fijó/desfijó se muestra citado arriba, igual que una
# respuesta normal: así se ve a qué mensaje se refiere sin duplicar su texto.
PIN_QUOTE = "={{ (() => { const p=((($json.body||{}).data||{}).message||{}).pinInChatMessage||{}; return ((p.key||{}).id)||null; })() }}"

# `secretEncType` distingue qué acción cifrada trae un `secretEncryptedMessage`
# (2 = edición, ya ruteada aparte por la regla `editedSecret`). WhatsApp no
# publica ese enum: esto solo deja el valor crudo en el fallback para poder
# ver en la base, con el tiempo, qué otros valores manda esta cuenta.
UNSUPPORTED_BASE_OLD = "const base = ({ original_type: $json.body.data.messageType });"
UNSUPPORTED_BASE_NEW = (
    "const t = $json.body.data.messageType; "
    "const base = { original_type: t }; "
    "if (t === 'secretEncryptedMessage') { "
    "const s = ((($json.body.data.message || {}).secretEncryptedMessage) || {}); "
    "if ('secretEncType' in s) base.secret_enc_type = s.secretEncType; "
    "}"
)


def _configure_content_node(node: dict[str, Any], message_type: str, content: str, payload: str, quote: str) -> None:
    _set(node, "content", content, "string")
    _set(node, "message_type", message_type, "string")
    _set(node, "payload", payload, "object")
    _set(node, "media_url", "=", "string")
    _set(node, "quoted_wa_message_id", quote, "string")


def _configure_interactive_code_node(node: dict[str, Any]) -> None:
    node["type"] = "n8n-nodes-base.code"
    node["typeVersion"] = 2
    node["parameters"] = {"jsCode": INTERACTIVE_CODE}


def _replace_strings(value: Any, replacements: list[tuple[str, str]]) -> Any:
    if isinstance(value, str):
        for old, new in replacements:
            value = value.replace(old, new)
        return value
    if isinstance(value, list):
        return [_replace_strings(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: _replace_strings(item, replacements) for key, item in value.items()}
    return value


def _add_ptv_chain(workflow: dict[str, Any]) -> None:
    mapping = {
        "get video": "get ptv",
        "Convert to video": "Convert to ptv",
        "Analyze video1": "Analyze ptv1",
        "upload video media": "upload ptv media",
        "video content": "ptv content",
    }
    replacements = sorted(mapping.items(), key=lambda item: len(item[0]), reverse=True) + [
        ("videoMessage", "ptvMessage"),
    ]
    existing = {node.get("name") for node in workflow["nodes"]}
    for old_name, new_name in mapping.items():
        if new_name in existing:
            node = _node(workflow, new_name)
        else:
            node = _replace_strings(copy.deepcopy(_node(workflow, old_name)), replacements)
            node["id"] = _id(new_name)
            if isinstance(node.get("position"), list):
                node["position"][1] += 960
            workflow["nodes"].append(node)
        if new_name == "ptv content":
            _set(node, "message_type", "ptv", "string")

    for old_name, new_name in mapping.items():
        connection = copy.deepcopy(workflow["connections"].get(old_name, {"main": [[]]}))
        workflow["connections"][new_name] = _replace_strings(connection, replacements)


def _add_poll_update_webhook(workflow: dict[str, Any]) -> None:
    name = "poll results webhook"
    try:
        node = _node(workflow, name)
    except ValueError:
        node = copy.deepcopy(_node(workflow, "reaction webhook1"))
        node.update({"id": _id(name), "name": name})
        node["position"] = [6944, 9600]
        workflow["nodes"].append(node)
    node["parameters"] = {
        "method": "POST",
        "url": "https://chat.dermicapro.app/api/webhooks/poll-results",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ (() => { const data=(($json.body||{}).data||{}); const u=((data.message||{}).pollUpdateMessage||{}); const snapshot=Array.isArray(data.pollResults); const source=snapshot?data.pollResults:(data.pollUpdates||u.pollVotes||(u.vote?[u.vote]:[])); const flat=Array.isArray(source)?source:[]; const results=flat.map(v=>{ const vote=v.vote||v; const option=vote.optionName||vote.option||vote.name||(typeof vote==='string'?vote:''); const voters=Array.isArray(vote.voters)?vote.voters:[]; return {option,count:voters.length||Number(vote.count)||1,voters}; }).filter(v=>v.option); const encrypted=!snapshot&&flat.length>0&&results.length===0; return JSON.stringify({chat_id:$('Resolver identidad WhatsApp').first().json.chat_id,target_wa_message_id:((u.pollCreationMessageKey||{}).id)||data.pollUpdateParentKey||null,results,voter_id:(data.key||{}).participant||(data.key||{}).remoteJid||null,mode:snapshot?'snapshot':'delta',decrypted:!encrypted}); })() }}",
        "options": {},
    }
    workflow["connections"][name] = {"main": [[]]}


def _enrich_unsupported_fallback(workflow: dict[str, Any]) -> None:
    node = _node(workflow, FALLBACK)
    payload_item = next(
        item for item in _assignments(node) if item.get("name") == "payload"
    )
    if UNSUPPORTED_BASE_OLD in payload_item["value"]:
        payload_item["value"] = payload_item["value"].replace(UNSUPPORTED_BASE_OLD, UNSUPPORTED_BASE_NEW)


def update_workflow(workflow: dict[str, Any]) -> bool:
    before = json.dumps(workflow, sort_keys=True, ensure_ascii=False)

    interactive = _content_node(workflow, "priority interactive content", 384)
    _configure_interactive_code_node(interactive)
    product = _content_node(workflow, "product content", 576)
    _configure_content_node(product, "product", PRODUCT_CONTENT, PRODUCT_PAYLOAD, "={{ (((($json.body.data.message||{}).productMessage||{}).contextInfo||{}).stanzaId)||null }}")
    payment = _content_node(workflow, "payment content", 768)
    _configure_content_node(payment, "payment", PAYMENT_CONTENT, PAYMENT_PAYLOAD, "={{ (() => { const data=$json.body.data; const p=(data.message||{})[data.messageType]||{}; return ((p.contextInfo||{}).stanzaId)||null; })() }}")
    snapshot = _content_node(workflow, "poll snapshot content", 960)
    _configure_content_node(snapshot, "poll", SNAPSHOT_CONTENT, SNAPSHOT_PAYLOAD, "={{ (() => { const data=$json.body.data; const s=(data.message||{})[data.messageType]||{}; return ((s.contextInfo||{}).stanzaId)||null; })() }}")
    view_once = _content_node(workflow, "view once content", 1152)
    _configure_content_node(
        view_once, "view_once", VIEW_ONCE_CONTENT, VIEW_ONCE_PAYLOAD,
        VIEW_ONCE_QUOTE,
    )
    pin = _content_node(workflow, "pin content", 1344)
    _configure_content_node(pin, "pin", PIN_CONTENT, PIN_PAYLOAD, PIN_QUOTE)

    poll = _node(workflow, "poll content")
    _set(poll, "content", POLL_CONTENT, "string")
    _set(poll, "payload", POLL_PAYLOAD, "object")

    # location content y get sticker1/sticker content ya existen en el export
    # crudo de n8n (rutean locationMessage/stickerMessage); acá solo se suma
    # la variante en vivo / animada a la misma regla y target.
    location = _node(workflow, "location content")
    _set(location, "payload", LOCATION_PAYLOAD, "object")

    _add_ptv_chain(workflow)
    _add_poll_update_webhook(workflow)
    _enrich_unsupported_fallback(workflow)

    _upsert_rule(workflow, "poll", POLL_CREATION_TYPES, "poll content")
    _upsert_rule(workflow, "priorityInteractive", INTERACTIVE_TYPES, "priority interactive content")
    _upsert_rule(workflow, "ptv", ["ptvMessage"], "get ptv")
    _upsert_rule(workflow, "pollSnapshot", POLL_SNAPSHOT_TYPES, "poll snapshot content")
    _upsert_rule(workflow, "pollUpdate", ["pollUpdateMessage"], "poll results webhook")
    _upsert_rule(workflow, "product", ["productMessage"], "product content")
    _upsert_rule(workflow, "payment", PAYMENT_TYPES, "payment content")
    _upsert_rule(workflow, "viewOnce", VIEW_ONCE_TYPES, "view once content")
    _upsert_rule(workflow, "location", LOCATION_TYPES, "location content")
    _upsert_rule(workflow, "sticker", STICKER_TYPES, "get sticker1")
    _upsert_rule(workflow, "pin", PIN_TYPES, "pin content")

    return before != json.dumps(workflow, sort_keys=True, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow", type=Path, nargs="+")
    args = parser.parse_args()
    for path in args.workflow:
        workflow = json.loads(path.read_text(encoding="utf-8"))
        changed = update_workflow(workflow)
        if changed:
            path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{path}: {'actualizado' if changed else 'sin cambios'}")


if __name__ == "__main__":
    main()
