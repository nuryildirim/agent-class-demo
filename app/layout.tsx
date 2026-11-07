export const metadata = { title: "Expense Review Agent" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
        {children}
      </body>
    </html>
  );
}
