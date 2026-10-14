# Migrations
The SQLAlchemy models in `app/main.py` are the schema source of truth.
Local/dev databases are created with `Base.metadata.create_all`.
For production Postgres: generate Alembic revisions from these models
(`alembic revision --autogenerate`) — never edit a released revision.
