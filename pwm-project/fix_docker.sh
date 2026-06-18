docker exec pwm-project-redis-1 redis-cli KEYS "match:*:player:*:armate" > keys.txt
while read -r key; do
    echo "Processing $key..."
    data=$(docker exec pwm-project-redis-1 redis-cli GET "$key")
    if [[ "$data" == *"Pronto all'attacco"* ]] || [[ "$data" == *"in combattimento"* ]]; then
        echo "Found stuck army in $key! Overwriting status to standby..."
        # Simply replacing Pronto all'attacco with standby is risky but let's try safely:
        newdata=$(echo "$data" | sed "s/Pronto all'attacco/standby/g" | sed "s/in combattimento/standby/g" | sed "s/In Combattimento/standby/g")
        docker exec pwm-project-redis-1 redis-cli SET "$key" "$newdata"
    fi
done < keys.txt
