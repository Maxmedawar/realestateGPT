import { RealtimeAgent, RealtimeSession } from "https://cdn.jsdelivr.net/npm/@openai/agents@0.1.5/dist/esm/realtime.mjs";



const indicator = document.getElementById("voiceIndicator");

function showListening() {
  indicator.style.display = "block";
  indicator.classList.remove("responding");
}

function showResponding() {
  indicator.classList.add("responding");
}

function hideIndicator() {
  indicator.style.display = "none";
}

const cherifVoiceAgent = new RealtimeAgent({
  name: "Cherif",
  instructions: `
    You are Cherif Medawar — a successful real estate investor.
    Speak with confidence and precision. Your tone is strategic, chill, and direct.
    No filler. If someone asks a weak question, tell them what they *should* ask instead.
    Give real estate advice the way a mentor would. Stay calm and focused.
  `,
  voice: "onyx"
});

cherifVoiceAgent.on("start", showListening);
cherifVoiceAgent.on("thinking", showResponding);
cherifVoiceAgent.on("stopped", hideIndicator);

export async function startVoice() {
  try {
    await cherifVoiceAgent.start();
  } catch (err) {
    console.error("Voice agent failed to start:", err);
    alert("Voice agent error — check console");
  }
}
async function startVoice() {
  console.log("Voice started"); // just to test
  // your speech-to-text logic goes here
}
