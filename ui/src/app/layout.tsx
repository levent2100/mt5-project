import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PropFirm Trading Farm Control Hub",
  description: "Advanced centralized control dashboard for multiple MetaTrader 5 trading instances.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${inter.className} min-h-screen antialiased selection:bg-neutral-800 selection:text-white`}>
        {children}
      </body>
    </html>
  );
}

