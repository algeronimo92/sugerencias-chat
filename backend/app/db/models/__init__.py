"""Registro ORM único: carga modelos de control y tenant para Alembic."""

from app.db.base import Base
from app.db.models.control import Organization, OrganizationBranding, OrganizationDomain, WhatsAppConnection, TenantSchemaVersion, PlatformSetting, PlatformUser, PlatformSession, WebhookInbox, KnowledgeTemplate
from app.db.models.ai import AIJob, KnowledgeDocument, AIProfile, KnowledgeChunk
from app.db.models.leads import Lead, WhatsAppIdentity, WhatsappAdConversion, LeadSale, LeadStage, LeadTagAssignment, LeadActivity, LeadNote, LeadNoteMention, LeadAssignmentTurn
from app.db.models.conversations import WspMessage, WhatsAppMessageEvent, WhatsAppEntryPointWindow, MessageOutbox, ScheduledMessage
from app.db.models.platform import WhatsAppPricingDaily
from app.db.models.settings import AppSetting
from app.db.models.auth import User, AuthLoginThrottle, AdminTotp, AdminTotpRecoveryCode, AuthActionToken, EmailNotificationLog, TrustedDevice, AuthSession
from app.db.models.catalogs import LeadTag, LeadService, ServicePackage, TemplateCategory, CustomFieldDefinition, MessageTemplate, TemplateUserState, TemplateAttachment
from app.db.models.notifications import UserNotification, PushSubscription
from app.db.models.reports import IssueReport, IssueReportAttachment, IssueReportComment, IssueReportEvent
from app.db.models.appointments import Appointment
from app.db.models.tasks import LeadTask
from app.db.models.media import MediaAsset
from app.db.models.automations import AutomationRule, AutomationFlowVersion, AutomationRoundRobinState, AutomationExecution

__all__ = [
    'Base',
    'Organization',
    'OrganizationBranding',
    'OrganizationDomain',
    'WhatsAppConnection',
    'TenantSchemaVersion',
    'PlatformSetting',
    'PlatformUser',
    'PlatformSession',
    'WebhookInbox',
    'KnowledgeTemplate',
    'AIJob',
    'KnowledgeDocument',
    'AIProfile',
    'KnowledgeChunk',
    'Lead',
    'WhatsAppIdentity',
    'WhatsappAdConversion',
    'WspMessage',
    'WhatsAppMessageEvent',
    'WhatsAppEntryPointWindow',
    'WhatsAppPricingDaily',
    'MessageOutbox',
    'ScheduledMessage',
    'AppSetting',
    'User',
    'AuthLoginThrottle',
    'AdminTotp',
    'AdminTotpRecoveryCode',
    'AuthActionToken',
    'EmailNotificationLog',
    'TrustedDevice',
    'AuthSession',
    'LeadStage',
    'LeadSale',
    'LeadTag',
    'LeadService',
    'ServicePackage',
    'TemplateCategory',
    'LeadTagAssignment',
    'LeadActivity',
    'LeadNote',
    'LeadNoteMention',
    'LeadAssignmentTurn',
    'UserNotification',
    'PushSubscription',
    'IssueReport',
    'IssueReportAttachment',
    'IssueReportComment',
    'IssueReportEvent',
    'CustomFieldDefinition',
    'Appointment',
    'LeadTask',
    'MessageTemplate',
    'TemplateUserState',
    'MediaAsset',
    'TemplateAttachment',
    'AutomationRule',
    'AutomationFlowVersion',
    'AutomationRoundRobinState',
    'AutomationExecution',
]
