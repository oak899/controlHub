import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

const API_BASE_URL = '/api'

const timeRanges = [
  { value: '1m', label: '1分钟' },
  { value: '5m', label: '5分钟' },
  { value: '20m', label: '20分钟' },
  { value: '1h', label: '1小时' },
  { value: '5h', label: '5小时' },
  { value: '1d', label: '1天' },
  { value: '1w', label: '1周' },
  { value: '1mo', label: '1个月' },
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
    setLoading(true)
    setError(null)
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

      const response = await axios.get(`${API_BASE_URL}/events`, { params })
      setEvents(response.data.events || [])
    } catch (err) {
      setError(err.response?.data?.error || err.message || '获取数据失败')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEvents()
  }, [timeRange, database])

  const handleContentFilterSubmit = (e) => {
    e.preventDefault()
    fetchEvents()
  }

  const formatTimestamp = (timestamp) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleString('zh-CN', {
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
              <h3>数据库</h3>
              <button
                className={`nav-item ${database === 'clickhouse' ? 'active' : ''}`}
                onClick={() => setDatabase('clickhouse')}
              >
                ClickHouse
              </button>
              <button
                className={`nav-item ${database === 'postgresql' ? 'active' : ''}`}
                onClick={() => setDatabase('postgresql')}
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
              <label>时间范围:</label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
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
              <label>内容过滤:</label>
              <input
                type="text"
                value={contentFilter}
                onChange={(e) => setContentFilter(e.target.value)}
                placeholder="搜索 structured 字段内容..."
                className="filter-input"
              />
              <button type="submit" className="filter-button">
                搜索
              </button>
            </form>

            <button onClick={fetchEvents} className="refresh-button" disabled={loading}>
              {loading ? '加载中...' : '刷新'}
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="error-message">
              <strong>错误:</strong> {error}
            </div>
          )}

          {/* Events Table */}
          <div className="events-container">
            {loading ? (
              <div className="loading">加载中...</div>
            ) : events.length === 0 ? (
              <div className="empty-state">没有找到事件数据</div>
            ) : (
              <div className="events-table-wrapper">
                <table className="events-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>时间戳</th>
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
              显示 {events.length} 条记录
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App

