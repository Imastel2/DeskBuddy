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
          <p className="card-label">WEATHER · AUSTIN</p>
          <div className="temperature">72° <span>☀</span></div>
          <h2>Sunny</h2>
          <p className="muted">A clear day ahead</p>
          <div className="weather-details">
            <span>High <strong>78°</strong></span>
            <span>Low <strong>61°</strong></span>
          </div>
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
      </main>
    </div>
  )
}

export default App