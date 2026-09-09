# Flourish Atlas — top-level developer entry points (docs/PROPOSAL.md §5.1)

.PHONY: setup data api web test lint typecheck build deploy

setup: ## Install Python and web dependencies
	uv sync --all-packages
	pnpm install

data: ## Build catalog, Parquet, DuckDB from raw files in data/raw/ (Phase 1)
	uv run flourish-pipeline

api: ## Run the API locally with reload
	uv run uvicorn flourish_api.main:app --reload --port 8000

web: ## Run the web app dev server
	pnpm -C apps/web dev

test: ## Run all tests (Python + web)
	uv run pytest
	pnpm -C apps/web test

lint: ## Lint both sides
	uv run ruff check .
	uv run ruff format --check .
	pnpm -C apps/web lint

typecheck: ## Typecheck both sides
	uv run pyright
	pnpm -C apps/web typecheck

build: ## Production build of the web app and the API image
	pnpm -C apps/web build
	docker build -f infra/Dockerfile -t flourish-api .

deploy: ## Deploys run from CI on tags (see .github/workflows/deploy.yml)
	@echo "Deploys run from GitHub Actions on a v* tag; see infra/README.md."
