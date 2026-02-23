import { useState, useEffect } from 'react';

const BANNER_HEIGHT = 36;

export default function AlphaBanner() {
  const [dismissed, setDismissed] = useState(true); // Start hidden to avoid flash

  useEffect(() => {
    const wasDismissed = localStorage.getItem('alphaBannerDismissed');
    const isVisible = wasDismissed !== 'true';
    setDismissed(!isVisible);
    
    // Set CSS variable for nav offset
    document.documentElement.style.setProperty(
      '--alpha-banner-height',
      isVisible ? `${BANNER_HEIGHT}px` : '0px'
    );
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('alphaBannerDismissed', 'true');
    document.documentElement.style.setProperty('--alpha-banner-height', '0px');
  };

  if (dismissed) return null;

  return (
    <div style={{
      background: 'linear-gradient(90deg, #ff6b35 0%, #f7931a 100%)',
      color: '#fff',
      padding: '0.5rem 1rem',
      textAlign: 'center',
      fontSize: '0.85rem',
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: `${BANNER_HEIGHT}px`,
      boxSizing: 'border-box',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <span>
        <strong>Alpha Software</strong> + Unaudited smart contracts. Only deposit what you can afford to lose.
      </span>
      <button
        onClick={handleDismiss}
        style={{
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          color: '#fff',
          marginLeft: '1rem',
          padding: '0.25rem 0.75rem',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.85rem',
        }}
      >
        Got it
      </button>
    </div>
  );
}
