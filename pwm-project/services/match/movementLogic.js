/**
 * MOCK - Logica di movimento (Pathfinding fittizio)
 * Questo modulo funge da placeholder in attesa del pathfinding reale 
 * basato sugli archi e sul file ETOPO.
 */

// Calcola un ETA fittizio (Tempo stimato di arrivo) basato sui nodi di partenza e arrivo
const calculatePath = (startCoords, endCoords) => {
  // Supponiamo che il file statico ci restituisca il percorso e la distanza
  console.log(`[PATHFINDING] Calcolo percorso da ${startCoords} a ${endCoords}...`);
  
  // Distanza fittizia basata su un calcolo casuale o fisso per ora
  const distance = Math.floor(Math.random() * 500) + 100; // Tra 100 e 600 "km" fittizi
  
  // ETA in millisecondi (es. 10 secondi per ogni spostamento mock)
  const etaMs = 10000;
  
  return {
    isValid: true,
    distance: distance,
    etaMs: etaMs,
    path: [startCoords, endCoords] // Nodi intermedi fittizi
  };
};

module.exports = {
  calculatePath
};
