#!/usr/bin/env python3

"""
Rimuove gli archi duplicati dal file archs.json.
Un arco è considerato duplicato se collega la stessa coppia di città (ignorando l'ordine).
In caso di duplicati o collisioni, viene data priorità agli archi con geometria valida (es. LineString).
Inoltre, questo script consolida eventuali oggetti multipli (es. archs1, archs2) in un unico oggetto "archs".
"""

import json
import argparse
from pathlib import Path

def main():
    script_dir = Path(__file__).resolve().parent
    default_map_dir = script_dir.parent / "assets" / "map"
    
    parser = argparse.ArgumentParser(description="Rimuove gli archi duplicati da archs.json in base alla coppia di città")
    parser.add_argument("--map-dir", type=Path, default=default_map_dir, help="Cartella contenente i file di mappa")
    args = parser.parse_args()

    archs_path = args.map_dir / "archs.json"
    
    print(f"Caricamento dati da {archs_path.resolve()}...")
    try:
        with open(archs_path, "r", encoding="utf-8") as f:
            archs_topo = json.load(f)
    except Exception as e:
        print(f"Errore durante il caricamento di {archs_path}: {e}")
        return

    objects = archs_topo.get("objects", {})
    
    unique_geometries = {}
    null_count = 0
    dup_count = 0

    # Iteriamo su tutti gli oggetti presenti (es. archs1, archs2)
    for obj_name, obj_data in objects.items():
        if obj_data.get("type") == "GeometryCollection":
            for geom in obj_data.get("geometries", []):
                props = geom.get("properties", {})
                city1 = props.get("city1")
                city2 = props.get("city2")
                
                # Se mancano le città, usiamo l'ID come chiave canonica per non unirli a caso
                geom_id = props.get("id") or geom.get("id")
                
                if city1 and city2:
                    # Ordiniamo i nomi delle città in modo che (A, B) sia uguale a (B, A)
                    canon_key = tuple(sorted([str(city1).strip(), str(city2).strip()]))
                else:
                    canon_key = geom_id
                
                # Consideriamo valido l'arco se ha un tipo definito e un array "arcs"
                is_valid = geom.get("type") in {"LineString", "MultiLineString"} and "arcs" in geom
                
                if canon_key in unique_geometries:
                    existing_geom = unique_geometries[canon_key]
                    existing_is_valid = existing_geom.get("type") in {"LineString", "MultiLineString"} and "arcs" in existing_geom
                    
                    if is_valid and not existing_is_valid:
                        # Sostituisce un record rotto (es. type: null) con uno valido
                        unique_geometries[canon_key] = geom
                    elif not is_valid and existing_is_valid:
                        # Ignora il record rotto se ne abbiamo già uno valido
                        pass
                    else:
                        # Entrambi validi o entrambi rotti: sovrascrive (vince l'ultimo trovato, es. archs2)
                        unique_geometries[canon_key] = geom
                        dup_count += 1
                else:
                    unique_geometries[canon_key] = geom

    # Filtra i conteggi per le statistiche
    final_geometries = list(unique_geometries.values())
    valid_count = sum(1 for g in final_geometries if g.get("type") in {"LineString", "MultiLineString"} and "arcs" in g)
    total_nulls = len(final_geometries) - valid_count
    
    # Consolida tutti i risultati in un unico GeometryCollection pulito
    archs_topo["objects"] = {
        "archs": {
            "type": "GeometryCollection",
            "geometries": final_geometries
        }
    }
    
    print(f"Rimossi {dup_count} archi duplicati tra le stesse città.")
    print(f"Archi validi rimanenti: {valid_count}")
    print(f"Archi rotti/vuoti rimanenti: {total_nulls}")
    print(f"Totale geometrie scritte: {len(final_geometries)}")

    # Salvataggio
    print("Salvataggio in corso...")
    with open(archs_path, "w", encoding="utf-8") as f:
        json.dump(archs_topo, f, ensure_ascii=False, indent=2)
    print("Operazione completata. Il file archs.json e' stato sanitizzato!")

if __name__ == "__main__":
    main()
