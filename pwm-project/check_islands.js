const fs = require('fs');
const adj = JSON.parse(fs.readFileSync('scratch_adj.json', 'utf8'));
for(let k in adj) {
  if(adj[k].name && (adj[k].name.includes('Pantelleria') || adj[k].name.includes('Lampedusa') || adj[k].name.includes('Pelagie'))) {
    console.log(adj[k].name, adj[k].lat, adj[k].lng);
  }
}
