import assert from "node:assert/strict";
import test from "node:test";
import {
  canViewCommissions,
  canViewGtm,
  defaultApplicationPathForRoles,
  isAssignedAreaOnlyUser,
  isAssignedRoleAllowedApplicationPath,
  isAccountManagementAllowedApplicationPath,
  isAccountManagementOnlyRole,
  isGtmAllowedApplicationPath,
  isGtmOnlyRole,
  isSalesAllowedApplicationPath,
  isSalesOnlyRole,
  normalizeAppRole,
  normalizeAppRoles,
  primaryAppRole,
} from "../src/lib/accessRoles.ts";

test("normalizes supported application roles", () => {
  assert.equal(normalizeAppRole(" ADMIN "), "admin");
  assert.equal(normalizeAppRole("Sales"), "sales");
  assert.equal(normalizeAppRole("Account Management"), "account_management");
  assert.equal(normalizeAppRole("account-management"), "account_management");
  assert.equal(normalizeAppRole("GTM"), "gtm");
  assert.equal(normalizeAppRole("viewer"), "viewer");
  assert.equal(normalizeAppRole("unknown"), "viewer");
  assert.equal(normalizeAppRole(undefined), "viewer");
});

test("normalizes multiple roles without losing assigned areas", () => {
  assert.deepEqual(normalizeAppRoles(["GTM", "sales", "sales"]), ["sales", "gtm"]);
  assert.deepEqual(normalizeAppRoles(["viewer", "account-management"]), ["viewer", "account_management"]);
  assert.deepEqual(normalizeAppRoles(["sales", "admin", "gtm"]), ["admin"]);
  assert.deepEqual(normalizeAppRoles([]), ["viewer"]);
  assert.equal(primaryAppRole(["gtm", "sales"]), "sales");
});

test("allows admins and sales users to view commissions", () => {
  assert.equal(canViewCommissions("admin"), true);
  assert.equal(canViewCommissions("sales"), true);
  assert.equal(canViewCommissions("viewer"), false);
  assert.equal(canViewCommissions("account_management"), false);
  assert.equal(canViewCommissions(["sales", "gtm"]), true);
});

test("allows admins and GTM users to view the GTM scorecard", () => {
  assert.equal(canViewGtm("admin"), true);
  assert.equal(canViewGtm("gtm"), true);
  assert.equal(canViewGtm(["sales", "gtm"]), true);
  assert.equal(canViewGtm("viewer"), false);
  assert.equal(canViewGtm("sales"), false);
});

test("identifies the account-management-only role", () => {
  assert.equal(isAccountManagementOnlyRole("account_management"), true);
  assert.equal(isAccountManagementOnlyRole("Account Management"), true);
  assert.equal(isAccountManagementOnlyRole("admin"), false);
});

test("identifies the sales-only role", () => {
  assert.equal(isSalesOnlyRole("sales"), true);
  assert.equal(isSalesOnlyRole("admin"), false);
  assert.equal(isSalesOnlyRole("viewer"), false);
  assert.equal(isSalesOnlyRole(["sales", "gtm"]), false);
});

test("identifies the GTM-only role", () => {
  assert.equal(isGtmOnlyRole("gtm"), true);
  assert.equal(isGtmOnlyRole(["sales", "gtm"]), false);
  assert.equal(isGtmOnlyRole("admin"), false);
});

test("restricts sales users to the commissions page and API", () => {
  assert.equal(isSalesAllowedApplicationPath("/commissions"), true);
  assert.equal(isSalesAllowedApplicationPath("/commissions/details"), true);
  assert.equal(isSalesAllowedApplicationPath("/api/commissions"), true);
  assert.equal(isSalesAllowedApplicationPath("/api/commissions/export"), true);

  assert.equal(isSalesAllowedApplicationPath("/"), false);
  assert.equal(isSalesAllowedApplicationPath("/combined-all-subs"), false);
  assert.equal(isSalesAllowedApplicationPath("/hubspot"), false);
  assert.equal(isSalesAllowedApplicationPath("/api/combined-all-subs-report"), false);
  assert.equal(isSalesAllowedApplicationPath("/commissions-other"), false);
});

test("restricts account management users to the migration page and API", () => {
  assert.equal(isAccountManagementAllowedApplicationPath("/migration"), true);
  assert.equal(isAccountManagementAllowedApplicationPath("/migration/details"), true);
  assert.equal(isAccountManagementAllowedApplicationPath("/api/migration"), true);
  assert.equal(isAccountManagementAllowedApplicationPath("/api/migration/export"), true);

  assert.equal(isAccountManagementAllowedApplicationPath("/"), false);
  assert.equal(isAccountManagementAllowedApplicationPath("/account-management"), false);
  assert.equal(isAccountManagementAllowedApplicationPath("/commissions"), false);
  assert.equal(isAccountManagementAllowedApplicationPath("/api/account-management"), false);
  assert.equal(isAccountManagementAllowedApplicationPath("/migration-other"), false);
});

test("restricts GTM users to the GTM page and API", () => {
  assert.equal(isGtmAllowedApplicationPath("/gtm"), true);
  assert.equal(isGtmAllowedApplicationPath("/gtm/details"), true);
  assert.equal(isGtmAllowedApplicationPath("/api/gtm"), true);
  assert.equal(isGtmAllowedApplicationPath("/api/gtm/details"), true);

  assert.equal(isGtmAllowedApplicationPath("/"), false);
  assert.equal(isGtmAllowedApplicationPath("/commissions"), false);
  assert.equal(isGtmAllowedApplicationPath("/gtm-other"), false);
});

test("combines the allowed areas for users with multiple roles", () => {
  const roles = ["sales", "gtm"];
  assert.equal(isAssignedAreaOnlyUser(roles), true);
  assert.equal(isAssignedRoleAllowedApplicationPath(roles, "/commissions"), true);
  assert.equal(isAssignedRoleAllowedApplicationPath(roles, "/api/commissions/quota"), true);
  assert.equal(isAssignedRoleAllowedApplicationPath(roles, "/gtm"), true);
  assert.equal(isAssignedRoleAllowedApplicationPath(roles, "/api/gtm/details"), true);
  assert.equal(isAssignedRoleAllowedApplicationPath(roles, "/migration"), false);
  assert.equal(isAssignedRoleAllowedApplicationPath(roles, "/combined-all-subs"), false);
  assert.equal(defaultApplicationPathForRoles(roles), "/commissions");
});

test("viewer combined with an area role keeps standard dashboard access", () => {
  const roles = ["viewer", "gtm"];
  assert.equal(isAssignedAreaOnlyUser(roles), false);
  assert.equal(canViewGtm(roles), true);
  assert.equal(defaultApplicationPathForRoles(roles), "/combined-all-subs");
});
