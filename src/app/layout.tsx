import type { ReactNode } from "react";
import AppNavigation from "./AppNavigation";
import HardRefreshButton from "./HardRefreshButton";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppNavigation />
        {children}
        <HardRefreshButton />
      </body>
    </html>
  );
}
