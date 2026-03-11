import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Backend Interview Lab',
  description:
    '29 practical Python challenges and 18 system design interviews, with runnable tests and guided review.',
};

/**
 * Runs before the first paint, which a `useEffect` in the page cannot do.
 *
 * Two things otherwise flash on every load: the theme, because the stored
 * preference is read after paint, and the library, because the server has no
 * idea which problem the URL names so it renders the library and the client
 * swaps to the workspace a frame later.
 *
 * The theme is fixed outright. The library cannot be, since it is what the
 * server rendered, so it is marked here and hidden by CSS until React replaces
 * it. If this script does not run, nothing is hidden and the page simply
 * behaves as it did before.
 */
const boot = `(function(){try{
var d=document.documentElement;
if(localStorage.getItem('interview-lab-theme')==='dark')d.classList.add('dark');
var v=new URLSearchParams(location.search).get('view');
if(v==='problem')d.setAttribute('data-boot',v);
}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The boot script mutates these attributes, so React must not treat the
    // difference as a mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
