import { useEffect, useState } from 'react'
import './App.css'
import { Shuffle, SkipBack, Play, SkipForward, Repeat2 } from 'lucide-react'

const events = [
  { time: '9:00 AM', title: 'Morning Class' },
  { time: '2:30 PM', title: 'Study session' },
]

const games = [
  { teams: ' Texas vs Oklahoma', detail: 'Saturday 2:30 PM'},
  { teams: ' Ohio State vs Michigan', detail: 'Saturday 11:00 AM' },
]

const pastGames = [
  { teams: 'Texas vs Rice', detail: 'Final · 35–10' },
  { teams: 'Ohio State vs Penn State', detail: 'Final · 24–17' },
]

function getCondition(code, isDay) {
  if (code === 0) return { label: 'Clear', icon: isDay ? '☀' : '☾' }
  if (code <= 3) return { label: 'Cloudy', icon: '☁' }
  if (code <= 48) return { label: 'Foggy', icon: '🌫' }
  if (code <= 57) return { label: 'Drizzle', icon: '🌧' }
  if (code <= 67) return { label: 'Rainy', icon: '🌧' }
  if (code <= 77) return { label: 'Snowy', icon: '❄' }
  if (code <= 82) return { label: 'Showers', icon: '🌦' }
  if (code <= 86) return { label: 'Snow showers', icon: '❄' }
  return { label: 'Thunderstorms', icon: '⛈' }
}

function App() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const time = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

  const date = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

const [weather, setWeather] = useState(null)
const [weatherError, setWeatherError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadWeather() {
      try {
        const WEATHER_URL =
          'https://api.open-meteo.com/v1/forecast?latitude=40.8136&longitude=-96.7026&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1'
          const response = await fetch(WEATHER_URL)

        if (!response.ok) throw new Error(`Weather API returned ${response.status}`)

        const data = await response.json()

        if (!cancelled) {
          setWeather(data)
          setWeatherError(false)
        }
        
        } catch (error) {
          console.error('Weather request failed:', error)

        if (!cancelled) {
          setWeather(null)
          setWeatherError(true)
        }
      }
    }

    loadWeather()
    const timer = setInterval(loadWeather, 15 * 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const condition = weather
  ? getCondition(weather.current.weather_code, weather.current.is_day)
  : null

 return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Good Morning, Isaac</h1>
          <p className="header-subtitle">DeskBuddy</p>
        </div>
        <div className="clock">
          <strong>{time}</strong>
          <span>{date}</span>
        </div>
      </header>

      <main className="panels">
        <section className="card weather-card">
          <p className="card-label">WEATHER · LINCOLN</p>

          {weather ? (
            <>
              <div className="temperature">
                {Math.round(weather.current.temperature_2m)}°
                <span> {condition.icon}</span>
              </div>
              <h2>{condition.label}</h2>
              <p className="muted">Current conditions</p>
              <div className="weather-details">
                <span>
                  High <strong>{Math.round(weather.daily.temperature_2m_max[0])}°</strong>
                </span>
                <span>
                  Low <strong>{Math.round(weather.daily.temperature_2m_min[0])}°</strong>
                </span>
              </div>
            </>
          ) : (
            <p className="muted">
              {weatherError ? 'Weather unavailable. Check internet.' : 'Loading weather…'}
            </p>
          )}
        </section>

        <section className="card">
          <p className="card-label">TODAY'S CALENDAR</p>
          <h2>Coming up</h2>
          <div className="event-list">
            {events.map((event) => (
              <div className="event" key={event.title}>
                <span>{event.time}</span>
                <strong>{event.title}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="card music-card">
          <p className="card-label">SPOTIFY</p>

          <img
            className="music-cover"
            src="/album-cover.jpg"
            alt="Current album cover"
          />

          <div className="music-controls">
            <button type="button" aria-label="Shuffle">
              <Shuffle size={17} />
            </button>
            <button type="button" aria-label="Previous song">
              <SkipBack size={19} fill="currentColor" />
            </button>
            <button type="button" className="play-button" aria-label="Play">
              <Play size={20} fill="currentColor" />
            </button>
            <button type="button" aria-label="Next song">
              <SkipForward size={19} fill="currentColor" />
            </button>
            <button type="button" aria-label="Repeat">
              <Repeat2 size={17} />
            </button>
          </div>

          <div className="music-timeline">
            <span>0:03</span>
            <div className="music-progress">
              <div className="music-progress-fill" />
            </div>
            <span>4:48</span>
          </div>
        </section>
          <section className="card football-card">
            <p className="card-label">COLLEGE FOOTBALL</p>

            <div className="football-sections">
              <div className="football-section">
                <h2>Upcoming games</h2>
                <div className="football-list">
                  {games.map((game) => (
                    <div className="game" key={game.teams}>
                      <strong>{game.teams}</strong>
                      <span>{game.detail}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="football-section">
                <h2>Past games</h2>
                <div className="football-list">
                  {pastGames.map((game) => (
                    <div className="game" key={game.teams}>
                      <strong>{game.teams}</strong>
                      <span>{game.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
      </main>
    </div>
  )
}

export default App