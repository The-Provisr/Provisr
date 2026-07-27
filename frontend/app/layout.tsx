import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Provisr",
  description: "Provisr infrastructure provisioning chat UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const document = (
    <html lang="en" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );

  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return document;
  }

  return (
    <ClerkProvider
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorBackground: "#141414",
          colorForeground: "#ffffff",
          colorInputBackground: "#222222",
          colorInputText: "#ffffff",
          colorNeutral: "#ffffff",
          colorPrimary: "#ffffff",
          colorText: "#ffffff",
          colorTextSecondary: "#999999",
          fontFamily: "Inter, sans-serif",
          borderRadius: "0.9rem",
        },
      }}
    >
      {document}
    </ClerkProvider>
  );
}
