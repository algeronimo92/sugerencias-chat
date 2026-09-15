from enum import StrEnum


class RealtimeEvent(StrEnum):
    CHATS_UPDATED = "chats_updated"
    TASKS_UPDATED = "tasks_updated"
    TASK_REMINDER = "task_reminder"
    SCHEDULED_MESSAGES_UPDATED = "scheduled_messages_updated"
    INTERNAL_NOTES_UPDATED = "internal_notes_updated"
    NOTIFICATION_CREATED = "notification_created"
    NOTIFICATIONS_UPDATED = "notifications_updated"
    ISSUE_REPORTS_UPDATED = "issue_reports_updated"
    TEMPLATES_UPDATED = "templates_updated"
    MEDIA_LIBRARY_UPDATED = "media_library_updated"
    AUTOMATIONS_UPDATED = "automations_updated"


class ChatsUpdateReason(StrEnum):
    INBOUND_MESSAGE = "inbound_message"
    EXTERNAL_MESSAGE = "external_message"
    OUTBOUND_QUEUED = "outbound_queued"
    OUTBOUND_MESSAGE = "outbound_message"
    MESSAGE_STATUS = "message_status"
    MESSAGE_EDITED = "message_edited"
    MESSAGE_DELETED = "message_deleted"
    MESSAGE_PINNED = "message_pinned"
    REACTION = "reaction"
    POLL_RESULTS = "poll_results"
    ANALYSIS = "analysis"
    READ = "read"
    UNREAD = "unread"
    LEAD_CREATED = "lead_created"
    LEAD_UPDATED = "lead_updated"
    LEAD_DELETED = "lead_deleted"
    STAGE_CHANGED = "stage_changed"
    TAG_CHANGED = "tag_changed"
    CONVERSATION_OPENED = "conversation_opened"
    CONVERSATION_CLOSED = "conversation_closed"
