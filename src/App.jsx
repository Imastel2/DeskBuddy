import { useEffect, useState } from 'react'
import './Styles/App.css'
import MusicPanel from './Panels/MusicPanel.jsx'
import CalendarSourcesPanel from './Panels/VercelPanel.jsx'
import TaskSourcesPanel from './Panels/Canvas.jsx'
import FootballTicker from './Panels/FootballTicker.jsx'
import CalendarPanel from './Panels/CalendarPanel.jsx'
import WeatherPanel from './Panels/WeatherPanel.jsx'
import './Styles/Weather.css'
import './Styles/Chatgpt.css'

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

function App({ displayName, username, now }) {
  const showChatGPT = username === 'ben'
  const hour = now.getHours()
  const greeting = hour < 12
    ? 'Good Morning'
    : hour < 17
      ? 'Good Afternoon'
      : 'Good Evening'
  
const [weather, setWeather] = useState(null)
const [weatherError, setWeatherError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadWeather() {
      try {
        const params = new URLSearchParams({
          latitude: '40.8136',
          longitude: '-96.7026',
          timezone: 'America/Chicago',
          temperature_unit: 'fahrenheit',
          current: 'temperature_2m,weather_code,is_day',
          daily: 'temperature_2m_max,temperature_2m_min',
          forecast_days: '1',
        })

        if (showChatGPT) {
          params.set('current', [
            'temperature_2m', 'weather_code', 'is_day', 'apparent_temperature',
            'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m',
            'wind_gusts_10m', 'cloud_cover', 'pressure_msl',
          ].join(','))
          params.set('hourly', 'temperature_2m,precipitation_probability')
          params.set('daily', [
            'temperature_2m_max', 'temperature_2m_min', 'weather_code',
            'precipitation_probability_max', 'precipitation_sum', 'snowfall_sum',
            'sunrise', 'sunset', 'uv_index_max',
          ].join(','))
          params.set('forecast_days', '7')
          params.set('wind_speed_unit', 'mph')
          params.set('precipitation_unit', 'inch')
        }

        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)

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
        <h1>{greeting}, {displayName}</h1>
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
        {showChatGPT ? (
          <div className="task-sources task-sources--calendar">
            <CalendarPanel />
          </div>
        ) : (
          <CalendarSourcesPanel />
        )}

        {showChatGPT ? (
          <section className="panel chatgpt-panel">
            <button
              type="button"
              className="chatgpt-launch-button"
              onClick={() =>
              window.open(
                'https://chatgpt.com/',
                '_blank',
                'popup,noopener,width=760,height=390,left=20,top=10',
              )              
            }
            >
              <img src="/Logos/chatgpt.png" alt="Open ChatGPT" />            </button>
          </section>
        ) : (
          <TaskSourcesPanel />
        )}

        {showChatGPT ? (
          <WeatherPanel
            weather={weather}
            weatherError={weatherError}
            getCondition={getCondition}
          />
        ) : (
          <MusicPanel />
        )}
      </main>

      <footer className="dashboard-footer">
        <FootballTicker />
      </footer>
    </div>
  )
}

export default App