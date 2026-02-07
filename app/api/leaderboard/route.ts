import { NextRequest, NextResponse } from 'next/server'
import { createClient } from 'redis'

const LEADERBOARD_KEY = 'somnia-jump-leaderboard'
const MAX_ENTRIES = 100

interface LeaderboardEntry {
    address: string
    score: number
    timestamp: number
}

// In-memory fallback storage для локальной разработки
let inMemoryLeaderboard: LeaderboardEntry[] = []

// Global variables to hold clients
let kv: any = null
let redisClient: any = null

// Helper to ensure connection - Fail-Safe version
async function getDb() {
    try {
        // 1. Prioritize Standard Redis (REDIS_URL)
        if (process.env.REDIS_URL) {
            if (!redisClient) {
                redisClient = createClient({
                    url: process.env.REDIS_URL,
                    socket: {
                        connectTimeout: 5000 // 5s timeout
                    }
                })
                redisClient.on('error', (err: any) => console.warn('Redis Client Error (will fallback):', err))
            }

            if (!redisClient.isOpen) {
                await redisClient.connect()
            }

            return { type: 'redis', client: redisClient }
        }

        // 2. Fallback to Vercel KV
        if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
            if (!kv) {
                kv = require('@vercel/kv').kv
            }
            return { type: 'kv', client: kv }
        }
    } catch (e) {
        console.warn("DB Connection failed (switching to in-memory):", e)
        return null
    }

    return null
}

// Функции для работы с in-memory storage
function getInMemoryLeaderboard(): LeaderboardEntry[] {
    return inMemoryLeaderboard
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
}

function saveToInMemoryLeaderboard(entry: LeaderboardEntry): boolean {
    const existingIndex = inMemoryLeaderboard.findIndex(
        e => e.address.toLowerCase() === entry.address.toLowerCase()
    )

    if (existingIndex >= 0) {
        if (entry.score > inMemoryLeaderboard[existingIndex].score) {
            inMemoryLeaderboard[existingIndex] = entry
            return true
        }
        return false
    } else {
        inMemoryLeaderboard.push(entry)
        if (inMemoryLeaderboard.length > MAX_ENTRIES) {
            inMemoryLeaderboard = inMemoryLeaderboard
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_ENTRIES)
        }
        return true
    }
}

// GET - Получить лидерборд
export async function GET() {
    try {
        const db = await getDb()

        // Try DB first
        if (db) {
            try {
                const { type, client } = db
                let entries = []
                const leaderboard: LeaderboardEntry[] = []

                if (type === 'kv') {
                    entries = await client.zrange(LEADERBOARD_KEY, 0, 9, { rev: true, withScores: true })
                    // Vercel KV parsing
                    if (Array.isArray(entries)) {
                        for (let i = 0; i < entries.length; i += 2) {
                            try {
                                const data = entries[i] as string
                                const score = Number(entries[i + 1])
                                const parsed = JSON.parse(data)
                                leaderboard.push({
                                    address: parsed.address,
                                    score: score,
                                    timestamp: parsed.timestamp
                                })
                            } catch { }
                        }
                    }
                } else {
                    // Redis v4
                    entries = await client.zRange(LEADERBOARD_KEY, 0, 9, {
                        REV: true,
                        WITHSCORES: true
                    })
                    // Redis v4 parsing
                    if (Array.isArray(entries)) {
                        for (const item of entries) {
                            try {
                                const dataStr = (item as any).value || item
                                const scoreVal = (item as any).score
                                const parsed = JSON.parse(dataStr)
                                leaderboard.push({
                                    address: parsed.address,
                                    score: scoreVal,
                                    timestamp: parsed.timestamp
                                })
                            } catch { }
                        }
                    }
                }

                return NextResponse.json({ leaderboard, storage: type })
            } catch (dbError) {
                console.error('DB Read Failed (falling back to memory):', dbError)
                // Proceed to fallback
            }
        }

        // Fallback or if DB failed
        return NextResponse.json({
            leaderboard: getInMemoryLeaderboard(),
            storage: 'memory',
            warning: 'Using in-memory storage (fallback active).'
        })

    } catch (error) {
        console.error('Leaderboard GET critical error:', error)
        return NextResponse.json({ leaderboard: [] })
    }
}

// POST - Добавить результат
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { address, score } = body

        if (!address || typeof score !== 'number') {
            return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
        }

        const db = await getDb()

        // Try DB first
        if (db) {
            try {
                const { type, client } = db
                let existingScore = 0
                let existingMember = ''

                // 1. Get existing score
                let allEntries = []
                if (type === 'kv') {
                    allEntries = await client.zrange(LEADERBOARD_KEY, 0, -1, { withScores: true })
                } else {
                    allEntries = await client.zRange(LEADERBOARD_KEY, 0, -1, { WITHSCORES: true })
                }

                if (type === 'kv') {
                    for (let i = 0; i < allEntries.length; i += 2) {
                        try {
                            const data = allEntries[i] as string
                            const parsed = JSON.parse(data)
                            if (parsed.address.toLowerCase() === address.toLowerCase()) {
                                existingScore = Number(allEntries[i + 1])
                                existingMember = data
                                break
                            }
                        } catch { }
                    }
                } else {
                    for (const item of allEntries) {
                        try {
                            const dataStr = (item as any).value || item
                            const scoreVal = (item as any).score
                            if (JSON.parse(dataStr).address.toLowerCase() === address.toLowerCase()) {
                                existingScore = scoreVal
                                existingMember = dataStr
                                break
                            }
                        } catch { }
                    }
                }

                if (score > existingScore) {
                    // Update score
                    if (existingMember) {
                        if (type === 'kv') await client.zrem(LEADERBOARD_KEY, existingMember)
                        else await client.zRem(LEADERBOARD_KEY, existingMember)
                    }

                    const newMember = JSON.stringify({ address, timestamp: Date.now() })

                    if (type === 'kv') await client.zadd(LEADERBOARD_KEY, { score, member: newMember })
                    else await client.zAdd(LEADERBOARD_KEY, { score, value: newMember })

                    // Limit size
                    const count = type === 'kv' ? await client.zcard(LEADERBOARD_KEY) : await client.zCard(LEADERBOARD_KEY)
                    if (count > MAX_ENTRIES) {
                        if (type === 'kv') await client.zremrangebyrank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1)
                        else await client.zRemRangeByRank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1)
                    }

                    return NextResponse.json({ success: true, newHighScore: true, storage: type })
                }

                return NextResponse.json({ success: true, newHighScore: false, storage: type })
            } catch (dbError) {
                console.error("DB Write Failed (falling back to memory):", dbError)
                // Proceed to fallback
            }
        }

        // In-memory fallback (if DB null or DB op failed)
        const entry: LeaderboardEntry = { address, score, timestamp: Date.now() }
        const isNewHighScore = saveToInMemoryLeaderboard(entry)
        return NextResponse.json({
            success: true,
            newHighScore: isNewHighScore,
            storage: 'memory',
            warning: 'Using in-memory storage (fallback active).'
        })

    } catch (error) {
        console.error('Leaderboard POST critical error:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
    }
}
