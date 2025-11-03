import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

const API_BASE_URL = '/api'

const timeRanges = [
  { value: '1m', label: '1 Minute' },
  { value: '5m', label: '5 Minutes' },
  { value: '20m', label: '20 Minutes' },
  { value: '1h', label: '1 Hour' },
  { value: '5h', label: '5 Hours' },
  { value: '1d', label: '1 Day' },
  { value: '1w', label: '1 Week' },
  { value: '1mo', label: '1 Month' },
]

function App() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [timeRange, setTimeRange] = useState('1h')
  const [contentFilter, setContentFilter] = useState('')
  const [database, setDatabase] = useState('clickhouse')
  const [selectedMenu, setSelectedMenu] = useState('events')

  const fetchEvents = async () => {
    console.log('[Frontend] Fetching events...', { database, timeRange, contentFilter })
    setLoading(true)
    setError(null)
    const startTime = Date.now()
    
    try {
      const params = {
        timeRange,
        limit: 100,
        offset: 0,
      }
      if (contentFilter.trim()) {
        params.content = contentFilter.trim()
      }
      if (database) {
        params.database = database
      }

      console.log('[Frontend] API request params:', params)
      const response = await axios.get(`${API_BASE_URL}/events`, { params })
      const duration = Date.now() - startTime
      console.log(`[Frontend] Received ${response.data.events?.length || 0} events in ${duration}ms`)
      setEvents(response.data.events || [])
    } catch (err) {
      const duration = Date.now() - startTime
      console.error('[Frontend] Failed to fetch events:', err)
      console.error('[Frontend] Error details:', err.response?.data || err.message)
      setError(err.response?.data?.error || err.message || 'Failed to fetch data')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    console.log('[Frontend] Component mounted or dependencies changed')
    fetchEvents()
  }, [timeRange, database])
  
  useEffect(() => {
    console.log('[Frontend] Component mounted')
    return () => {
      console.log('[Frontend] Component unmounting')
    }
  }, [])

  const handleContentFilterSubmit = (e) => {
    e.preventDefault()
    console.log('[Frontend] Content filter submitted:', contentFilter)
    fetchEvents()
  }

  const formatTimestamp = (timestamp) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch (e) {
      return timestamp
    }
  }

  return (
    <div className="app">
      {/* Banner */}
      <header className="banner">
        <div className="banner-content">
          <h1>Control Hub</h1>
          <div className="banner-status">
            <span className={`status-indicator ${database === 'clickhouse' ? 'active' : ''}`}>
              ClickHouse
            </span>
            <span className={`status-indicator ${database === 'postgresql' ? 'active' : ''}`}>
              PostgreSQL
            </span>
          </div>
        </div>
      </header>

      <div className="main-container">
        {/* Sidebar */}
        <aside className="sidebar">
          <nav className="sidebar-nav">
            <button
              className={`nav-item ${selectedMenu === 'events' ? 'active' : ''}`}
              onClick={() => setSelectedMenu('events')}
            >
              Events
            </button>
            <div className="nav-section">
              <h3>Databases</h3>
              <button
                className={`nav-item ${database === 'clickhouse' ? 'active' : ''}`}
                onClick={() => {
                  console.log('[Frontend] Switching to ClickHouse database')
                  setDatabase('clickhouse')
                }}
              >
                ClickHouse
              </button>
              <button
                className={`nav-item ${database === 'postgresql' ? 'active' : ''}`}
                onClick={() => {
                  console.log('[Frontend] Switching to PostgreSQL database')
                  setDatabase('postgresql')
                }}
              >
                PostgreSQL
              </button>
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="content">
          {/* Filters */}
          <div className="filters">
            <div className="filter-group">
              <label>Time Range:</label>
              <select
                value={timeRange}
                onChange={(e) => {
                  console.log('[Frontend] Time range changed to:', e.target.value)
                  setTimeRange(e.target.value)
                }}
                className="filter-select"
              >
                {timeRanges.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>

            <form onSubmit={handleContentFilterSubmit} className="filter-group">
              <label>Content Filter:</label>
              <input
                type="text"
                value={contentFilter}
                onChange={(e) => setContentFilter(e.target.value)}
                placeholder="Search structured field content..."
                className="filter-input"
              />
              <button type="submit" className="filter-button">
                Search
              </button>
            </form>

            <button onClick={fetchEvents} className="refresh-button" disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Events Table */}
          <div className="events-container">
            {loading ? (
              <div className="loading">Loading...</div>
            ) : events.length === 0 ? (
              <div className="empty-state">No events found</div>
            ) : (
              <div className="events-table-wrapper">
                <table className="events-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Timestamp</th>
                      <th>Shard</th>
                      <th>Seq</th>
                      <th>Tool</th>
                      <th>Topic</th>
                      <th>Structured</th>
                      <th>Genlog</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td className="td-id">{event.id}</td>
                        <td>{formatTimestamp(event.timestamp)}</td>
                        <td>{event.shard}</td>
                        <td>{event.seq}</td>
                        <td>{event.tool}</td>
                        <td>{event.topic}</td>
                        <td className="td-structured">
                          <div className="structured-content">
                            {event.structured || '-'}
                          </div>
                        </td>
                        <td className="td-genlog">
                          <div className="genlog-content">{event.__genlog__ || '-'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Stats */}
          {events.length > 0 && (
            <div className="stats">
              Displaying {events.length} record{events.length !== 1 ? 's' : ''}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App

