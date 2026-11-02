/** Contrato explícito para otras features: solo lo que usan desde afuera. */
export { formatDayLabel, formatMessageTime, formatMoney, groupByDay, messageAdReferral, messageContacts, messageCoords, messageFilename, messageFlowReply, messageOrder, messageProducts, messageReply, messageSystemNotice, metaErrors, parseContent, parseRichText, quotePreview, resolveMediaUrl, searchSnippet, splitOnMatch } from '../message'
export type { AdReferral, MessageKind, ParsedContent, SharedContact, TemplateMessage } from '../message'
