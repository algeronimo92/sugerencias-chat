import { describe, expect, it } from 'vitest'

import type { LeadStageDefinition } from '../types'
import {
  buildStageCatalog,
  conditionStageOptions,
  contrastRatio,
  LEAD_STAGE_COLORS,
  stageBadgeColors,
  DEFAULT_LEAD_STAGES,
  humanizeStageKey,
  kanbanColumns,
  stageOptions,
} from './leadStageMeta'

function stage(key: string, position: number, overrides: Partial<LeadStageDefinition> = {}): LeadStageDefinition {
  return { key, name: key, color: '#0ea5e9', kind: 'open', position, is_active: true, description: null, is_system: false, ...overrides }
}

describe('catálogo de etapas', () => {
  it('ordena por posición y separa las activas', () => {
    const catalog = buildStageCatalog([
      stage('cierre', 2),
      stage('nuevo', 0),
      stage('archivado', 1, { is_active: false }),
    ])

    expect(catalog.stages.map(item => item.key)).toEqual(['nuevo', 'archivado', 'cierre'])
    expect(catalog.active.map(item => item.key)).toEqual(['nuevo', 'cierre'])
  })

  it('rotula una clave que el negocio ya no tiene sin romper', () => {
    const catalog = buildStageCatalog([stage('nuevo', 0)])

    expect(catalog.label('cita_pagada')).toBe('Cita pagada')
    expect(catalog.get('cita_pagada').is_active).toBe(false)
  })

  it('la razón de pérdida sigue al tipo, no al nombre', () => {
    const catalog = buildStageCatalog([stage('sin_respuesta', 0, { kind: 'lost' }), stage('perdido', 1)])

    expect(catalog.isLost('sin_respuesta')).toBe(true)
    expect(catalog.isLost('perdido')).toBe(false)
  })

  it('el respaldo trae las 13 etapas de siempre con su semántica', () => {
    const catalog = buildStageCatalog(DEFAULT_LEAD_STAGES)

    expect(catalog.stages).toHaveLength(13)
    expect(catalog.label('en_diagnostico')).toBe('En diagnóstico')
    expect(catalog.stages.filter(item => item.kind === 'lost').map(item => item.key)).toEqual(['perdido', 'descalificado', 'baja'])
    expect(catalog.get('nuevo').is_system).toBe(true)
  })

  it('los destinos incluyen la etapa actual aunque esté desactivada', () => {
    const catalog = buildStageCatalog([stage('nuevo', 0), stage('archivado', 1, { is_active: false })])

    expect(stageOptions(catalog).map(item => item.key)).toEqual(['nuevo'])
    expect(stageOptions(catalog, 'archivado').map(item => item.key)).toEqual(['nuevo', 'archivado'])
    expect(conditionStageOptions(catalog, 'borrada').map(item => item.key)).toEqual(['nuevo', 'archivado', 'borrada'])
  })

  it('el kanban muestra las inactivas solo si todavía tienen leads', () => {
    const catalog = buildStageCatalog([
      stage('nuevo', 0),
      stage('archivado', 1, { is_active: false }),
      stage('pausado', 2, { is_active: false }),
    ])

    const columns = kanbanColumns(catalog, { nuevo: 0, archivado: 3, pausado: 0, borrada: 1 })

    expect(columns.map(item => item.key)).toEqual(['nuevo', 'archivado', 'borrada'])
  })

  it('humaniza claves', () => {
    expect(humanizeStageKey('oferta_presentada')).toBe('Oferta presentada')
  })
})

describe('colores de etapa', () => {
  it.each(LEAD_STAGE_COLORS.map(color => [color.label, color.value]))('la insignia %s se lee en claro y en oscuro', (_label, color) => {
    const badge = stageBadgeColors(color)

    expect(contrastRatio(badge.lightText, badge.lightBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(badge.darkText, badge.darkBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('las etapas por defecto usan colores de la paleta', () => {
    const palette = new Set(LEAD_STAGE_COLORS.map(color => color.value))

    expect(DEFAULT_LEAD_STAGES.every(stage => palette.has(stage.color))).toBe(true)
  })
})
