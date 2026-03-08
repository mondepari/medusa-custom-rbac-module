/**
 * Bootstrap script: assigns the Super Admin RBAC role to all admin users,
 * and ensures the Super Admin role has ALL individual policies (required so
 * that Super Admin can assign any policy to other roles via the UI).
 *
 * Usage:
 *   yarn medusa exec ./src/scripts/assign-super-admin-role.ts
 *
 * Prerequisites:
 *   1. `yarn medusa db:sync-links` — creates the user_rbac_role link table
 *   2. RBAC module loaded in medusa-config.ts (creates Super Admin role on startup)
 *   3. Server started at least once (syncRegisteredPolicies creates individual policies)
 */

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function assignSuperAdminRole({
  container,
}: {
  container: any
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const rbacService = container.resolve("rbac")
  const userService = container.resolve(Modules.USER)

  logger.info("=== RBAC Bootstrap: Super Admin role setup ===\n")

  // ── 1. Find the Super Admin role ──────────────────────────────────────────
  const { data: roles } = await query.graph({
    entity: "rbac_role",
    fields: ["id", "name"],
  })

  const superAdminRole = roles.find((r: any) => r.name === "Super Admin")
  if (!superAdminRole) {
    logger.error(
      "Super Admin role not found!\n" +
        "Make sure @medusajs/rbac module is loaded in medusa-config.ts and\n" +
        "the server has started at least once to run the initial-data loader."
    )
    return
  }
  logger.info(`[1/4] Super Admin role found: ${superAdminRole.id}`)

  // ── 2. Assign ALL individual policies to Super Admin ─────────────────────
  //
  // Why: validateUserPermissionsStep in createRbacRolePoliciesWorkflow checks
  // exact policy IDs of the actor. The *:* wildcard does NOT satisfy this check.
  // Super Admin must have all individual policy IDs to be able to assign them
  // to other roles via the RBAC UI.
  //
  const { data: allPolicies } = await query.graph({
    entity: "rbac_policy",
    fields: ["id", "key"],
  })
  logger.info(`[2/4] Found ${allPolicies.length} policies in the database`)

  // Find which ones are already assigned to Super Admin
  const { data: existingPolicyLinks } = await query.graph({
    entity: "rbac_role_policy",
    fields: ["id", "policy_id"],
    filters: { role_id: superAdminRole.id },
  })
  const alreadyLinkedPolicyIds = new Set(
    existingPolicyLinks.map((l: any) => l.policy_id)
  )
  const missingPolicies = allPolicies.filter(
    (p: any) => !alreadyLinkedPolicyIds.has(p.id)
  )

  if (missingPolicies.length === 0) {
    logger.info(`[2/4] All policies already assigned to Super Admin`)
  } else {
    await rbacService.createRbacRolePolicies(
      missingPolicies.map((p: any) => ({
        role_id: superAdminRole.id,
        policy_id: p.id,
      }))
    )
    logger.info(
      `[2/4] Assigned ${missingPolicies.length} missing policies to Super Admin:\n` +
        missingPolicies.map((p: any) => `         ${p.key}`).join("\n")
    )
  }

  // ── 3. Assign Super Admin role to admin users ─────────────────────────────
  const [users, count] = await userService.listAndCountUsers({}, { take: 100 })
  logger.info(`\n[3/4] Found ${count} admin user(s)`)

  if (count === 0) {
    logger.warn(
      "No admin users found.\n" +
        "Create one with: yarn medusa user -e email@example.com -p password"
    )
    return
  }

  const { data: existingUserLinks } = await query.graph({
    entity: "user_rbac_role",
    fields: ["user_id"],
    filters: { rbac_role_id: superAdminRole.id },
  })
  const alreadyAssignedUsers = new Set(
    existingUserLinks.map((l: any) => l.user_id)
  )

  let assigned = 0
  let skipped = 0
  for (const user of users) {
    if (alreadyAssignedUsers.has(user.id)) {
      logger.info(`  SKIP  ${user.email} — already has Super Admin role`)
      skipped++
      continue
    }
    try {
      await remoteLink.create([
        {
          [Modules.USER]: { user_id: user.id },
          rbac: { rbac_role_id: superAdminRole.id },
        },
      ])
      logger.info(`  OK    ${user.email} — Super Admin role assigned`)
      assigned++
    } catch (e: any) {
      logger.error(`  FAIL  ${user.email} — ${e.message}`)
    }
  }
  logger.info(
    `[3/4] Users: ${assigned} newly assigned, ${skipped} already had the role`
  )

  // ── 4. Summary ────────────────────────────────────────────────────────────
  logger.info("\n[4/4] Done!\n")
  logger.info("Next steps:")
  logger.info("  1. Set MEDUSA_FF_RBAC=true in .env")
  logger.info("  2. Restart the server")
  logger.info(
    "  3. Log OUT and log back IN — JWT must be refreshed to include your roles"
  )
  logger.info(
    "  After login, you can assign any policy to any role in the RBAC UI."
  )
}
