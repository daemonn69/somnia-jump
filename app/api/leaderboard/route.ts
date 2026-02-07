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

// Global variables to hold clients across invocations (essential for serverless)
// Note: In Next.js dev mode, this file might get re-executed, creating new clients.
// Ideally usage of globalThis pattern is recommended but simple global vars work for now.
let kv: any = null
let redisClient: any = null

// Helper to ensure connection
async function getDb() {
    // 1. Prioritize Standard Redis (REDIS_URL)
    // This is likely what you entered manually
    if (process.env.REDIS_URL) {
        if (!redisClient) {
            redisClient = createClient({
                url: process.env.REDIS_URL
            })
            redisClient.on('error', (err: any) => console.log('Redis Client Error', err))
        }

        if (!redisClient.isOpen) {
            await redisClient.connect()
        }

        return { type: 'redis', client: redisClient }
    }

    // 2. Fallback to Vercel KV (HTTP)
    // This uses stateless HTTP requests, no connection needed
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        if (!kv) {
            kv = require('@vercel/kv').kv
        }
        return { type: 'kv', client: kv }
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

        if (db) {
            const { type, client } = db
            let entries = []

            try {
                if (type === 'kv') {
                    entries = await client.zrange(LEADERBOARD_KEY, 0, 9, { rev: true, withScores: true })
                } else {
                    // Redis v4
                    entries = await client.zRange(LEADERBOARD_KEY, 0, 9, {
                        REV: true,
                        WITHSCORES: true
                    })
                }
            } catch (dbError) {
                console.error('DB Read Error:', dbError)
                // Fallback to empty if DB fails
                return NextResponse.json({ leaderboard: [], error: 'DB Read Failed' })
            }

            const leaderboard: LeaderboardEntry[] = []

            if (type === 'kv') {
                // Vercel KV returns flat array: [member, score, member, score]
                // But sometimes if empty it returns []
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
                        } catch { /* Skip */ }
                    }
                }
            } else {
                // Redis v4 returns objects {value, score}
                if (Array.isArray(entries)) {
                    for (const item of entries) {
                        try {
                            const dataStr = (item as any).value
                            const scoreVal = (item as any).score
                            const parsed = JSON.parse(dataStr)
                            leaderboard.push({
                                address: parsed.address,
                                score: scoreVal,
                                timestamp: parsed.timestamp
                            })
                        } catch { /* Skip */ }
                    }
                }
            }

            return NextResponse.json({ leaderboard, storage: type })
        } else {
            // In-memory fallback
            return NextResponse.json({
                leaderboard: getInMemoryLeaderboard(),
                storage: 'memory',
                warning: 'Using in-memory storage.'
            })
        }
    } catch (error) {
        console.error('Leaderboard GET error:', error)
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

        if (db) {
            const { type, client } = db
            let existingScore = 0
            let existingMember = ''

            // Get all to find user
            let allEntries = []
            if (type === 'kv') {
                allEntries = await client.zrange(LEADERBOARD_KEY, 0, -1, { withScores: true })
            } else {
                allEntries = await client.zRange(LEADERBOARD_KEY, 0, -1, { WITHSCORES: true })
            }

            // Find existing
            if (type === 'kv') {
                for (let i = 0; i < allEntries.length; i += 2) {
                    try {
                        const data = allEntries[i] as string
                        if (JSON.parse(data).address.toLowerCase() === address.toLowerCase()) {
                            existingScore = Number(allEntries[i + 1])
                            existingMember = data
                            break
                        }
                    } catch { }
                }
            } else {
                for (const item of allEntries) {
                    try {
                        const dataStr = (item as any).value
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
        } else {
            const entry: LeaderboardEntry = { address, score, timestamp: Date.now() }
            const isNewHighScore = saveToInMemoryLeaderboard(entry)
            return NextResponse.json({ success: true, newHighScore: isNewHighScore, storage: 'memory' })
        }
    } catch (error) {
        console.error('Leaderboard POST error:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
    }
}
