FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build the Go app statically
RUN CGO_ENABLED=0 GOOS=linux go build -o pathfinding-service .

FROM alpine:latest  
RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/pathfinding-service .

EXPOSE 8090

CMD ["./pathfinding-service"]
