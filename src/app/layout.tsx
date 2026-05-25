import type { Metadata } from 'next';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import Footer from '@/components/Footer';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alex Invest Dashboard - S&P 500 & DAX Signale',
  description: 'Professionelle Kaufs- und Verkaufssignale für DAX und S&P 500 Aktien basierend auf technischen und fundamentalen Kriterien.',
  authors: [{ name: 'Antigravity Pro Systems' }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" data-theme="dark">
      <body>
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Footer />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
