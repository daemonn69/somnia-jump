import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { somniaMainnet } from './lib/chains'

export const config = getDefaultConfig({
    appName: 'Somnia DApp',
    projectId: '8afef30bd8814e89439c4c03c1611295',
    chains: [somniaMainnet],
    ssr: true,
})
