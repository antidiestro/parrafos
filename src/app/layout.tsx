import type { Metadata } from "next";
import { STIX_Two_Text } from "next/font/google";
import Script from "next/script";
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

const OG_IMAGE_PATH = "/og-image.png";

const gtmId = process.env.NEXT_PUBLIC_GTM_ID?.trim() ?? "";

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
      <body>
        {gtmId.length > 0 ? (
          <>
            <Script id="google-tag-manager" strategy="afterInteractive">
              {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer',${JSON.stringify(gtmId)});`}
            </Script>
            <noscript>
              <iframe
                src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtmId)}`}
                height={0}
                width={0}
                style={{ display: "none", visibility: "hidden" }}
                title="Google Tag Manager"
              />
            </noscript>
          </>
        ) : null}
        {children}
      </body>
    </html>
  );
}
