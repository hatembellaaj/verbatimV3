# Service d'embeddings — FastAPI + sentence-transformers
# Modèle : OrdalieTech/Solon-embeddings-base-0.1 (français, ~440 Mo, 768 dim)
# Endpoints :
#   GET  /health → état + dim du modèle
#   POST /embed  → encode un batch de textes, retourne les vecteurs

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List
import os
import time

MODEL_NAME = os.getenv("MODEL_NAME", "OrdalieTech/Solon-embeddings-base-0.1")
MAX_BATCH = int(os.getenv("MAX_BATCH", "256"))

app = FastAPI(title="DORIA Embed Service")

print(f"[embed] Loading model {MODEL_NAME}...", flush=True)
_t0 = time.time()
model = SentenceTransformer(MODEL_NAME)
DIM = model.get_sentence_embedding_dimension()
print(f"[embed] Model loaded in {time.time()-_t0:.1f}s — dim={DIM}", flush=True)


class EmbedRequest(BaseModel):
    texts: List[str]
    normalize: bool = True  # normalisation L2 → similarité cosinus = produit scalaire


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "dim": DIM, "max_batch": MAX_BATCH}


@app.post("/embed")
def embed(req: EmbedRequest):
    if not req.texts:
        return {"embeddings": [], "model": MODEL_NAME, "dim": DIM}
    if len(req.texts) > MAX_BATCH:
        raise HTTPException(
            status_code=413,
            detail=f"Batch trop grand ({len(req.texts)} > {MAX_BATCH})",
        )
    t0 = time.time()
    vectors = model.encode(
        req.texts,
        normalize_embeddings=req.normalize,
        show_progress_bar=False,
        batch_size=32,
        convert_to_numpy=True,
    )
    elapsed = time.time() - t0
    print(f"[embed] {len(req.texts)} texts → {elapsed:.2f}s ({len(req.texts)/elapsed:.0f}/s)", flush=True)
    return {
        "embeddings": vectors.tolist(),
        "model": MODEL_NAME,
        "dim": int(vectors.shape[1]),
        "elapsed_ms": int(elapsed * 1000),
    }
