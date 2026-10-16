"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { MouseEvent } from "react";
import BotpressLogo from "./BotpressLogo";
import { DATA_TOOLS_BUSY_EVENT, DATA_TOOLS_TOGGLE_EVENT } from "./HardRefreshButton";

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
  const groupsRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dataToolsBusy, setDataToolsBusy] = useState(false);

  useEffect(() => {
    const onBusy = (event: Event) => setDataToolsBusy(Boolean((event as CustomEvent<{ busy: boolean }>).detail?.busy));
    window.addEventListener(DATA_TOOLS_BUSY_EVENT, onBusy);
    return () => window.removeEventListener(DATA_TOOLS_BUSY_EVENT, onBusy);
  }, []);

  // With a mouse, menus open on hover and close shortly after the pointer leaves (the delay
  // covers the small gap between the button and the menu). Touch and keyboard still use click.
  function openOnHover(event: ReactPointerEvent<HTMLDetailsElement>) {
    if (event.pointerType !== "mouse") return;
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    const menu = event.currentTarget;
    groupsRef.current?.querySelectorAll("details[open]").forEach((other) => {
      if (other !== menu) (other as HTMLDetailsElement).open = false;
    });
    menu.open = true;
  }

  function closeOnHoverLeave(event: ReactPointerEvent<HTMLDetailsElement>) {
    if (event.pointerType !== "mouse") return;
    const menu = event.currentTarget;
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = setTimeout(() => {
      menu.open = false;
    }, 150);
  }

  // Close open menus when clicking anywhere outside them, or on Escape.
  useEffect(() => {
    function closeMenusExcept(target: Node | null) {
      groupsRef.current?.querySelectorAll("details[open]").forEach((menu) => {
        if (!target || !menu.contains(target)) (menu as HTMLDetailsElement).open = false;
      });
    }
    function onPointerDown(event: PointerEvent) {
      closeMenusExcept(event.target as Node);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenusExcept(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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
            { href: "/renewals", label: "Renewals" },
            { href: "/migration", label: "Pricing migration" },
            { href: "/scorecards", label: "Team scorecards" },
          ],
        },
      );
    } else if (roles.includes("account_management")) {
      nextGroups.push({
        label: "Operations",
        items: [
          { href: "/account-management", label: "Account management" },
          { href: "/renewals", label: "Renewals" },
          { href: "/migration", label: "Pricing migration" },
        ],
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
    if (roles.includes("admin") || roles.includes("viewer")) return "/";
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
          <BotpressLogo className="app-nav__brand-mark" />
          <span>ARR Calculator</span>
        </Link>
        <div className="app-nav__groups" ref={groupsRef}>
          {homeHref === "/" && (
            <Link
              aria-current={pathname === "/" ? "page" : undefined}
              className={pathname === "/" ? "app-nav__summary app-nav__summary--active" : "app-nav__summary"}
              href="/"
            >
              Dashboard
            </Link>
          )}
          {groups.map((group) => {
            const groupActive = group.items.some((item) => isActive(pathname, item.href));
            return (
              <details
                className="app-nav__group"
                key={group.label}
                onPointerEnter={openOnHover}
                onPointerLeave={closeOnHoverLeave}
              >
                <summary
                  className={groupActive ? "app-nav__summary app-nav__summary--active" : "app-nav__summary"}
                  onClick={(event) => {
                    // Hover already opened it; a mouse click shouldn't toggle it shut.
                    if ((event.nativeEvent as PointerEvent).pointerType === "mouse") event.preventDefault();
                  }}
                >
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
        {homeHref === "/" && (
          <button
            type="button"
            className="app-nav__summary app-nav__tools"
            data-data-tools-toggle
            onClick={() => window.dispatchEvent(new Event(DATA_TOOLS_TOGGLE_EVENT))}
            title={dataToolsBusy ? "A data job is running" : "Sync, backfill and refresh tools"}
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Data tools
            {dataToolsBusy && <span className="app-nav__busy-dot" aria-label="running" />}
          </button>
        )}
      </div>
    </nav>
  );
}
