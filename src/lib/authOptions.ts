import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { accessRolesForEmail, loadAccessControlPolicy } from "@/lib/accessControlStore";
import { normalizeAppRoles, primaryAppRole } from "@/lib/accessRoles";

const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const authSecret = String(process.env.AUTH_SECRET || "").trim();

if (!googleClientId || !googleClientSecret || !authSecret) {
  throw new Error(
    "Missing SSO env vars. Required: AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET",
  );
}

export const authOptions: NextAuthOptions = {
  secret: authSecret,
  providers: [
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ account, user, profile }) {
      if (account?.provider !== "google") return false;

      const email = String(user.email || "").trim().toLowerCase();
      const emailVerified =
        (profile as { email_verified?: unknown } | undefined)?.email_verified === true;

      if (!email || !emailVerified) return false;
      const { policy } = await loadAccessControlPolicy();
      if (policy.allowedEmails.includes(email)) return true;
      return false;
    },
    async jwt({ token }) {
      const email = String(token.email || "").trim().toLowerCase();
      const { policy } = await loadAccessControlPolicy();
      const roles = accessRolesForEmail(policy, email);
      token.roles = roles;
      token.role = primaryAppRole(roles);
      return token;
    },
    async session({ session, token }) {
      const roles = normalizeAppRoles(token.roles || token.role);
      (session.user as { role?: string; roles?: string[] } | undefined) = {
        ...(session.user || {}),
        role: primaryAppRole(roles),
        roles,
      };
      return session;
    },
  },
};
