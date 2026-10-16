import type { Metadata, Viewport } from "next"

import "./globals.css"

export const metadata: Metadata = {
  title: "Тренировки: Pull / Push / Legs",
  description:
    "Интерактивный трекер тренировок Pull / Push / Legs: выбирай день, отмечай подходы, меняй вес и повторения, следи за отдыхом между подходами.",
}

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
