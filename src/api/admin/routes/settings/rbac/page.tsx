import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  Drawer,
  FocusModal,
  Heading,
  Input,
  Tabs,
  Text,
  Toaster,
  toast,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import React, { useState } from "react"
import { sdk } from "../../../lib/sdk"

// ─── Types ───────────────────────────────────────────────────────────────────

interface RbacRole {
  id: string
  name: string
  description?: string
  metadata?: Record<string, unknown>
  parent_id?: string
}

interface RbacPolicy {
  id: string
  key: string
  resource: string
  operation: string
  name?: string
  description?: string
}

interface RolePolicy {
  id: string
  role_id: string
  policy_id: string
  policy?: RbacPolicy
}

interface AdminUser {
  id: string
  first_name?: string
  last_name?: string
  email: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const userName = (u: AdminUser) =>
  [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email

const OP_LABELS: Record<string, string> = {
  create: "Create",
  read: "Read",
  update: "Update",
  delete: "Delete",
  "*": "All operations",
}
const formatOp = (op: string) => OP_LABELS[op] ?? op

const formatResource = (r: string): string => {
  if (r === "*") return "Wildcard"
  return r
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

// ─── Page ────────────────────────────────────────────────────────────────────

const RbacPage = () => {
  const queryClient = useQueryClient()

  // UI state
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null)
  const [createRoleOpen, setCreateRoleOpen] = useState(false)
  const [editRole, setEditRole] = useState<RbacRole | null>(null)
  const [addPolicyRoleId, setAddPolicyRoleId] = useState<string | null>(null)
  const [addUserRoleId, setAddUserRoleId] = useState<string | null>(null)
  const [policySearch, setPolicySearch] = useState("")
  const [modalPolicySearch, setModalPolicySearch] = useState("")
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [roleForm, setRoleForm] = useState({ name: "", description: "" })

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ["rbac-roles"],
    queryFn: () =>
      sdk.client.fetch<{ roles: RbacRole[] }>("/admin/rbac/roles?limit=100"),
  })

  const { data: policiesData } = useQuery({
    queryKey: ["rbac-policies-all"],
    queryFn: () =>
      sdk.client.fetch<{ policies: RbacPolicy[] }>(
        "/admin/rbac/policies?limit=500"
      ),
  })

  const { data: rolePoliciesData } = useQuery({
    queryKey: ["rbac-role-policies", expandedRoleId],
    queryFn: () =>
      sdk.client.fetch<{ policies: RolePolicy[] }>(
        `/admin/rbac/roles/${expandedRoleId}/policies`
      ),
    enabled: !!expandedRoleId,
  })

  const { data: roleUsersData } = useQuery({
    queryKey: ["rbac-role-users", expandedRoleId],
    queryFn: () =>
      sdk.client.fetch<{ users: AdminUser[] }>(
        `/admin/rbac/roles/${expandedRoleId}/users`
      ),
    enabled: !!expandedRoleId,
  })

  const { data: adminUsersData } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => sdk.admin.user.list({ limit: 200 }),
    enabled: !!addUserRoleId,
  })

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createRoleMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      sdk.client.fetch("/admin/rbac/roles", { method: "POST", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })
      setCreateRoleOpen(false)
      setRoleForm({ name: "", description: "" })
      toast.success("Role created")
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: { name: string; description?: string }
    }) =>
      sdk.client.fetch(`/admin/rbac/roles/${id}`, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })
      setEditRole(null)
      toast.success("The role has been updated.")
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  })

  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/rbac/roles/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })
      if (expandedRoleId === id) setExpandedRoleId(null)
      toast.success("Role removed")
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  })

  const assignPoliciesMutation = useMutation({
    mutationFn: ({
      roleId,
      policies,
    }: {
      roleId: string
      policies: string[]
    }) =>
// Use /admin/rbac-admin/... instead of /admin/rbac/...
// Reason: The built-in POST /admin/rbac/roles/:id/policies calls
// createRbacRolePoliciesWorkflow → validateUserPermissionsStep,
// which checks the EXACT policy IDs of the actor.
// Super Admin only has *:* (wildcard ID), so it gets a 403.
// Our custom route calls rbacService directly, bypassing the workflow.
      sdk.client.fetch(`/admin/rbac-admin/roles/${roleId}/policies`, {
        method: "POST",
        body: { policies },
      }),
    onSuccess: (_, { roleId }) => {
      queryClient.invalidateQueries({
        queryKey: ["rbac-role-policies", roleId],
      })
      setAddPolicyRoleId(null)
      setSelectedPolicies([])
      setModalPolicySearch("")
      toast.success("Politicians are appointed")
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  })

  const removePolicyMutation = useMutation({
    mutationFn: ({
      roleId,
      policyId,
    }: {
      roleId: string
      policyId: string
    }) =>
      sdk.client.fetch(`/admin/rbac/roles/${roleId}/policies/${policyId}`, {
        method: "DELETE",
      }),
    onSuccess: (_, { roleId }) => {
      queryClient.invalidateQueries({
        queryKey: ["rbac-role-policies", roleId],
      })
      toast.success("The policy has been removed.")
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  })

  const assignUsersMutation = useMutation({
    mutationFn: ({
      roleId,
      users,
    }: {
      roleId: string
      users: string[]
    }) =>
      sdk.client.fetch(`/admin/rbac/roles/${roleId}/users`, {
        method: "POST",
        body: { users },
      }),
    onSuccess: (_, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: ["rbac-role-users", roleId] })
      setAddUserRoleId(null)
      setSelectedUsers([])
      toast.success("Users added to role")
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  })

  const removeUserMutation = useMutation({
    mutationFn: ({
      roleId,
      userId,
    }: {
      roleId: string
      userId: string
    }) =>
      sdk.client.fetch(`/admin/rbac/roles/${roleId}/users`, {
        method: "DELETE",
        body: { users: [userId] },
      }),
    onSuccess: (_, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: ["rbac-role-users", roleId] })
      toast.success("The user has been removed from the role.")
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  })

  // ─── Derived data ──────────────────────────────────────────────────────────

  const roles = rolesData?.roles ?? []
  const allPolicies = policiesData?.policies ?? []
  const rolePolicies = rolePoliciesData?.policies ?? []
  const roleUsers = roleUsersData?.users ?? []
  const adminUsers = (adminUsersData as any)?.users ?? []

  // Lookup map: policyId → RbacPolicy (for displaying readable names in badges)
  const policyById = new Map(allPolicies.map((p) => p.id).map((id, i) => [id, allPolicies[i]]))
  // A more reliable option:
  const policyMap = new Map<string, RbacPolicy>()
  allPolicies.forEach((p) => policyMap.set(p.id, p))

  // Human-readable label for a policy by its ID
  const policyLabel = (policyId: string): string => {
    const p = policyMap.get(policyId)
    if (!p) return policyId
    if (p.key === "*:*") return "★ SuperAdmin"
    // Show "Create • Product" style
    return `${formatOp(p.operation)} • ${formatResource(p.resource)}`
  }

  // Badge color: orange for wildcard, blue for regular
  const policyBadgeColor = (policyId: string): "blue" | "orange" => {
    const p = policyMap.get(policyId)
    return p?.key === "*:*" ? "orange" : "blue"
  }

  const assignedPolicyIds = new Set(rolePolicies.map((rp) => rp.policy_id))
  const assignedUserIds = new Set(roleUsers.map((u) => u.id))

  const unassignedPolicies = allPolicies.filter(
    (p) => !assignedPolicyIds.has(p.id)
  )
  const unassignedUsers = adminUsers.filter(
    (u: AdminUser) => !assignedUserIds.has(u.id)
  )

  // Policies tab: group ALL policies by resource with search
  const filteredPolicyGroups = allPolicies
    .filter((p) => {
      const q = policySearch.toLowerCase()
      return (
        !q ||
        p.key.toLowerCase().includes(q) ||
        (p.resource?.toLowerCase() ?? "").includes(q) ||
        (p.name?.toLowerCase() ?? "").includes(q)
      )
    })
    .reduce<Record<string, RbacPolicy[]>>((acc, p) => {
      const res = p.resource || "—"
        ; (acc[res] = acc[res] ?? []).push(p)
      return acc
    }, {})

  // Modal: group UNASSIGNED policies by resource with search
  const modalFilteredUnassigned = unassignedPolicies.filter((p) => {
    if (!modalPolicySearch) return true
    const q = modalPolicySearch.toLowerCase()
    return (
      p.key.toLowerCase().includes(q) ||
      (p.resource?.toLowerCase() ?? "").includes(q) ||
      formatOp(p.operation).toLowerCase().includes(q)
    )
  })

  const unassignedByResource = modalFilteredUnassigned.reduce<
    Record<string, RbacPolicy[]>
  >((acc, p) => {
    const res = p.resource || "—"
      ; (acc[res] = acc[res] ?? []).push(p)
    return acc
  }, {})

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleExpandRole = (roleId: string) =>
    setExpandedRoleId((prev) => (prev === roleId ? null : roleId))

  const handleOpenCreate = () => {
    setRoleForm({ name: "", description: "" })
    setCreateRoleOpen(true)
  }

  const handleOpenEdit = (role: RbacRole) => {
    setRoleForm({ name: role.name, description: role.description ?? "" })
    setEditRole(role)
  }

  const handleDeleteRole = (role: RbacRole) => {
    if (
      confirm(`Remove role "${role.name}"? This action cannot be undone.`)
    ) {
      deleteRoleMutation.mutate(role.id)
    }
  }

  const handleOpenAddPolicy = (roleId: string) => {
    setSelectedPolicies([])
    setModalPolicySearch("")
    setAddPolicyRoleId(roleId)
  }

  const handleOpenAddUser = (roleId: string) => {
    setSelectedUsers([])
    setAddUserRoleId(roleId)
  }

  const togglePolicy = (id: string, checked: boolean) =>
    setSelectedPolicies((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id)
    )

  const toggleUser = (id: string, checked: boolean) =>
    setSelectedUsers((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id)
    )

  // Select / deselect all policies in a resource group
  const handleToggleGroup = (policies: RbacPolicy[], select: boolean) => {
    const ids = policies.map((p) => p.id)
    if (select) {
      setSelectedPolicies((prev) => [...new Set([...prev, ...ids])])
    } else {
      setSelectedPolicies((prev) => prev.filter((id) => !ids.includes(id)))
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-y-4 p-6">
      <Toaster />
      <Heading level="h1">Access control (RBAC)</Heading>

      <Tabs defaultValue="roles">
        <Tabs.List>
          <Tabs.Trigger value="roles">Roles</Tabs.Trigger>
          <Tabs.Trigger value="policies">Politicians</Tabs.Trigger>
        </Tabs.List>

        {/* ══════════════ ROLES TAB ══════════════ */}
        <Tabs.Content value="roles">
          <Container className="mt-4 p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border-base">
              <Heading level="h2">Roles</Heading>
              <Button size="small" onClick={handleOpenCreate}>
                + Create a role
              </Button>
            </div>

            {rolesLoading ? (
              <div className="px-6 py-4">
                <Text className="text-ui-fg-subtle">Loading...</Text>
              </div>
            ) : roles.length === 0 ? (
              <div className="px-6 py-4">
                <Text className="text-ui-fg-muted">There are no roles</Text>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                    <th className="text-left py-2 px-4 font-medium text-ui-fg-subtle">
                      Name
                    </th>
                    <th className="text-left py-2 px-4 font-medium text-ui-fg-subtle">
                      Description
                    </th>
                    <th className="text-right py-2 px-4 font-medium text-ui-fg-subtle">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <React.Fragment key={role.id}>
                      <tr
                        className="border-b border-ui-border-base hover:bg-ui-bg-subtle-hover cursor-pointer"
                        onClick={() => handleExpandRole(role.id)}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-ui-fg-muted text-xs w-3">
                              {expandedRoleId === role.id ? "▼" : "▶"}
                            </span>
                            <Text weight="plus">{role.name}</Text>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-ui-fg-subtle">
                          {role.description || "—"}
                        </td>
                        <td className="py-3 px-4">
                          <div
                            className="flex gap-2 justify-end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="small"
                              variant="secondary"
                              onClick={() => handleOpenEdit(role)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              variant="danger"
                              onClick={() => handleDeleteRole(role)}
                              disabled={deleteRoleMutation.isPending}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {expandedRoleId === role.id && (
                        <tr className="border-b border-ui-border-base">
                          <td
                            colSpan={3}
                            className="bg-ui-bg-base px-8 py-5"
                          >
                            <div className="flex flex-col gap-5">
                              {/* Policies */}
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <Text
                                    size="small"
                                    weight="plus"
                                    className="text-ui-fg-subtle uppercase tracking-wide"
                                  >
                                    Politicians
                                  </Text>
                                  <Button
                                    size="small"
                                    variant="secondary"
                                    onClick={() =>
                                      handleOpenAddPolicy(role.id)
                                    }
                                  >
                                    + Add a policy
                                  </Button>
                                </div>
                                {rolePolicies.length === 0 ? (
                                  <Text
                                    size="small"
                                    className="text-ui-fg-muted"
                                  >
                                    Politicians are not appointed
                                  </Text>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {rolePolicies.map((rp) => (
                                      <button
                                        key={rp.id}
                                        type="button"
                                        title="Click to delete"
                                        disabled={
                                          removePolicyMutation.isPending
                                        }
                                        onClick={() =>
                                          removePolicyMutation.mutate({
                                            roleId: role.id,
                                            policyId: rp.policy_id,
                                          })
                                        }
                                        className="inline-flex items-center gap-1 disabled:opacity-50"
                                      >
                                        <Badge
                                          color={policyBadgeColor(
                                            rp.policy_id
                                          )}
                                        >
                                          {policyLabel(rp.policy_id)}
                                          <span className="ml-1 opacity-60">
                                            ✕
                                          </span>
                                        </Badge>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Users */}
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <Text
                                    size="small"
                                    weight="plus"
                                    className="text-ui-fg-subtle uppercase tracking-wide"
                                  >
                                    Users
                                  </Text>
                                  <Button
                                    size="small"
                                    variant="secondary"
                                    onClick={() =>
                                      handleOpenAddUser(role.id)
                                    }
                                  >
                                    + Add user
                                  </Button>
                                </div>
                                {roleUsers.length === 0 ? (
                                  <Text
                                    size="small"
                                    className="text-ui-fg-muted"
                                  >
                                    There are no users
                                  </Text>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {roleUsers.map((user) => (
                                      <button
                                        key={user.id}
                                        type="button"
                                        title="Click to delete"
                                        disabled={
                                          removeUserMutation.isPending
                                        }
                                        onClick={() =>
                                          removeUserMutation.mutate({
                                            roleId: role.id,
                                            userId: user.id,
                                          })
                                        }
                                        className="inline-flex items-center gap-1 disabled:opacity-50"
                                      >
                                        <Badge color="green">
                                          {userName(user)}
                                          <span className="ml-1 opacity-60">
                                            ✕
                                          </span>
                                        </Badge>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </Container>
        </Tabs.Content>

        {/* ══════════════ POLICIES TAB ══════════════ */}
        <Tabs.Content value="policies">
          <Container className="mt-4 p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border-base">
              <Heading level="h2">Access policies</Heading>
              <Input
                placeholder="Search by key or resource..."
                value={policySearch}
                onChange={(e) => setPolicySearch(e.target.value)}
                className="max-w-xs"
              />
            </div>

            <div className="p-6 flex flex-col gap-6">
              {Object.keys(filteredPolicyGroups).length === 0 ? (
                <Text className="text-ui-fg-muted">There are no policies</Text>
              ) : (
                Object.entries(filteredPolicyGroups)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([resource, policies]) => (
                    <div key={resource}>
                      <Text
                        size="small"
                        weight="plus"
                        className="text-ui-fg-subtle uppercase tracking-wide mb-2"
                      >
                        {formatResource(resource)}
                      </Text>
                      <table className="w-full text-sm border border-ui-border-base rounded">
                        <thead>
                          <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                            <th className="text-left py-2 px-3 font-medium text-ui-fg-subtle">
                              Key
                            </th>
                            <th className="text-left py-2 px-3 font-medium text-ui-fg-subtle">
                              Operation
                            </th>
                            <th className="text-left py-2 px-3 font-medium text-ui-fg-subtle">
                              Name
                            </th>
                            <th className="text-left py-2 px-3 font-medium text-ui-fg-subtle">
                              Description
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {policies.map((p) => (
                            <tr
                              key={p.id}
                              className="border-b border-ui-border-base last:border-0 hover:bg-ui-bg-subtle-hover"
                            >
                              <td className="py-2 px-3 font-mono text-xs">
                                {p.key}
                              </td>
                              <td className="py-2 px-3">
                                <Badge color="grey">
                                  {formatOp(p.operation)}
                                </Badge>
                              </td>
                              <td className="py-2 px-3">
                                {p.name || "—"}
                              </td>
                              <td className="py-2 px-3 text-ui-fg-subtle">
                                {p.description || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
              )}
            </div>
          </Container>
        </Tabs.Content>
      </Tabs>

      {/* ══════════════ CREATE ROLE MODAL ══════════════ */}
      <FocusModal open={createRoleOpen} onOpenChange={setCreateRoleOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <Button
              size="small"
              disabled={
                createRoleMutation.isPending || !roleForm.name.trim()
              }
              isLoading={createRoleMutation.isPending}
              onClick={() =>
                createRoleMutation.mutate({
                  name: roleForm.name.trim(),
                  description:
                    roleForm.description.trim() || undefined,
                })
              }
            >
              Create
            </Button>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col gap-4 p-6 max-w-lg mx-auto w-full">
            <Heading>Create a role</Heading>
            <div>
              <Text
                size="small"
                weight="plus"
                className="mb-1 text-ui-fg-subtle"
              >
                Name *
              </Text>
              <Input
                placeholder="Manager"
                value={roleForm.name}
                onChange={(e) =>
                  setRoleForm((f) => ({ ...f, name: e.target.value }))
                }
                autoFocus
              />
            </div>
            <div>
              <Text
                size="small"
                weight="plus"
                className="mb-1 text-ui-fg-subtle"
              >
                Description
              </Text>
              <Input
                placeholder="Optional"
                value={roleForm.description}
                onChange={(e) =>
                  setRoleForm((f) => ({
                    ...f,
                    description: e.target.value,
                  }))
                }
              />
            </div>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>

      {/* ══════════════ EDIT ROLE DRAWER ══════════════ */}
      <Drawer
        open={!!editRole}
        onOpenChange={(open) => {
          if (!open) setEditRole(null)
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Edit role</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4 p-4">
            <div>
              <Text
                size="small"
                weight="plus"
                className="mb-1 text-ui-fg-subtle"
              >
                Name *
              </Text>
              <Input
                value={roleForm.name}
                onChange={(e) =>
                  setRoleForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div>
              <Text
                size="small"
                weight="plus"
                className="mb-1 text-ui-fg-subtle"
              >
                Description
              </Text>
              <Input
                placeholder="Необязательно"
                value={roleForm.description}
                onChange={(e) =>
                  setRoleForm((f) => ({
                    ...f,
                    description: e.target.value,
                  }))
                }
              />
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" onClick={() => setEditRole(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                updateRoleMutation.isPending || !roleForm.name.trim()
              }
              isLoading={updateRoleMutation.isPending}
              onClick={() =>
                editRole &&
                updateRoleMutation.mutate({
                  id: editRole.id,
                  data: {
                    name: roleForm.name.trim(),
                    description:
                      roleForm.description.trim() || undefined,
                  },
                })
              }
            >
              Save
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      {/* ══════════════ ADD POLICY MODAL ══════════════ */}
      <FocusModal
        open={!!addPolicyRoleId}
        onOpenChange={(open) => {
          if (!open) {
            setAddPolicyRoleId(null)
            setSelectedPolicies([])
            setModalPolicySearch("")
          }
        }}
      >
        <FocusModal.Content>
          <FocusModal.Header>
            <div className="flex items-center gap-4 flex-1">
              <Heading className="text-ui-fg-base">Add policies</Heading>
              <Input
                placeholder="Search by resource or operation..."
                value={modalPolicySearch}
                onChange={(e) => setModalPolicySearch(e.target.value)}
                className="max-w-xs"
              />
              <Text size="small" className="text-ui-fg-subtle ml-auto">
                Selected: {selectedPolicies.length}
              </Text>
            </div>
            <Button
              size="small"
              disabled={
                assignPoliciesMutation.isPending ||
                selectedPolicies.length === 0
              }
              isLoading={assignPoliciesMutation.isPending}
              onClick={() =>
                addPolicyRoleId &&
                assignPoliciesMutation.mutate({
                  roleId: addPolicyRoleId,
                  policies: selectedPolicies,
                })
              }
            >
              Assign ({selectedPolicies.length})
            </Button>
          </FocusModal.Header>

          <FocusModal.Body className="p-6 overflow-y-auto">
            {/* Legend */}
            <Text size="small" className="text-ui-fg-subtle mb-4">
              Only policies that have not yet been assigned are shown. Checkbox in
              column header - select / deselect all in the group.
            </Text>

            {Object.keys(unassignedByResource).length === 0 ? (
              <Text className="text-ui-fg-muted">
                {unassignedPolicies.length === 0
                  ? "All policies are already assigned to this role."
                  : "Nothing found"}
              </Text>
            ) : (
              <div className="grid gap-3"
                style={{
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(180px, 1fr))",
                }}
              >
                {Object.entries(unassignedByResource)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([resource, policies]) => {
                    const groupIds = policies.map((p) => p.id)
                    const allSelected = groupIds.every((id) =>
                      selectedPolicies.includes(id)
                    )
                    const someSelected = groupIds.some((id) =>
                      selectedPolicies.includes(id)
                    )
                    const isWildcard = resource === "*"

                    return (
                      <div
                        key={resource}
                        className={`border rounded-lg flex flex-col overflow-hidden ${
                          isWildcard
                            ? "border-ui-border-interactive"
                            : "border-ui-border-base"
                        }`}
                      >
                        {/* Column header */}
                        <div
                          className={`flex items-center justify-between px-3 py-2 border-b ${
                            isWildcard
                              ? "bg-ui-bg-interactive border-ui-border-interactive"
                              : "bg-ui-bg-subtle border-ui-border-base"
                          }`}
                        >
                          <Text
                            size="small"
                            weight="plus"
                            className={
                              isWildcard
                                ? "text-ui-fg-interactive"
                                : "text-ui-fg-base"
                            }
                          >
                            {isWildcard
                              ? "★ Wildcard"
                              : formatResource(resource)}
                          </Text>
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={(checked) =>
                              handleToggleGroup(policies, !!checked)
                            }
                            title="Select all in the group"
                          />
                        </div>

                        {/* Operations list */}
                        <div className="flex flex-col">
                          {policies
                            .sort((a, b) =>
                              a.operation.localeCompare(b.operation)
                            )
                            .map((p) => {
                              const isChecked = selectedPolicies.includes(
                                p.id
                              )
                              return (
                                <label
                                  key={p.id}
                                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-ui-border-base last:border-0 ${
                                    isChecked
                                      ? "bg-ui-bg-highlight"
                                      : "hover:bg-ui-bg-subtle-hover"
                                  }`}
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) =>
                                      togglePolicy(p.id, !!checked)
                                    }
                                  />
                                  <div className="flex-1 min-w-0">
                                    <Text size="small">
                                      {formatOp(p.operation)}
                                    </Text>
                                  </div>
                                </label>
                              )
                            })}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>

      {/* ══════════════ ADD USER MODAL ══════════════ */}
      <FocusModal
        open={!!addUserRoleId}
        onOpenChange={(open) => {
          if (!open) {
            setAddUserRoleId(null)
            setSelectedUsers([])
          }
        }}
      >
        <FocusModal.Content>
          <FocusModal.Header>
            <Button
              size="small"
              disabled={
                assignUsersMutation.isPending ||
                selectedUsers.length === 0
              }
              isLoading={assignUsersMutation.isPending}
              onClick={() =>
                addUserRoleId &&
                assignUsersMutation.mutate({
                  roleId: addUserRoleId,
                  users: selectedUsers,
                })
              }
            >
              Add ({selectedUsers.length})
            </Button>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col gap-4 p-6 max-w-lg mx-auto w-full">
            <Heading>Add users</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Only users without this role are shown.
            </Text>
            {unassignedUsers.length === 0 ? (
              <Text className="text-ui-fg-muted">
                All users already have this role
              </Text>
            ) : (
              <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
                {unassignedUsers.map((user: AdminUser) => (
                  <label
                    key={user.id}
                    className="flex items-start gap-3 p-2 rounded hover:bg-ui-bg-subtle cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedUsers.includes(user.id)}
                      onCheckedChange={(checked) =>
                        toggleUser(user.id, !!checked)
                      }
                    />
                    <div>
                      <Text size="small" weight="plus">
                        {userName(user)}
                      </Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        {user.email}
                      </Text>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Access Management",
})

export default RbacPage
