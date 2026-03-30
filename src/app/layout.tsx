import type { Metadata } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { STIX_Two_Text } from "next/font/google";
import "./globals.css";

const stixTwoText = STIX_Two_Text({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const SITE_DESCRIPTION =
  "Una síntesis de noticias para quedar al día en un par de minutos. Se actualiza cada 15 minutos.";

/** No trailing slash. Baked in at build time; set in production so og:image URLs are absolute. */
const siteUrlRaw =
  process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ?? "";
const siteUrl = siteUrlRaw.length > 0 ? siteUrlRaw : "http://localhost:3000";

const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim() ?? "";

const OG_IMAGE_PATH = "/og-image.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Párrafos",
  description: SITE_DESCRIPTION,
  icons: {
    icon: "/icon.png",
  },
  openGraph: {
    title: "Párrafos",
    description: SITE_DESCRIPTION,
    locale: "es",
    type: "website",
    url: "/",
    images: [
      {
        url: OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "Párrafos",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Párrafos",
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE_PATH],
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
      {gaId.length > 0 ? <GoogleAnalytics gaId={gaId} /> : null}
    </html>
  );
}
