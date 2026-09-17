import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/authOptions";
import {
  accessRolesForEmail,
  loadAccessControlPolicy,
  removeAccessEmail,
  setEmailRoles,
  upsertAccessEmail,
} from "@/lib/accessControlStore";
import { normalizeAppRoles, type AppRole } from "@/lib/accessRoles";

const REQUIRED_ADMINS = new Set<string>(["hany.safwat@botpress.com", "siya.gupta@botpress.com"]);

async function requireAdminUser() {
  const session = await getServerSession(authOptions);
  const email = String(session?.user?.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    redirect("/login?callbackUrl=/access-control");
  }
  const { policy } = await loadAccessControlPolicy({ bypassCache: true });
  const isAdmin = policy.adminEmails.includes(email);
  return { email, isAdmin, policy };
}

async function addAccessEmailAction(formData: FormData) {
  "use server";
  const { isAdmin } = await requireAdminUser();
  if (!isAdmin) redirect("/access-control?error=admin_required");
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const roles = normalizeAppRoles(formData.getAll("roles"));
  await upsertAccessEmail(email, roles);
  redirect("/access-control?updated=1");
}

async function setEmailRolesAction(formData: FormData) {
  "use server";
  const { isAdmin } = await requireAdminUser();
  if (!isAdmin) redirect("/access-control?error=admin_required");
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const roles = normalizeAppRoles(formData.getAll("roles"));
  await setEmailRoles(email, roles);
  redirect("/access-control?updated=1");
}

async function removeAccessEmailAction(formData: FormData) {
  "use server";
  const { isAdmin } = await requireAdminUser();
  if (!isAdmin) redirect("/access-control?error=admin_required");
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  await removeAccessEmail(email);
  redirect("/access-control?updated=1");
}

type AccessControlSearchParams = Promise<{
  updated?: string;
  error?: string;
}>;

function errorMessage(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value === "admin_required") return "Only admins can manage access.";
  return value.replaceAll("_", " ");
}

function roleLabel(role: AppRole) {
  if (role === "account_management") return "Account Management";
  if (role === "gtm") return "GTM";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

const ROLE_OPTIONS: Array<{ role: AppRole; label: string }> = [
  { role: "viewer", label: "Viewer" },
  { role: "sales", label: "Sales" },
  { role: "account_management", label: "Account Management" },
  { role: "gtm", label: "GTM" },
  { role: "admin", label: "Admin" },
];

function RoleChecklist({ defaultRoles = [], disabled = false }: { defaultRoles?: AppRole[]; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      {ROLE_OPTIONS.map(({ role, label }) => (
        <label key={role} style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "#374151" }}>
          <input
            type="checkbox"
            name="roles"
            value={role}
            defaultChecked={defaultRoles.includes(role)}
            disabled={disabled}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export default async function AccessControlPage(props: { searchParams: AccessControlSearchParams }) {
  const searchParams = await props.searchParams;
  const { email: currentEmail, isAdmin, policy } = await requireAdminUser();
  const updated = String(searchParams.updated || "") === "1";
  const error = errorMessage(String(searchParams.error || ""));

  if (!isAdmin) {
    return (
      <div className="stripe-ui">
        <section className="stripe-ui__hero ui-reveal">
          <div className="stripe-ui__eyebrow">Security</div>
          <div className="stripe-ui__hero-row">
            <div>
              <h1 className="stripe-ui__title">Access Control</h1>
              <p className="stripe-ui__subtitle">You do not have admin access to this page.</p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Link href="/combined-all-subs" className="stripe-ui__hero-link">
                Back to Combined All Subs
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Security</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Access Control</h1>
            <p className="stripe-ui__subtitle">
              Manage who can sign in and which parts of the site they can access. Current admin: <strong>{currentEmail}</strong>.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Add Access Email</h2>
        <p className="stripe-ui__panel-subtitle">
          Assign one or more roles. Viewer grants the standard dashboards, Sales grants Commissions, Account Management grants Migration, GTM grants the GTM scorecard, and Admin grants everything.
        </p>
        {updated ? (
          <p style={{ color: "#166534", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 12px" }}>
            Access control updated.
          </p>
        ) : null}
        {error ? (
          <p style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px" }}>
            {error}
          </p>
        ) : null}
        <form action={addAccessEmailAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="stripe-ui__control"
            type="email"
            name="email"
            placeholder="name@company.com"
            required
            style={{ maxWidth: 360 }}
          />
          <RoleChecklist />
          <button type="submit" className="stripe-ui__btn stripe-ui__btn--primary">
            Add email
          </button>
        </form>
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: 10 }}>
          If no role is selected, Viewer is assigned. Admin already includes access to every area.
        </p>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-2">
        <h2 className="stripe-ui__panel-title">Allowed Emails</h2>
        <p className="stripe-ui__panel-subtitle">
          Area roles can be combined—for example, Sales + GTM grants both Commissions and GTM. Required admins cannot be changed or removed.
        </p>
        <div className="stripe-ui__table-wrap">
          <table className="stripe-ui__table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Roles</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {policy.allowedEmails.map((email) => {
                const roles = accessRolesForEmail(policy, email);
                const isRequired = REQUIRED_ADMINS.has(email);
                return (
                  <tr key={email}>
                    <td>{email}</td>
                    <td>{roles.map(roleLabel).join(" + ")}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <form action={setEmailRolesAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                          <input type="hidden" name="email" value={email} />
                          <RoleChecklist defaultRoles={roles} disabled={isRequired} />
                          <button type="submit" className="stripe-ui__btn" disabled={isRequired}>
                            Save roles
                          </button>
                        </form>
                        <form action={removeAccessEmailAction}>
                          <input type="hidden" name="email" value={email} />
                          <button type="submit" className="stripe-ui__btn" disabled={isRequired}>
                            Remove
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
