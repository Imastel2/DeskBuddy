import { useEffect, useState } from 'react'
import './App.css'
import SpotifyPanel from './SpotifyPanel.jsx'
import CalendarPanel from './CalendarPanel.jsx'
import TasksPanel from './TasksPanel.jsx'
import FootballTicker from './FootballTicker.jsx'

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
        <h1>Good Morning, Isaac</h1>

        <div className="header-weather" aria-label="Current weather">
          {weather ? (
            <>
              <span>{Math.round(weather.current.temperature_2m)}°</span>
              <span>{condition.label}</span>
            </>
          ) : (
            <span className="weather-message">
              {weatherError ? 'Weather unavailable' : 'Loading weather…'}
            </span>
          )}
        </div>
      </header>

      <main className="panels">
        <CalendarPanel />
        <TasksPanel />
        <SpotifyPanel />
      </main>

      <footer className="dashboard-footer">
        <FootballTicker />
        <div className="clock">
          <time dateTime={now.toISOString()}>{time}</time>
          <span>
            {now.toLocaleDateString('en-US', {
              month: '2-digit',
              day: '2-digit',
              year: '2-digit',
            })}
          </span>
        </div>
      </footer>
    </div>
  )
}

export default App