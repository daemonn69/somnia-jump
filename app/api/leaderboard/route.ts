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

// Проверяем доступность Vercel KV или обычного Redis
let kvAvailable = false
let kv: any = null

let redisAvailable = false
let redisClient: any = null

// Инициализация клиентов
try {
    // 1. Пробуем Vercel KV (HTTP)
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        kv = require('@vercel/kv').kv
        kvAvailable = true
        console.log('✅ Vercel KV connected')
    }
    // 2. Пробуем обычный Redis (TCP) если есть REDIS_URL
    else if (process.env.REDIS_URL) {
        redisClient = createClient({
            url: process.env.REDIS_URL
        })

        redisClient.on('error', (err: any) => console.log('Redis Client Error', err))

        // Подключаемся (для node-redis v4+)
        redisClient.connect().then(() => {
            redisAvailable = true
            console.log('✅ Standard Redis connected')
        }).catch((err: any) => {
            console.error('❌ Failed to connect to Redis:', err)
        })
    }
    else {
        console.log('⚠️  No database configured, using in-memory storage')
    }
} catch (error) {
    console.log('⚠️  Database setup failed, using in-memory storage', error)
}

// Функции для работы с in-memory storage
function getInMemoryLeaderboard(): LeaderboardEntry[] {
    return inMemoryLeaderboard
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
}

function saveToInMemoryLeaderboard(entry: LeaderboardEntry): boolean {
    // Ищем существующую запись для этого адреса
    const existingIndex = inMemoryLeaderboard.findIndex(
        e => e.address.toLowerCase() === entry.address.toLowerCase()
    )

    if (existingIndex >= 0) {
        // Обновляем только если новый результат лучше
        if (entry.score > inMemoryLeaderboard[existingIndex].score) {
            inMemoryLeaderboard[existingIndex] = entry
            return true
        }
        return false
    } else {
        // Новая запись
        inMemoryLeaderboard.push(entry)
        // Ограничиваем размер
        if (inMemoryLeaderboard.length > MAX_ENTRIES) {
            inMemoryLeaderboard = inMemoryLeaderboard
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_ENTRIES)
        }
        return true
    }
}

// Helper signatures for unified access
async function zrange(key: string, min: number, max: number, options?: any) {
    if (kvAvailable && kv) {
        return await kv.zrange(key, min, max, options)
    } else if (redisAvailable && redisClient) {
        // Redis client adaptation
        // zRange arguments differ slightly in node-redis v4
        // rev: true meant zRevRange in older versions, but options for v4
        const rev = options?.rev || false
        const withScores = options?.withScores || false

        // Use proper method based on options
        // Note: This is a simplified adaptation. Node-redis v4 uses .zRange with options object
        return await redisClient.zRange(key, min, max, {
            REV: rev,
            WITHSCORES: withScores
        })
    }
    return []
}

async function zadd(key: string, score: number, member: string) {
    if (kvAvailable && kv) {
        return await kv.zadd(key, { score, member })
    } else if (redisAvailable && redisClient) {
        return await redisClient.zAdd(key, { score, value: member })
    }
}

async function zrem(key: string, member: string) {
    if (kvAvailable && kv) {
        return await kv.zrem(key, member)
    } else if (redisAvailable && redisClient) {
        return await redisClient.zRem(key, member)
    }
}

async function zcard(key: string) {
    if (kvAvailable && kv) {
        return await kv.zcard(key)
    } else if (redisAvailable && redisClient) {
        return await redisClient.zCard(key)
    }
    return 0
}

async function zremrangebyrank(key: string, min: number, max: number) {
    if (kvAvailable && kv) {
        return await kv.zremrangebyrank(key, min, max)
    } else if (redisAvailable && redisClient) {
        return await redisClient.zRemRangeByRank(key, min, max)
    }
}


// GET - Получить лидерборд
export async function GET() {
    try {
        if ((kvAvailable && kv) || (redisAvailable && redisClient)) {
            // Используем базу данных (KV или Redis)

            // Получаем топ 10
            let entries = []
            if (kvAvailable) {
                entries = await kv.zrange(LEADERBOARD_KEY, 0, 9, { rev: true, withScores: true })
            } else {
                // Redis client returns array of objects {value, score} or strings depending on config
                // We use generic approach
                entries = await redisClient.zRange(LEADERBOARD_KEY, 0, 9, {
                    REV: true
                })

                // If it doesn't return scores by default, we need WITHSCORES.
                // Re-doing with correct config for node-redis v4
                entries = await redisClient.zRange(LEADERBOARD_KEY, 0, 9, {
                    REV: true,
                    WITHSCORES: true
                })
            }

            const leaderboard: LeaderboardEntry[] = []

            // Parsing depends on client response format
            if (kvAvailable) {
                // Vercel KV returns [member, score, member, score...]
                for (let i = 0; i < entries.length; i += 2) {
                    const data = entries[i] as string
                    const score = entries[i + 1] as number
                    try {
                        const parsed = JSON.parse(data)
                        leaderboard.push({
                            address: parsed.address,
                            score: score,
                            timestamp: parsed.timestamp
                        })
                    } catch { /* Skip invalid */ }
                }
            } else {
                // Node Redis v4 returns [{value: '...', score: 123}, ...]
                // OR ['value', 'score', ...] depending on flags.
                // Assuming default object return for newer versions or flat array for older?
                // Actually node-redis v4 with WITHSCORES returns array of objects {value, score}

                for (const item of entries) {
                    try {
                        // Check if item has value/score properties (node-redis v4 object style)
                        const dataStr = (item as any).value || item
                        const scoreVal = (item as any).score

                        // If it's a flat array (older redis or specific config), logic would be different
                        // But let's assume v4 object style as per createClient defaults

                        const parsed = JSON.parse(dataStr)
                        leaderboard.push({
                            address: parsed.address,
                            score: scoreVal,
                            timestamp: parsed.timestamp
                        })
                    } catch (e) { /* Skip */ }
                }
            }

            return NextResponse.json({ leaderboard, storage: kvAvailable ? 'kv' : 'redis' })
        } else {
            // Используем in-memory storage
            return NextResponse.json({
                leaderboard: getInMemoryLeaderboard(),
                storage: 'memory',
                warning: 'Using in-memory storage. Data will be lost on server restart. Configure Database for persistent storage.'
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

        if ((kvAvailable && kv) || (redisAvailable && redisClient)) {
            // Используем базу данных
            let existingScore = 0
            let existingMember = ''

            // Check existing score in DB
            // Need to get all entries to find user? Or just maintain user->score map?
            // ZSET only stores score. The member needs to be unique.
            // Our member is JSON string {address, timestamp}. This is unique per timestamp!
            // This is actually bad design in original code: if timestamp changes, member changes, so we can have multiple entries for same user?
            // The original code tried to find existing entry by parsing all! That's inefficient but works for small leaderboards.

            // Let's stick to original logic: scan all entries to find user
            let allEntries = []
            if (kvAvailable) {
                allEntries = await kv.zrange(LEADERBOARD_KEY, 0, -1, { withScores: true })
            } else {
                allEntries = await redisClient.zRange(LEADERBOARD_KEY, 0, -1, { WITHSCORES: true })
            }

            if (kvAvailable) {
                for (let i = 0; i < allEntries.length; i += 2) {
                    const data = allEntries[i] as string
                    try {
                        const parsed = JSON.parse(data)
                        if (parsed.address.toLowerCase() === address.toLowerCase()) {
                            existingScore = allEntries[i + 1] as number
                            existingMember = data
                            break
                        }
                    } catch { }
                }
            } else {
                for (const item of allEntries) {
                    const dataStr = (item as any).value
                    const scoreVal = (item as any).score
                    try {
                        const parsed = JSON.parse(dataStr)
                        if (parsed.address.toLowerCase() === address.toLowerCase()) {
                            existingScore = scoreVal
                            existingMember = dataStr
                            break
                        }
                    } catch { }
                }
            }

            if (score > existingScore) {
                // Удаляем старый результат
                if (existingMember) {
                    if (kvAvailable) await kv.zrem(LEADERBOARD_KEY, existingMember)
                    else await redisClient.zRem(LEADERBOARD_KEY, existingMember)
                }

                // Добавляем новый
                const newMember = JSON.stringify({
                    address,
                    timestamp: Date.now()
                })

                if (kvAvailable) await kv.zadd(LEADERBOARD_KEY, { score, member: newMember })
                else await redisClient.zAdd(LEADERBOARD_KEY, { score, value: newMember })

                // Ограничиваем размер
                const count = kvAvailable ? await kv.zcard(LEADERBOARD_KEY) : await redisClient.zCard(LEADERBOARD_KEY)

                if (count > MAX_ENTRIES) {
                    const entToRemove = count - MAX_ENTRIES
                    if (kvAvailable) await kv.zremrangebyrank(LEADERBOARD_KEY, 0, entToRemove - 1)
                    else await redisClient.zRemRangeByRank(LEADERBOARD_KEY, 0, entToRemove - 1)
                }

                return NextResponse.json({ success: true, newHighScore: true, storage: kvAvailable ? 'kv' : 'redis' })
            }

            return NextResponse.json({ success: true, newHighScore: false, storage: kvAvailable ? 'kv' : 'redis' })
        } else {
            // Используем in-memory storage
            const entry: LeaderboardEntry = {
                address,
                score,
                timestamp: Date.now()
            }

            const isNewHighScore = saveToInMemoryLeaderboard(entry)

            return NextResponse.json({
                success: true,
                newHighScore: isNewHighScore,
                storage: 'memory',
                warning: 'Using in-memory storage. Configure Database for persistent storage.'
            })
        }
    } catch (error) {
        console.error('Leaderboard POST error:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
    }
}
