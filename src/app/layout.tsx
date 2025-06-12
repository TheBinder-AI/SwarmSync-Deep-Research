import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deep Research Engine",
  description: "A deep research engine",
  icons: {
    icon: [
      {
        url: "/brain.png",
        sizes: "32x32",
        type: "image/png",
      },
    ],
    shortcut: "/brain.png",
    apple: "/brain.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning={true}
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          inter.variable
        )}
      >
        <main className="">
          {children}
        </main>
      </body>
    </html>
  );
}
