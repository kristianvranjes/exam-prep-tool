FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
ARG INSTALL_EMBEDDINGS=0
RUN if [ "$INSTALL_EMBEDDINGS" = "1" ]; then pip install --no-cache-dir '.[embeddings]'; else pip install --no-cache-dir .; fi
COPY alembic.ini ./
COPY alembic ./alembic
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec python -m app.start"]
