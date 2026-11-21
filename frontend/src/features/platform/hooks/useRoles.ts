import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ME_QUERY_KEY } from '../../../shared/queryClient'
import { fetchDbPrivileges, fetchRoles, updateRolePermissions } from '../api'
import { roleKeys } from '../keys'

export function useRoles() {
  return useQuery({ queryKey: roleKeys.all, queryFn: fetchRoles })
}

export function useDbPrivileges() {
  return useQuery({ queryKey: roleKeys.dbPrivileges, queryFn: fetchDbPrivileges })
}

export function useUpdateRolePermissions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateRolePermissions,
    onSuccess: (matrix) => {
      queryClient.setQueryData(roleKeys.all, matrix)
      // Los GRANT de la base cambiaron con la matriz.
      void queryClient.invalidateQueries({ queryKey: roleKeys.dbPrivileges })
      // Quien edita podría estar en el rol que cambió: su menú se pone al día.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}
