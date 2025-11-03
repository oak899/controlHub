import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [timeRange, setTimeRange] = useState('1h')
  const [exactTime, setExactTime] = useState('')
  const [useExactTime, setUseExactTime] = useState(false)
  const [contentFilter, setContentFilter] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [formatJson, setFormatJson] = useState(false)
  const [database, setDatabase] = useState('clickhouse')
  const [selectedMenu, setSelectedMenu] = useState('events')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const eventsContainerRef = useRef(null)

  const fetchEvents = async (append = false, currentOffset = 0) => {
    console.log('[Frontend] Fetching events...', { database, timeRange, exactTime, useExactTime, contentFilter, topicFilter, offset: currentOffset, append })
    
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setOffset(0)
      setHasMore(true)
    }
    setError(null)
    const startTime = Date.now()
    
    try {
      const params = {
        limit: 100,
        offset: currentOffset,
      }
      
      // Use exact time if enabled and provided, otherwise use timeRange
      if (useExactTime && exactTime) {
        params.exactTime = exactTime
      } else {
        params.timeRange = timeRange
      }
      
      if (contentFilter.trim()) {
        params.content = contentFilter.trim()
      }
      if (topicFilter.trim()) {
        params.topic = topicFilter.trim()
      }
      if (database) {
        params.database = database
      }

      console.log('[Frontend] API request params:', params)
      const response = await axios.get(`${API_BASE_URL}/events`, { 
        params,
        timeout: 30000, // 30 second timeout
        validateStatus: function (status) {
          return status < 500; // Resolve only if the status code is less than 500
        }
      })
      const duration = Date.now() - startTime
      const newEvents = response.data.events || []
      console.log(`[Frontend] Received ${newEvents.length} events in ${duration}ms`)
      
      if (append) {
        setEvents(prev => [...prev, ...newEvents])
      } else {
        setEvents(newEvents)
      }
      
      // Check if we have more data
      if (newEvents.length < 100) {
        setHasMore(false)
      } else {
        setHasMore(true)
        setOffset(currentOffset + newEvents.length)
      }
    } catch (err) {
      const duration = Date.now() - startTime
      console.error('[Frontend] Failed to fetch events:', err)
      console.error('[Frontend] Error details:', err.response?.data || err.message)
      setError(err.response?.data?.error || err.message || 'Failed to fetch data')
      if (!append) {
        setEvents([])
      }
    } finally {
      if (append) {
        setLoadingMore(false)
      } else {
        setLoading(false)
      }
    }
  }

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      setLoadingMore(true)
      const currentOffset = offset
      // Use the offset state directly
      const params = {
        limit: 100,
        offset: currentOffset,
      }
      
      // Use exact time if enabled and provided, otherwise use timeRange
      if (useExactTime && exactTime) {
        params.exactTime = exactTime
      } else {
        params.timeRange = timeRange
      }
      
      if (contentFilter.trim()) {
        params.content = contentFilter.trim()
      }
      if (topicFilter.trim()) {
        params.topic = topicFilter.trim()
      }
      if (database) {
        params.database = database
      }

      axios.get(`${API_BASE_URL}/events`, { 
        params,
        timeout: 30000,
        validateStatus: function (status) {
          return status < 500
        }
      }).then(response => {
        const newEvents = response.data.events || []
        setEvents(prev => [...prev, ...newEvents])
        if (newEvents.length < 100) {
          setHasMore(false)
        } else {
          setHasMore(true)
          setOffset(currentOffset + newEvents.length)
        }
        setLoadingMore(false)
      }).catch(err => {
        console.error('[Frontend] Failed to load more events:', err)
        setLoadingMore(false)
      })
    }
  }, [loadingMore, hasMore, loading, offset, timeRange, exactTime, useExactTime, contentFilter, topicFilter, database])

  // Handle scroll for infinite loading
  useEffect(() => {
    const container = eventsContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollElement = container.querySelector('.events-table-wrapper')
      if (!scrollElement) return

      const { scrollTop, scrollHeight, clientHeight } = scrollElement
      // Load more when within 100px of bottom
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMore()
      }
    }

    const scrollElement = container.querySelector('.events-table-wrapper')
    if (scrollElement) {
      scrollElement.addEventListener('scroll', handleScroll)
      return () => scrollElement.removeEventListener('scroll', handleScroll)
    }
  }, [loadMore])

  useEffect(() => {
    console.log('[Frontend] Component mounted or dependencies changed')
    // Check backend health first
    const checkHealth = async () => {
      try {
        const healthResponse = await axios.get('/api/health', { timeout: 5000 })
        console.log('[Frontend] Backend health check:', healthResponse.data)
        fetchEvents(false, 0)
      } catch (err) {
        console.error('[Frontend] Backend health check failed:', err.message)
        setError(`Cannot connect to backend server. Please ensure the backend is running on port 7890. Error: ${err.message}`)
        setLoading(false)
      }
    }
    checkHealth()
  }, [timeRange, database, topicFilter, contentFilter, useExactTime, exactTime])
  
  useEffect(() => {
    console.log('[Frontend] Component mounted')
    return () => {
      console.log('[Frontend] Component unmounting')
    }
  }, [])


  const formatStructured = (structured) => {
    if (!structured) return '-'
    if (!formatJson) return structured
    
    try {
      const parsed = JSON.parse(structured)
      return JSON.stringify(parsed, null, 2)
    } catch (e) {
      return structured
    }
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
          <h1 className="banner-title">SN7001</h1>
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
              <label>
                <input
                  type="checkbox"
                  checked={useExactTime}
                  onChange={(e) => {
                    setUseExactTime(e.target.checked)
                    if (e.target.checked && !exactTime) {
                      // Set default to current time
                      const now = new Date()
                      now.setSeconds(0, 0) // Round to nearest minute
                      setExactTime(now.toISOString().slice(0, 16))
                    }
                  }}
                />
                Exact Time
              </label>
            </div>

            {useExactTime ? (
              <div className="filter-group">
                <label>Time:</label>
                <input
                  type="datetime-local"
                  value={exactTime}
                  onChange={(e) => {
                    console.log('[Frontend] Exact time changed to:', e.target.value)
                    setExactTime(e.target.value)
                  }}
                  className="filter-input"
                  step="1"
                />
              </div>
            ) : (
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
            )}

            <div className="filter-group">
              <label>Content Filter:</label>
              <input
                type="text"
                value={contentFilter}
                onChange={(e) => setContentFilter(e.target.value)}
                placeholder="Search structured field content..."
                className="filter-input"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    fetchEvents(false, 0)
                  }
                }}
              />
            </div>

            <div className="filter-group">
              <label>Topic Filter:</label>
              <input
                type="text"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder="Filter by topic..."
                className="filter-input"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    fetchEvents(false, 0)
                  }
                }}
              />
            </div>

            <div className="filter-group">
              <label>
                <input
                  type="checkbox"
                  checked={formatJson}
                  onChange={(e) => setFormatJson(e.target.checked)}
                />
                Format JSON
              </label>
            </div>

            <button onClick={() => fetchEvents(false, 0)} className="refresh-button" disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <div className="filter-info">
              <small>Filters auto-apply or click Refresh to reload</small>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Events Table */}
          <div className="events-container" ref={eventsContainerRef}>
            {loading ? (
              <div className="loading">Loading...</div>
            ) : events.length === 0 ? (
              <div className="empty-state">No events found</div>
            ) : (
              <div className="events-table-wrapper">
                <table className="events-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Tool</th>
                      <th>Topic</th>
                      <th>Structured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event, index) => (
                      <tr key={`${event.timestamp}-${index}`}>
                        <td className="td-timestamp">{formatTimestamp(event.timestamp)}</td>
                        <td className="td-tool" title={event.tool || ''}>
                          {event.tool ? (event.tool.length > 8 ? event.tool.substring(0, 8) + '...' : event.tool) : '-'}
                        </td>
                        <td className="td-topic" title={event.topic || ''}>
                          {event.topic || '-'}
                        </td>
                        <td className="td-structured">
                          <div className={`structured-content ${formatJson ? 'json-formatted' : ''}`}>
                            {formatStructured(event.structured)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {loadingMore && (
                  <div className="loading-more">
                    Loading more events...
                  </div>
                )}
                {!hasMore && events.length > 0 && (
                  <div className="no-more-data">
                    No more events to load
                  </div>
                )}
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

