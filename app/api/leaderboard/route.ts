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
                let entries: any[] = []
                const leaderboard: LeaderboardEntry[] = []

                console.log('[Leaderboard GET] Using storage type:', type)

                if (type === 'kv') {
                    entries = await client.zrange(LEADERBOARD_KEY, 0, 9, { rev: true, withScores: true })
                } else {
                    // Redis v4
                    entries = await client.zRange(LEADERBOARD_KEY, 0, 9, {
                        REV: true,
                        WITHSCORES: true
                    })
                }

                console.log('[Leaderboard GET] Raw entries:', JSON.stringify(entries, null, 2))
                console.log('[Leaderboard GET] Entries length:', entries?.length)

                // Universal parsing logic
                if (Array.isArray(entries) && entries.length > 0) {
                    const firstItem = entries[0]
                    console.log('[Leaderboard GET] First item type:', typeof firstItem)
                    console.log('[Leaderboard GET] First item:', JSON.stringify(firstItem))
                    console.log('[Leaderboard GET] First item keys:', typeof firstItem === 'object' && firstItem !== null ? Object.keys(firstItem) : 'N/A')
                    console.log('[Leaderboard GET] Has score prop:', typeof firstItem === 'object' && firstItem !== null && 'score' in firstItem)
                    console.log('[Leaderboard GET] Has value prop:', typeof firstItem === 'object' && firstItem !== null && 'value' in firstItem)
                    console.log('[Leaderboard GET] Has member prop:', typeof firstItem === 'object' && firstItem !== null && 'member' in firstItem)

                    // Check if it's an object format (Redis v4 often returns {value, score}, Vercel KV might too)
                    const isObjectFormat = typeof firstItem === 'object' && firstItem !== null && ('score' in firstItem)
                    console.log('[Leaderboard GET] Is object format:', isObjectFormat)

                    if (isObjectFormat) {
                        for (const item of entries) {
                            try {
                                // Handle both 'member' (Vercel) and 'value' (Redis) keys
                                const dataStr = (item as any).member || (item as any).value || JSON.stringify(item)
                                const scoreVal = (item as any).score

                                console.log('[Leaderboard GET] Parsing object item:', { dataStr, scoreVal })

                                // dataStr might already be an object in some cases
                                const parsed = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr
                                const finalScore = (scoreVal !== undefined && scoreVal !== null) ? Number(scoreVal) : 0
                                leaderboard.push({
                                    address: parsed.address,
                                    score: isNaN(finalScore) ? 0 : finalScore,
                                    timestamp: parsed.timestamp || Date.now()
                                })
                            } catch (e) {
                                console.error('[Leaderboard GET] Parse error (object):', e, item)
                            }
                        }
                    } else {
                        // Flat array format: [member, score, member, score...]
                        for (let i = 0; i < entries.length; i += 2) {
                            try {
                                const dataStr = entries[i]
                                const scoreVal = entries[i + 1]

                                console.log('[Leaderboard GET] Parsing flat item:', { dataStr, scoreVal, index: i })

                                const parsed = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr
                                const finalScore = (scoreVal !== undefined && scoreVal !== null) ? Number(scoreVal) : 0
                                leaderboard.push({
                                    address: parsed.address,
                                    score: isNaN(finalScore) ? 0 : finalScore,
                                    timestamp: parsed.timestamp || Date.now()
                                })
                            } catch (e) {
                                console.error('[Leaderboard GET] Parse error (flat):', e, entries[i])
                            }
                        }
                    }
                }

                console.log('[Leaderboard GET] Final leaderboard:', leaderboard)
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

        console.log('[Leaderboard POST] Received:', { address, score })

        if (!address || typeof score !== 'number') {
            console.log('[Leaderboard POST] Invalid data:', { address, score })
            return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
        }

        const db = await getDb()
        console.log('[Leaderboard POST] DB connection:', db ? db.type : 'null (memory fallback)')

        // Try DB first
        if (db) {
            try {
                const { type, client } = db
                let existingScore = 0
                let existingMember = ''

                // 1. Get existing score
                let allEntries: any[] = []
                if (type === 'kv') {
                    allEntries = await client.zrange(LEADERBOARD_KEY, 0, -1, { withScores: true })
                } else {
                    allEntries = await client.zRange(LEADERBOARD_KEY, 0, -1, { WITHSCORES: true })
                }

                console.log('[Leaderboard POST] All entries count:', allEntries?.length)

                // Universal parsing to find existing entry
                if (Array.isArray(allEntries) && allEntries.length > 0) {
                    const firstItem = allEntries[0]
                    const isObjectFormat = typeof firstItem === 'object' && firstItem !== null && ('score' in firstItem)

                    if (isObjectFormat) {
                        for (const item of allEntries) {
                            try {
                                const dataStr = (item as any).member || (item as any).value || JSON.stringify(item)
                                const scoreVal = (item as any).score
                                const parsed = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr
                                if (parsed.address?.toLowerCase() === address.toLowerCase()) {
                                    existingScore = Number(scoreVal)
                                    existingMember = typeof dataStr === 'string' ? dataStr : JSON.stringify({ address: parsed.address, timestamp: parsed.timestamp })
                                    break
                                }
                            } catch { }
                        }
                    } else {
                        // Flat array
                        for (let i = 0; i < allEntries.length; i += 2) {
                            try {
                                const dataStr = allEntries[i]
                                const scoreVal = allEntries[i + 1]
                                const parsed = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr
                                if (parsed.address?.toLowerCase() === address.toLowerCase()) {
                                    existingScore = Number(scoreVal)
                                    existingMember = typeof dataStr === 'string' ? dataStr : JSON.stringify({ address: parsed.address, timestamp: parsed.timestamp })
                                    break
                                }
                            } catch { }
                        }
                    }
                }

                console.log('[Leaderboard POST] Existing score:', existingScore, 'New score:', score)

                if (score > existingScore) {
                    // Update score
                    if (existingMember) {
                        console.log('[Leaderboard POST] Removing old entry:', existingMember)
                        if (type === 'kv') await client.zrem(LEADERBOARD_KEY, existingMember)
                        else await client.zRem(LEADERBOARD_KEY, existingMember)
                    }

                    const newMember = JSON.stringify({ address, timestamp: Date.now() })
                    console.log('[Leaderboard POST] Adding new entry:', newMember, 'with score:', score)

                    if (type === 'kv') await client.zadd(LEADERBOARD_KEY, { score, member: newMember })
                    else await client.zAdd(LEADERBOARD_KEY, { score, value: newMember })

                    // Limit size
                    const count = type === 'kv' ? await client.zcard(LEADERBOARD_KEY) : await client.zCard(LEADERBOARD_KEY)
                    if (count > MAX_ENTRIES) {
                        if (type === 'kv') await client.zremrangebyrank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1)
                        else await client.zRemRangeByRank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1)
                    }

                    console.log('[Leaderboard POST] Success! New high score saved.')
                    return NextResponse.json({ success: true, newHighScore: true, storage: type })
                }

                console.log('[Leaderboard POST] Score not higher than existing, not saving.')
                return NextResponse.json({ success: true, newHighScore: false, storage: type })
            } catch (dbError) {
                console.error("[Leaderboard POST] DB Write Failed (falling back to memory):", dbError)
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
