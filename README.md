# Control Hub

控制服务器，用于连接和查询 ClickHouse 和 PostgreSQL 数据库中的 events 数据。

## 功能特性

- 连接 ClickHouse 和 PostgreSQL 数据库
- 实时查询 events 数据
- 时间范围过滤（1分钟、5分钟、20分钟、1小时、5小时、1天、1周、1个月）
- 内容过滤（搜索 structured 字段）
- 现代化 React 前端界面
- 响应式设计

## 技术栈

- **后端**: Golang + Gin + ClickHouse Driver + PostgreSQL Driver
- **前端**: React + Vite + Axios

## 数据库配置

### PostgreSQL
- 主机: localhost
- 用户名: admin
- 密码: secure
- 数据库: tsdb
- 表: events

### ClickHouse
- 主机: localhost:9000
- 用户名: default
- 密码: (空)
- 数据库: default
- 表: events

## 安装和运行

### 后端

1. 确保已安装 Go 1.21 或更高版本
2. 进入后端目录:
```bash
cd backend
```

3. 安装依赖:
```bash
go mod download
```

4. 运行服务器:
```bash
go run main.go
```

服务器将在 `http://localhost:8080` 启动

### 前端

1. 确保已安装 Node.js 和 npm
2. 进入前端目录:
```bash
cd frontend
```

3. 安装依赖:
```bash
npm install
```

4. 启动开发服务器:
```bash
npm run dev
```

前端将在 `http://localhost:3000` 启动

## 构建生产版本

### 后端
```bash
cd backend
go build -o controlhub main.go
./controlhub
```

### 前端
```bash
cd frontend
npm run build
```

构建后的文件将在 `frontend/dist` 目录中。

## API 端点

### GET /api/events
查询 events 数据

查询参数:
- `timeRange`: 时间范围 (1m, 5m, 20m, 1h, 5h, 1d, 1w, 1mo)
- `content`: 内容过滤（搜索 structured 字段）
- `database`: 数据库类型 (clickhouse 或 postgresql)
- `limit`: 返回记录数（默认 100）
- `offset`: 偏移量（默认 0）

示例:
```
GET /api/events?timeRange=1h&content=error&database=clickhouse&limit=50
```

### GET /api/stats
获取服务器状态

## 表结构

events 表包含以下字段:
- `id`: UUID
- `timestamp`: 时间戳 (datetime64(3, 'America/Los_Angeles'))
- `shard`: int16
- `seq`: int32
- `tool`: string
- `topic`: string
- `structured`: string (codec zstd(3))
- `__genlog__`: string

