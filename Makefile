.PHONY: deps-up deps-down deps-ps deps-logs deps-clean

# External dependencies only (Redis + ChromaDB)
# Apps run natively on the host

deps-up:
	docker compose up -d

deps-down:
	docker compose down

deps-ps:
	docker compose ps

deps-logs:
	docker compose logs -f

deps-clean:
	docker compose down -v
