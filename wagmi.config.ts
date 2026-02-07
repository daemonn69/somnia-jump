import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { somniaTestnet, somniaMainnet } from './lib/chains'

export const config = getDefaultConfig({
    appName: 'Somnia DApp',
    projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // Get from https://cloud.walletconnect.com
    chains: [somniaTestnet, somniaMainnet],
    ssr: true,
})
