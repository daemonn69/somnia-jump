'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import './game.css'

interface Platform {
    x: number
    y: number
    width: number
}

export default function SomniaJumpGame() {
    const { address, isConnected } = useAccount()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [gameState, setGameState] = useState<'start' | 'playing' | 'paused' | 'gameover'>('start')
    const [score, setScore] = useState(0)
    const [highScore, setHighScore] = useState(0)
    const [savingToLeaderboard, setSavingToLeaderboard] = useState(false)
    const [leaderboard, setLeaderboard] = useState<{ address: string; score: number }[]>([])
    const [showLeaderboard, setShowLeaderboard] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)

    // Game refs
    const gameRef = useRef({
        player: { x: 0, y: 0, vy: 0, width: 80, height: 80 },
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
        fetchLeaderboard()
    }, [])

    const fetchLeaderboard = async () => {
        try {
            const res = await fetch('/api/leaderboard')
            const data = await res.json()
            setLeaderboard(data.leaderboard || [])
        } catch (error) {
            console.error('Failed to fetch leaderboard:', error)
        }
    }

    const saveToLeaderboard = useCallback(async (finalScore: number) => {
        if (!address || finalScore === 0) return

        setSavingToLeaderboard(true)
        setSaveSuccess(false)
        try {
            const response = await fetch('/api/leaderboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, score: finalScore })
            })

            const data = await response.json()
            if (data.success) {
                console.log('New high score saved to leaderboard!')
                setSaveSuccess(true)
                fetchLeaderboard()
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
            x: CANVAS_WIDTH / 2 - 40,
            y: CANVAS_HEIGHT - 100,
            vy: JUMP_VELOCITY,
            width: 80,
            height: 80
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
        setShowLeaderboard(false)
        setSaveSuccess(false)
    }, [generatePlatforms])

    const togglePause = useCallback(() => {
        setGameState(prev => prev === 'playing' ? 'paused' : prev === 'paused' ? 'playing' : prev)
    }, [])

    const goToMenu = useCallback(() => {
        cancelAnimationFrame(gameRef.current.animationId)
        setGameState('start')
        setScore(0)
    }, [])

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

            // Player - Cypher Character
            const px = player.x + player.width / 2
            const py = player.y + player.height / 2
            // Original SVG key points are based on 100x100 grid. Player is 40x40.
            // Scale factor: 40 / 100 = 0.4
            const s = player.width / 100

            ctx.save()
            ctx.translate(px, py)
            ctx.scale(s, s)
            // Center the local coordinate system (50,50 becomes 0,0)
            ctx.translate(-50, -50)

            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)'
            ctx.beginPath()
            ctx.ellipse(50, 90, 30, 5, 0, 0, Math.PI * 2)
            ctx.fill()

            // Body Gradient
            const bodyGrad = ctx.createLinearGradient(0, 0, 100, 100)
            bodyGrad.addColorStop(0, '#8b5cf6')
            bodyGrad.addColorStop(1, '#3b82f6')

            // Body Shape (Matches SVG path: M30 30 Q30 15 50 15 Q70 15 70 30 L75 70 Q75 85 50 85 Q25 85 25 70 Z)
            ctx.fillStyle = bodyGrad
            ctx.beginPath()
            ctx.moveTo(30, 30)
            ctx.quadraticCurveTo(30, 15, 50, 15)
            ctx.quadraticCurveTo(70, 15, 70, 30)
            ctx.lineTo(75, 70)
            ctx.quadraticCurveTo(75, 85, 50, 85)
            ctx.quadraticCurveTo(25, 85, 25, 70)
            ctx.closePath()
            ctx.fill()

            // Eye Visor (rect x="35" y="35" width="30" height="12" rx="6")
            ctx.fillStyle = '#1e1b4b'
            ctx.beginPath()
            ctx.roundRect(35, 35, 30, 12, 6)
            ctx.fill()

            // Textures/Glow for eyes
            const time = Date.now()
            const eyeOpacity = 0.5 + 0.5 * Math.sin(time / 200) // Blinking effect

            // Glowing Eyes (cx="42" cy="41", cx="58" cy="41")
            ctx.fillStyle = `rgba(96, 165, 250, ${0.4 + 0.6 * eyeOpacity})` // #60a5fa
            ctx.shadowColor = '#60a5fa'
            ctx.shadowBlur = 10

            ctx.beginPath()
            ctx.arc(42, 41, 3, 0, Math.PI * 2)
            ctx.fill()

            ctx.beginPath()
            ctx.arc(58, 41, 3, 0, Math.PI * 2)
            ctx.fill()

            ctx.shadowBlur = 0 // Reset shadow

            // Core Detail
            // Ring
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(50, 65, 8, 0, Math.PI * 2)
            ctx.stroke()

            // Inner Core
            ctx.fillStyle = '#a78bfa'
            ctx.shadowColor = '#a78bfa'
            ctx.shadowBlur = 5
            ctx.beginPath()
            ctx.arc(50, 65, 4, 0, Math.PI * 2)
            ctx.fill()

            ctx.restore()

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
            if (e.key === 'Escape') {
                if (gameState === 'playing' || gameState === 'paused') togglePause()
                if (gameState === 'start' && showLeaderboard) setShowLeaderboard(false)
            }
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
    }, [gameState, startGame, togglePause])

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
                <h1 className="game-title">Somnia <span className="gradient-text">Jump</span></h1>

                {gameState === 'playing' && (
                    <button className="pause-button" onClick={togglePause} title="Pause (Esc)">⏸</button>
                )}

                {gameState !== 'start' && (
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
                )}
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
                            {!showLeaderboard && (
                                <>
                                    <div className="character-preview">
                                        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="cypher-float">
                                            {/* Shadow */}
                                            <ellipse cx="50" cy="90" rx="30" ry="5" fill="rgba(0,0,0,0.3)"></ellipse>

                                            {/* Main Body */}
                                            <defs>
                                                <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                    <stop offset="0%" stopColor="#8b5cf6"></stop>
                                                    <stop offset="100%" stopColor="#3b82f6"></stop>
                                                </linearGradient>
                                                <filter id="glow">
                                                    <feGaussianBlur stdDeviation="1.5" result="coloredBlur"></feGaussianBlur>
                                                    <feMerge>
                                                        <feMergeNode in="coloredBlur"></feMergeNode>
                                                        <feMergeNode in="SourceGraphic"></feMergeNode>
                                                    </feMerge>
                                                </filter>
                                            </defs>

                                            {/* Body Shape */}
                                            <path d="M30 30 Q30 15 50 15 Q70 15 70 30 L75 70 Q75 85 50 85 Q25 85 25 70 Z" fill="url(#bodyGradient)"></path>

                                            {/* Eye Visor */}
                                            <rect x="35" y="35" width="30" height="12" rx="6" fill="#1e1b4b"></rect>

                                            {/* Glowing Eyes */}
                                            <circle cx="42" cy="41" r="3" fill="#60a5fa" filter="url(#glow)">
                                                <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"></animate>
                                            </circle>
                                            <circle cx="58" cy="41" r="3" fill="#60a5fa" filter="url(#glow)">
                                                <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"></animate>
                                            </circle>

                                            {/* Detail / Core */}
                                            <circle cx="50" cy="65" r="8" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"></circle>
                                            <circle cx="50" cy="65" r="4" fill="#a78bfa" filter="url(#glow)"></circle>
                                        </svg>
                                    </div>
                                    <h2 className="overlay-title">Somnia Jump</h2>
                                    <p className="overlay-description">Jump to the top!</p>
                                    <div className="controls-info">
                                        <p>🎮 ← → or A/D to move</p>
                                        <p>📱 Touch left/right on mobile</p>
                                    </div>
                                </>
                            )}

                            <div className="menu-buttons">
                                <button className="game-button" onClick={startGame}>Start Game</button>
                                <button className="game-button secondary" onClick={() => setShowLeaderboard(!showLeaderboard)}>
                                    {showLeaderboard ? '🏠 Back to Menu' : '🏆 Leaderboard'}
                                </button>
                            </div>

                            <div className="wallet-section" style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 50 }}>
                                {!isConnected && <p className="wallet-hint">Connect wallet to save scores</p>}
                                <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
                            </div>

                            {showLeaderboard && (
                                <div className="leaderboard">
                                    <h3 className="leaderboard-title">🏆 Top Players</h3>
                                    {leaderboard.length === 0 ? (
                                        <p className="leaderboard-empty">No scores yet. Be the first!</p>
                                    ) : (
                                        <div className="leaderboard-list">
                                            {leaderboard.map((entry, index) => (
                                                <div key={index} className={`leaderboard-entry ${address?.toLowerCase() === entry.address.toLowerCase() ? 'is-you' : ''}`}>
                                                    <span className="leaderboard-rank">
                                                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                                                    </span>
                                                    <span className="leaderboard-address">
                                                        {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
                                                    </span>
                                                    <span className="leaderboard-score">{entry.score}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {gameState === 'paused' && (
                    <div className="game-overlay">
                        <div className="overlay-content">
                            <h2 className="overlay-title">⏸ Paused</h2>
                            <p className="overlay-description">Score: {score}</p>
                            <div className="pause-buttons">
                                <button className="game-button" onClick={togglePause}>▶ Resume</button>
                                <button className="game-button secondary" onClick={goToMenu}>🏠 Main Menu</button>
                            </div>
                            <p className="hint">Press ESC to resume</p>
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
                            {saveSuccess && <p className="hint" style={{ color: '#22c55e' }}>✅ Saved to leaderboard!</p>}

                            {!isConnected && score > 0 && (
                                <div className="wallet-prompt" style={{ margin: '1rem 0' }}>
                                    <p className="hint">🔗 Connect wallet to save to leaderboard</p>
                                    <ConnectButton />
                                </div>
                            )}

                            <div className="gameover-buttons">
                                <button className="game-button" onClick={startGame}>🔄 Play Again</button>
                                <button className="game-button secondary" onClick={goToMenu}>🏠 Main Menu</button>
                            </div>
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
