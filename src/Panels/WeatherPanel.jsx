const weekday = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: 'UTC',
})

function reading(value, unit = '', decimals = 0) {
  return Number.isFinite(value) ? `${value.toFixed(decimals)}${unit}` : '—'
}

// Open-Meteo supplies these timestamps in the forecast location's local time.
function localTime(timestamp) {
  if (!timestamp) return '—'

  const [hours, minutes] = timestamp.slice(11, 16).split(':')
  const hour = Number(hours)
  return `${hour % 12 || 12}:${minutes} ${hour < 12 ? 'AM' : 'PM'}`
}

export default function WeatherPanel({ weather, weatherError, getCondition }) {
  const { current, hourly, daily } = weather ?? {}

  const nextHours = hourly?.time
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => time > current?.time)
    .slice(0, 4) ?? []

  const details = current && daily ? [
    ['Humidity', reading(current.relative_humidity_2m, '%')],
    ['Dew point', reading(current.dew_point_2m, '°')],
    ['Wind', reading(current.wind_speed_10m, ' mph')],
    ['Wind gusts', reading(current.wind_gusts_10m, ' mph')],
    ['Cloud cover', reading(current.cloud_cover, '%')],
    ['Pressure', reading(current.pressure_msl, ' hPa')],
    ['Peak UV today', reading(daily.uv_index_max[0], '', 1)],
    ['Precip. today', reading(daily.precipitation_sum[0], ' in', 2)],
    ['Snow today', reading(daily.snowfall_sum[0], ' in', 1)],
    ['Peak precip. chance', reading(daily.precipitation_probability_max[0], '%')],
    ['Sunrise', localTime(daily.sunrise[0])],
    ['Sunset', localTime(daily.sunset[0])],
  ] : []

  return (
    <section className="panel weather-panel" aria-label="Lincoln weather" tabIndex={0}>
      <h2>
        <img
          src="/Logos/accuweather.png"
          alt="AccuWeather"
          className="weather-panel-logo"
        />
      </h2>

      {current && daily ? (
        <>
          <div className="weather-panel-current">
            <strong>{reading(current.temperature_2m, '°F')}</strong>
            <div>
              <strong>{getCondition(current.weather_code, current.is_day).label}</strong>
              <div>Feels like {reading(current.apparent_temperature, '°')}</div>
              <div>H {reading(daily.temperature_2m_max[0], '°')} · L {reading(daily.temperature_2m_min[0], '°')}</div>
            </div>
          </div>

        <h3>Weather details</h3>
          <dl className="weather-panel-details">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>


          <h3>Next 4 hours</h3>
          <ul className="weather-panel-list">
            {nextHours.map(({ time, index }) => (
              <li key={time}>
                <span>{localTime(time)}</span>
                <span>{reading(hourly.temperature_2m[index], '°')}</span>
                <span>{reading(hourly.precipitation_probability[index], '%')} precip.</span>
              </li>
            ))}
          </ul>

          <h3>7-day forecast</h3>
          <ul className="weather-panel-list">
            {daily.time.map((date, index) => (
              <li key={date}>
                <span>{index === 0 ? 'Today' : weekday.format(new Date(date))}</span>
                <span>{getCondition(daily.weather_code[index], true).label}</span>
                <span>{reading(daily.temperature_2m_max[index], '°')} / {reading(daily.temperature_2m_min[index], '°')}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status">{weatherError ? 'Weather unavailable' : 'Loading weather…'}</p>
      )}
    </section>
  )
}