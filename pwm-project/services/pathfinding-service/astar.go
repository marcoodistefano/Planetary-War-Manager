package main

import (
	"container/heap"
	"log"
	"math"
)

type Point struct {
	X int
	Y int
}

type Node struct {
	Pt       Point
	Cost     float64
	Priority float64
	Index    int
}

type PriorityQueue []*Node

func (pq PriorityQueue) Len() int { return len(pq) }

func (pq PriorityQueue) Less(i, j int) bool {
	return pq[i].Priority < pq[j].Priority
}

func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].Index = i
	pq[j].Index = j
}

func (pq *PriorityQueue) Push(x any) {
	n := len(*pq)
	item := x.(*Node)
	item.Index = n
	*pq = append(*pq, item)
}

func (pq *PriorityQueue) Pop() any {
	old := *pq
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	item.Index = -1
	*pq = old[0 : n-1]
	return item
}

func lngLatToIndex(lng, lat float64) Point {
	x := int(math.Floor((lng - OriginX) / ResolutionX))
	y := int(math.Floor((OriginY - lat) / ResolutionY))

	if x < 0 { x = 0 }
	if x >= Width { x = Width - 1 }
	if y < 0 { y = 0 }
	if y >= Height { y = Height - 1 }

	return Point{X: x, Y: y}
}

func indexToLngLat(pt Point) (float64, float64) {
	lng := OriginX + (float64(pt.X)+0.5)*ResolutionX
	lat := OriginY - (float64(pt.Y)+0.5)*ResolutionY
	return lng, lat
}

var TerrainKeyMap = map[uint8]string{
	1:  "forest_needle_eve",
	2:  "forest_needle_dec",
	3:  "forest_broad_eve",
	4:  "forest_broad_dec",
	5:  "forest_mixed",
	6:  "shrubland_closed",
	7:  "shrubland_open",
	8:  "savanna_woody",
	9:  "savanna",
	10: "grassland",
	11: "wetlands",
	12: "cropland",
	13: "urban",
	14: "cropland_mosaic",
	15: "snow_ice",
	16: "barren_desert",
}

func isWater(pt Point) bool {
	idx := pt.Y*Width + pt.X
	if idx < 0 || idx >= len(EtopoData) {
		return false
	}

	elevation := EtopoData[idx]
	if elevation <= 0 {
		return true // Acqua marina (sotto il livello del mare)
	}

	if LandCoverData != nil && LcWidth > 0 {
		lng, lat := indexToLngLat(pt)

		lcX := int(math.Floor((lng - LcOriginX) / LcResolutionX))
		lcY := int(math.Floor((LcOriginY - lat) / LcResolutionY))
		if lcX < 0 { lcX = 0 }
		if lcX >= LcWidth { lcX = LcWidth - 1 }
		if lcY < 0 { lcY = 0 }
		if lcY >= LcHeight { lcY = LcHeight - 1 }
		lcIdx := lcY*LcWidth + lcX

		if lcIdx >= 0 && lcIdx < len(LandCoverData) {
			lcClass := LandCoverData[lcIdx]
			// Classi 0 e 17 = corpi idrici MODIS (laghi, fiumi larghi, bacini interni)
			// Classe 15 = ghiaccio/neve (non navigabile per navi)
			if (lcClass == 0 || lcClass == 17) && lcClass != 15 {
				return true
			}
		}
	}
	return false
}

func getCostLand(pt Point) float64 {
	idx := pt.Y*Width + pt.X
	if idx < 0 || idx >= len(EtopoData) {
		return math.Inf(1)
	}

	elevation := EtopoData[idx]
	if elevation <= 0 {
		return math.Inf(1) // Acqua marina (sotto il livello del mare)
	}

	multiplier := 1.0
	if LandCoverData != nil && LcWidth > 0 {
		// Calcola le coordinate geografiche del punto corrente
		lng, lat := indexToLngLat(pt)

		// Calcola l'indice nel raster MCD12Q1 usando la SUA origine e risoluzione
		lcX := int(math.Floor((lng - LcOriginX) / LcResolutionX))
		lcY := int(math.Floor((LcOriginY - lat) / LcResolutionY))
		if lcX < 0 { lcX = 0 }
		if lcX >= LcWidth { lcX = LcWidth - 1 }
		if lcY < 0 { lcY = 0 }
		if lcY >= LcHeight { lcY = LcHeight - 1 }
		lcIdx := lcY*LcWidth + lcX

		if lcIdx >= 0 && lcIdx < len(LandCoverData) {
			lcClass := LandCoverData[lcIdx]
			// Classi 0 e 17 = corpi idrici MODIS (laghi, fiumi larghi, bacini interni)
			if lcClass == 0 || lcClass == 17 {
				return math.Inf(1)
			}
			if TerrainCosts != nil {
				terrainKey, ok := TerrainKeyMap[lcClass]
				if ok {
					speedMult, hasCost := TerrainCosts[terrainKey]
					if hasCost && speedMult > 0 {
						multiplier = 1.0 / speedMult
					}
				}
			}
		}
	}
	return multiplier
}

func getCostSea(pt Point) float64 {
	if !isWater(pt) {
		return math.Inf(1) // Terraferma non navigabile per unità navali
	}
	return 1.0 // Costo piatto per acqua navigabile
}

func getCostMode(pt Point, mode string) float64 {
	if mode == "sea" {
		return getCostSea(pt)
	}
	return getCostLand(pt)
}

func heuristic(a, b Point) float64 {
	dx := math.Abs(float64(a.X - b.X))
	dy := math.Abs(float64(a.Y - b.Y))
	return math.Max(dx, dy)
}

func findNearestLandPoint(pt Point) Point {
	if !math.IsInf(getCostLand(pt), 1) {
		return pt
	}

	for r := 1; r < 20; r++ {
		for dx := -r; dx <= r; dx++ {
			p1 := Point{X: pt.X + dx, Y: pt.Y - r}
			if p1.X >= 0 && p1.X < Width && p1.Y >= 0 && p1.Y < Height {
				if !math.IsInf(getCostLand(p1), 1) {
					return p1
				}
			}
			p2 := Point{X: pt.X + dx, Y: pt.Y + r}
			if p2.X >= 0 && p2.X < Width && p2.Y >= 0 && p2.Y < Height {
				if !math.IsInf(getCostLand(p2), 1) {
					return p2
				}
			}
		}
		for dy := -r + 1; dy < r; dy++ {
			p1 := Point{X: pt.X - r, Y: pt.Y + dy}
			if p1.X >= 0 && p1.X < Width && p1.Y >= 0 && p1.Y < Height {
				if !math.IsInf(getCostLand(p1), 1) {
					return p1
				}
			}
			p2 := Point{X: pt.X + r, Y: pt.Y + dy}
			if p2.X >= 0 && p2.X < Width && p2.Y >= 0 && p2.Y < Height {
				if !math.IsInf(getCostLand(p2), 1) {
					return p2
				}
			}
		}
	}
	return pt
}

func findNearestWaterPoint(pt Point) Point {
	if isWater(pt) {
		return pt
	}

	for r := 1; r < 50; r++ { // raggio di ricerca più ampio per coste
		for dx := -r; dx <= r; dx++ {
			p1 := Point{X: pt.X + dx, Y: pt.Y - r}
			if p1.X >= 0 && p1.X < Width && p1.Y >= 0 && p1.Y < Height {
				if isWater(p1) {
					return p1
				}
			}
			p2 := Point{X: pt.X + dx, Y: pt.Y + r}
			if p2.X >= 0 && p2.X < Width && p2.Y >= 0 && p2.Y < Height {
				if isWater(p2) {
					return p2
				}
			}
		}
		for dy := -r + 1; dy < r; dy++ {
			p1 := Point{X: pt.X - r, Y: pt.Y + dy}
			if p1.X >= 0 && p1.X < Width && p1.Y >= 0 && p1.Y < Height {
				if isWater(p1) {
					return p1
				}
			}
			p2 := Point{X: pt.X + r, Y: pt.Y + dy}
			if p2.X >= 0 && p2.X < Width && p2.Y >= 0 && p2.Y < Height {
				if isWater(p2) {
					return p2
				}
			}
		}
	}
	return pt
}

func FindPath(startLng, startLat, endLng, endLat float64, multiplier float64, mode string) ([][2]float64, float64, bool) {
	start := lngLatToIndex(startLng, startLat)
	end := lngLatToIndex(endLng, endLat)

	fallbackPath := [][2]float64{{startLng, startLat}, {endLng, endLat}}

	var snappedStart, snappedEnd Point
	if mode == "sea" {
		snappedStart = findNearestWaterPoint(start)
		snappedEnd = findNearestWaterPoint(end)
	} else {
		snappedStart = findNearestLandPoint(start)
		snappedEnd = findNearestLandPoint(end)
	}

	log.Printf("[DEBUG_SNAP] mode=%s, start=(%d,%d), end=(%d,%d), snappedStart=(%d,%d), snappedEnd=(%d,%d)", mode, start.X, start.Y, end.X, end.Y, snappedStart.X, snappedStart.Y, snappedEnd.X, snappedEnd.Y)

	pq := make(PriorityQueue, 0)
	heap.Init(&pq)

	cameFrom := make(map[Point]Point)
	gScore := make(map[Point]float64)

	gScore[snappedStart] = 0
	heap.Push(&pq, &Node{
		Pt:       snappedStart,
		Cost:     0,
		Priority: heuristic(snappedStart, snappedEnd),
	})

	nodesVisited := 0
	// Limite elevato per supportare percorsi intercontinentali su larga scala
	maxNodes := 1500000

	for pq.Len() > 0 {
		nodesVisited++
		if nodesVisited > maxNodes {
			break
		}

		current := heap.Pop(&pq).(*Node)
		currPt := current.Pt

		if currPt == snappedEnd {
			path := reconstructPath(cameFrom, currPt, startLng, startLat, endLng, endLat)
			if len(path) > 0 {
				path[0] = [2]float64{startLng, startLat}
				path[len(path)-1] = [2]float64{endLng, endLat}
			}
			return path, current.Cost * multiplier, true
		}

		neighbors := []Point{
			{X: currPt.X, Y: currPt.Y - 1}, {X: currPt.X, Y: currPt.Y + 1},
			{X: currPt.X - 1, Y: currPt.Y}, {X: currPt.X + 1, Y: currPt.Y},
			{X: currPt.X - 1, Y: currPt.Y - 1}, {X: currPt.X + 1, Y: currPt.Y - 1},
			{X: currPt.X - 1, Y: currPt.Y + 1}, {X: currPt.X + 1, Y: currPt.Y + 1},
		}

		for _, n := range neighbors {
			if n.X < 0 || n.X >= Width || n.Y < 0 || n.Y >= Height {
				continue
			}

			cost := getCostMode(n, mode)
			if math.IsInf(cost, 1) {
				continue
			}

			dist := 1.0
			if n.X != currPt.X && n.Y != currPt.Y {
				dist = 1.414
			}

			tentativeGScore := gScore[currPt] + (dist * cost)
			
			gScoreN, exists := gScore[n]
			if !exists || tentativeGScore < gScoreN {
				cameFrom[n] = currPt
				gScore[n] = tentativeGScore
				priority := tentativeGScore + heuristic(n, snappedEnd)
				heap.Push(&pq, &Node{
					Pt:       n,
					Cost:     tentativeGScore,
					Priority: priority,
				})
			}
		}
	}

	return fallbackPath, 0.0, false
}

func reconstructPath(cameFrom map[Point]Point, current Point, exactStartLng, exactStartLat, exactEndLng, exactEndLat float64) [][2]float64 {
	var path [][2]float64
	path = append(path, [2]float64{exactEndLng, exactEndLat})

	curr := current
	for {
		lng, lat := indexToLngLat(curr)
		path = append([][2]float64{{lng, lat}}, path...)

		prev, ok := cameFrom[curr]
		if !ok {
			break
		}
		curr = prev
	}

	if len(path) > 0 {
		path[0] = [2]float64{exactStartLng, exactStartLat}
	}

	return simplifyPath(path)
}

func simplifyPath(path [][2]float64) [][2]float64 {
	if len(path) <= 2 {
		return path
	}
	simplified := [][2]float64{path[0]}

	for i := 1; i < len(path)-1; i++ {
		// Preserva sempre il penultimo elemento per evitare che la semplificazione
		// rimuova il punto di snapping finale reale (importante per il controllo delle navi).
		if i == len(path)-2 {
			simplified = append(simplified, path[i])
			continue
		}

		p1 := path[i-1]
		p2 := path[i]
		p3 := path[i+1]

		dx1 := p2[0] - p1[0]
		dy1 := p2[1] - p1[1]
		dx2 := p3[0] - p2[0]
		dy2 := p3[1] - p2[1]

		if math.Abs(dx1*dy2-dy1*dx2) > 0.0001 {
			simplified = append(simplified, p2)
		}
	}
	simplified = append(simplified, path[len(path)-1])
	return simplified
}
