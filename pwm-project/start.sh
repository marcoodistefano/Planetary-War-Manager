#!/bin/bash

echo "Starting Planetary War Manager (PWM) Microservices..."
echo "Building and starting containers in detached mode..."

docker-compose up -d --build

echo ""
echo "Container Status:"
docker-compose ps

echo ""
echo "PWM Project is now running!"
echo "To view logs for all services: docker-compose logs -f"
echo "To view logs for a specific service: docker-compose logs -f <service_name>"
echo "To stop the project: docker-compose down"
