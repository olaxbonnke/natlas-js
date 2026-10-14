import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "N-ATLaS Playground · natlas-js",
  description:
    "Chat and translate in Yoruba, Hausa, Igbo and Nigerian English with N-ATLaS, Nigeria's multilingual LLM. Powered by the open-source natlas-js SDK.",
  openGraph: {
    title: "N-ATLaS Playground",
    description: "Try Nigeria's multilingual LLM in Yoruba, Hausa, Igbo and English, and copy the SDK code.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#008751",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
