import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useListPagination } from './useListPagination'

const items = Array.from({ length: 25 }, (_, index) => index)

describe('useListPagination', () => {
  beforeEach(() => localStorage.clear())

  it('reparte la lista en páginas de 10 por defecto', () => {
    const { result } = renderHook(() => useListPagination(items, 'prueba:filas'))
    expect(result.current.pageItems).toEqual(items.slice(0, 10))
    act(() => result.current.setPage(2))
    expect(result.current.pageItems).toEqual([20, 21, 22, 23, 24])
  })

  it('vuelve a la primera página cuando cambian los filtros', () => {
    const { result, rerender } = renderHook(({ key }) => useListPagination(items, 'prueba:filas', key), { initialProps: { key: 'a' } })
    act(() => result.current.setPage(1))
    rerender({ key: 'b' })
    expect(result.current.page).toBe(0)
  })

  it('muestra la última página que existe si la lista se achica', () => {
    const { result, rerender } = renderHook(({ list }) => useListPagination(list, 'prueba:filas'), { initialProps: { list: items } })
    act(() => result.current.setPage(2))
    rerender({ list: items.slice(0, 12) })
    expect(result.current.page).toBe(1)
    expect(result.current.pageItems).toEqual([10, 11])
  })

  it('recuerda las filas por página y vuelve a la primera', () => {
    const { result } = renderHook(() => useListPagination(items, 'prueba:filas'))
    act(() => result.current.setPage(2))
    act(() => result.current.setPageSize(20))
    expect(result.current.page).toBe(0)
    expect(localStorage.getItem('prueba:filas')).toBe('20')
  })
})
