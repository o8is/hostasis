import { useState, useEffect } from 'react';
import type { AppProps } from 'next/app';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';

import { config } from '../wagmi';
import BackgroundCanvas from '../components/BackgroundCanvas';
import { NetworkStatus } from '../components/NetworkStatus';
import { PasskeyProvider } from '../contexts/PasskeyContext';
import AlphaBanner from '../components/AlphaBanner';

import '@rainbow-me/rainbowkit/styles.css';
import '@o8is/brand/o8-brand.css';
import '../styles/custom.css';

const client = new QueryClient();

function MyApp({ Component, pageProps }: AppProps) {
  // RainbowKit accesses localStorage during render, so we must wait for the client
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>
        {mounted ? (
          <RainbowKitProvider
            theme={darkTheme({
              accentColor: '#7a7a7a',
              accentColorForeground: 'white',
              borderRadius: 'medium',
              fontStack: 'system',
              overlayBlur: 'small',
            })}
            showRecentTransactions={true}
          >
            <PasskeyProvider>
              <AlphaBanner />
              <BackgroundCanvas />
              <NetworkStatus />
              <Component {...pageProps} />
            </PasskeyProvider>
          </RainbowKitProvider>
        ) : null}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default MyApp;
