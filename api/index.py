from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
import stripe
import os
from typing import List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.post("/ask")
async def ask(request: Request):
    data = await request.json()
    question = data.get("question", "")

    async def generate():
        stream = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful real estate assistant."},
                {"role": "user", "content": question}
            ],
            stream=True
        )
        async for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    return StreamingResponse(generate(), media_type="text/plain")

@app.post("/upload")
async def upload(files: List[UploadFile] = File(...)):
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Too many files (max 10)")
    meta = [{"filename": f.filename, "content_type": f.content_type} for f in files]
    return {"files": meta}

@app.post("/billing/status")
async def billing_status():
    return {"plan": "NONE"}

@app.post("/billing/create-setup-intent")
async def create_setup_intent():
    intent = stripe.SetupIntent.create()
    return {"client_secret": intent.client_secret}

@app.post("/billing/subscribe")
async def subscribe():
    return {"status": "ok"}

@app.post("/billing/cancel")
async def cancel():
    return {"status": "canceled"}
