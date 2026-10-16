"use client";

import { signIn } from "next-auth/react";

export default function GoogleSignInButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl })}
      style={{
        width: "100%",
        borderRadius: 10,
        border: "1px solid #050404",
        background: "#050404",
        color: "#f8f7f4",
        padding: "10px 12px",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Sign in with Google
    </button>
  );
}

