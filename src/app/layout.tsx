import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import type { ReactNode } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DeployGuard AI | Production Readiness Intelligence",
    template: "%s | DeployGuard AI",
  },
  description:
    "Evidence-driven production readiness assessment for software repositories. DeployGuard AI verifies builds, tests, security, configuration, and deployment readiness before release.",
  applicationName: "DeployGuard AI",
  openGraph: {
    title: "DeployGuard AI | Production Readiness Intelligence",
    description:
      "Evidence-driven production readiness assessment for software repositories. DeployGuard AI verifies builds, tests, security, configuration, and deployment readiness before release.",
    type: "website",
  },
};


export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
