import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import MobileQuickAddWrapper from "./dispatch/MobileQuickAddWrapper"; // Import MobileQuickAddWrapper

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dispatch Master",
  description: "Trucking Dispatch Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="pb-24 md:pb-0">{children}</div>
        <div className="md:hidden">
          <MobileQuickAddWrapper />
        </div>
      </body>
    </html>
  );
}
