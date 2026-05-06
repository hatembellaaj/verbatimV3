# Service embeddings — Python 3.11 slim + sentence-transformers
# Le modèle est téléchargé au build time (~440 Mo) et baké dans l'image
# pour avoir un startup instantané au runtime.

FROM python:3.11-slim

WORKDIR /app

# Outils minimaux pour pip + nettoyage immédiat
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Torch CPU-only — installé séparément depuis l'index PyTorch CPU pour réduire
# drastiquement la taille de l'image (1.5 Go évités vs torch GPU par défaut).
RUN pip install --no-cache-dir \
        torch==2.2.2 \
        --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pré-téléchargement du modèle Solon (à la place du téléchargement au boot)
ENV HF_HOME=/app/.cache/huggingface
ENV SENTENCE_TRANSFORMERS_HOME=/app/.cache/huggingface
RUN python -c "from sentence_transformers import SentenceTransformer; \
SentenceTransformer('OrdalieTech/Solon-embeddings-base-0.1')"

COPY app.py .

ENV PORT=8000
ENV MODEL_NAME=OrdalieTech/Solon-embeddings-base-0.1

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
