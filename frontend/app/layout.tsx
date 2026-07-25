import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Provisr GPT",
  description: "Provisr infrastructure provisioning chat UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
