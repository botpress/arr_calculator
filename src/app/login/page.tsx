import GoogleSignInButton from "./GoogleSignInButton";

type LoginSearchParams = Promise<{
  callbackUrl?: string;
  error?: string;
}>;

function safeCallbackUrl(raw: string | undefined) {
  const value = String(raw || "").trim();
  if (!value.startsWith("/")) return "/combined-all-subs";
  if (value.startsWith("//")) return "/combined-all-subs";
  return value;
}

function loginErrorMessage(error: string) {
  const key = String(error || "").trim();
  if (key === "AccessDenied") {
    return "Access denied. Use an approved company Google account.";
  }
  if (key) return `Login failed: ${key}`;
  return "";
}

export default async function LoginPage(props: { searchParams: LoginSearchParams }) {
  const searchParams = await props.searchParams;
  const callbackUrl = safeCallbackUrl(searchParams.callbackUrl);
  const errorText = loginErrorMessage(String(searchParams.error || ""));

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 420,
          border: "1px solid #e0dbd2",
          borderRadius: 12,
          padding: 24,
          background: "#f8f7f4",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22 }}>Sign in</h1>
        <p style={{ marginTop: 10, marginBottom: 18, color: "#625d54" }}>
          Continue with your company Google account.
        </p>

        {errorText ? (
          <p
            style={{
              marginTop: 0,
              marginBottom: 14,
              color: "#b42318",
              background: "#f8e3df",
              border: "1px solid #e8b4aa",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            {errorText}
          </p>
        ) : null}

        <GoogleSignInButton callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}
