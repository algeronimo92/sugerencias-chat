"""Eventos de los reportes de problemas. Todos refrescan la lista de
reportes; los que avisan a alguien llevan lo necesario para la notificación."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.events import DomainEvent


@dataclass(frozen=True, kw_only=True)
class IssueReportsChanged(DomainEvent):
    """Cambió algún reporte: las listas tienen que refrescarse."""


@dataclass(frozen=True, kw_only=True)
class IssueReportFiled(IssueReportsChanged):
    """Un usuario cargó un reporte: los admins se enteran."""

    report_id: int
    public_code: str
    title: str
    reporter_id: int
    reporter_name: str


@dataclass(frozen=True, kw_only=True)
class IssueReportStatusChanged(IssueReportsChanged):
    """Un admin cambió el estado del reporte de otro usuario: su autor se
    entera."""

    report_id: int
    public_code: str
    title: str
    status_label: str
    reporter_id: int


@dataclass(frozen=True, kw_only=True)
class IssueReportCommented(IssueReportsChanged):
    """Alguien comentó un reporte: la otra parte se entera (el autor si
    comentó un admin, los admins si comentó el autor)."""

    report_id: int
    public_code: str
    author_id: int
    author_name: str
    content: str
    recipient_ids: tuple[int, ...]
