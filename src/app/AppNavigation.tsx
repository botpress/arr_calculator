"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";

type NavigationItem = {
  href: string;
  label: string;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

function shouldHide(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/privacy-policy" ||
    pathname === "/eula" ||
    pathname === "/tv" ||
    pathname.startsWith("/tv/")
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function closeMenu(event: MouseEvent<HTMLAnchorElement>) {
  const menu = event.currentTarget.closest("details");
  if (menu) menu.open = false;
}

export default function AppNavigation() {
  const pathname = usePathname();
  const [roles, setRoles] = useState<string[]>([]);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((session: { user?: { role?: string; roles?: string[] } } | null) => {
        if (!active) return;
        const nextRoles = Array.isArray(session?.user?.roles)
          ? session.user.roles
          : [String(session?.user?.role || "")];
        setRoles(nextRoles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean));
      })
      .catch(() => {
        if (active) setRoles([]);
      })
      .finally(() => {
        if (active) setSessionLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo<NavigationGroup[]>(() => {
    const isAdmin = roles.includes("admin");
    const canViewStandard = isAdmin || roles.includes("viewer");
    const nextGroups: NavigationGroup[] = [];

    if (canViewStandard) {
      nextGroups.push(
        {
          label: "Overview",
          items: [
            { href: "/combined-all-subs", label: "All subscriptions" },
            { href: "/combined-billing-overview", label: "Billing overview" },
          ],
        },
        {
          label: "Revenue",
          items: [
            { href: "/hubspot", label: "HubSpot ARR" },
            { href: "/stripe-through-mrr", label: "Stripe MRR" },
            { href: "/stripe", label: "Stripe customers" },
            { href: "/stripe-billing-overview", label: "Invoice planning" },
            { href: "/tofu", label: "ARR detail" },
            { href: "/ndr-gdr", label: "NDR / GDR" },
            { href: "/plg", label: "PLG & Sales NRR" },
          ],
        },
        {
          label: "Operations",
          items: [
            { href: "/ai-spend", label: "AI spend" },
            { href: "/quickbooks", label: "QuickBooks" },
            { href: "/account-management", label: "Account management" },
            { href: "/migration", label: "Pricing migration" },
            { href: "/scorecards", label: "Team scorecards" },
          ],
        },
      );
    } else if (roles.includes("account_management")) {
      nextGroups.push({
        label: "Operations",
        items: [{ href: "/migration", label: "Pricing migration" }],
      });
    }

    const commercialItems: NavigationItem[] = [];
    if (isAdmin || roles.includes("gtm")) commercialItems.push({ href: "/gtm", label: "GTM scorecard" });
    if (isAdmin || roles.includes("sales")) commercialItems.push({ href: "/commissions", label: "Commissions" });
    if (commercialItems.length) nextGroups.push({ label: "Commercial", items: commercialItems });

    if (isAdmin) {
      nextGroups.push({
        label: "Admin",
        items: [
          { href: "/model-update", label: "Model update" },
          { href: "/access-control", label: "Access control" },
        ],
      });
    }

    return nextGroups;
  }, [roles]);

  const homeHref = useMemo(() => {
    if (roles.includes("admin") || roles.includes("viewer")) return "/combined-all-subs";
    if (roles.includes("sales")) return "/commissions";
    if (roles.includes("account_management")) return "/migration";
    if (roles.includes("gtm")) return "/gtm";
    return "/combined-all-subs";
  }, [roles]);

  if (shouldHide(pathname) || !sessionLoaded || groups.length === 0) return null;

  return (
    <nav className="app-nav" aria-label="Main navigation">
      <div className="app-nav__inner">
        <Link className="app-nav__brand" href={homeHref}>
          <span className="app-nav__brand-mark" aria-hidden="true">B</span>
          <span>ARR Calculator</span>
        </Link>
        <div className="app-nav__groups">
          {groups.map((group) => {
            const groupActive = group.items.some((item) => isActive(pathname, item.href));
            return (
              <details className="app-nav__group" key={group.label}>
                <summary className={groupActive ? "app-nav__summary app-nav__summary--active" : "app-nav__summary"}>
                  {group.label}
                  <span aria-hidden="true" className="app-nav__chevron">⌄</span>
                </summary>
                <div className="app-nav__menu">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={active ? "app-nav__link app-nav__link--active" : "app-nav__link"}
                        href={item.href}
                        key={item.href}
                        onClick={closeMenu}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
