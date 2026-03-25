import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VOTH Dashboard',
  description: 'Dashboard de análise de gargalos e otimização de processos',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
