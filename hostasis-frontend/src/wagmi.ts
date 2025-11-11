import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { gnosis } from 'wagmi/chains';
import { http, fallback } from 'wagmi';

export const config = getDefaultConfig({
  appName: 'Hostasis - Swarm Postage Yield Distribution',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [gnosis],
  transports: {
    [gnosis.id]: fallback([
      http('https://rpc.gnosischain.com', {
        batch: true,
        retryCount: 3,
        retryDelay: 1000,
      }),
      http('https://rpc.ankr.com/gnosis', {
        batch: true,
        retryCount: 3,
        retryDelay: 1000,
      }),
      http('https://gnosis.drpc.org', {
        batch: true,
        retryCount: 3,
        retryDelay: 1000,
      }),
    ]),
  },
  ssr: true,
});
