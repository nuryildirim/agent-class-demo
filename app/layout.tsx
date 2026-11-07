// The frame around every page: a header with links to the two views.
//
// There is no real login. The "switch" between employee and admin is just
// two links, which keeps the demo about the agent rather than about accounts.

import Link from "next/link";
import "./globals.css";

export const metadata = { title: "Expense Review Agent" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Lumen &amp; Co. Expenses
          </Link>
          <nav>
            <Link href="/employee">Employee view</Link>
            <Link href="/admin">Admin view</Link>
            <Link href="/admin/eval">Evaluation</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
