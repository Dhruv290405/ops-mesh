import './globals.css';
import { SocketProvider } from '../lib/socket';
import { ReactNode } from 'react';

export const metadata = {
  title: 'OpsMesh Dashboard',
  description: 'Incident command center for OpsMesh'
};

const themeScript = `
(function(){try{var t=localStorage.getItem('opsmesh-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}
