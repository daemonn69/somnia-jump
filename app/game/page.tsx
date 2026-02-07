'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import './game.css'

interface Platform {
    x: number
    y: number
    width: number
}

export default function SomniaJumpGame() {
    const { address } = useAccount()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start')
    const [score, setScore] = useState(0)
    const [highScore, setHighScore] = useState(0)
    const [savingToLeaderboard, setSavingToLeaderboard] = useState(false)

    // Game refs
    const gameRef = useRef({
        player: { x: 0, y: 0, vy: 0, width: 40, height: 40 },
        platforms: [] as Platform[],
        keys: { left: false, right: false },
        maxY: 0,
        animationId: 0
    })

    // Constants
    const CANVAS_WIDTH = 400
    const CANVAS_HEIGHT = 600
    const GRAVITY = 0.5
    const JUMP_VELOCITY = -15
    const MOVE_SPEED = 8
    const PLATFORM_WIDTH = 70
    const PLATFORM_HEIGHT = 15
    const PLATFORM_COUNT = 7

    useEffect(() => {
        const saved = localStorage.getItem('somniaJumpHighScore')
        if (saved) setHighScore(parseInt(saved))
    }, [])

    const saveToLeaderboard = useCallback(async (finalScore: number) => {
        if (!address || finalScore === 0) return

        setSavingToLeaderboard(true)
        try {
            const response = await fetch('/api/leaderboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, score: finalScore })
            })

            const data = await response.json()
            if (data.newHighScore) {
                console.log('New high score saved to leaderboard!')
            }
        } catch (error) {
            console.error('Failed to save to leaderboard:', error)
        } finally {
            setSavingToLeaderboard(false)
        }
    }, [address])

    const generatePlatforms = useCallback((startY: number, count: number): Platform[] => {
        const platforms: Platform[] = []
        for (let i = 0; i < count; i++) {
            platforms.push({
                x: Math.random() * (CANVAS_WIDTH - PLATFORM_WIDTH),
                y: startY - i * (CANVAS_HEIGHT / PLATFORM_COUNT),
                width: PLATFORM_WIDTH
            })
        }
        return platforms
    }, [])

    const startGame = useCallback(() => {
        const game = gameRef.current

        // Reset player - start on first platform
        game.player = {
            x: CANVAS_WIDTH / 2 - 20,
            y: CANVAS_HEIGHT - 100,
            vy: JUMP_VELOCITY,
            width: 40,
            height: 40
        }

        // Generate initial platforms
        game.platforms = []
        // First platform directly under player
        game.platforms.push({
            x: CANVAS_WIDTH / 2 - PLATFORM_WIDTH / 2,
            y: CANVAS_HEIGHT - 50,
            width: PLATFORM_WIDTH
        })
        // Rest of platforms going up
        game.platforms.push(...generatePlatforms(CANVAS_HEIGHT - 150, PLATFORM_COUNT - 1))

        game.maxY = 0
        game.keys = { left: false, right: false }

        setScore(0)
        setGameState('playing')
    }, [generatePlatforms])

    useEffect(() => {
        if (gameState !== 'playing') return

        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const game = gameRef.current

        const gameLoop = () => {
            const player = game.player
            const platforms = game.platforms

            // Horizontal movement
            if (game.keys.left) player.x -= MOVE_SPEED
            if (game.keys.right) player.x += MOVE_SPEED

            // Screen wrap
            if (player.x < -player.width) player.x = CANVAS_WIDTH
            if (player.x > CANVAS_WIDTH) player.x = -player.width

            // Apply gravity
            player.vy += GRAVITY
            player.y += player.vy

            // Platform collision (only when falling)
            if (player.vy > 0) {
                for (const platform of platforms) {
                    if (
                        player.x + player.width > platform.x &&
                        player.x < platform.x + platform.width &&
                        player.y + player.height >= platform.y &&
                        player.y + player.height <= platform.y + PLATFORM_HEIGHT + player.vy
                    ) {
                        player.y = platform.y - player.height
                        player.vy = JUMP_VELOCITY
                        break
                    }
                }
            }

            // Scroll world when player goes above middle
            if (player.y < CANVAS_HEIGHT / 2) {
                const scrollAmount = CANVAS_HEIGHT / 2 - player.y
                player.y = CANVAS_HEIGHT / 2
                game.maxY += scrollAmount

                // Move all platforms down
                for (const platform of platforms) {
                    platform.y += scrollAmount
                }

                // Remove platforms below screen and add new ones above
                game.platforms = platforms.filter(p => p.y < CANVAS_HEIGHT + 50)

                while (game.platforms.length < PLATFORM_COUNT) {
                    const topPlatform = game.platforms.reduce((min, p) => p.y < min.y ? p : min, game.platforms[0])
                    game.platforms.push({
                        x: Math.random() * (CANVAS_WIDTH - PLATFORM_WIDTH),
                        y: topPlatform.y - (CANVAS_HEIGHT / PLATFORM_COUNT),
                        width: PLATFORM_WIDTH
                    })
                }

                // Update score
                const newScore = Math.floor(game.maxY / 10)
                setScore(newScore)
            }

            // Game over - fell off screen
            if (player.y > CANVAS_HEIGHT) {
                const finalScore = Math.floor(game.maxY / 10)
                if (finalScore > highScore) {
                    setHighScore(finalScore)
                    localStorage.setItem('somniaJumpHighScore', finalScore.toString())
                }
                // Сохраняем результат в лидерборд
                saveToLeaderboard(finalScore)
                setGameState('gameover')
                return
            }

            // ===== RENDER =====
            // Background
            ctx.fillStyle = '#0a0a1a'
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

            // Stars
            ctx.fillStyle = 'rgba(255,255,255,0.5)'
            for (let i = 0; i < 30; i++) {
                const sx = (i * 47 + game.maxY * 0.02) % CANVAS_WIDTH
                const sy = (i * 89) % CANVAS_HEIGHT
                ctx.fillRect(sx, sy, 2, 2)
            }

            // Platforms
            for (const platform of game.platforms) {
                const gradient = ctx.createLinearGradient(platform.x, platform.y, platform.x, platform.y + PLATFORM_HEIGHT)
                gradient.addColorStop(0, '#7B3FF2')
                gradient.addColorStop(1, '#5B2FC2')
                ctx.fillStyle = gradient
                ctx.beginPath()
                ctx.roundRect(platform.x, platform.y, platform.width, PLATFORM_HEIGHT, 5)
                ctx.fill()
            }

            // Player
            const px = player.x + player.width / 2
            const py = player.y + player.height / 2

            // Body
            const bodyGrad = ctx.createRadialGradient(px, py, 0, px, py, player.width / 2)
            bodyGrad.addColorStop(0, '#A855F7')
            bodyGrad.addColorStop(1, '#7B3FF2')
            ctx.fillStyle = bodyGrad
            ctx.beginPath()
            ctx.arc(px, py, player.width / 2, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 2
            ctx.stroke()

            // Eyes
            ctx.fillStyle = '#fff'
            ctx.beginPath()
            ctx.arc(px - 8, py - 5, 6, 0, Math.PI * 2)
            ctx.arc(px + 8, py - 5, 6, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#000'
            ctx.beginPath()
            ctx.arc(px - 8, py - 5, 3, 0, Math.PI * 2)
            ctx.arc(px + 8, py - 5, 3, 0, Math.PI * 2)
            ctx.fill()

            // Mouth
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(px, py + 3, 8, 0.1 * Math.PI, 0.9 * Math.PI)
            ctx.stroke()

            game.animationId = requestAnimationFrame(gameLoop)
        }

        game.animationId = requestAnimationFrame(gameLoop)

        return () => cancelAnimationFrame(game.animationId)
    }, [gameState, highScore, saveToLeaderboard])

    // Keyboard controls
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') gameRef.current.keys.left = true
            if (e.key === 'ArrowRight' || e.key === 'd') gameRef.current.keys.right = true
            if (e.key === ' ' && gameState === 'gameover') startGame()
        }
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') gameRef.current.keys.left = false
            if (e.key === 'ArrowRight' || e.key === 'd') gameRef.current.keys.right = false
        }

        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
        }
    }, [gameState, startGame])

    // Touch controls
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const onTouchStart = (e: TouchEvent) => {
            const touch = e.touches[0]
            const rect = canvas.getBoundingClientRect()
            const x = touch.clientX - rect.left
            if (x < CANVAS_WIDTH / 2) {
                gameRef.current.keys.left = true
            } else {
                gameRef.current.keys.right = true
            }
        }
        const onTouchEnd = () => {
            gameRef.current.keys.left = false
            gameRef.current.keys.right = false
        }

        canvas.addEventListener('touchstart', onTouchStart)
        canvas.addEventListener('touchend', onTouchEnd)
        return () => {
            canvas.removeEventListener('touchstart', onTouchStart)
            canvas.removeEventListener('touchend', onTouchEnd)
        }
    }, [])

    return (
        <div className="game-container">
            <div className="game-header">
                <Link href="/" className="back-button">← Back</Link>
                <h1 className="game-title">Somnia <span className="gradient-text">Jump</span></h1>
                <div className="score-display">
                    <div className="score-item">
                        <span className="score-label">Score</span>
                        <span className="score-value">{score}</span>
                    </div>
                    <div className="score-item">
                        <span className="score-label">Best</span>
                        <span className="score-value">{highScore}</span>
                    </div>
                </div>
            </div>

            <div className="canvas-wrapper">
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    className="game-canvas"
                />

                {gameState === 'start' && (
                    <div className="game-overlay">
                        <div className="overlay-content">
                            <h2 className="overlay-title">Somnia Jump</h2>
                            <p className="overlay-description">Jump to the top!</p>
                            <div className="controls-info">
                                <p>🎮 ← → or A/D to move</p>
                                <p>📱 Touch left/right on mobile</p>
                            </div>
                            <button className="game-button" onClick={startGame}>Start Game</button>
                        </div>
                    </div>
                )}

                {gameState === 'gameover' && (
                    <div className="game-overlay">
                        <div className="overlay-content">
                            <h2 className="overlay-title">Game Over!</h2>
                            <div className="final-score">
                                <p className="score-label">Score</p>
                                <p className="score-value-large">{score}</p>
                            </div>
                            {score >= highScore && score > 0 && <p className="new-record">🎉 New Record!</p>}
                            {savingToLeaderboard && <p className="hint">💾 Saving to leaderboard...</p>}
                            {!address && score > 0 && <p className="hint">🔗 Connect wallet to save to leaderboard</p>}
                            <button className="game-button" onClick={startGame}>Play Again</button>
                            <p className="hint">Press SPACE to restart</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="game-footer">
                <p>Built with ❤️ on Somnia Network</p>
            </div>
        </div>
    )
}
