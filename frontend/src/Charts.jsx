import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
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

function Charts() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [timeRange, setTimeRange] = useState('1h')
  const [topicFilter, setTopicFilter] = useState('')
  const [database, setDatabase] = useState('clickhouse')
  const [events, setEvents] = useState([])
  const [availableFields, setAvailableFields] = useState([])
  const [selectedFields, setSelectedFields] = useState([])
  const [chartData, setChartData] = useState([])
  const [fieldSearch, setFieldSearch] = useState('')
  const [fieldSelectorHeight, setFieldSelectorHeight] = useState(200) // Default height in pixels
  const isResizing = useRef(false)
  const fieldSelectorRef = useRef(null)

  const fetchEvents = async () => {
    if (!topicFilter.trim()) {
      setError('Please enter a topic filter')
      return
    }

    setLoading(true)
    setError(null)
    console.log('[Charts] Fetching events for charting...', { database, timeRange, topicFilter })

    try {
      const params = {
        timeRange,
        topic: topicFilter.trim(),
        database,
        limit: 1000, // Get more data for charts
        offset: 0,
      }

      const response = await axios.get(`${API_BASE_URL}/events`, {
        params,
        timeout: 30000,
      })

      const fetchedEvents = response.data.events || []
      console.log(`[Charts] Received ${fetchedEvents.length} events`)
      setEvents(fetchedEvents)

      // Extract available fields from structured JSON
      extractFields(fetchedEvents)
    } catch (err) {
      console.error('[Charts] Failed to fetch events:', err)
      setError(err.response?.data?.error || err.message || 'Failed to fetch data')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const loadFromURL = () => {
      const params = new URLSearchParams(window.location.search)
      const urlTimeRange = params.get('timeRange')
      const urlExactTime = params.get('exactTime')
      const urlUseExactTime = params.get('useExactTime') === 'true'
      const urlTopic = params.get('topic')
      const urlDatabase = params.get('database')
      
      if (urlTimeRange) setTimeRange(urlTimeRange)
      if (urlTopic) {
        setTopicFilter(urlTopic)
      }
      if (urlDatabase) setDatabase(urlDatabase)
    }

    loadFromURL()
    
    // Listen for URL changes (e.g., when navigating from Events page)
    const handlePopState = () => {
      loadFromURL()
    }
    
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    // Auto-load data if topic filter is set from URL
    const params = new URLSearchParams(window.location.search)
    const urlTopic = params.get('topic')
    if (urlTopic && topicFilter === urlTopic && topicFilter.trim()) {
      // Small delay to ensure state is set
      const timer = setTimeout(() => {
        fetchEvents()
      }, 200)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicFilter])
  
  useEffect(() => {
    if (events.length > 0 && selectedFields.length === 0 && availableFields.length > 0) {
      setSelectedFields([availableFields[0]])
    }
  }, [events, availableFields, selectedFields.length])

  // Recursively extract all numeric fields from nested JSON
  const extractNestedFields = (obj, prefix = '', fieldSet = new Set()) => {
    if (obj === null || obj === undefined) return fieldSet
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        extractNestedFields(item, `${prefix}[${index}]`, fieldSet)
      })
    } else if (typeof obj === 'object') {
      Object.keys(obj).forEach(key => {
        const value = obj[key]
        const fieldPath = prefix ? `${prefix}.${key}` : key
        
        if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)) && value.trim() !== '')) {
          // Check if it's a valid number
          const numValue = typeof value === 'number' ? value : parseFloat(value)
          if (!isNaN(numValue) && isFinite(numValue)) {
            fieldSet.add(fieldPath)
          }
        } else if (typeof value === 'object' && value !== null) {
          // Recursively process nested objects
          extractNestedFields(value, fieldPath, fieldSet)
        }
      })
    }
    
    return fieldSet
  }

  const extractFields = (events) => {
    const fieldSet = new Set()
    
    events.forEach((event) => {
      if (event.structured) {
        try {
          const parsed = JSON.parse(event.structured)
          extractNestedFields(parsed, '', fieldSet)
        } catch (e) {
          // Not valid JSON, skip
        }
      }
    })

    const fields = Array.from(fieldSet).sort()
    console.log('[Charts] Available numeric fields (including nested):', fields)
    setAvailableFields(fields)
    
    // Auto-select first field if none selected
    if (fields.length > 0 && selectedFields.length === 0) {
      setSelectedFields([fields[0]])
    }
  }

  useEffect(() => {
    if (events.length > 0 && selectedFields.length > 0) {
      prepareChartData()
    } else {
      setChartData([])
    }
  }, [events, selectedFields])

  const prepareChartData = () => {
    const dataMap = new Map()

    events.forEach((event) => {
      if (event.structured) {
        try {
          const parsed = JSON.parse(event.structured)
          const timestamp = new Date(event.timestamp).getTime()
          
          const dataPoint = {
            timestamp,
            time: new Date(event.timestamp).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          }

          selectedFields.forEach((field) => {
            // Get nested value using field path (e.g., "user.score" or "data[0].value")
            const value = getNestedValue(parsed, field)
            if (value !== undefined && value !== null) {
              const numValue = typeof value === 'number' ? value : parseFloat(value)
              if (!isNaN(numValue) && isFinite(numValue)) {
                dataPoint[field] = numValue
              }
            }
          })

          // Group by timestamp (in case multiple events at same time)
          if (dataMap.has(timestamp)) {
            const existing = dataMap.get(timestamp)
            selectedFields.forEach((field) => {
              if (dataPoint[field] !== undefined) {
                existing[field] = (existing[field] || 0) + dataPoint[field]
              }
            })
          } else {
            dataMap.set(timestamp, dataPoint)
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    })

    const chartDataArray = Array.from(dataMap.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(item => {
        const { timestamp, ...rest } = item
        return rest
      })

    console.log('[Charts] Prepared chart data:', chartDataArray.length, 'data points')
    setChartData(chartDataArray)
  }

  // Get nested value from object using dot notation or array notation
  const getNestedValue = (obj, path) => {
    if (!obj || !path) return undefined
    
    // Handle array notation like "data[0].value"
    const parts = path.split(/[\.\[\]]/).filter(p => p !== '')
    
    let current = obj
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (Array.isArray(current)) {
        const index = parseInt(part, 10)
        if (isNaN(index)) return undefined
        current = current[index]
      } else if (typeof current === 'object') {
        current = current[part]
      } else {
        return undefined
      }
    }
    
    return current
  }

  const handleFieldToggle = (field) => {
    setSelectedFields(prev => {
      if (prev.includes(field)) {
        return prev.filter(f => f !== field)
      } else {
        return [...prev, field]
      }
    })
  }

  // Filter fields based on search
  const filteredFields = availableFields.filter(field =>
    field.toLowerCase().includes(fieldSearch.toLowerCase())
  )

  // Handle resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing.current) return
      
      const container = fieldSelectorRef.current?.closest('.charts-content-container')
      if (!container) return
      
      const containerRect = container.getBoundingClientRect()
      const newHeight = e.clientY - containerRect.top
      const minHeight = 100
      const maxHeight = containerRect.height * 0.8
      
      setFieldSelectorHeight(Math.max(minHeight, Math.min(maxHeight, newHeight)))
    }

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    // Always attach listeners, but only act if isResizing is true
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const handleResizeStart = (e) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042']

  return (
    <div className="charts-page">
      <div className="charts-controls">
        <div className="chart-filter-group">
          <label>Time Range:</label>
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

        <div className="chart-filter-group">
          <label>Topic Filter:</label>
          <input
            type="text"
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            placeholder="Enter topic to filter..."
            className="filter-input"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                fetchEvents()
              }
            }}
          />
        </div>

        <div className="chart-filter-group">
          <label>Database:</label>
          <select
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            className="filter-select"
          >
            <option value="clickhouse">ClickHouse</option>
            <option value="postgresql">PostgreSQL</option>
          </select>
        </div>

        <button onClick={fetchEvents} className="refresh-button" disabled={loading}>
          {loading ? 'Loading...' : 'Load Data'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="charts-content-container">
        {availableFields.length > 0 && (
          <>
            <div 
              className="field-selector"
              ref={fieldSelectorRef}
              style={{ height: `${fieldSelectorHeight}px` }}
            >
              <div className="field-selector-header">
                <label>Select Fields to Plot ({availableFields.length} available):</label>
                <input
                  type="text"
                  placeholder="Search fields..."
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  className="field-search-input"
                />
              </div>
              <div className="field-checkboxes-container">
                <div className="field-checkboxes">
                  {filteredFields.length > 0 ? (
                    filteredFields.map((field) => (
                      <label key={field} className={`field-checkbox ${selectedFields.includes(field) ? 'checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedFields.includes(field)}
                          onChange={() => handleFieldToggle(field)}
                        />
                        <span>{field}</span>
                      </label>
                    ))
                  ) : (
                    <div className="no-fields-found">No fields match your search</div>
                  )}
                </div>
              </div>
            </div>
            <div 
              className="resizer"
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            >
              <div className="resizer-handle"></div>
            </div>
          </>
        )}

        {loading && (
          <div className="loading">Loading chart data...</div>
        )}

        {chartData.length > 0 && selectedFields.length > 0 ? (
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="time" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis />
                <Tooltip />
                <Legend />
                {selectedFields.map((field, index) => (
                  <Line
                    key={field}
                    type="monotone"
                    dataKey={field}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : events.length > 0 && selectedFields.length === 0 ? (
          <div className="empty-state">Please select at least one field to plot</div>
        ) : events.length === 0 && !loading ? (
          <div className="empty-state">
            Enter a topic filter and click "Load Data" to view charts
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Charts

