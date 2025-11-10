import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { gnosis } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Hostasis - Swarm Postage Yield Distribution',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [gnosis],
  ssr: true,
});
