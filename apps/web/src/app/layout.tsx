import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "NikoBox",
  description: "Discord music bot dashboard",
  icons: {
    icon: "https://cdn-icons-png.flaticon.com/512/15071/15071874.png",
    shortcut: "https://cdn-icons-png.flaticon.com/512/15071/15071874.png",
    apple: "https://cdn-icons-png.flaticon.com/512/15071/15071874.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
