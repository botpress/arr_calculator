import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f1f0ea",
        color: "#050404",
        padding: "2rem 1rem",
      }}
    >
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Privacy Policy</h1>
        <p style={{ color: "#625d54" }}>Effective date: March 12, 2026</p>
        <p>
          This Privacy Policy explains how ARR Calculator (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) handles information when
          you use the Service.
        </p>

        <h2>1. Information We Process</h2>
        <p>When you use integrations, we may process:</p>
        <ul>
          <li>Account metadata and billing records from connected systems (for example QuickBooks, Stripe, HubSpot).</li>
          <li>OAuth credentials and tokens needed to access connected services.</li>
          <li>Operational logs needed for reliability, debugging, and security.</li>
        </ul>

        <h2>2. How We Use Information</h2>
        <p>We use information to:</p>
        <ul>
          <li>Provide requested reporting and analytics.</li>
          <li>Maintain and secure integration connectivity.</li>
          <li>Operate, troubleshoot, and improve the Service.</li>
        </ul>

        <h2>3. Storage and Security</h2>
        <p>
          We use reasonable technical and organizational safeguards designed to protect information. Integration
          tokens may be encrypted at rest where supported by the platform.
        </p>

        <h2>4. Sharing</h2>
        <p>
          We do not sell personal information. We may share data with service providers that host or support the
          Service, and as required by law.
        </p>

        <h2>5. Data Retention</h2>
        <p>
          We retain information for as long as needed to provide the Service, comply with legal obligations,
          resolve disputes, and enforce agreements.
        </p>

        <h2>6. Your Choices</h2>
        <p>
          You can disconnect integrations to stop future access. You may also request deletion of stored
          integration data by contacting your ARR Calculator administrator.
        </p>

        <h2>7. International Processing</h2>
        <p>
          Information may be processed in countries other than your own, subject to applicable legal safeguards.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update this Privacy Policy from time to time. Continued use after updates means you accept the
          revised policy.
        </p>

        <h2>9. Contact</h2>
        <p>For privacy questions, contact your ARR Calculator administrator.</p>

        <p style={{ marginTop: "2rem" }}>
          <Link href="/eula">View EULA</Link>
        </p>
      </div>
    </main>
  );
}
