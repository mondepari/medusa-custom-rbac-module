# medusa-custom-rbac-module
The rbac module interface and an example of adding custom routes for Medusa 2.13.3

## How the RBAC module works now in 2.13.3

### Architecture

```
definePolicies() ← you declare policies in the module code
↓
syncRegisteredPolicies() ← on server startup: syncs to the database
↓
rbac_policy table ← { key, resource, operation, name }
↓
wrapWithPoliciesCheck() ← middleware on the route: checks the user's JWT
↓
app_metadata.roles in JWT ← what roles the user has
↓
hasPermission() ← do the roles have the required policy?
```

### Policy Lifecycle

1. **Declaration** — `definePolicies({ resource: "loyalty", operation: "read", name: "ReadLoyalty" })` in any module file
2. **Synchronization** — `syncRegisteredPolicies()` creates/updates records in the `rbac_policy` table every time the server starts
3. **Assignment** — you assign the required policies to roles through the RBAC UI
4. **Check** — `wrapWithPoliciesCheck` on the route looks at the user's JWT, finds their roles, and checks for the required policy in `rbac_role_policy`

---

## What's already working

| Function | Status |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Create/Edit/Delete Roles | ✅ |
| Assigning policies to roles | ✅ |
| Assigning users to roles | ✅ (after `db:sync-links`) |
| Limiting built-in Medusa routes | ✅ — all `/admin/*` routes already have policies |
| "Super Admin" role with `*:*` | ✅ — created automatically |
| Limiting **your custom routes** | ⚠️ — must be added manually (explained below) |

---

## Create "Manager" role?

Here's a real-world scenario: a manager sees orders and customers, but **cannot** change settings, prices, or products:

In the RBAC UI (Settings → Access Management):

1. Create the "Manager" role
2. Assign policies:
* `order:read`, `order:create`, `order:update`
* `customer:read`
* `fulfillment:read`, `fulfillment:create`
* `return:read`, `return:create`
3. **Don't assign**: `product:*`, `price_list:*`, `store:*`, `user:*`

Policies for all built-in routes have already been created and are visible in the "Policies" section.

# Problem with 403 403 when assigning policies, the `*:* Wildcard` key — SuperAdmin in Medusa

## The `*:*` key — SuperAdmin

**`*:*`** is created by the `initial-data.js` loader on first startup:

```js
// node_modules/@medusajs/rbac/dist/loaders/initial-data.js
await rbacService.createRbacPolicies([{key:"*:*",resource:"*",operation:"*"}])
await rbacService.createRbacRolePolicies([{role_id: superAdminRole.id,policy_id: wildcardPolicy.id}])
```

### How wildcards work in `has-permission.js`:

```js
// Build a resourceMap from user role policies:
// Map { "product" => Set(["read","create"]), "*" => Set(["*"]) }

functionhasPermission({ resource, operation, userRoles }){
const allowedOps = resourceMap.get(resource)// looking for a specific resource
?? resourceMap.get("*")// OR wildcard resource

return allowedOps?.has(operation)// specific operation
?? allowedOps?.has("*")// OR wildcard operation
}
```

→ `*:*` **works correctly** for `wrapWithPoliciesCheck` (route-level). Super Admin traverses all routes.

### Then why do we get a 403 when assigning policies?

`validateUserPermissionsStep` (inside the workflow) uses **different logic** — ID comparison, without wildcards:

```js
// node_modules/@medusajs/core-flows/dist/rbac/steps/validate-user-permissions.js
const userPolicyIds = newSet(user.rbac_roles[0].policies.map(p=> p.id))
// userPolicyIds = Set { "rpol_WILDCARD_ID" } ← only *:* IDs

const unauthorized = policy_ids.filter(id=>!userPolicyIds.has(id))
// policy_ids = ["rpol_product_create_ID"] ← this is NOT a wildcard ID
// unauthorized = ["rpol_product_create_ID"] ← FORBIDDEN!
```

**Result**: `*:*` is sufficient for **accessing routes**, but NOT for **executing workflow operations** (assigning policies, managing users). That's why I created a bootstrap script that additionally assigns ALL individual policies to the Super Admin.

# Integration with custom modules

I'll demonstrate this using the custom **loyalty** module as an example. You need two files:

### 1. Declare policies in the module

Create the file `src/modules/loyalty/policies.ts`:

```typescript
exportdefaultdefinePolicies([
{
name:"ReadLoyaltySettings",
resource:"loyalty_setting",
operation:"read",
description:"View bonus program settings",
},
{
name:"WriteLoyaltySettings",
resource:"loyalty_setting",
operation:"update",
description:"Change bonus program settings",
},
{
name:"ReadLoyaltyPoints",
resource:"loyalty_point",
operation:"read",
description:"View customer points",
},
{
name:"WriteLoyaltyPoints",
resource:"loyalty_point",
operation:"update",
description:"Accumulate/decrease points manually",
},
{
name:"ResetLoyalty",
resource:"loyalty_point",
operation:"delete",
description:"Reset all points" loyalty",
},

import{Module}from"@medusajs/framework/utils"
importLoyaltyModuleServicefrom"./service"
import"./policies"// ← Registers policies when loading the module

exportconstLOYALTY_MODULE="loyalty"

exportdefaultModule(LOYALTY_MODULE,{
service:LoyaltyModuleService,
})
```

### 2. Protect routes with policies

In `src/api/middlewares.ts`, add `policies` to the required routes:

```TypeScript
// ─── RBAC: Loyalty Module (only /admin/* routes) ───────────────────────
// Store routes (/store/loyalty/*, /store/customers/me/loyalty-points)
// We do NOT protect RBAC — they use authenticate("customer", ...) and
// do not pass through checkPermissions.

// GET /admin/loyalty/settings — View bonus program settings
{
matcher: "/admin/loyalty/settings",
method: "GET",
policies: [{ resource: "loyalty_setting", operation: "read" }],
},

// POST /admin/loyalty/settings — Change bonus program settings
{
matcher: "/admin/loyalty/settings",
method: "POST",
policies: [{ resource: "loyalty_setting", operation: "update" }],
},

// GET /admin/loyalty/customers/:id — View customer points
{
matcher: "/admin/loyalty/customers/:id",
method: "GET",
policies: [{ resource: "loyalty_point", operation: "read" }],
},

// POST /admin/loyalty/customers/:id — Manually accrue/debit points
{
matcher: "/admin/loyalty/customers/:id",
method: "POST",
policies: [{ resource: "loyalty_point", operation: "update" }],
},

// POST /admin/loyalty/reset — Reset all points (superadmin only)
{
matcher: "/admin/loyalty/reset",
method: "POST",
policies: [{ resource: "loyalty_point", operation: "delete" }],
},
```
# What needs to be done after deployment/restart

Once RBAC is enabled (`MEDUSA_FF_RBAC=true`) and the server is started, the new policies `loyalty_setting:read`, `loyalty_point:delete`, etc. will appear in the `rbac_policy` table. If the bootstrap script has already been run (i.e., the Super Admin has all the policies), then **nothing else needs to be done**. However, if the script was run before the loyalty policies appeared, you need to run it again to add the new policies to the Super Admin role.

# Limitations and important details

1. Policies don't apply to store routes — only /admin/*
2. Custom routes without policies in middlewares are available to all authorized admin users (even without a role) until you explicitly add protection.
3. After changing a role, the user must re-login — roles are taken from the JWT at login.
4. Policy cache — hasPermission caches the result for 7 days (using cache-memory). After changing role policies, re-login.
5. validateUserRolePermissionsStep — a manager cannot assign roles with policies they don't have. This means a manager cannot grant someone broader rights than they have.

# PROBLEMS WITH THE assign-super-admin-role.ts SCRIPT

When first run, it assigns all users to super admin, meaning that users who were previously assigned the role will become super admins again.
