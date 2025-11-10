'use client';

import { useEffect } from 'react';

export default function BackgroundCanvas() {
  useEffect(() => {
    // Dynamically load the O8 background script
    const script = document.createElement('script');
    script.src = '/js/o8-background.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      // Cleanup script on unmount
      document.body.removeChild(script);
    };
  }, []);

  return <canvas id="bgCanvas" style={{ position: 'fixed', top: 0, left: 0, zIndex: -1 }} />;
}
