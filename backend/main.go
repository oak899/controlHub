package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

type Event struct {
	ID         string    `json:"id"`
	Timestamp  time.Time `json:"timestamp"`
	Shard      int16     `json:"shard"`
	Seq        int32     `json:"seq"`
	Tool       string    `json:"tool"`
	Topic      string    `json:"topic"`
	Structured string    `json:"structured"`
	Genlog     string    `json:"__genlog__"`
}

type QueryParams struct {
	TimeRange  string `form:"timeRange" json:"timeRange"`   // 1m, 5m, 20m, 1h, 5h, 1d, 1w, 1mo
	Content    string `form:"content" json:"content"`       // filter content in structured field
	Database   string `form:"database" json:"database"`     // clickhouse or postgresql
	Limit      int    `form:"limit" json:"limit"`           // default 100
	Offset     int    `form:"offset" json:"offset"`         // default 0
}

var clickhouseConn driver.Conn
var postgresqlDB *sql.DB

func main() {
	// Initialize ClickHouse connection
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

	// Initialize PostgreSQL connection
	postgresqlDB, err = sql.Open("postgres", "host=localhost user=admin password=secure dbname=tsdb sslmode=disable")
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer postgresqlDB.Close()

	// Test connections
	if err = postgresqlDB.Ping(); err != nil {
		log.Fatalf("Failed to ping PostgreSQL: %v", err)
	}
	log.Println("Connected to both databases")

	// Setup Gin router
	r := gin.Default()

	// CORS middleware
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// API routes
	api := r.Group("/api")
	{
		api.GET("/events", getEvents)
		api.GET("/stats", getStats)
	}

	// Serve static files in production
	r.Static("/static", "./frontend/dist")
	r.StaticFile("/", "./frontend/dist/index.html")

	log.Println("Server starting on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}


func getEvents(c *gin.Context) {
	var params QueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
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

	var events []Event
	var err error

	if params.Database == "clickhouse" {
		events, err = queryClickHouse(params)
	} else {
		events, err = queryPostgreSQL(params)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"events": events,
		"count":  len(events),
		"params": params,
	})
}

func queryClickHouse(params QueryParams) ([]Event, error) {
	ctx := context.Background()

	query := `SELECT id, timestamp, shard, seq, tool, topic, structured, __genlog__ FROM events WHERE 1=1`

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

	rows, err := clickhouseConn.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var event Event
		if err := rows.Scan(
			&event.ID,
			&event.Timestamp,
			&event.Shard,
			&event.Seq,
			&event.Tool,
			&event.Topic,
			&event.Structured,
			&event.Genlog,
		); err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, rows.Err()
}

func queryPostgreSQL(params QueryParams) ([]Event, error) {
	query := `SELECT id, timestamp, shard, seq, tool, topic, structured, __genlog__ FROM events WHERE 1=1`

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

	// Add content filter
	if params.Content != "" {
		query += fmt.Sprintf(" AND structured LIKE $%d", argIndex)
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

	rows, err := postgresqlDB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var event Event
		if err := rows.Scan(
			&event.ID,
			&event.Timestamp,
			&event.Shard,
			&event.Seq,
			&event.Tool,
			&event.Topic,
			&event.Structured,
			&event.Genlog,
		); err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, rows.Err()
}

func getStats(c *gin.Context) {
	// Return basic statistics
	c.JSON(http.StatusOK, gin.H{
		"clickhouse": "connected",
		"postgresql": "connected",
	})
}

