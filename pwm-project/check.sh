for hash in bkAKn3smKxu4YujqhpDwFEeS7vB345UnkMJvGhnLR2xafuAyhNbQdklOFdkQZg74oCJz7XeVuxGcksOp4YUMiShoA8iEg87ZwzBopLOp8EAQMpqrj2uWzcOiaL806SGfA9RyKO810jVEMH7kt8u0xfh1YmdhnhJP6deJbg2xJ5e4BTeDlLX1K5JWqBw0rbJJJxkJuuLlXUMzSzYfiECDql03KpGOymAHxPPHm4ntWnfXyy5oHLZxfgJ8xYttfCR; do
  docker exec pwm-project-redis-1 redis-cli GET "match:$hash:nations" | jq -r '.[] | select(.territories_flat | index("THA-441")) | "Match: '$hash' -> Owner: \(.playerId) (\(.nationName))"'
done
