import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Provisr | Cloud Provisioning Made Simple",
  description:
    "Describe what you need, review the plan, and launch cloud resources with confidence.",
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
