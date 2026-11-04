import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDraft, resetDraftsForTests, setDraftText, useChatDraft } from './draftStore'

describe('draftStore', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDraftsForTests()
  })

  it('conserva el borrador de cada chat al cambiar de uno a otro', () => {
    const { result, rerender } = renderHook(({ chatId }) => useChatDraft(chatId), { initialProps: { chatId: 'a' } })
    act(() => result.current[1]('hola a'))
    rerender({ chatId: 'b' })
    expect(result.current[0]).toBe('')
    act(() => result.current[1]((current) => `${current}hola b`))
    rerender({ chatId: 'a' })
    expect(result.current[0]).toBe('hola a')
  })

  it('sobrevive a una recarga y se borra al vaciarlo', () => {
    setDraftText('a', 'pendiente')
    resetDraftsForTests()
    expect(getDraft('a')).toBe('pendiente')
    setDraftText('a', '')
    resetDraftsForTests()
    expect(getDraft('a')).toBe('')
    expect(localStorage.getItem('chat-drafts:v1')).toBe('{}')
  })

  it('descarta los borradores más viejos pasado el tope', () => {
    for (let i = 0; i < 105; i++) setDraftText(`chat-${i}`, `texto ${i}`)
    expect(getDraft('chat-0')).toBe('')
    expect(getDraft('chat-104')).toBe('texto 104')
  })
})
