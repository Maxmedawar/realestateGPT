from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
import openai
import os
from dotenv import load_dotenv

# Load API key from .env or Replit secrets
load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
async def serve_html():
    with open("chatbot.html", "r") as f:
        return f.read()

@app.post("/ask")
async def ask_question(request: Request):
    data = await request.json()
    question = data.get("question")

    # Send to GPT-4
    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[
            {
                "role": "system",
                "content": "You are Cherif Medawar. Answer real estate questions like him: confident, experienced, strategic, and clear. Keep answers straight to the point, like you’re talking to an investor."
            },
            {
                "role": "user",
                "content": question
            }
        ]
    )

    answer = response["choices"][0]["message"]["content"]
    return JSONResponse({"answer": answer})
