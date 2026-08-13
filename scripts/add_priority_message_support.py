"""Añade a un workflow n8n los mensajes prioritarios de WhatsApp Business.

Incluye interactivos/listas, PTV, encuestas V2-V5 y snapshots, productos,
pagos, visualización única y actualizaciones de voto. Es idempotente y
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


INTERACTIVE_CONTENT = "={{ (() => { const data=(($json.body||{}).data||{}); const m=data.message||{}; const t=data.messageType; const v=m[t]||{}; const parse=x=>{try{return typeof x==='string'?JSON.parse(x):x||{}}catch{return {}}}; const response=parse((v.nativeFlowResponseMessage||{}).paramsJson); const single=v.singleSelectReply||{}; return v.selectedDisplayText||v.selected_text||v.title||(v.body||{}).text||response.display_text||response.title||single.selectedRowId||'Mensaje interactivo'; })() }}"
INTERACTIVE_PAYLOAD = "={{ (() => { const data=(($json.body||{}).data||{}); const m=data.message||{}; const t=data.messageType; const v=m[t]||{}; const parse=x=>{try{return typeof x==='string'?JSON.parse(x):x||{}}catch{return {}}}; const response=parse((v.nativeFlowResponseMessage||{}).paramsJson); const rows=(v.sections||[]).flatMap(s=>(s.rows||[]).map(r=>({id:r.rowId||r.id||null,text:r.title||r.name||null,description:r.description||null}))); const buttons=((v.nativeFlowMessage||{}).buttons||v.buttons||[]).map(b=>{const p=parse(b.buttonParamsJson); return {id:b.buttonId||p.id||null,text:((b.buttonText||{}).displayText)||p.display_text||null,url:p.url||null}}); const single=v.singleSelectReply||{}; return {original_type:t,title:v.title||(v.header||{}).title||null,body:(v.body||{}).text||v.contentText||v.description||null,footer:(v.footer||{}).text||v.footerText||null,options:rows,buttons,selected_id:v.selectedButtonId||single.selectedRowId||response.id||response.selected_id||null,selected_text:v.selectedDisplayText||response.display_text||response.title||null}; })() }}"

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


def _configure_content_node(node: dict[str, Any], message_type: str, content: str, payload: str, quote: str) -> None:
    _set(node, "content", content, "string")
    _set(node, "message_type", message_type, "string")
    _set(node, "payload", payload, "object")
    _set(node, "media_url", "=", "string")
    _set(node, "quoted_wa_message_id", quote, "string")


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


def update_workflow(workflow: dict[str, Any]) -> bool:
    before = json.dumps(workflow, sort_keys=True, ensure_ascii=False)

    interactive = _content_node(workflow, "priority interactive content", 384)
    _configure_content_node(
        interactive, "interactive", INTERACTIVE_CONTENT, INTERACTIVE_PAYLOAD,
        "={{ (() => { const data=(($json.body||{}).data||{}); const v=(data.message||{})[data.messageType]||{}; return ((v.contextInfo||{}).stanzaId)||null; })() }}",
    )
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

    poll = _node(workflow, "poll content")
    _set(poll, "content", POLL_CONTENT, "string")
    _set(poll, "payload", POLL_PAYLOAD, "object")

    _add_ptv_chain(workflow)
    _add_poll_update_webhook(workflow)

    _upsert_rule(workflow, "poll", POLL_CREATION_TYPES, "poll content")
    _upsert_rule(workflow, "priorityInteractive", INTERACTIVE_TYPES, "priority interactive content")
    _upsert_rule(workflow, "ptv", ["ptvMessage"], "get ptv")
    _upsert_rule(workflow, "pollSnapshot", POLL_SNAPSHOT_TYPES, "poll snapshot content")
    _upsert_rule(workflow, "pollUpdate", ["pollUpdateMessage"], "poll results webhook")
    _upsert_rule(workflow, "product", ["productMessage"], "product content")
    _upsert_rule(workflow, "payment", PAYMENT_TYPES, "payment content")
    _upsert_rule(workflow, "viewOnce", VIEW_ONCE_TYPES, "view once content")

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
