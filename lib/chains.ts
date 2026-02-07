import { defineChain } from 'viem'

export const somniaTestnet = defineChain({
    id: 50312,
    name: 'Somnia Testnet',
    nativeCurrency: {
        decimals: 18,
        name: 'STT',
        symbol: 'STT',
    },
    rpcUrls: {
        default: {
            http: ['https://dream-rpc.somnia.network'],
        },
        public: {
            http: ['https://dream-rpc.somnia.network'],
        },
    },
    blockExplorers: {
        default: {
            name: 'Somnia Explorer',
            url: 'https://somnia-testnet.socialscan.io',
        },
    },
    testnet: true,
})

export const somniaMainnet = defineChain({
    id: 5031,
    name: 'Somnia',
    nativeCurrency: {
        decimals: 18,
        name: 'SOMI',
        symbol: 'SOMI',
    },
    rpcUrls: {
        default: {
            http: ['https://api.infra.mainnet.somnia.network'],
        },
        public: {
            http: ['https://api.infra.mainnet.somnia.network'],
        },
    },
    blockExplorers: {
        default: {
            name: 'Somnia Explorer',
            url: 'https://mainnet.somnia.w3us.site',
        },
    },
    testnet: false,
})
