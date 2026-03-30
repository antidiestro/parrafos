import type { Metadata } from "next";
import { STIX_Two_Text } from "next/font/google";
import "./globals.css";

const stixTwoText = STIX_Two_Text({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const SITE_DESCRIPTION = "Para quedar al día en un par de minutos.";

export const metadata: Metadata = {
  title: "Párrafos",
  description: SITE_DESCRIPTION,
  openGraph: {
    title: "Párrafos",
    description: SITE_DESCRIPTION,
    locale: "es",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Párrafos",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={stixTwoText.className}>
      <body>{children}</body>
    </html>
  );
}
