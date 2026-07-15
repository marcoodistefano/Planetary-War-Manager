package main

import (
	"context"
	"encoding/json"
	"math"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

var ctx = context.Background()
var rdb *redis.Client

var EtopoData []int16
var LandCoverData []uint8
var TerrainCosts map[string]float64

// Assuming global 2:1 ratio for raster size based on arrays size
var Width int
var Height int
var Resolution float64 = 0.1

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
			// Convert bytes to int16 slice
			// Assuming LittleEndian
			EtopoData = make([]int16, len(data)/2)
			for i := 0; i < len(data); i += 2 {
				EtopoData[i/2] = int16(data[i]) | int16(data[i+1])<<8
			}
			log.Printf("ETOPO loaded: %d cells.", len(EtopoData))
			
			// Compute Dimensions roughly
			// total = width * height where width = 2 * height
			// 2 * height^2 = total => height = sqrt(total/2)
			totalCells := len(EtopoData)
			
			// Just an approximation. Can be overridden if known.
			Height = int(math.Round(math.Sqrt(float64(totalCells) / 2.0)))
			Width = Height * 2
			Resolution = 360.0 / float64(Width)
			log.Printf("Grid dimensions deduced: %dx%d (Res: %f)", Width, Height, Resolution)
		}
	}

	// Find LandCover key
	lcKeys, err := rdb.Keys(ctx, "map_data:raster:lc_mcd12*").Result()
	if err == nil && len(lcKeys) > 0 {
		log.Printf("Loading Land Cover raster: %s", lcKeys[0])
		data, err := rdb.Get(ctx, lcKeys[0]).Bytes()
		if err == nil {
			LandCoverData = data
			log.Printf("Land Cover loaded: %d cells.", len(LandCoverData))
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
