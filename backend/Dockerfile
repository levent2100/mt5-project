FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install required library dependencies directly
RUN pip install --no-cache-dir fastapi websockets "uvicorn[standard]" httpx pydantic

# Copy the backend code into the backend subfolder
COPY . ./backend

# Expose FastAPI central communication port
EXPOSE 9999

# Boot FastAPI server
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "9999"]
