package main

import (
	"context"
	"encoding/json"
	"math"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

var ctx = context.Background()
var rdb *redis.Client

var EtopoData []int16
var LandCoverData []uint8
var TerrainCosts map[string]float64

// ETOPO raster dimensions (dalla chiave raster_meta in Redis)
var Width int
var Height int
var Resolution float64 = 0.016667 // default 1 arcominuto
var OriginX float64 = -180.0
var OriginY float64 = 90.0

// MCD12Q1 Land Cover raster dimensions (dalla chiave raster_meta in Redis)
var LcWidth int
var LcHeight int
var LcResolution float64 = 0.004167 // default ~500m
var LcOriginX float64 = -180.0
var LcOriginY float64 = 90.0

type RasterMeta struct {
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	OriginX float64 `json:"originX"`
	OriginY float64 `json:"originY"`
	ResX    float64 `json:"resX"`
	ResY    float64 `json:"resY"`
}

func initRedis() {
	redisHost := os.Getenv("REDIS_HOST")
	if redisHost == "" {
		redisHost = "redis:6379"
	}

	rdb = redis.NewClient(&redis.Options{
		Addr: redisHost,
	})

	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		log.Fatalf("Could not connect to Redis: %v", err)
	}
	log.Println("Connected to Redis successfully.")
}

func loadMapData() {
	log.Println("Loading Map Data from Redis...")
	
	// Load Terrain Costs
	costsStr, err := rdb.Get(ctx, "map_data:terrain_costs").Result()
	if err == nil {
		err = json.Unmarshal([]byte(costsStr), &TerrainCosts)
		if err != nil {
			log.Printf("Error unmarshaling terrain costs: %v", err)
		} else {
			log.Println("Terrain costs loaded.")
		}
	}

	// Find ETOPO key
	keys, err := rdb.Keys(ctx, "map_data:raster:ETOPO*").Result()
	if err == nil && len(keys) > 0 {
		log.Printf("Loading ETOPO raster: %s", keys[0])
		data, err := rdb.Get(ctx, keys[0]).Bytes()
		if err == nil {
			// Convert bytes to int16 slice (Little Endian)
			EtopoData = make([]int16, len(data)/2)
			for i := 0; i < len(data); i += 2 {
				EtopoData[i/2] = int16(data[i]) | int16(data[i+1])<<8
			}
			log.Printf("ETOPO loaded: %d cells.", len(EtopoData))

			// Load exact grid dimensions from raster_meta written by warmup geotiff
			metaKey := strings.Replace(keys[0], "map_data:raster:", "map_data:raster_meta:", 1)
			metaStr, merr := rdb.Get(ctx, metaKey).Result()
			if merr == nil {
				var meta RasterMeta
				if err2 := json.Unmarshal([]byte(metaStr), &meta); err2 == nil {
					Width = meta.Width
					Height = meta.Height
					Resolution = meta.ResX
					OriginX = meta.OriginX
					OriginY = meta.OriginY
					log.Printf("ETOPO grid from meta: %dx%d, Res=%f, Origin=(%f,%f)", Width, Height, Resolution, OriginX, OriginY)
				} else {
					log.Printf("ETOPO meta parse error: %v — falling back to approximation", err2)
					H := int(math.Round(math.Sqrt(float64(len(EtopoData)) / 2.0)))
					Width = H * 2; Height = H; Resolution = 360.0 / float64(Width)
				}
			} else {
				log.Printf("ETOPO meta not found: %v — falling back to approximation", merr)
				H := int(math.Round(math.Sqrt(float64(len(EtopoData)) / 2.0)))
				Width = H * 2; Height = H; Resolution = 360.0 / float64(Width)
			}
			log.Printf("ETOPO ready: Grid %dx%d (Res: %f)", Width, Height, Resolution)
		}
	}

	// Find LandCover key
	lcKeys, err := rdb.Keys(ctx, "map_data:raster:lc_mcd12*").Result()
	if err == nil && len(lcKeys) > 0 {
		log.Printf("Loading Land Cover raster: %s", lcKeys[0])
		data, err := rdb.Get(ctx, lcKeys[0]).Bytes()
		if err == nil {
			LandCoverData = data
			// Load exact grid dimensions from raster_meta written by warmup geotiff
			metaKey := strings.Replace(lcKeys[0], "map_data:raster:", "map_data:raster_meta:", 1)
			metaStr, merr := rdb.Get(ctx, metaKey).Result()
			if merr == nil {
				var meta RasterMeta
				if err2 := json.Unmarshal([]byte(metaStr), &meta); err2 == nil {
					LcWidth = meta.Width
					LcHeight = meta.Height
					LcResolution = meta.ResX
					LcOriginX = meta.OriginX
					LcOriginY = meta.OriginY
					log.Printf("LC grid from meta: %dx%d, Res=%f, Origin=(%f,%f)", LcWidth, LcHeight, LcResolution, LcOriginX, LcOriginY)
				} else {
					log.Printf("LC meta parse error: %v — falling back to approximation", err2)
					LcH := int(math.Round(math.Sqrt(float64(len(LandCoverData)) / 2.0)))
					LcWidth = LcH * 2; LcHeight = LcH; LcResolution = 360.0 / float64(LcWidth)
				}
			} else {
				log.Printf("LC meta not found: %v — falling back to approximation", merr)
				LcH := int(math.Round(math.Sqrt(float64(len(LandCoverData)) / 2.0)))
				LcWidth = LcH * 2; LcHeight = LcH; LcResolution = 360.0 / float64(LcWidth)
			}
			log.Printf("LC ready: %d cells. Grid: %dx%d (Res: %f)", len(LandCoverData), LcWidth, LcHeight, LcResolution)
		}
	}
}

type PathRequest struct {
	StartX     float64 `json:"startX"`
	StartY     float64 `json:"startY"`
	TargetX    float64 `json:"targetX"`
	TargetY    float64 `json:"targetY"`
	Multiplier float64 `json:"multiplier"`
}

func handleCalculatePath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	type PathResponse struct {
		Path    [][2]float64 `json:"path"`
		Cost    float64      `json:"cost"`
		IsValid bool         `json:"isValid"`
	}

	var req PathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if EtopoData == nil {
		// Fallback se i dati non sono caricati
		path := [][2]float64{{req.StartX, req.StartY}, {req.TargetX, req.TargetY}}
		json.NewEncoder(w).Encode(PathResponse{Path: path, Cost: 0.0, IsValid: false})
		return
	}

	multiplier := req.Multiplier
	if multiplier <= 0 {
		multiplier = 1.0
	}

	path, cost, isValid := FindPath(req.StartX, req.StartY, req.TargetX, req.TargetY, multiplier)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PathResponse{Path: path, Cost: cost, IsValid: isValid})
}

func main() {
	// Attesa di 5 secondi per dare il tempo a redis e warmup di partire
	time.Sleep(5 * time.Second)
	
	initRedis()
	
	// Tentiamo di caricare i dati finché non ci sono
	for {
		loadMapData()
		if EtopoData != nil {
			break
		}
		log.Println("Waiting for raster data to be populated in Redis...")
		time.Sleep(10 * time.Second)
	}

	http.HandleFunc("/api/calculate", handleCalculatePath)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	log.Printf("Pathfinding Service listening on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
