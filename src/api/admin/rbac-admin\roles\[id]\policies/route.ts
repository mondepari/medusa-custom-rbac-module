/**
 * Custom RBAC admin route: bypass createRbacRolePoliciesWorkflow
 *
 * Why needed:
 *   The built-in POST /admin/rbac/roles/:id/policies calls
 *   createRbacRolePoliciesWorkflow → validateUserPermissionsStep,
 *   which checks EXACT policy IDs of the actor.
 *   Super Admin has only the *:* wildcard policy ID, not individual ones,
 *   so the workflow step always returns 403.
 *
 *   This route calls rbacService.createRbacRolePolicies() directly,
 *   bypassing the workflow. It is still protected by the outer
 *   wrapWithPoliciesCheck (see middlewares.ts), which correctly supports
 *   the *:* wildcard.
 *
 * Routes:
 *   POST /admin/rbac-admin/roles/:id/policies
 *     Body: { policies: string[] }   ← array of rbac_policy IDs
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const roleId = req.params.id
  const { policies } = req.body as { policies: string[] }

  if (!Array.isArray(policies) || policies.length === 0) {
    return res.status(400).json({ message: "policies must be a non-empty array of policy IDs" })
  }

  const rbacService = req.scope.resolve("rbac") as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Directly assign policies — no validateUserPermissionsStep
  await rbacService.createRbacRolePolicies(
    policies.map((policyId: string) => ({
      role_id: roleId,
      policy_id: policyId,
    }))
  )

  // Return the newly created role-policy links
  const { data } = await query.graph({
    entity: "rbac_role_policy",
    fields: ["id", "role_id", "policy_id"],
    filters: { role_id: roleId, policy_id: policies },
  })

  res.status(200).json({ policies: data })
}
