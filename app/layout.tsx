import './globals.css';

export const metadata = {
  title: 'Mastery Dashboard',
  description: 'Desempeño de campañas de Meta Ads en tiempo real',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
