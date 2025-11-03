package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

type Event struct {
	Timestamp  time.Time `json:"timestamp"`
	Tool       string    `json:"tool"`
	Topic      string    `json:"topic"`
	Structured string    `json:"structured"`
}

type QueryParams struct {
	TimeRange string `form:"timeRange" json:"timeRange"` // 1m, 5m, 20m, 1h, 5h, 1d, 1w, 1mo
	Content   string `form:"content" json:"content"`     // filter content in structured field
	Database  string `form:"database" json:"database"`   // clickhouse or postgresql
	Limit     int    `form:"limit" json:"limit"`         // default 100
	Offset    int    `form:"offset" json:"offset"`       // default 0
}

var clickhouseConn driver.Conn
var postgresqlDB *sql.DB

func main() {
	// Initialize ClickHouse connection
	log.Println("Connecting to ClickHouse...")
	var err error
	clickhouseConn, err = clickhouse.Open(&clickhouse.Options{
		Addr: []string{"localhost:9000"},
		Auth: clickhouse.Auth{
			Database: "default",
			Username: "default",
			Password: "",
		},
	})
	if err != nil {
		log.Fatalf("Failed to connect to ClickHouse: %v", err)
	}
	defer clickhouseConn.Close()
	log.Println("ClickHouse connection established")

	// Initialize PostgreSQL connection
	log.Println("Connecting to PostgreSQL...")
	postgresqlDB, err = sql.Open("postgres", "host=localhost user=postgres password=secure dbname=tsdb sslmode=disable")
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer postgresqlDB.Close()

	// Test connections
	if err = postgresqlDB.Ping(); err != nil {
		log.Fatalf("Failed to ping PostgreSQL: %v", err)
	}
	log.Println("Successfully connected to PostgreSQL")
	log.Println("Successfully connected to ClickHouse")
	log.Println("Both databases are ready")

	// Setup Gin router
	r := gin.Default()

	// Add logging middleware
	r.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return fmt.Sprintf("[%s] %s %s %d %s \"%s\" %s\n",
			param.TimeStamp.Format("2006-01-02 15:04:05"),
			param.ClientIP,
			param.Method,
			param.StatusCode,
			param.Latency,
			param.Path,
			param.ErrorMessage,
		)
	}))
	r.Use(gin.Recovery())

	// CORS middleware
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// API routes - register before static files to avoid conflicts
	api := r.Group("/api")
	{
		// Health check endpoint - register first
		api.GET("/health", func(c *gin.Context) {
			log.Printf("[API] GET /api/health - Health check request from %s", c.ClientIP())
			c.JSON(http.StatusOK, gin.H{
				"status":    "ok",
				"timestamp": time.Now(),
				"path":      c.Request.URL.Path,
			})
		})
		api.GET("/events", getEvents)
		api.GET("/stats", getStats)
	}

	// Log all registered routes for debugging
	log.Println("Registered API routes:")
	log.Println("  GET /api/health")
	log.Println("  GET /api/events")
	log.Println("  GET /api/stats")

	// Serve static files in production (only if directory exists)
	r.Static("/static", "./frontend/dist")

	// Handle 404 for API routes
	r.NoRoute(func(c *gin.Context) {
		log.Printf("[404] No route found for: %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())

		// Only serve index.html for non-API routes
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{
				"error":  "API endpoint not found",
				"path":   c.Request.URL.Path,
				"method": c.Request.Method,
			})
		} else {
			// Try to serve index.html for frontend routes
			c.File("./frontend/dist/index.html")
		}
	})

	log.Println("Server starting on 0.0.0.0:7890")
	if err := r.Run("0.0.0.0:7890"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func getEvents(c *gin.Context) {
	log.Printf("[API] GET /api/events - Client IP: %s", c.ClientIP())

	var params QueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		log.Printf("[ERROR] Failed to bind query parameters: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Set defaults
	if params.Limit <= 0 {
		params.Limit = 100
	}
	if params.Database == "" {
		params.Database = "clickhouse"
	}

	log.Printf("[QUERY] Database: %s, TimeRange: %s, ContentFilter: %s, Limit: %d, Offset: %d",
		params.Database, params.TimeRange, params.Content, params.Limit, params.Offset)

	var events []Event
	var err error
	startTime := time.Now()

	if params.Database == "clickhouse" {
		events, err = queryClickHouse(params)
	} else {
		events, err = queryPostgreSQL(params)
	}

	duration := time.Since(startTime)

	if err != nil {
		log.Printf("[ERROR] Query failed after %v: %v", duration, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	log.Printf("[SUCCESS] Retrieved %d events from %s in %v", len(events), params.Database, duration)
	c.JSON(http.StatusOK, gin.H{
		"events": events,
		"count":  len(events),
		"params": params,
	})
}

func queryClickHouse(params QueryParams) ([]Event, error) {
	log.Printf("[ClickHouse] Starting query with timeRange=%s, content=%s", params.TimeRange, params.Content)
	ctx := context.Background()

	query := `SELECT timestamp, tool, topic, structured FROM events WHERE 1=1`

	args := []interface{}{}

	// Add time range condition
	if params.TimeRange != "" {
		var duration time.Duration
		switch params.TimeRange {
		case "1m":
			duration = 1 * time.Minute
		case "5m":
			duration = 5 * time.Minute
		case "20m":
			duration = 20 * time.Minute
		case "1h":
			duration = 1 * time.Hour
		case "5h":
			duration = 5 * time.Hour
		case "1d":
			duration = 24 * time.Hour
		case "1w":
			duration = 7 * 24 * time.Hour
		case "1mo":
			duration = 30 * 24 * time.Hour
		default:
			duration = 1 * time.Hour
		}
		query += " AND timestamp >= ?"
		args = append(args, time.Now().Add(-duration))
	}

	// Add content filter
	if params.Content != "" {
		query += " AND structured LIKE ?"
		args = append(args, "%"+params.Content+"%")
	}

	// LIMIT and OFFSET in ClickHouse are safe to use with fmt.Sprintf as they're validated integers
	if params.Limit > 0 {
		if params.Offset > 0 {
			query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT %d OFFSET %d", params.Limit, params.Offset)
		} else {
			query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT %d", params.Limit)
		}
	} else {
		query += " ORDER BY timestamp DESC"
	}

	log.Printf("[ClickHouse] Executing query: %s", query)
	rows, err := clickhouseConn.Query(ctx, query, args...)
	if err != nil {
		log.Printf("[ClickHouse] Query execution failed: %v", err)
		return nil, err
	}
	defer rows.Close()

	var events []Event
	rowCount := 0
	for rows.Next() {
		var event Event
		if err := rows.Scan(
			&event.Timestamp,
			&event.Tool,
			&event.Topic,
			&event.Structured,
		); err != nil {
			log.Printf("[ClickHouse] Row scan error: %v", err)
			return nil, err
		}
		events = append(events, event)
		rowCount++
	}

	log.Printf("[ClickHouse] Successfully retrieved %d rows", rowCount)
	return events, rows.Err()
}

func queryPostgreSQL(params QueryParams) ([]Event, error) {
	log.Printf("[PostgreSQL] Starting query with timeRange=%s, content=%s", params.TimeRange, params.Content)
	// Convert jsonb to text in SELECT to handle jsonb type properly
	query := `SELECT timestamp, tool, topic, structured::text FROM events WHERE 1=1`

	args := []interface{}{}
	argIndex := 1

	// Add time range condition
	if params.TimeRange != "" {
		var duration time.Duration
		switch params.TimeRange {
		case "1m":
			duration = 1 * time.Minute
		case "5m":
			duration = 5 * time.Minute
		case "20m":
			duration = 20 * time.Minute
		case "1h":
			duration = 1 * time.Hour
		case "5h":
			duration = 5 * time.Hour
		case "1d":
			duration = 24 * time.Hour
		case "1w":
			duration = 7 * 24 * time.Hour
		case "1mo":
			duration = 30 * 24 * time.Hour
		default:
			duration = 1 * time.Hour
		}
		query += fmt.Sprintf(" AND timestamp >= $%d", argIndex)
		args = append(args, time.Now().Add(-duration))
		argIndex++
	}

	// Add content filter - convert jsonb to text for LIKE search
	if params.Content != "" {
		query += fmt.Sprintf(" AND structured::text LIKE $%d", argIndex)
		args = append(args, "%"+params.Content+"%")
		argIndex++
	}

	query += " ORDER BY timestamp DESC"
	if params.Limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", argIndex)
		args = append(args, params.Limit)
		argIndex++
	}
	if params.Offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", argIndex)
		args = append(args, params.Offset)
	}

	log.Printf("[PostgreSQL] Executing query: %s", query)
	rows, err := postgresqlDB.Query(query, args...)
	if err != nil {
		log.Printf("[PostgreSQL] Query execution failed: %v", err)
		return nil, err
	}
	defer rows.Close()

	var events []Event
	rowCount := 0
	for rows.Next() {
		var event Event
		if err := rows.Scan(
			&event.Timestamp,
			&event.Tool,
			&event.Topic,
			&event.Structured,
		); err != nil {
			log.Printf("[PostgreSQL] Row scan error: %v", err)
			return nil, err
		}
		events = append(events, event)
		rowCount++
	}

	log.Printf("[PostgreSQL] Successfully retrieved %d rows", rowCount)
	return events, rows.Err()
}

func getStats(c *gin.Context) {
	log.Printf("[API] GET /api/stats - Client IP: %s", c.ClientIP())
	c.JSON(http.StatusOK, gin.H{
		"clickhouse": "connected",
		"postgresql": "connected",
	})
}
