import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { somniaMainnet } from './lib/chains'

export const config = getDefaultConfig({
    appName: 'Somnia DApp',
    projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // Get from https://cloud.walletconnect.com
    chains: [somniaMainnet],
    ssr: true,
})
