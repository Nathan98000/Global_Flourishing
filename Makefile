# Flourish Atlas — top-level developer entry points (docs/PROPOSAL.md §5.1)
# Works with GNU make (Linux) and the make shipped with macOS dev tools.

.DEFAULT_GOAL := help

.PHONY: help setup data data-validate api web lint format typecheck test build docker-build docker-run deploy clean

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

setup: ## Install Python + web dependencies and the pre-commit hook
	uv sync --all-packages
	pnpm install
	uv run pre-commit install

data: ## Build catalog/Parquet/DuckDB/report from data/raw/ (see data/README.md)
	uv run flourish-pipeline run

data-validate: ## Re-run validation + manifest on existing outputs
	uv run flourish-pipeline run --from validate

api: ## Run the API dev server on :8080
	uv run uvicorn flourish_api.main:app --reload --port 8080

web: ## Run the Vite dev server
	pnpm -C apps/web dev

lint: ## ruff + eslint + prettier --check
	uv run ruff check .
	uv run ruff format --check .
	pnpm -C apps/web lint

format: ## ruff format + prettier --write
	uv run ruff format .
	pnpm -C apps/web format

typecheck: ## pyright + tsc
	uv run pyright
	pnpm -C apps/web typecheck

test: ## pytest (both packages) + vitest
	uv run pytest
	pnpm -C apps/web test

build: ## Production web build + API Docker image
	pnpm -C apps/web build
	$(MAKE) docker-build

docker-build: ## Build the API image (repo root as context)
	docker build -f infra/Dockerfile -t flourish-api .

docker-run: ## Run the API image on :8080 and curl /health
	docker run -d --rm -p 8080:8080 --name flourish-api flourish-api
	@sleep 2 && curl -fsS localhost:8080/health && echo && docker stop flourish-api

deploy: ## Tag a release: make deploy TAG=vX.Y.Z (tag push triggers .github/workflows/deploy.yml)
	@test -n "$(TAG)" || { echo "Usage: make deploy TAG=vX.Y.Z"; exit 1; }
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	  test "$$branch" = "main" || { echo "Refusing: on '$$branch', deploy tags are cut from main"; exit 1; }
	@git diff --quiet && git diff --cached --quiet || { echo "Refusing: working tree not clean"; exit 1; }
	@git fetch origin main
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || \
	  { echo "Refusing: local main is not in sync with origin/main"; exit 1; }
	git tag -a "$(TAG)" -m "Release $(TAG)"
	git push origin "$(TAG)"
	@echo "Pushed $(TAG); watch https://github.com/Nathan98000/Global_Flourishing/actions"

clean: ## Remove build artefacts and caches
	rm -rf apps/web/dist .pytest_cache .ruff_cache coverage.xml .coverage
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
