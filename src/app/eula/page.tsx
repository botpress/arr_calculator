import Link from "next/link";

export default function EulaPage() {
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
        <h1 style={{ marginTop: 0 }}>End User License Agreement (EULA)</h1>
        <p style={{ color: "#625d54" }}>Effective date: March 12, 2026</p>
        <p>
          This End User License Agreement governs your use of ARR Calculator (the &quot;Service&quot;). By using
          the Service, you agree to this EULA.
        </p>

        <h2>1. License</h2>
        <p>
          We grant you a limited, non-exclusive, non-transferable, revocable license to access and use the
          Service for your internal business purposes.
        </p>

        <h2>2. Restrictions</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Copy, modify, or create derivative works of the Service except as permitted by law.</li>
          <li>Reverse engineer or attempt to extract source code, except where legally allowed.</li>
          <li>Use the Service in a way that violates applicable law or third-party rights.</li>
        </ul>

        <h2>3. Your Data</h2>
        <p>
          You are responsible for the data you connect and process through the Service, including QuickBooks and
          other integrated platforms.
        </p>

        <h2>4. Third-Party Services</h2>
        <p>
          The Service may connect to third-party systems such as QuickBooks, Stripe, HubSpot, and Vercel. Your
          use of those systems is governed by their terms and policies.
        </p>

        <h2>5. Disclaimer</h2>
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, including
          warranties of merchantability, fitness for a particular purpose, and non-infringement.
        </p>

        <h2>6. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect, incidental, special,
          consequential, or punitive damages, or loss of profits, data, or goodwill arising from your use of the
          Service.
        </p>

        <h2>7. Termination</h2>
        <p>
          We may suspend or terminate access if you violate this EULA. You may stop using the Service at any time.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update this EULA from time to time. Continued use after updates means you accept the revised
          terms.
        </p>

        <h2>9. Contact</h2>
        <p>For legal questions, contact your ARR Calculator administrator.</p>

        <p style={{ marginTop: "2rem" }}>
          <Link href="/privacy-policy">View Privacy Policy</Link>
        </p>
      </div>
    </main>
  );
}
